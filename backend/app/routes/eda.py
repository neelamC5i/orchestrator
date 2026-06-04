"""EDA (Exploratory Data Analysis) artifact routes."""
from __future__ import annotations
import json
import os
from collections import Counter
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Any, Optional
from app.db.database import get_db

router = APIRouter(prefix="/eda", tags=["eda"])


async def _corpus_dir(job_id: str, db: AsyncSession) -> str:
    row = (await db.execute(text("SELECT job_id FROM ingest_jobs WHERE job_id=:id"), {"id": job_id})).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="job not found")
    return f"corpus_store/{job_id}"


def _load_json(path: str):
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _safe_load(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


async def _job_row(job_id: str, db: AsyncSession) -> dict[str, Any]:
    row = (await db.execute(
        text(
            """
            SELECT job_id, domain_label, status, progress, metadata, file_count,
                   entity_count, community_count, created_at, completed_at, error_message
            FROM ingest_jobs
            WHERE job_id=:id
            """
        ),
        {"id": job_id},
    )).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="job not found")
    return dict(row)


def _resolve_corpus_path(row: dict[str, Any], job_id: str) -> Path:
    meta = row.get("metadata") or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            meta = {}
    corpus_dir = meta.get("corpus_dir")
    if corpus_dir:
        return Path(corpus_dir)
    return Path("corpus_store") / job_id


def _sum_file_sizes(paths: list[Path]) -> int:
    total = 0
    for p in paths:
        if p.is_file():
            try:
                total += p.stat().st_size
            except Exception:
                continue
    return total


def _walk_size(path: Path) -> int:
    if not path.exists():
        return 0
    if path.is_file():
        return _sum_file_sizes([path])
    total = 0
    for f in path.rglob("*"):
        if f.is_file():
            try:
                total += f.stat().st_size
            except Exception:
                continue
    return total


def _load_artifacts(corpus_dir: Path) -> dict[str, dict[str, Any]]:
    return {
        "metadata_intelligence": _safe_load(corpus_dir / "metadata_intelligence.json") or {},
        "semantic_learning": _safe_load(corpus_dir / "semantic_learning.json") or {},
        "ml_validation": _safe_load(corpus_dir / "ml_validation.json") or {},
        "ontology": _safe_load(corpus_dir / "ontology.json") or {},
        "graph_validation": _safe_load(corpus_dir / "graph_validation.json") or {},
        "canonical_graph": _safe_load(corpus_dir / "canonical_graph.json") or {},
    }


