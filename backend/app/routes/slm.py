"""
SLM registry management routes.
GET  /api/v1/slm/registry — list all registered SLMs
POST /api/v1/slm/build — trigger manual SLM build
POST /api/v1/slm/approve-install — approve Ollama deployment after review
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.modules.slm_factory.slm_registry import SLMRegistry
from app.adapters.registry import get_adapter_registry
from app.config import get_settings
from app.schemas import SLMStatusResponse, SLMStatsResponse, SLMForCorpusResponse

settings = get_settings()
router = APIRouter(prefix="/slm", tags=["slm"])


class BuildRequest(BaseModel):
    domain_label: str
    coverage_topics: list[str] = Field(default_factory=list)
    corpus_hash: str = ""
    trigger_query: str = ""
    quick_rebuild: bool = False            # reuse existing QA pairs, skip teacher synthesis
    # SLM Studio configurable fields
    teacher_model: str | None = None       # override default teacher (e.g. "mistral:latest")
    advisor_model: str | None = None       # optional advisor for critique pass
    student_model: str | None = None       # override auto-selection (e.g. "SmolLM2-1.7B")
    qa_pairs_target: int | None = None     # target Q&A pairs (3000–15000)
    lora_r: int | None = None              # LoRA rank (4–64)
    lora_alpha: int | None = None          # LoRA alpha
    num_epochs: int | None = None          # training epochs (1–10)
    learning_rate: float | None = None     # e.g. 2e-4
    curriculum_stages: int | None = None   # multi-stage curriculum steps (1–5)


class ApproveInstallRequest(BaseModel):
    model_id: str


@router.get("/registry")
async def list_registry(db: AsyncSession = Depends(get_db)):
    registry = SLMRegistry(db)
    records = await registry.list_all()
    return {"slms": records, "count": len(records)}


@router.post("/build")
async def trigger_build(request: BuildRequest, db: AsyncSession = Depends(get_db)):
    """Queue an SLM build via Celery. Skips if same corpus already built (dedup)."""
    try:
        registry = SLMRegistry(db)

        # ── Deduplication: skip full build if SLM already exists for this corpus ──
        if request.corpus_hash and not request.quick_rebuild:
            existing = await registry.find_by_corpus_hash(request.corpus_hash)
            if existing:
                return {
                    "status": "exists",
                    "model_id": existing["model_id"],
                    "ollama_model_name": existing.get("ollama_model_name"),
                    "model_path": existing.get("model_path"),
                    "task_id": None,
                }

        # ── Quick rebuild: locate cached QA pairs from prior build ────
        qa_pairs_path: str | None = None
        if request.quick_rebuild and request.corpus_hash:
            prior = await registry.find_by_corpus_hash(request.corpus_hash)
            if prior and prior.get("model_path"):
                from pathlib import Path as _Path
                candidate = _Path(prior["model_path"]) / "train.jsonl"
                if candidate.exists():
                    qa_pairs_path = str(candidate)

        from app.tasks.slm_build_task import run_slm_build
        slm_config = {
            "teacher_model":     request.teacher_model,
            "advisor_model":     request.advisor_model,
            "student_model":     request.student_model,
            "qa_pairs_target":   request.qa_pairs_target,
            "lora_r":            request.lora_r,
            "lora_alpha":        request.lora_alpha,
            "num_epochs":        request.num_epochs,
            "learning_rate":     request.learning_rate,
            "curriculum_stages": request.curriculum_stages,
        }
        job = run_slm_build.delay(
            request.domain_label,
            request.coverage_topics,
            request.corpus_hash,
            request.trigger_query,
            slm_config,
            qa_pairs_path,
        )
        return {
            "task_id": job.id,
            "status": "queued",
            "quick_rebuild": request.quick_rebuild,
            "qa_pairs_reused": qa_pairs_path is not None,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/for-corpus", response_model=SLMForCorpusResponse)
async def slm_for_corpus(job_id: str, db: AsyncSession = Depends(get_db)):
    """Return the most recent SLM built for a corpus (by job_id), or not-found."""
    registry = SLMRegistry(db)
    record = await registry.find_by_corpus_hash(job_id)
    if record:
        return {
            "exists": True,
            "model_id": record["model_id"],
            "domain_label": record["domain_label"],
            "ollama_model_name": record.get("ollama_model_name"),
            "model_path": record.get("model_path"),
            "val_loss": record.get("val_loss"),
        }
    return {"exists": False}


@router.post("/approve-install")
async def approve_install(request: ApproveInstallRequest, db: AsyncSession = Depends(get_db)):
    """
    After user reviews the SLM, approve deployment to Ollama.
    Triggers `ollama create` with the stored Modelfile.
    """
    registry = SLMRegistry(db)
    record = await registry.get(request.model_id)
    if not record:
        raise HTTPException(status_code=404, detail="SLM not found")

    adapter_registry = get_adapter_registry()
    adapter = adapter_registry.get_ollama()
    if not await adapter.is_available():
        raise HTTPException(status_code=503, detail="Ollama not available")

    from pathlib import Path
    from app.modules.slm_factory.slm_store import SLMStore
    store = SLMStore(settings.slm_store_path)
    modelfile_path = Path(store.model_dir(request.model_id)) / "Modelfile"

    if not modelfile_path.exists():
        raise HTTPException(status_code=404, detail="Modelfile not found")

    try:
        await adapter.create_model(request.model_id, str(modelfile_path))
        return {"status": "deployed", "model_id": request.model_id, "ollama_name": request.model_id}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/status", response_model=SLMStatusResponse)
async def slm_status(
    domain_label: str,
    task_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Return build status for the most recent SLM in a domain."""
    registry = SLMRegistry(db)
    records = await registry.list_all()
    domain_records = [r for r in records if r.get("domain_label") == domain_label]
    if domain_records:
        latest = sorted(domain_records, key=lambda r: str(r.get("created_at") or ""), reverse=True)[0]
        return {"status": "done", "model_id": latest.get("model_id"), "domain_label": domain_label}
    # Check Celery task state if task_id supplied
    if task_id:
        try:
            from app.tasks import celery_app
            result = celery_app.AsyncResult(task_id)
            if result.state == "FAILURE":
                return {"status": "failed", "model_id": None, "domain_label": domain_label}
            if result.state == "PENDING":
                return {"status": "queued", "model_id": None, "domain_label": domain_label}
            if result.state in ("STARTED", "RETRY"):
                return {"status": "running", "model_id": None, "domain_label": domain_label}
        except Exception:
            pass
    return {"status": "none", "model_id": None, "domain_label": domain_label}


