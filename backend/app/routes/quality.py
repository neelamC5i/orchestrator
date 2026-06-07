"""Quality scorecard routes."""
from __future__ import annotations
import json
import os
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.db.database import get_db
from app.config import get_settings
from app.schemas import QualityMetricsResponse

router = APIRouter(prefix="/quality", tags=["quality"])


async def _corpus_dir(job_id: str, db: AsyncSession) -> str:
    row = (await db.execute(text("SELECT job_id FROM ingest_jobs WHERE job_id=:id"), {"id": job_id})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="job not found")
    return get_settings().corpus_dir(job_id)


@router.get("/{job_id}/metrics", response_model=QualityMetricsResponse)
async def quality_metrics(job_id: str, db: AsyncSession = Depends(get_db)):
    corpus_dir = await _corpus_dir(job_id, db)
    from app.modules.graph.graph_builder import GraphBuilder
    from app.modules.kg.entity_resolution import registry_metrics

    graph_builder = GraphBuilder(corpus_dir)
    graph_metrics = graph_builder.canonical_graph_metrics()
    reg_metrics = registry_metrics(corpus_dir)

    # Aggregate EDA scorecards
    processed_dir = os.path.join(corpus_dir, "processed")
    scorecards = []
    if os.path.isdir(processed_dir):
        for fname in os.listdir(processed_dir):
            if fname.endswith("_kg_scorecard.json"):
                try:
                    with open(os.path.join(processed_dir, fname), encoding="utf-8") as f:
                        scorecards.append(json.load(f))
                except Exception:
                    pass

    return {
        "job_id": job_id,
        "graph_metrics": graph_metrics,
        "registry_metrics": reg_metrics,
        "file_scorecards": scorecards,
        "file_count": len(scorecards),
    }
