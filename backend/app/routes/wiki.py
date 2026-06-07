"""
Wiki article viewer API — replaces the old nanoGPT training UI entirely.

GET  /wiki/{job_id}/pages                — list/search wiki pages
GET  /wiki/{job_id}/page/{canonical_id}  — get a single wiki page
GET  /wiki/{job_id}/reviews              — entity merge review queue
POST /wiki/{job_id}/review/{review_id}   — approve or reject a merge
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import List, Optional

from app.db.database import get_db
from app.schemas import WikiReviewsResponse

router = APIRouter(prefix="/wiki", tags=["wiki"])


async def _corpus_dir(job_id: str, db: AsyncSession) -> str:
    row = (await db.execute(
        text("SELECT job_id FROM ingest_jobs WHERE job_id = :id"),
        {"id": job_id},
    )).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="job not found")
    return f"corpus_store/{job_id}"


class ReviewDecision(BaseModel):
    decision: str           # "approve" | "reject"
    decided_by: str = "user"


@router.get("/{job_id}/pages")
async def list_wiki_pages(
    job_id: str,
    q: str = Query("", alias="q"),
    file_ids: Optional[str] = Query(None),
    limit: int = Query(50),
    db: AsyncSession = Depends(get_db),
):
    corpus_dir = await _corpus_dir(job_id, db)
    from app.modules.wiki.wiki_builder import WikiBuilder
    wb = WikiBuilder(corpus_dir)
    fids = [f.strip() for f in file_ids.split(",")] if file_ids else None
    result = wb.list_pages(query=q, file_ids=fids, limit=limit)
    page_list = result.get("pages", []) if isinstance(result, dict) else (result if isinstance(result, list) else [])
    return {"pages": page_list, "total": len(page_list)}


@router.get("/{job_id}/page/{canonical_id}")
async def get_wiki_page(
    job_id: str,
    canonical_id: str,
    db: AsyncSession = Depends(get_db),
):
    corpus_dir = await _corpus_dir(job_id, db)
    from app.modules.wiki.wiki_builder import WikiBuilder
    wb = WikiBuilder(corpus_dir)
    page = wb.get_page(canonical_id)
    if not page:
        raise HTTPException(status_code=404, detail="wiki page not found")
    return page


@router.get("/{job_id}/reviews", response_model=WikiReviewsResponse)
async def list_entity_reviews(
    job_id: str,
    status: str = Query("pending"),
    limit: int = Query(100),
    db: AsyncSession = Depends(get_db),
):
    corpus_dir = await _corpus_dir(job_id, db)
    from app.modules.kg.entity_resolution import list_pending_reviews
    result = list_pending_reviews(corpus_dir, status=status, limit=limit)
    return {"reviews": result["reviews"], "total": result["count"]}


@router.post("/{job_id}/review/{review_id}")
async def submit_entity_review(
    job_id: str,
    review_id: str,
    body: ReviewDecision,
    db: AsyncSession = Depends(get_db),
):
    corpus_dir = await _corpus_dir(job_id, db)
    from app.modules.kg.entity_resolution import apply_review_decision
    result = apply_review_decision(
        corpus_dir, review_id, decision=body.decision, decided_by=body.decided_by
    )
    return result