@router.get("/suggestions")
async def slm_suggestions(
    domain_label: str,
    job_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Return 10 rich suggestion objects for the domain, powered by SLM or fallback templates.
    Each suggestion: {"label": str, "desc": str, "prompt": str}
    Optional job_id injects top entities from the corpus into the prompt for grounded suggestions.
    """
    import json as _json

    # ── Gather top entity hints from corpus (optional, enhances prompt) ────────
    entity_hint = ""
    if job_id:
        try:
            from sqlalchemy import text as _t
            from pathlib import Path as _P
            row = (await db.execute(
                _t("SELECT graph_path, metadata FROM ingest_jobs WHERE job_id = :id"),
                {"id": job_id},
            )).mappings().first()
            if row:
                corpus_dir = None
                if row.get("graph_path"):
                    corpus_dir = str(_P(row["graph_path"]).parent.parent)
                elif row.get("metadata"):
                    meta = row["metadata"]
                    if isinstance(meta, str):
                        meta = _json.loads(meta)
                    corpus_dir = (meta or {}).get("corpus_dir")
                if corpus_dir:
                    wiki_dir = _P(corpus_dir) / "graphify-out" / "wiki"
                    entities: list[str] = []
                    if wiki_dir.exists():
                        import re as _re
                        for mdf in sorted(wiki_dir.glob("*.md"))[:5]:
                            raw = mdf.read_text(encoding="utf-8", errors="replace")
                            title_m = _re.search(r"^# (.+)$", raw, _re.MULTILINE)
                            if title_m:
                                entities.append(title_m.group(1).strip())
                    if entities:
                        entity_hint = f" Key topics found in the data: {', '.join(entities[:6])}."
        except Exception:
            pass

    # ── Try SLM (trained Ollama model for this domain) ─────────────────────────
    registry = SLMRegistry(db)
    records = await registry.list_all()
    domain_records = [r for r in records if r.get("domain_label") == domain_label]
    if domain_records:
        latest = sorted(domain_records, key=lambda r: str(r.get("created_at") or ""), reverse=True)[0]
        ollama_model = latest.get("ollama_model_name")
        if ollama_model:
            try:
                adapter_registry = get_adapter_registry()
                ollama = adapter_registry.get_ollama()
                if await ollama.is_available():
                    prompt = (
                        f'You are an expert analyst on "{domain_label}" data.{entity_hint} '
                        f'List exactly 10 specific, actionable analyses a user can perform on this {domain_label} corpus. '
                        "Each analysis must be concrete, descriptive, and produce a useful business or technical insight. "
                        "Return ONLY a valid JSON array of exactly 10 objects. Each object must have exactly these keys: "
                        '"label" (5-7 word title), "desc" (one sentence describing what the analysis reveals), '
                        '"prompt" (2-3 sentence detailed prompt that a user would send to an AI to perform this analysis). '
                        'No markdown, no explanation, no text outside the JSON array. '
                        'Example format: [{"label": "Identify top risk factors", "desc": "Surface the highest-impact risks hidden in your data.", "prompt": "Analyze the corpus and identify the top 5 risk factors. For each risk, explain its likelihood, potential impact, and recommended mitigation strategy."}, ...]'
                    )
                    raw = await ollama.generate(ollama_model, prompt, stream=False, max_tokens=1024)
                    # Extract the first JSON array
                    start = raw.find("[")
                    end = raw.rfind("]") + 1
                    if start != -1 and end > start:
                        parsed = _json.loads(raw[start:end])
                        if isinstance(parsed, list) and len(parsed) >= 3:
                            # Normalise: accept both {label,desc,prompt} objects and plain strings
                            suggestions = []
                            for item in parsed[:10]:
                                if isinstance(item, dict) and item.get("label") and item.get("prompt"):
                                    suggestions.append({
                                        "label":  str(item["label"])[:80],
                                        "desc":   str(item.get("desc", ""))[:200],
                                        "prompt": str(item["prompt"])[:600],
                                    })
                                elif isinstance(item, str) and item.strip():
                                    # Fallback: plain string — derive label from first few words
                                    words = item.strip().split()
                                    suggestions.append({
                                        "label":  " ".join(words[:6]),
                                        "desc":   item[:200],
                                        "prompt": item,
                                    })
                            if len(suggestions) >= 3:
                                return {"suggestions": suggestions, "source": "slm", "model_id": ollama_model}
            except Exception:
                pass

    # ── Fallback: rich domain-aware templates ──────────────────────────────────
    d = domain_label.replace("-", " ").replace("_", " ")
    fallback = [
        {"label": f"Key trends in {d[:20]}",         "desc": f"Discover dominant patterns and trends across the {d} dataset.",                          "prompt": f"Analyze the key trends and patterns in the {d} data. Identify what is increasing, decreasing, or changing over time. Explain the significance of each trend and what it means for decision-making."},
        {"label": "Anomaly & outlier detection",      "desc": f"Flag unusual values and statistical outliers that warrant attention in {d}.",             "prompt": f"Scan the {d} dataset for anomalies, outliers, and unexpected values. For each anomaly found, explain what it is, why it is unusual, and what action should be taken."},
        {"label": "Top performance drivers",          "desc": f"Identify which factors most strongly influence performance in {d}.",                       "prompt": f"Identify the top 5 performance drivers in the {d} data. For each driver, quantify its impact and explain how it can be optimized or leveraged for better outcomes."},
        {"label": "Risk factor analysis",             "desc": f"Surface hidden risks and vulnerabilities present in the {d} corpus.",                      "prompt": f"Analyze the {d} corpus and identify the main risk factors. For each risk, assess its likelihood, potential impact, and recommend a mitigation strategy."},
        {"label": "Build predictive dashboard",       "desc": f"Create an AI-powered dashboard that forecasts future {d} outcomes.",                       "prompt": f"Design and describe an AI-powered analytics dashboard for {d}. Specify the key KPIs to track, the predictive models to use, and how the dashboard should alert users to emerging trends or risks."},
        {"label": "Actionable insight summary",       "desc": f"Condense the most valuable findings from the {d} corpus into executive-ready insights.",   "prompt": f"Summarize the most important actionable insights from the {d} data. Present each insight with supporting evidence, business implication, and a recommended next step. Format for an executive audience."},
        {"label": "Process improvement roadmap",      "desc": f"Design a step-by-step improvement plan based on {d} findings.",                            "prompt": f"Based on the {d} data, design a practical process improvement roadmap. Identify the 3-5 highest-impact improvement opportunities, prioritize them, and outline concrete implementation steps for each."},
        {"label": "Comparative benchmarking",         "desc": f"Compare performance segments, time periods, or categories within {d}.",                    "prompt": f"Perform a comparative analysis of the {d} dataset. Identify the best and worst performing segments, compare them across key metrics, and explain what separates top performers from the rest."},
        {"label": "Compliance & gap audit",           "desc": f"Check {d} data against policies, standards, or regulatory requirements.",                  "prompt": f"Audit the {d} corpus against relevant policies, standards, or compliance requirements. Identify gaps, non-conformances, and areas of risk. Provide a prioritized remediation plan."},
        {"label": "Strategic recommendation report",  "desc": f"Generate a board-level strategic report grounded in the {d} evidence.",                    "prompt": f"Generate a strategic recommendation report from the {d} data. Include an executive summary, 3-5 key findings with evidence, strategic implications, and a prioritized list of recommended actions for leadership."},
    ]
    return {"suggestions": fallback, "source": "fallback"}


@router.get("/stats", response_model=SLMStatsResponse)
async def get_stats(db: AsyncSession = Depends(get_db)):
    """Aggregate stats used by dashboard."""
    registry = SLMRegistry(db)
    records = await registry.list_all()
    total_queries = sum(getattr(r, "query_count", 0) for r in records)
    return {
        "active_slms": len(records),
        "tokens_saved": total_queries * 120,  # rough estimate
        "files_ingested": 0,
        "cost_saved": round(total_queries * 0.002, 2),
    }


@router.get("/learning-progress")
async def learning_progress(db: AsyncSession = Depends(get_db)):
    """Return per-model bandit learning progress for dashboard visualization."""
    import json
    from pathlib import Path

    registry = SLMRegistry(db)
    records = await registry.list_all()

    result = []
    bandit_path = Path(settings.slm_store_path) / "bandit_state.json"
    bandit_data: dict = {}
    if bandit_path.exists():
        try:
            bandit_data = json.loads(bandit_path.read_text())
        except Exception:
            pass

    for r in records:
        # list_all() returns list[dict] — use .get(), not getattr()
        model_id = r.get("model_id") or "unknown"
        query_count = r.get("query_count") or 0
        hallucination_rate = r.get("hallucination_rate") or 0.0
        val_loss = r.get("val_loss")
        task_completion_rate = r.get("task_completion_rate") or 0.85

        # Bandit convergence check: if arm exists in bandit state
        arm = bandit_data.get(model_id, {})
        converged = False
        if arm and query_count > 20:
            # Heuristic: b-vector norm growth rate slows at convergence
            converged = query_count > 50

        accuracy = round((1.0 - hallucination_rate) * 100, 1)
        reward = round(0.50 * task_completion_rate + 0.35 * (1.0 - hallucination_rate) + 0.15 * 0.9, 3)

        result.append({
            "model_id": model_id,
            "query_count": query_count,
            "accuracy_pct": accuracy,
            "val_loss": val_loss,
            "task_completion_rate": task_completion_rate,
            "hallucination_rate": hallucination_rate,
            "reward": reward,
            "converged": converged,
        })

    # Overall summary
    total_queries = sum(r["query_count"] for r in result)
    avg_accuracy = round(sum(r["accuracy_pct"] for r in result) / max(len(result), 1), 1)
    any_converged = any(r["converged"] for r in result)

    return {
        "models": result,
        "summary": {
            "total_queries": total_queries,
            "avg_accuracy_pct": avg_accuracy,
            "any_converged": any_converged,
            "active_models": len(result),
        },
    }
