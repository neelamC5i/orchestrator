"""Cross-source link management routes."""
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.db.database import get_db
from app.config import get_settings

router = APIRouter(prefix="/links", tags=["links"])

async def _corpus_dir(job_id: str, db: AsyncSession) -> str:
    row = (await db.execute(text("SELECT job_id FROM ingest_jobs WHERE job_id=:id"), {"id": job_id})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="job not found")
    return get_settings().corpus_dir(job_id)

class LinkReviewDecision(BaseModel):
    decision: str
    decided_by: str = "user"

@router.get("/{job_id}/cross-source/{source_id}")
async def cross_source_links(job_id: str, source_id: str, db: AsyncSession = Depends(get_db)):
    corpus_dir = await _corpus_dir(job_id, db)
    from app.modules.kg.cross_source_linker import list_cross_link_reviews
    reviews = list_cross_link_reviews(corpus_dir, status="all", limit=500)
    by_source = [r for r in reviews if r.get("source_id") == source_id]
    return {"source_id": source_id, "links": by_source}

@router.get("/{job_id}/reviews")
async def list_cross_link_reviews_route(
    job_id: str,
    status: str = Query("pending"),
    limit: int = Query(100),
    db: AsyncSession = Depends(get_db),
):
    corpus_dir = await _corpus_dir(job_id, db)
    from app.modules.kg.cross_source_linker import list_cross_link_reviews
    reviews = list_cross_link_reviews(corpus_dir, status=status, limit=limit)
    return {"reviews": reviews, "total": len(reviews)}

@router.post("/{job_id}/review/{review_id}")
async def submit_cross_link_review(
    job_id: str, review_id: str, body: LinkReviewDecision, db: AsyncSession = Depends(get_db)
):
    corpus_dir = await _corpus_dir(job_id, db)
    from app.modules.kg.cross_source_linker import apply_cross_link_review
    return apply_cross_link_review(corpus_dir, review_id, decision=body.decision, decided_by=body.decided_by)

@router.get("/{job_id}/metrics")
async def cross_link_metrics(job_id: str, db: AsyncSession = Depends(get_db)):
    corpus_dir = await _corpus_dir(job_id, db)
    from app.modules.kg.cross_source_linker import cross_link_metrics
    return cross_link_metrics(corpus_dir)
