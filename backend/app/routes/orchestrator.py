"""
POST /api/v1/orchestrator/ask — SSE streaming endpoint.
Holds query open while SLM builds if needed (no fallback).
"""
import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.adapters.registry import get_adapter_registry
from app.modules.orchestrator.orchestrator import Orchestrator
from app.modules.slm_factory.slm_registry import SLMRegistry
from app.modules.slm_factory.slm_store import SLMStore
from app.config import get_settings

settings = get_settings()
router = APIRouter(prefix="/orchestrator", tags=["orchestrator"])


class ModelWeights(BaseModel):
    """User-configurable composite scoring weights. Must sum to 1.0 (enforced by normalisation)."""
    benchmark: float = Field(0.30, ge=0.0, le=1.0)
    availability: float = Field(0.20, ge=0.0, le=1.0)
    bandit: float = Field(0.20, ge=0.0, le=1.0)
    speed: float = Field(0.15, ge=0.0, le=1.0)
    ctx_fit: float = Field(0.10, ge=0.0, le=1.0)
    task_fit: float = Field(0.05, ge=0.0, le=1.0)

    def normalised(self) -> "ModelWeights":
        """Return a copy with weights re-normalised to sum to 1.0."""
        total = self.benchmark + self.availability + self.bandit + self.speed + self.ctx_fit + self.task_fit
        if total <= 0:
            return ModelWeights()
        f = 1.0 / total
        return ModelWeights(
            benchmark=self.benchmark * f,
            availability=self.availability * f,
            bandit=self.bandit * f,
            speed=self.speed * f,
            ctx_fit=self.ctx_fit * f,
            task_fit=self.task_fit * f,
        )


class AskRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=4096)
    session_id: str | None = None
    job_id: str | None = None          # if provided, load graph context from ingest job
    graph_context: str = ""
    wiki_articles: list[dict] = Field(default_factory=list)
    domain_label: str = "general"
    coverage_topics: list[str] = Field(default_factory=list)
    corpus_hash: str = ""
    system_prompt: str = ""           # optional user-defined persona / constraints
    model_overrides: dict | None = None  # optional {task_type: model_name} overrides from SLM Studio
    scoring_weights: ModelWeights = Field(default_factory=ModelWeights)  # user-tunable LLM scoring


async def _get_embedding(text: str) -> list[float]:
    """Use nomic-embed-text via Ollama if available, else zero vector."""
    try:
        registry = get_adapter_registry()
        adapter = registry.get_ollama()
        if adapter:
            r = await adapter._client.post(
                "/api/embeddings",
                json={"model": "nomic-embed-text", "prompt": text},
            )
            r.raise_for_status()
            return r.json().get("embedding", [0.0] * settings.embedding_dim)
    except Exception:
        pass
    return [0.0] * settings.embedding_dim


