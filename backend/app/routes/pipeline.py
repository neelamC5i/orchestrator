"""
Pipeline control-plane routes.

The Processing UI should hydrate from /snapshot first, then consume SSE.
Existing endpoints remain for backward compatibility.
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.schemas import PipelineSnapshotResponse, PipelineKpisResponse, EntitiesPreviewResponse
from app.modules.pipeline.read_model import (
    TERMINAL_STATUSES,
    build_layer_artifacts,
    build_snapshot,
)

router = APIRouter(prefix="/pipeline", tags=["pipeline"])


class PipelineConfigPatch(BaseModel):
    quality_threshold: float | None = None
    dedup_sensitivity: int | None = None
    selected_model: str | None = None
    gates_enabled: bool | None = None


async def _job_row(job_id: str, db: AsyncSession) -> dict:
    row = (await db.execute(
        text("""
            SELECT job_id, status, progress, metadata, graph_path, file_count,
                   entity_count, community_count, domain_label, error_message,
                   error, created_at, completed_at
            FROM ingest_jobs
            WHERE job_id = :id
        """),
        {"id": job_id},
    )).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return dict(row)


def _get_redis():
    import redis as _redis
    from app.config import get_settings

    return _redis.from_url(get_settings().redis_url, decode_responses=True)


def _build_topology(layers: list[dict]) -> list[dict]:
    def group_status(ids: list[str]) -> str:
        statuses = [next((layer.get("status") for layer in layers if layer.get("id") == layer_id), "pending") for layer_id in ids]
        if any(status == "error" for status in statuses):
            return "error"
        if any(status == "running" for status in statuses):
            return "running"
        if statuses and all(status == "done" for status in statuses):
            return "done"
        return "pending"

    return [
        {"id": "import", "label": "Import Data", "icon": "import", "status": group_status(["upload", "extract"])},
        {"id": "clean", "label": "Clean & Organize", "icon": "clean", "status": group_status(["clean", "chunk", "metadata"])},
        {"id": "quality", "label": "Readiness Check", "icon": "quality", "status": group_status(["entities", "semantic", "eda", "validation"])},
        {"id": "graph", "label": "Knowledge Graph", "icon": "graph", "status": group_status(["ontology", "canonical", "graph_build", "graph_consist"])},
        {"id": "ai", "label": "Select AI Models", "icon": "ai", "status": "pending"},
        {"id": "answer", "label": "Generate Answer", "icon": "answer", "status": "pending"},
    ]


@router.get("/{job_id}/snapshot", response_model=PipelineSnapshotResponse)
async def get_snapshot(job_id: str, db: AsyncSession = Depends(get_db)):
    """Return the Processing page read model: progress, KPIs, previews, and logs."""
    row = await _job_row(job_id, db)
    return build_snapshot(job_id, row)


@router.get("/{job_id}/state")
async def get_state(job_id: str, db: AsyncSession = Depends(get_db)):
    """Return full pipeline topology with per-node statuses."""
    snapshot = build_snapshot(job_id, await _job_row(job_id, db))

    try:
        r = _get_redis()
        gate_states = {
            step: r.get(f"gate:{job_id}:{step}") or "pending"
            for step in ["import", "clean", "quality", "graph", "model"]
        }
        paused = r.exists(f"pipeline_pause:{job_id}") == 1
    except Exception:
        gate_states = {}
        paused = False

    return {
        "job_id": job_id,
        "db_status": snapshot["status"],
        "overall_pct": snapshot["overall_pct"],
        "eta_seconds": snapshot["eta_seconds"],
        "nodes": _build_topology(snapshot["layers"]),
        "gate_states": gate_states,
        "paused": paused,
    }


@router.patch("/{job_id}/config")
async def patch_config(job_id: str, body: PipelineConfigPatch):
    """Write pipeline config overrides to Redis."""
    try:
        r = _get_redis()
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
    """Pause the pipeline; workers will stop at the next checkpoint that checks Redis."""
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
async def get_layer_detail(job_id: str, layer_id: str, db: AsyncSession = Depends(get_db)):
    """Return per-layer artifact detail for the given pipeline layer."""
    row = await _job_row(job_id, db)
    snapshot = build_snapshot(job_id, row)
    valid_layers = {layer["id"] for layer in snapshot["layers"]}
    if layer_id not in valid_layers:
        raise HTTPException(status_code=400, detail=f"Invalid layer_id. Must be one of: {valid_layers}")

    layer = next((item for item in snapshot["layers"] if item.get("id") == layer_id), {})
    return {
        "job_id": job_id,
        "layer_id": layer_id,
        "label": layer.get("label", layer_id),
        "status": layer.get("status", "pending"),
        "started_at": layer.get("started_at"),
        "completed_at": layer.get("completed_at"),
        "error_code": layer.get("error_code"),
        "artifacts": build_layer_artifacts(job_id, layer_id, row),
    }


@router.get("/{job_id}/kpis", response_model=PipelineKpisResponse)
async def get_pipeline_kpis(job_id: str, db: AsyncSession = Depends(get_db)):
    """Return aggregate header KPIs for the pipeline dashboard."""
    snapshot = build_snapshot(job_id, await _job_row(job_id, db))
    return {"job_id": job_id, "kpis": snapshot["kpis"]}


@router.get("/{job_id}/entities/preview", response_model=EntitiesPreviewResponse)
async def entities_preview(job_id: str, limit: int = 20, db: AsyncSession = Depends(get_db)):
    """Return top entities from the knowledge graph for the given job."""
    snapshot = build_snapshot(job_id, await _job_row(job_id, db))
    entities = snapshot["previews"].get("entities", [])[:limit]
    total = snapshot["previews"].get("kg", {}).get("graph_nodes", len(entities))
    if not entities and not total and snapshot["status"] not in TERMINAL_STATUSES:
        raise HTTPException(status_code=404, detail="Graph not available yet")
    return {"job_id": job_id, "entities": entities, "total": total}
