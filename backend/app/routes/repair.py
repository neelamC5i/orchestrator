"""Graph repair routes — suppress/restore relations, split entities, reprocess files."""
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.db.database import get_db
from app.config import get_settings

router = APIRouter(prefix="/repair", tags=["repair"])


async def _corpus_dir(job_id: str, db: AsyncSession) -> str:
    row = (await db.execute(text("SELECT job_id FROM ingest_jobs WHERE job_id=:id"), {"id": job_id})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="job not found")
    return get_settings().corpus_dir(job_id)


class SuppressRelationRequest(BaseModel):
    relation_id: str


class RestoreRelationRequest(BaseModel):
    relation_id: str


class SplitEntityRequest(BaseModel):
    canonical_id: str
    alias: str
    entity_type: str
    decided_by: str = "user"


@router.post("/{job_id}/reprocess/{file_id}")
async def reprocess_file(job_id: str, file_id: str, db: AsyncSession = Depends(get_db)):
    """Trigger re-extraction for a single file within a job."""
    from app.tasks.ingest_task import run_ingest_pipeline
    # Queue as a subtask — in production you'd track individual file tasks
    run_ingest_pipeline.apply_async(args=[job_id], queue="ingest")
    return {"queued": True, "job_id": job_id, "file_id": file_id}


@router.post("/{job_id}/suppress-relation")
async def suppress_relation(
    job_id: str, body: SuppressRelationRequest, db: AsyncSession = Depends(get_db)
):
    corpus_dir = await _corpus_dir(job_id, db)
    from app.modules.graph.graph_builder import GraphBuilder
    gb = GraphBuilder(corpus_dir)
    result = gb.suppress_canonical_relation(body.relation_id)
    return {"suppressed": result, "relation_id": body.relation_id}


@router.post("/{job_id}/restore-relation")
async def restore_relation(
    job_id: str, body: RestoreRelationRequest, db: AsyncSession = Depends(get_db)
):
    corpus_dir = await _corpus_dir(job_id, db)
    from app.modules.graph.graph_builder import GraphBuilder
    gb = GraphBuilder(corpus_dir)
    result = gb.restore_canonical_relation(body.relation_id)
    return {"restored": result, "relation_id": body.relation_id}


@router.post("/{job_id}/split-entity")
async def split_entity(
    job_id: str, body: SplitEntityRequest, db: AsyncSession = Depends(get_db)
):
    corpus_dir = await _corpus_dir(job_id, db)
    from app.modules.kg.entity_resolution import split_entity_from_alias
    result = split_entity_from_alias(
        corpus_dir,
        canonical_id=body.canonical_id,
        alias=body.alias,
        entity_type=body.entity_type,
        decided_by=body.decided_by,
    )
    return result