@router.post("/ask")
async def ask(request: AskRequest, db: AsyncSession = Depends(get_db)):
    import json as _json
    from pathlib import Path
    from sqlalchemy import text

    registry = get_adapter_registry()
    slm_registry = SLMRegistry(db)
    slm_store = SLMStore(settings.slm_store_path)

    # Load graph context + wiki articles from ingest job if job_id provided
    graph_context = request.graph_context
    wiki_articles = request.wiki_articles
    domain_label = request.domain_label
    coverage_topics = request.coverage_topics
    corpus_hash = request.corpus_hash

    if request.job_id:
        try:
            row = (await db.execute(
                text("SELECT graph_path, corpus_path, domain_label, metadata FROM ingest_jobs WHERE job_id = :id"),
                {"id": request.job_id},
            )).mappings().first()
            if row:
                domain_label = row["domain_label"] or domain_label
                # Load graph context from graph.json
                graph_path = row["graph_path"]
                if graph_path and Path(graph_path).exists():
                    g_data = _json.loads(Path(graph_path).read_text(encoding="utf-8"))
                    nodes = g_data.get("nodes", [])
                    edges = g_data.get("edges", [])
                    graph_context = (
                        f"Knowledge Graph: {len(nodes)} entities, {len(edges)} relationships.\n"
                        + "\n".join(f"- {n.get('label', n.get('id', ''))} ({n.get('type', '')})" for n in nodes[:60])
                    )
                    coverage_topics = list({n.get("type", "") for n in nodes if n.get("type")})[:10]
                # Load wiki articles from graphify-out/wiki/
                meta = row["metadata"] or {}
                if isinstance(meta, str):
                    meta = _json.loads(meta)
                corpus_dir = meta.get("corpus_dir") or row.get("corpus_path") or ""
                if corpus_dir:
                    wiki_dir = Path(corpus_dir) / "graphify-out" / "wiki"
                    if wiki_dir.exists():
                        for md in sorted(wiki_dir.glob("*.md"))[:30]:
                            wiki_articles.append({"title": md.stem, "content": md.read_text(encoding="utf-8", errors="replace")})
        except Exception:
            pass  # non-fatal — proceed without context

    available = await registry.list_all_models()
    available_names = [m.model_id for m in available]

    import redis.asyncio as aioredis
    try:
        redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    except Exception:
        redis_client = None

    orchestrator = Orchestrator(
        adapter_registry=registry,
        slm_registry=slm_registry,
        slm_store=slm_store,
        embed_fn=_get_embedding,
        redis_client=redis_client,
    )

    query_embedding = await _get_embedding(request.query)
    session_id = request.session_id or str(uuid.uuid4())

    try:
        await db.execute(
            text("""
                INSERT INTO sessions (session_id, session_name, domain_tags, user_goal, corpus_path)
                VALUES (:sid, :name, :tags, :goal, :corpus)
                ON CONFLICT (session_id) DO UPDATE SET updated_at = NOW()
            """),
            {
                "sid": session_id,
                "name": request.query[:120],
                "tags": [domain_label],
                "goal": request.query,
                "corpus": request.job_id or "",
            },
        )
        await db.commit()
    except Exception:
        await db.rollback()

    async def event_stream():
        # ── Pre-stream: emit model_context so the UI knows what state the AI is in ──
        # This is the probabilistic transparency layer: every consumer of this stream
        # can see (a) whether semantic embeddings were available, (b) how many real
        # queries each model has seen, and (c) whether the system is still exploring.
        import numpy as np
        from app.modules.slm_factory.bandit import get_bandit
        embedding_available = any(v != 0.0 for v in query_embedding)
        if not embedding_available:
            _warn = json.dumps({
                "type": "warning",
                "code": "embedding_unavailable",
                "message": (
                    "Semantic similarity unavailable — results ranked by keyword match only. "
                    "Install nomic-embed-text via: ollama pull nomic-embed-text"
                ),
            })
            yield f"data: {_warn}\n\n"
        bandit = get_bandit()
        arm_context = []
        for m in available:
            arm = bandit._arms.get(m.model_id)
            if arm:
                try:
                    A_inv = np.linalg.inv(arm["A"])
                    theta = A_inv @ arm["b"]
                    # Observations = excess on A diagonal beyond identity scale=10
                    obs = max(0, round(float(np.mean(np.diag(arm["A"]))) - 10.0))
                    explore = float(np.sqrt(float(np.mean(np.diag(A_inv)))))
                    est_reward = round(float(np.mean(theta)), 4)
                    state = "Exploring" if obs < 20 else "Learning" if obs < 50 else "Confident"
                    arm_context.append({
                        "model_id": m.model_id,
                        "provider": m.provider,
                        "observations": obs,
                        "explore_width": round(explore, 5),
                        "estimated_reward": est_reward,
                        "state": state,
                    })
                except Exception:
                    pass  # singular matrix or other; skip this arm
        _ctx = json.dumps({
            "type": "model_context",
            "data": {
                "embedding_available": embedding_available,
                "arms": arm_context,
                "available_model_count": len(available),
            },
        })
        yield f"data: {_ctx}\n\n"

        import time as _time
        _started_ms = int(_time.time() * 1000)
        _last_event: dict[str, Any] = {}

        async for event in orchestrator.run(
            query=request.query,
            session_id=session_id,
            graph_context=graph_context,
            wiki_articles=wiki_articles,
            domain_label=domain_label,
            coverage_topics=coverage_topics,
            corpus_hash=corpus_hash,
            available_models=available_names,
            system_prompt=request.system_prompt,
            scoring_weights=request.scoring_weights.normalised(),
        ):
            _last_event = event
            yield f"data: {json.dumps(event)}\n\n"

        _elapsed_ms = int(_time.time() * 1000) - _started_ms
        try:
            await db.execute(
                text("""
                    INSERT INTO query_history
                        (session_id, query, task_category, task_type, slm_used,
                         response_summary, hallucination_rate, task_completion_rate,
                         latency_ms, token_count_in, token_count_out)
                    VALUES (:sid, :query, :cat, :ttype, :slm, :summary,
                            :halluc, :completion, :latency, :tok_in, :tok_out)
                """),
                {
                    "sid": session_id,
                    "query": request.query[:4096],
                    "cat": _last_event.get("domain_label") or domain_label,
                    "ttype": _last_event.get("task_type", ""),
                    "slm": _last_event.get("slm_model_id", ""),
                    "summary": (_last_event.get("answer") or "")[:1000],
                    "halluc": _last_event.get("hallucination_rate"),
                    "completion": _last_event.get("task_completion_rate"),
                    "latency": _elapsed_ms,
                    "tok_in": _last_event.get("token_count_in"),
                    "tok_out": _last_event.get("token_count_out"),
                },
            )
            await db.commit()
        except Exception:
            await db.rollback()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