def _collect_file_summaries(processed_dir: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not processed_dir.is_dir():
        return out
    for path in processed_dir.glob("*_eda_summary.json"):
        data = _safe_load(path)
        if not data:
            continue
        data["_file_id"] = data.get("file_id") or path.name.replace("_eda_summary.json", "")
        out.append(data)
    return out


def _collect_file_visuals(processed_dir: Path) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not processed_dir.is_dir():
        return out
    for path in processed_dir.glob("*_eda_visuals.json"):
        data = _safe_load(path)
        if not data:
            continue
        data["_file_id"] = path.name.replace("_eda_visuals.json", "")
        out.append(data)
    return out


def _parse_stage_sizes(corpus_dir: Path, processed_dir: Path) -> dict[str, int]:
    raw_inputs = [
        p for p in corpus_dir.iterdir()
        if p.is_file() and p.name not in {
            "metadata_intelligence.json",
            "semantic_learning.json",
            "ml_validation.json",
            "ontology.json",
            "graph_validation.json",
            "canonical_graph.json",
            "canonical_registry.json",
        }
    ] if corpus_dir.exists() else []

    return {
        "extract_input": _sum_file_sizes(raw_inputs),
        "extract_output": _sum_file_sizes(list(processed_dir.glob("*_corpus.json"))),
        "clean_output": _sum_file_sizes(list(processed_dir.glob("*_corpus.json"))),
        "chunk_output": _sum_file_sizes(list(processed_dir.glob("*_corpus.json"))),
        "metadata_intel_output": _sum_file_sizes([corpus_dir / "metadata_intelligence.json"]),
        "entities_output": _sum_file_sizes([corpus_dir / "canonical_graph.json"]),
        "semantic_learn_output": _sum_file_sizes([corpus_dir / "semantic_learning.json"]),
        "eda_output": _sum_file_sizes(list(processed_dir.glob("*_eda_summary.json"))),
        "ml_validation_output": _sum_file_sizes([corpus_dir / "ml_validation.json"]),
        "ontology_output": _sum_file_sizes([corpus_dir / "ontology.json"]),
        "canonical_output": _sum_file_sizes([corpus_dir / "canonical_graph.json", corpus_dir / "canonical_registry.json"]),
        "graph_build_output": _walk_size(corpus_dir / "graphs") + _sum_file_sizes([corpus_dir / "canonical_graph.json"]),
        "graph_validate_output": _sum_file_sizes([corpus_dir / "graph_validation.json"]),
        "wiki_output": _walk_size(corpus_dir / "graphify-out" / "wiki"),
        "embed_output": _walk_size(corpus_dir / "faiss"),
    }


def _build_pipeline_rows(row: dict[str, Any], corpus_dir: Path) -> list[dict[str, Any]]:
    progress = row.get("progress") or {}
    if isinstance(progress, str):
        try:
            progress = json.loads(progress)
        except Exception:
            progress = {}
    steps = progress.get("steps") or []
    processed_dir = corpus_dir / "processed"
    sizes = _parse_stage_sizes(corpus_dir, processed_dir)

    out: list[dict[str, Any]] = []
    for s in steps:
        sid = s.get("id", "")
        output_size = sizes.get(f"{sid}_output")
        row_errors = [row.get("error_message")] if row.get("error_message") and s.get("status") == "failed" else []
        out.append({
            "id": sid,
            "label": s.get("label", sid),
            "status": s.get("status", "pending"),
            "pct": s.get("pct"),
            "detail": s.get("detail"),
            "input_size_bytes": sizes.get("extract_input") if sid == "extract" else None,
            "output_size_bytes": output_size,
            "processing_time_ms": None,
            "warnings": [],
            "errors": [e for e in row_errors if e],
        })
    return out


def _build_extraction_payload(
    file_summaries: list[dict[str, Any]],
    canonical_graph: dict[str, Any],
) -> dict[str, Any]:
    parser_confidence = []
    ocr_timeline = []

    for summary in file_summaries:
        source = summary.get("source") or {}
        entity_stats = summary.get("entity_statistics") or {}
        parser_confidence.append({
            "source_file": summary.get("_file_id"),
            "adapter": source.get("adapter"),
            "confidence": entity_stats.get("mean_confidence"),
        })

        pdf_eda = summary.get("pdf_specific_eda") or {}
        timeline = pdf_eda.get("ocr_confidence_timeline") or []
        for idx, item in enumerate(timeline):
            if isinstance(item, dict):
                ocr_timeline.append({
                    "source_file": summary.get("_file_id"),
                    "point": item.get("point", idx),
                    "confidence": item.get("confidence"),
                })

    node_rows: dict[tuple[str, int], dict[str, Any]] = {}
    for node in canonical_graph.get("nodes") or []:
        conf = node.get("confidence")
        label = node.get("label")
        for prov in node.get("provenance") or []:
            source_file = prov.get("file_id") or "unknown"
            chunk_idx = int(prov.get("chunk_idx") or 0)
            key = (source_file, chunk_idx)
            row = node_rows.get(key)
            if not row:
                row = {
                    "chunk_id": f"{source_file}:{chunk_idx}",
                    "source_file": source_file,
                    "adapter": None,
                    "confidence_values": [],
                    "page_row": prov.get("page") or prov.get("row") or prov.get("line"),
                    "entity_count": 0,
                    "warnings": [],
                }
                node_rows[key] = row
            if conf is not None:
                row["confidence_values"].append(conf)
            row["entity_count"] += 1
            if label:
                row["warnings"].append(f"entity:{label}")

    adapter_by_file = {
        f.get("_file_id"): (f.get("source") or {}).get("adapter")
        for f in file_summaries
    }

    lineage = []
    for (source_file, _), val in sorted(node_rows.items(), key=lambda x: x[0]):
        conf_values = val.pop("confidence_values")
        lineage.append({
            "chunk_id": val["chunk_id"],
            "source_file": source_file,
            "adapter": adapter_by_file.get(source_file),
            "confidence": round(sum(conf_values) / len(conf_values), 4) if conf_values else None,
            "page_row": val["page_row"],
            "entity_count": val["entity_count"],
            "warnings": sorted(set(val["warnings"]))[:6],
        })

    return {
        "parser_confidence": parser_confidence,
        "ocr_confidence_timeline": ocr_timeline,
        "lineage": lineage,
    }


def _build_metadata_payload(
    metadata_intelligence: dict[str, Any],
    file_summaries: list[dict[str, Any]],
) -> dict[str, Any]:
    files_meta = metadata_intelligence.get("files") or {}
    completeness = []
    missing_schema_fields = []
    type_coverage = []
    richness_heatmap = []

    for file_id, file_meta in files_meta.items():
        if not isinstance(file_meta, dict):
            continue
        completeness_score = file_meta.get("completeness_score")
        if completeness_score is None:
            fields = file_meta.get("fields") or []
            missing = file_meta.get("missing_fields") or []
            if fields:
                completeness_score = (len(fields) - len(missing)) / max(len(fields), 1)

        completeness.append({"target": file_id, "score": completeness_score})
        for field in file_meta.get("missing_fields") or []:
            missing_schema_fields.append({"target": file_id, "field": field})
        type_coverage.append({"target": file_id, "coverage": file_meta.get("type_coverage")})

        keys = [k for k, v in file_meta.items() if v not in (None, "", [], {}, False)]
        richness_heatmap.append({"target": file_id, "richness": len(keys)})

    # Fallback for non-tabular corpora: derive a light richness metric from EDA summaries.
    if not richness_heatmap:
        for summary in file_summaries:
            file_id = summary.get("_file_id")
            keys = [k for k, v in summary.items() if not k.startswith("_") and v not in (None, "", [], {}, False)]
            richness_heatmap.append({"target": file_id, "richness": len(keys)})

    return {
        "completeness": completeness,
        "missing_schema_fields": missing_schema_fields,
        "type_coverage": type_coverage,
        "richness_heatmap": richness_heatmap,
    }


def _extract_numeric_columns(file_summaries: list[dict[str, Any]], file_visuals: list[dict[str, Any]]) -> dict[str, Any]:
    col_stats = []
    histograms = []
    outliers = []
    box_plots = []

    def _to_stat_row(file_id: str, column: str, stats: dict[str, Any]) -> dict[str, Any]:
        return {
            "file_id": file_id,
            "column": column,
            "mean": stats.get("mean"),
            "median": stats.get("median"),
            "std": stats.get("std") or stats.get("std_dev"),
            "p10": stats.get("p10") or stats.get("percentile_10"),
            "p90": stats.get("p90") or stats.get("percentile_90"),
        }

    for summary in file_summaries:
        file_id = summary.get("_file_id")
        candidates = [
            summary.get("numeric_statistics"),
            summary.get("column_statistics"),
            (summary.get("tabular_statistics") or {}).get("numeric_columns"),
        ]
        for payload in candidates:
            if not isinstance(payload, dict):
                continue
            for col, stats in payload.items():
                if isinstance(stats, dict):
                    row = _to_stat_row(file_id, str(col), stats)
                    if any(row.get(k) is not None for k in ("mean", "median", "std", "p10", "p90")):
                        col_stats.append(row)

    for visual in file_visuals:
        file_id = visual.get("_file_id")
        conf_hists = (visual.get("confidence_histograms") or {})
        for name, bins in conf_hists.items():
            if isinstance(bins, list):
                histograms.append({"file_id": file_id, "column": name, "bins": bins})

        if isinstance(visual.get("outliers"), list):
            outliers.extend([{"file_id": file_id, **o} for o in visual["outliers"] if isinstance(o, dict)])
        if isinstance(visual.get("box_plots"), list):
            box_plots.extend([{"file_id": file_id, **b} for b in visual["box_plots"] if isinstance(b, dict)])

    return {
        "column_statistics": col_stats,
        "histograms": histograms,
        "outliers": outliers,
        "box_plots": box_plots,
    }


def _build_kg_payload(
    domain_runs: list[dict[str, Any]],
    canonical_graph: dict[str, Any],
    graph_validation: dict[str, Any],
) -> dict[str, Any]:
    entity_growth = []
    relationship_growth = []

    for r in domain_runs:
        entity_growth.append({
            "job_id": r.get("job_id"),
            "created_at": str(r.get("created_at")),
            "count": r.get("entity_count") or 0,
        })
        relationship_growth.append({
            "job_id": r.get("job_id"),
            "created_at": str(r.get("created_at")),
            "count": r.get("relationship_count") or 0,
        })

    degree = Counter()
    label_by_id = {}
    for n in canonical_graph.get("nodes") or []:
        cid = n.get("canonical_id") or n.get("id")
        if cid:
            label_by_id[cid] = n.get("label") or cid
            degree[cid] += 0

    for e in canonical_graph.get("edges") or []:
        s = e.get("source") or e.get("source_canonical_id")
        t = e.get("target") or e.get("target_canonical_id")
        if s:
            degree[s] += 1
        if t:
            degree[t] += 1

    top_connected = [
        {"entity": label_by_id.get(node_id, node_id), "degree": deg}
        for node_id, deg in degree.most_common(10)
    ]

    return {
        "entity_growth": entity_growth,
        "relationship_growth": relationship_growth,
        "top_connected_entities": top_connected,
        "orphan_nodes_count": graph_validation.get("orphan_node_count"),
    }


def _build_confidence_payload(
    canonical_graph: dict[str, Any],
    ml_validation: dict[str, Any],
    graph_validation: dict[str, Any],
    file_summaries: list[dict[str, Any]],
) -> dict[str, Any]:
    scorecards = [
        s.get("confidence_scores") for s in file_summaries
        if isinstance(s.get("confidence_scores"), dict)
    ]
    avg_conf = {}
    for key in (
        "entity_confidence_score",
        "canonical_resolution_score",
        "relationship_confidence_score",
        "extraction_reliability_score",
    ):
        vals = [sc.get(key) for sc in scorecards if sc.get(key) is not None]
        avg_conf[key] = (sum(vals) / len(vals)) if vals else None

    stages = [
        "Extraction",
        "Resolution",
        "Canonicalization",
        "Graph Insert",
        "EDA Validation",
    ]

    matrix = []
    breakdown = {}
    for node in canonical_graph.get("nodes") or []:
        name = node.get("label") or node.get("canonical_id") or "entity"
        extraction = node.get("confidence")
        resolution = avg_conf.get("canonical_resolution_score")
        graph_insert = ml_validation.get("relation_mean_confidence")
        eda_validation = avg_conf.get("extraction_reliability_score")

        per_stage = {
            "Extraction": extraction,
            "Resolution": resolution,
            "Canonicalization": resolution,
            "Graph Insert": graph_insert,
            "EDA Validation": eda_validation,
        }
        breakdown[name] = {
            "entity": name,
            "canonical_id": node.get("canonical_id"),
            "entity_type": node.get("entity_type") or node.get("type"),
            "stages": per_stage,
            "source_files": node.get("source_files") or [],
        }
        matrix.append({"entity": name, "stages": per_stage})

    return {
        "stages": stages,
        "matrix": matrix,
        "breakdown": breakdown,
        "default_values": {
            "entity_confidence_score": avg_conf.get("entity_confidence_score"),
            "canonical_resolution_score": avg_conf.get("canonical_resolution_score"),
            "graph_trust_score": graph_validation.get("trust_score"),
        },
    }


def _build_validation_trust_payload(
    graph_validation: dict[str, Any],
    ml_validation: dict[str, Any],
    metadata_payload: dict[str, Any],
) -> dict[str, Any]:
    validation_errors = {
        "schema": len(metadata_payload.get("missing_schema_fields") or []),
        "nulls": None,
        "duplicates": graph_validation.get("duplicate_relationship_count"),
    }
    trust_breakdown = {
        "trust_score": graph_validation.get("trust_score"),
        "consistency": (graph_validation.get("scorecard") or {}).get("consistency_score"),
        "confidence": (graph_validation.get("scorecard") or {}).get("confidence_score"),
        "graph_trust": (graph_validation.get("scorecard") or {}).get("graph_trust_score"),
        "f1_proxy": ml_validation.get("f1_proxy"),
    }
    return {
        "validation_errors": validation_errors,
        "ontology_violations": graph_validation.get("ontology_violation_count"),
        "orphan_nodes": graph_validation.get("orphan_node_count"),
        "trust_breakdown": trust_breakdown,
    }


def _build_governance_payload(ontology: dict[str, Any], graph_validation: dict[str, Any]) -> dict[str, Any]:
    summary = ontology.get("summary") or {}
    relation_constraints = ontology.get("relation_constraints") or {}
    alerts = []
    for v in ontology.get("violations") or []:
        if isinstance(v, dict):
            alerts.append(v)
    if graph_validation.get("ontology_violation_count"):
        alerts.append({
            "type": "ontology_violation_count",
            "count": graph_validation.get("ontology_violation_count"),
        })

    return {
        "ontology_consistency_score": (graph_validation.get("scorecard") or {}).get("consistency_score"),
        "relationship_type_violations": summary.get("violation_count"),
        "schema_adherence": {
            "type_count": summary.get("type_count"),
            "relation_count": summary.get("relation_count"),
            "constraints": len(relation_constraints),
        },
        "governance_alerts": alerts,
    }


async def _domain_runs(job_id: str, db: AsyncSession) -> list[dict[str, Any]]:
    domain_row = (await db.execute(
        text("SELECT domain_label FROM ingest_jobs WHERE job_id=:id"),
        {"id": job_id},
    )).mappings().first()
    if not domain_row:
        return []
    domain_label = domain_row.get("domain_label")
    if not domain_label:
        return []

    rows = (await db.execute(
        text(
            """
            SELECT job_id, created_at, entity_count, metadata
            FROM ingest_jobs
            WHERE domain_label=:domain
            ORDER BY created_at ASC
            """
        ),
        {"domain": domain_label},
    )).mappings().all()

    out: list[dict[str, Any]] = []
    for row in rows:
        entry = dict(row)
        meta = entry.get("metadata") or {}
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                meta = {}
        corpus_dir = Path(meta.get("corpus_dir") or (Path("corpus_store") / entry["job_id"]))
        gv = _safe_load(corpus_dir / "graph_validation.json") or {}
        entry["relationship_count"] = gv.get("edge_count") or 0
        out.append(entry)
    return out


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


@router.get("/extraction/{job_id}")
async def extraction(job_id: str, db: AsyncSession = Depends(get_db)):
    row = await _job_row(job_id, db)
    corpus_dir = _resolve_corpus_path(row, job_id)
    processed_dir = corpus_dir / "processed"
    artifacts = _load_artifacts(corpus_dir)
    file_summaries = _collect_file_summaries(processed_dir)
    payload = _build_extraction_payload(file_summaries, artifacts["canonical_graph"])
    return {"job_id": job_id, **payload}


@router.get("/metadata/{job_id}")
async def metadata(job_id: str, db: AsyncSession = Depends(get_db)):
    row = await _job_row(job_id, db)
    corpus_dir = _resolve_corpus_path(row, job_id)
    processed_dir = corpus_dir / "processed"
    artifacts = _load_artifacts(corpus_dir)
    file_summaries = _collect_file_summaries(processed_dir)
    payload = _build_metadata_payload(artifacts["metadata_intelligence"], file_summaries)
    return {"job_id": job_id, **payload}


@router.get("/confidence/{job_id}")
async def confidence(job_id: str, db: AsyncSession = Depends(get_db)):
    row = await _job_row(job_id, db)
    corpus_dir = _resolve_corpus_path(row, job_id)
    processed_dir = corpus_dir / "processed"
    artifacts = _load_artifacts(corpus_dir)
    file_summaries = _collect_file_summaries(processed_dir)
    payload = _build_confidence_payload(
        artifacts["canonical_graph"],
        artifacts["ml_validation"],
        artifacts["graph_validation"],
        file_summaries,
    )
    return {"job_id": job_id, **payload}


@router.get("/summary/{job_id}")
async def summary(job_id: str, db: AsyncSession = Depends(get_db)):
    row = await _job_row(job_id, db)
    corpus_dir = _resolve_corpus_path(row, job_id)
    processed_dir = corpus_dir / "processed"
    artifacts = _load_artifacts(corpus_dir)
    file_summaries = _collect_file_summaries(processed_dir)
    metadata_payload = _build_metadata_payload(artifacts["metadata_intelligence"], file_summaries)
    payload = _build_validation_trust_payload(
        artifacts["graph_validation"],
        artifacts["ml_validation"],
        metadata_payload,
    )
    return {"job_id": job_id, **payload}


@router.get("/observatory/{job_id}")
async def observatory(job_id: str, db: AsyncSession = Depends(get_db)):
    row = await _job_row(job_id, db)
    corpus_dir = _resolve_corpus_path(row, job_id)
    processed_dir = corpus_dir / "processed"
    artifacts = _load_artifacts(corpus_dir)
    file_summaries = _collect_file_summaries(processed_dir)
    file_visuals = _collect_file_visuals(processed_dir)
    domain_runs = await _domain_runs(job_id, db)

    graph_nodes = artifacts["graph_validation"].get("node_count")
    entity_count = len(artifacts["canonical_graph"].get("nodes") or [])
    relationship_count = len(artifacts["canonical_graph"].get("edges") or [])
    trust_score = artifacts["graph_validation"].get("trust_score")
    ontology_consistency = (artifacts["graph_validation"].get("scorecard") or {}).get("consistency_score")

    overview = {
        "entities_count": entity_count,
        "relationships_count": relationship_count,
        "graph_nodes": graph_nodes,
        "trust_score": trust_score,
        "ontology_consistency": ontology_consistency,
    }
    pipeline_rows = _build_pipeline_rows(row, corpus_dir)
    extraction_payload = _build_extraction_payload(file_summaries, artifacts["canonical_graph"])
    metadata_payload = _build_metadata_payload(artifacts["metadata_intelligence"], file_summaries)
    eda_payload = _extract_numeric_columns(file_summaries, file_visuals)
    kg_payload = _build_kg_payload(domain_runs, artifacts["canonical_graph"], artifacts["graph_validation"])
    confidence_payload = _build_confidence_payload(
        artifacts["canonical_graph"],
        artifacts["ml_validation"],
        artifacts["graph_validation"],
        file_summaries,
    )
    validation_payload = _build_validation_trust_payload(
        artifacts["graph_validation"],
        artifacts["ml_validation"],
        metadata_payload,
    )
    governance_payload = _build_governance_payload(artifacts["ontology"], artifacts["graph_validation"])

    has_data = any([
        overview["entities_count"],
        overview["relationships_count"],
        bool(pipeline_rows),
        bool(extraction_payload.get("lineage")),
        bool(metadata_payload.get("richness_heatmap")),
        bool(kg_payload.get("top_connected_entities")),
    ])

    return {
        "job_id": job_id,
        "domain_label": row.get("domain_label"),
        "status": row.get("status"),
        "has_data": has_data,
        "overview": overview,
        "pipeline": {"stages": pipeline_rows},
        "extraction": extraction_payload,
        "metadata": metadata_payload,
        "eda": eda_payload,
        "knowledge_graph": kg_payload,
        "confidence": confidence_payload,
        "validation_trust": validation_payload,
        "governance_ontology": governance_payload,
    }
