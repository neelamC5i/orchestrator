"""
Pipeline control-plane routes.
GET   /api/v1/pipeline/{job_id}/state           — full node topology with per-node status
PATCH /api/v1/pipeline/{job_id}/config          — write thresholds to Redis pipeline_config:{job_id}
POST  /api/v1/pipeline/{job_id}/approve/{step}  — set Redis gate:{job_id}:{step}=approved
POST  /api/v1/pipeline/{job_id}/pause           — set Redis pipeline_pause:{job_id}=1
POST  /api/v1/pipeline/{job_id}/resume          — delete that key
GET   /api/v1/pipeline/{job_id}/entities/preview — top-20 entities from graph
GET   /api/v1/pipeline/{job_id}/layer/{layer_id} — per-layer artifact detail
GET   /api/v1/pipeline/{job_id}/kpis            — aggregate header KPIs
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/pipeline", tags=["pipeline"])

# ── Redis helpers ─────────────────────────────────────────────────────────────

def _get_redis():
    import redis as _redis
    from app.config import get_settings
    s = get_settings()
    return _redis.from_url(s.redis_url, decode_responses=True)


# ── Models ────────────────────────────────────────────────────────────────────

class PipelineConfigPatch(BaseModel):
    quality_threshold: float | None = None
    dedup_sensitivity: int | None = None
    selected_model: str | None = None
    gates_enabled: bool | None = None


# ── Node topology helper ──────────────────────────────────────────────────────

_STEP_STATUS_MAP = {
    "ingesting":        {"import": "running"},
    "deduplicating":    {"import": "done",    "clean":   "running"},
    "quality_scoring":  {"import": "done",    "clean":   "done",    "quality": "running"},
    "graph_building":   {"import": "done",    "clean":   "done",    "quality": "done",    "graph": "running"},
    "graph_done":       {"import": "done",    "clean":   "done",    "quality": "done",    "graph": "done"},
    "failed":           {},
}

def _build_topology(db_status: str) -> list[dict]:
    status_map = _STEP_STATUS_MAP.get(db_status, {})
    nodes = [
        {"id": "import",  "label": "Import Data",       "icon": "📥"},
        {"id": "clean",   "label": "Clean & Organize",   "icon": "🧹"},
        {"id": "quality", "label": "Readiness Check",    "icon": "📊"},
        {"id": "graph",   "label": "Knowledge Graph",    "icon": "🕸️"},
        {"id": "ai",      "label": "Select AI Models",   "icon": "🤖"},
        {"id": "answer",  "label": "Generate Answer",    "icon": "✨"},
    ]
    for node in nodes:
        node["status"] = status_map.get(node["id"], "pending")
    return nodes


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{job_id}/state")
async def get_state(job_id: str):
    """Return full pipeline topology with per-node statuses."""
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
    from sqlalchemy.pool import NullPool
    from sqlalchemy import text as sql_text
    from app.config import get_settings
    import json

    s = get_settings()
    engine = create_async_engine(s.database_url, echo=False, poolclass=NullPool)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with factory() as db:
        row = await db.execute(
            sql_text("SELECT status, progress FROM ingest_jobs WHERE job_id = :id"),
            {"id": job_id},
        )
        result = row.fetchone()

    await engine.dispose()

    if not result:
        raise HTTPException(status_code=404, detail="Job not found")

    db_status, progress_json = result
    progress = json.loads(progress_json) if progress_json else {}

    # Check Redis for gate states
    try:
        r = _get_redis()
        gate_states = {}
        for step in ["import", "clean", "quality", "graph", "model"]:
            val = r.get(f"gate:{job_id}:{step}")
            gate_states[step] = val or "pending"
        paused = r.exists(f"pipeline_pause:{job_id}") == 1
    except Exception:
        gate_states = {}
        paused = False

    topology = _build_topology(db_status)

    return {
        "job_id": job_id,
        "db_status": db_status,
        "overall_pct": progress.get("overall_pct", 0),
        "eta_seconds": progress.get("eta_seconds"),
        "nodes": topology,
        "gate_states": gate_states,
        "paused": paused,
    }


@router.patch("/{job_id}/config")
async def patch_config(job_id: str, body: PipelineConfigPatch):
    """Write pipeline config overrides to Redis (picked up by ingest task on next gate)."""
    try:
        r = _get_redis()
        import json
        existing_raw = r.get(f"pipeline_config:{job_id}")
        existing = json.loads(existing_raw) if existing_raw else {}
        patch = body.model_dump(exclude_none=True)
        existing.update(patch)
        r.set(f"pipeline_config:{job_id}", json.dumps(existing), ex=86400)
        return {"status": "ok", "config": existing}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/{job_id}/approve/{step}")
async def approve_gate(job_id: str, step: str):
    """Signal that the user has approved the gate for a given pipeline step."""
    valid = {"import", "clean", "quality", "graph", "model"}
    if step not in valid:
        raise HTTPException(status_code=400, detail=f"Invalid step. Must be one of: {valid}")
    try:
        r = _get_redis()
        r.set(f"gate:{job_id}:{step}", "approved", ex=3600)
        return {"status": "approved", "job_id": job_id, "step": step}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/{job_id}/pause")
async def pause_pipeline(job_id: str):
    """Pause the pipeline — ingest task will stop at next checkpoint."""
    try:
        r = _get_redis()
        r.set(f"pipeline_pause:{job_id}", "1", ex=3600)
        return {"status": "paused", "job_id": job_id}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/{job_id}/resume")
async def resume_pipeline(job_id: str):
    """Resume a paused pipeline."""
    try:
        r = _get_redis()
        r.delete(f"pipeline_pause:{job_id}")
        return {"status": "resumed", "job_id": job_id}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{job_id}/layer/{layer_id}")
async def get_layer_detail(job_id: str, layer_id: str):
    """Return per-layer artifact detail for the given pipeline layer."""
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
    from sqlalchemy.pool import NullPool
    from sqlalchemy import text as sql_text
    from app.config import get_settings
    import json, os, glob

    valid_layers = {
        "upload", "extract", "clean", "chunk", "metadata", "entities",
        "semantic", "eda", "validation", "ontology", "canonical",
        "graph_build", "graph_consist", "wiki",
    }
    if layer_id not in valid_layers:
        raise HTTPException(status_code=400, detail=f"Invalid layer_id. Must be one of: {valid_layers}")

    s = get_settings()
    engine = create_async_engine(s.database_url, echo=False, poolclass=NullPool)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with factory() as db:
        row = await db.execute(
            sql_text("SELECT metadata, progress FROM ingest_jobs WHERE job_id = :id"),
            {"id": job_id},
        )
        result = row.fetchone()

    await engine.dispose()

    if not result:
        raise HTTPException(status_code=404, detail="Job not found")

    meta_raw, progress_raw = result
    meta = json.loads(meta_raw) if isinstance(meta_raw, str) else (meta_raw or {})
    progress = json.loads(progress_raw) if isinstance(progress_raw, str) else (progress_raw or {})

    corpus_dir = meta.get("corpus_dir", f"corpus_store/{job_id}")
    processed_dir = os.path.join(corpus_dir, "processed")

    step_data = {}
    for st in progress.get("steps", []):
        if st.get("id") == layer_id:
            step_data = st
            break

    detail_str = step_data.get("detail", "{}")
    try:
        step_detail = json.loads(detail_str) if detail_str else {}
    except (json.JSONDecodeError, TypeError):
        step_detail = {"raw": detail_str}

    artifacts = {}

    def _safe_read_json(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    if layer_id == "upload":
        artifacts = step_detail

    elif layer_id == "extract":
        corpus_files = glob.glob(os.path.join(processed_dir, "*_corpus.json"))
        artifacts = {
            **step_detail,
            "corpus_files": [os.path.basename(f) for f in corpus_files],
        }

    elif layer_id in ("clean", "chunk"):
        artifacts = step_detail

    elif layer_id == "metadata":
        artifacts = step_detail

    elif layer_id == "entities":
        graph_path = os.path.join(corpus_dir, "knowledge_graph.json")
        graph_data = _safe_read_json(graph_path)
        entity_sample = []
        rel_sample = []
        if graph_data:
            nodes = graph_data.get("nodes", [])
            edges = graph_data.get("edges", [])
            entity_sample = sorted(nodes, key=lambda n: n.get("weight", 0), reverse=True)[:30]
            rel_sample = edges[:30]
        artifacts = {
            **step_detail,
            "entity_sample": entity_sample,
            "relationship_sample": rel_sample,
        }

    elif layer_id == "semantic":
        artifacts = step_detail

    elif layer_id == "eda":
        eda_files = glob.glob(os.path.join(processed_dir, "*_eda_summary.json"))
        scorecard_files = glob.glob(os.path.join(processed_dir, "*_kg_scorecard.json"))
        eda_summaries = [_safe_read_json(f) for f in eda_files if _safe_read_json(f)]
        scorecards = [_safe_read_json(f) for f in scorecard_files if _safe_read_json(f)]
        artifacts = {
            **step_detail,
            "eda_summaries": eda_summaries[:5],
            "scorecards": scorecards[:5],
        }

    elif layer_id == "validation":
        scorecard_files = glob.glob(os.path.join(processed_dir, "*_kg_scorecard.json"))
        scorecards = [_safe_read_json(f) for f in scorecard_files if _safe_read_json(f)]
        artifacts = {**step_detail, "scorecards": scorecards[:5]}

    elif layer_id == "ontology":
        graph_val_files = glob.glob(os.path.join(processed_dir, "*_graph_validation.json"))
        validations = [_safe_read_json(f) for f in graph_val_files if _safe_read_json(f)]
        artifacts = {**step_detail, "validations": validations[:5]}

    elif layer_id == "canonical":
        reg_path = os.path.join(corpus_dir, "canonical_registry.json")
        reg = _safe_read_json(reg_path)
        artifacts = {
            **step_detail,
            "registry_summary": {
                "total_nodes": len(reg.get("nodes", [])) if reg else 0,
                "total_aliases": sum(len(n.get("aliases", [])) for n in (reg or {}).get("nodes", [])),
            } if reg else {},
        }

    elif layer_id == "graph_build":
        graph_path = os.path.join(corpus_dir, "canonical_graph.json")
        graph = _safe_read_json(graph_path)
        if graph:
            nodes = graph.get("nodes", [])
            edges = graph.get("edges", [])
            artifacts = {
                **step_detail,
                "node_count": len(nodes),
                "edge_count": len(edges),
                "node_sample": nodes[:20],
                "edge_sample": edges[:20],
            }
        else:
            artifacts = step_detail

    elif layer_id == "graph_consist":
        artifacts = step_detail

    elif layer_id == "wiki":
        wiki_dir = os.path.join(corpus_dir, "wiki")
        wiki_count = 0
        wiki_pages = []
        if os.path.isdir(wiki_dir):
            for wp in os.listdir(wiki_dir):
                if wp.endswith(".json"):
                    wiki_count += 1
                    wiki_pages.append(wp.replace(".json", ""))
        artifacts = {
            **step_detail,
            "wiki_page_count": wiki_count,
            "wiki_pages_sample": wiki_pages[:20],
        }

    return {
        "job_id": job_id,
        "layer_id": layer_id,
        "label": step_data.get("label", layer_id),
        "status": step_data.get("status", "pending"),
        "started_at": step_data.get("started_at"),
        "completed_at": step_data.get("completed_at"),
        "error_code": step_data.get("error_code"),
        "artifacts": artifacts,
    }


@router.get("/{job_id}/kpis")
async def get_pipeline_kpis(job_id: str):
    """Return aggregate header KPIs for the pipeline dashboard."""
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
    from sqlalchemy.pool import NullPool
    from sqlalchemy import text as sql_text
    from app.config import get_settings
    import json, os

    s = get_settings()
    engine = create_async_engine(s.database_url, echo=False, poolclass=NullPool)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with factory() as db:
        row = await db.execute(
            sql_text("SELECT metadata, progress FROM ingest_jobs WHERE job_id = :id"),
            {"id": job_id},
        )
        result = row.fetchone()

    await engine.dispose()

    if not result:
        raise HTTPException(status_code=404, detail="Job not found")

    meta_raw, progress_raw = result
    meta = json.loads(meta_raw) if isinstance(meta_raw, str) else (meta_raw or {})
    progress = json.loads(progress_raw) if isinstance(progress_raw, str) else (progress_raw or {})

    corpus_dir = meta.get("corpus_dir", f"corpus_store/{job_id}")

    kpis = {
        "entities": 0, "relationships": 0, "graph_nodes": 0,
        "trust_score": 0.0, "ontology_consistency": 0,
    }

    for st in progress.get("steps", []):
        try:
            d = json.loads(st.get("detail", "{}")) if st.get("detail") else {}
        except (json.JSONDecodeError, TypeError):
            d = {}

        if st["id"] == "entities":
            kpis["entities"] = d.get("entity_count", 0)
            kpis["relationships"] = d.get("relationship_count", 0)
        elif st["id"] == "graph_build":
            kpis["graph_nodes"] = d.get("graph_nodes", 0)
        elif st["id"] == "validation":
            kpis["trust_score"] = d.get("avg_trust_score", 0.0)
        elif st["id"] == "ontology":
            kpis["ontology_consistency"] = d.get("ontology_violations", 0)

    graph_path = os.path.join(corpus_dir, "canonical_graph.json")
    if os.path.exists(graph_path):
        try:
            with open(graph_path, encoding="utf-8") as f:
                graph = json.load(f)
            kpis["graph_nodes"] = kpis["graph_nodes"] or len(graph.get("nodes", []))
        except Exception:
            pass

    return {"job_id": job_id, "kpis": kpis}


@router.get("/{job_id}/entities/preview")
async def entities_preview(job_id: str, limit: int = 20):
    """Return top entities from the knowledge graph for the given job."""
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
    from sqlalchemy.pool import NullPool
    from sqlalchemy import text as sql_text
    from app.config import get_settings
    import json

    s = get_settings()
    engine = create_async_engine(s.database_url, echo=False, poolclass=NullPool)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with factory() as db:
        row = await db.execute(
            sql_text("SELECT graph_path FROM ingest_jobs WHERE job_id = :id"),
            {"id": job_id},
        )
        result = row.fetchone()

    await engine.dispose()

    if not result or not result[0]:
        raise HTTPException(status_code=404, detail="Graph not available yet")

    import os
    graph_path = result[0]
    if not os.path.exists(graph_path):
        raise HTTPException(status_code=404, detail="Graph file not found")

    try:
        with open(graph_path) as f:
            graph = json.load(f)
        nodes = graph.get("nodes", [])
        # Sort by degree/weight if available
        nodes_sorted = sorted(nodes, key=lambda n: n.get("weight", 0), reverse=True)
        top = [n.get("label", n.get("id", "")) for n in nodes_sorted[:limit]]
        return {"job_id": job_id, "entities": top, "total": len(nodes)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
