"""EDA (Exploratory Data Analysis) artifact routes."""
from __future__ import annotations
import json
import os
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from app.db.database import get_db
from app.config import get_settings

router = APIRouter(prefix="/eda", tags=["eda"])


async def _corpus_dir(job_id: str, db: AsyncSession) -> str:
    row = (await db.execute(text("SELECT job_id FROM ingest_jobs WHERE job_id=:id"), {"id": job_id})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="job not found")
    return get_settings().corpus_dir(job_id)


def _load_json(path: str):
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@router.get("/{job_id}/file/{file_id}")
async def file_eda(job_id: str, file_id: str, db: AsyncSession = Depends(get_db)):
    corpus_dir = await _corpus_dir(job_id, db)
    processed_dir = os.path.join(corpus_dir, "processed")

    summary = _load_json(os.path.join(processed_dir, f"{file_id}_eda_summary.json"))
    scorecard = _load_json(os.path.join(processed_dir, f"{file_id}_kg_scorecard.json"))
    graph_validation = _load_json(os.path.join(processed_dir, f"{file_id}_graph_validation.json"))

    if not summary and not scorecard:
        raise HTTPException(status_code=404, detail="EDA artifacts not found for this file")

    return {
        "file_id": file_id,
        "job_id": job_id,
        "summary": summary,
        "scorecard": scorecard,
        "graph_validation": graph_validation,
    }


@router.get("/{job_id}/file/visuals")
async def file_eda_visuals(
    job_id: str,
    file_ids: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    corpus_dir = await _corpus_dir(job_id, db)
    processed_dir = os.path.join(corpus_dir, "processed")

    fids = [f.strip() for f in file_ids.split(",")] if file_ids else None
    result = []
    if os.path.isdir(processed_dir):
        for fname in os.listdir(processed_dir):
            if not fname.endswith("_eda_visuals.json"):
                continue
            file_id = fname.replace("_eda_visuals.json", "")
            if fids and file_id not in fids:
                continue
            data = _load_json(os.path.join(processed_dir, fname))
            if data:
                result.append({"file_id": file_id, "visuals": data})

    return {"job_id": job_id, "files": result}


@router.get("/{job_id}/db/{db_id}")
async def db_eda(job_id: str, db_id: str, db: AsyncSession = Depends(get_db)):
    corpus_dir = await _corpus_dir(job_id, db)
    processed_dir = os.path.join(corpus_dir, "processed")
    artifact = _load_json(os.path.join(processed_dir, "eda_artifact.json"))
    profile = _load_json(os.path.join(processed_dir, f"{db_id}_profile.json"))
    if not artifact and not profile:
        raise HTTPException(status_code=404, detail="DB EDA artifacts not found")
    return {"job_id": job_id, "db_id": db_id, "eda_artifact": artifact, "profile": profile}


@router.get("/dashboard")
async def eda_dashboard(
    file_ids: Optional[str] = Query(None),
    db_ids: Optional[str] = Query(None),
):
    """Aggregate EDA dashboard — returns a summary across multiple corpus jobs."""
    return {
        "message": "Provide job-scoped endpoints for per-job EDA artifacts",
        "file_ids": file_ids,
        "db_ids": db_ids,
    }
