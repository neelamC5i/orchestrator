import glob
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any


def _to_iso(val: Any) -> str | None:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.isoformat()
    return str(val)


TERMINAL_STATUSES = {"graph_done", "failed", "error"}

DEFAULT_LAYERS = [
    ("upload", "File Upload + Lineage"),
    ("extract", "Ingestion & Extraction"),
    ("clean", "Cleaning + Normalization"),
    ("chunk", "Chunking + Segmentation"),
    ("metadata", "Metadata Intelligence"),
    ("entities", "Entity + Relationship"),
    ("semantic", "Semantic Learning"),
    ("eda", "EDA Intelligence"),
    ("validation", "ML Validation & Accuracy"),
    ("ontology", "Ontology & Governance"),
    ("canonical", "Canonicalization"),
    ("graph_build", "KG Construction"),
    ("graph_consist", "Graph Consistency"),
    ("wiki", "Wiki + Explainability"),
]


def parse_jsonish(value: Any, default: Any = None) -> Any:
    if default is None:
        default = {}
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        if not value.strip():
            return default
        try:
            return json.loads(value)
        except Exception:
            return default
    return default


def parse_step_detail(step: dict[str, Any]) -> dict[str, Any]:
    raw = step.get("detail")
    parsed = parse_jsonish(raw, default=None)
    if isinstance(parsed, dict):
        return parsed
    if raw:
        return {"raw": raw}
    return {}


def read_json(path: str | Path) -> Any:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def glob_json(processed_dir: str, pattern: str, limit: int = 5) -> list[Any]:
    out = []
    for path in sorted(glob.glob(os.path.join(processed_dir, pattern)))[:limit]:
        data = read_json(path)
        if data is not None:
            out.append(data)
    return out


def resolve_corpus_dir(job_id: str, metadata: dict[str, Any], graph_path: str | None = None) -> str:
    if graph_path:
        try:
            path = Path(graph_path)
            if path.parent.name == "graphify-out":
                return str(path.parent.parent)
            return str(path.parent)
        except Exception:
            pass
    from app.config import get_settings
    return str(metadata.get("corpus_dir") or get_settings().corpus_dir(job_id))


def normalize_layers(progress: dict[str, Any], status: str) -> list[dict[str, Any]]:
    raw_steps = progress.get("steps") or []
    if raw_steps:
        return [
            {
                "id": step.get("id", ""),
                "label": step.get("label", step.get("id", "")),
                "status": step.get("status", "pending"),
                "pct": step.get("pct", 0),
                "detail": step.get("detail") or "",
                "started_at": _to_iso(step.get("started_at")),
                "completed_at": _to_iso(step.get("completed_at")),
                "error_code": step.get("error_code"),
            }
            for step in raw_steps
        ]

    if status == "graph_done":
        default_status = "done"
        pct = 100
    elif status in {"failed", "error"}:
        default_status = "error"
        pct = 0
    else:
        default_status = "pending"
        pct = 0

    return [
        {
            "id": layer_id,
            "label": label,
            "status": default_status,
            "pct": pct,
            "detail": "",
            "started_at": None,
            "completed_at": None,
            "error_code": None,
        }
        for layer_id, label in DEFAULT_LAYERS
    ]


def layer_detail_map(layers: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {layer.get("id", ""): parse_step_detail(layer) for layer in layers}


def graph_payload(corpus_dir: str) -> tuple[dict[str, Any] | None, str]:
    graph_path = os.path.join(corpus_dir, "canonical_graph.json")
    graph = read_json(graph_path)
    if isinstance(graph, dict):
        return graph, graph_path
    return None, graph_path


def build_eda_preview(corpus_dir: str, step_detail: dict[str, Any]) -> dict[str, Any]:
    processed_dir = os.path.join(corpus_dir, "processed")
    scorecards = glob_json(processed_dir, "*_kg_scorecard.json", 10)
    visuals = glob_json(processed_dir, "*_eda_visuals.json", 10)
    summaries = glob_json(processed_dir, "*_eda_summary.json", 10)
    validations = glob_json(processed_dir, "*_graph_validation.json", 10)
    first_score = scorecards[0] if scorecards else {}
    first_visual = visuals[0] if visuals else {}
    first_summary = summaries[0] if summaries else {}

    warnings = []
    if not visuals:
        warnings.append("EDA visuals unavailable")
    if not scorecards:
        warnings.append("EDA scorecard unavailable")

    return {
        **step_detail,
        "scorecards": scorecards,
        "visuals": visuals,
        "eda_summaries": summaries,
        "graph_validations": validations,
        "scorecard": first_score,
        "confidence_histograms": first_visual.get("confidence_histograms", {}),
        "entity_distribution": first_visual.get("entity_distribution", []),
        "relation_distributions": first_visual.get("relation_distributions", []),
        "graph_metrics": first_summary.get("graph_metrics", {}),
        "warnings": warnings,
    }


def build_kg_preview(corpus_dir: str, step_detail: dict[str, Any]) -> dict[str, Any]:
    graph, _ = graph_payload(corpus_dir)
    per_file_graphs = glob.glob(os.path.join(corpus_dir, "graphs", "*_graph.json"))
    if not graph:
        return {
            **step_detail,
            "graph_nodes": step_detail.get("graph_nodes", 0),
            "graph_edges": step_detail.get("graph_edges", 0),
            "per_file_graph_count": len(per_file_graphs),
            "central_entities": [],
            "node_sample": [],
            "edge_sample": [],
            "edge_confidence_distribution": {"low": 0, "medium": 0, "high": 0},
            "warnings": ["Knowledge graph not generated yet"],
        }

    nodes = graph.get("nodes", [])
    edges = [edge for edge in graph.get("edges", []) if not edge.get("suppressed")]
    conf_dist = {"low": 0, "medium": 0, "high": 0}
    for edge in edges:
        confidence = float(edge.get("confidence", 0) or 0)
        if confidence < 0.4:
            conf_dist["low"] += 1
        elif confidence < 0.7:
            conf_dist["medium"] += 1
        else:
            conf_dist["high"] += 1

    central = sorted(
        nodes,
        key=lambda node: (
            node.get("weight")
            or node.get("degree")
            or len(node.get("source_files", []) or [])
            or node.get("confidence", 0)
        ),
        reverse=True,
    )

    return {
        **step_detail,
        "graph_nodes": len(nodes),
        "graph_edges": len(edges),
        "node_count": len(nodes),
        "edge_count": len(edges),
        "density": graph.get("stats", {}).get("density", 0),
        "avg_degree": graph.get("stats", {}).get("avg_degree", 0),
        "edge_confidence_distribution": conf_dist,
        "central_entities": [
            {
                "label": node.get("label") or node.get("canonical_id") or node.get("id", ""),
                "type": node.get("entity_type") or node.get("type", ""),
                "confidence": float(node.get("confidence", 0) or 0),
                "source_count": len(node.get("source_files", []) or []),
            }
            for node in central[:20]
        ],
        "node_sample": nodes[:25],
        "edge_sample": edges[:25],
        "per_file_graph_count": len(per_file_graphs),
        "warnings": [],
    }


def build_wiki_preview(corpus_dir: str, step_detail: dict[str, Any]) -> dict[str, Any]:
    wiki_dir = os.path.join(corpus_dir, "wiki_pages")
    wiki_index = read_json(os.path.join(wiki_dir, "index.json")) or {}
    page_catalog = wiki_index.get("pages", [])
    sample_pages = []
    for entry in page_catalog[:8]:
        cid = entry.get("canonical_id", "")
        safe_id = cid.replace("/", "_").replace("\\", "_")
        page_data = read_json(os.path.join(wiki_dir, f"{safe_id}.json"))
        if not page_data:
            continue
        sample_pages.append({
            "canonical_id": page_data.get("canonical_id", cid),
            "title": page_data.get("title", cid),
            "entity_type": page_data.get("entity_type", ""),
            "summary": (page_data.get("summary", "") or "")[:420],
            "key_fact_count": len(page_data.get("key_facts", [])),
            "related_entity_count": len(page_data.get("related_entities", [])),
            "source_file_count": len(page_data.get("source_files", [])),
            "citation_coverage": page_data.get("citation_coverage", {}),
        })

    faiss_chunks = 0
    chunks_path = os.path.join(corpus_dir, "faiss", "chunks.pkl")
    try:
        import pickle
        with open(chunks_path, "rb") as f:
            faiss_chunks = len(pickle.load(f))
    except Exception:
        faiss_chunks = int(step_detail.get("faiss_chunks_indexed") or 0)

    return {
        **step_detail,
        "wiki_page_count": len(page_catalog),
        "wiki_pages": len(page_catalog) or step_detail.get("wiki_pages", 0),
        "wiki_pages_sample": [p.get("title") or p.get("canonical_id", "") for p in page_catalog[:30]],
        "sample_pages": sample_pages,
        "faiss_chunks_indexed": faiss_chunks,
        "index_updated_at": wiki_index.get("updated_at"),
        "warnings": [] if page_catalog else ["Wiki not generated yet"],
    }


def build_layer_artifacts(job_id: str, layer_id: str, row: dict[str, Any]) -> dict[str, Any]:
    metadata = parse_jsonish(row.get("metadata"), {})
    progress = parse_jsonish(row.get("progress"), {})
    corpus_dir = resolve_corpus_dir(job_id, metadata, row.get("graph_path"))
    processed_dir = os.path.join(corpus_dir, "processed")
    layers = normalize_layers(progress, row.get("status") or "pending")
    details = layer_detail_map(layers)
    step_detail = details.get(layer_id, {})

    if layer_id == "upload":
        return step_detail
    if layer_id == "extract":
        corpus_files = glob.glob(os.path.join(processed_dir, "*_corpus.json"))
        return {**step_detail, "corpus_files": [os.path.basename(f) for f in corpus_files]}
    if layer_id in {"clean", "chunk", "metadata"}:
        return step_detail
    if layer_id == "entities":
        kg = build_kg_preview(corpus_dir, details.get("graph_build", {}))
        return {
            **step_detail,
            "entity_sample": kg.get("node_sample", []),
            "relationship_sample": kg.get("edge_sample", []),
            "per_file_graph_count": kg.get("per_file_graph_count", 0),
            "confidence_histograms": build_eda_preview(corpus_dir, details.get("eda", {})).get("confidence_histograms", {}),
        }
    if layer_id == "semantic":
        return {
            **step_detail,
            "confidence_histograms": build_eda_preview(corpus_dir, details.get("eda", {})).get("confidence_histograms", {}),
        }
    if layer_id == "eda":
        return build_eda_preview(corpus_dir, step_detail)
    if layer_id == "validation":
        eda = build_eda_preview(corpus_dir, details.get("eda", {}))
        scorecard = eda.get("scorecard", {})
        score_keys = (
            "overall_kg_quality_score", "completeness_score", "consistency_score",
            "confidence_score", "graph_trust_score", "retrieval_readiness_score",
            "semantic_coherence_score", "canonical_resolution_score",
            "extraction_reliability_score",
        )
        return {**step_detail, "scorecards": eda.get("scorecards", []), "score_breakdown": {k: scorecard.get(k, 0) for k in score_keys}}
    if layer_id == "ontology":
        validations = glob_json(processed_dir, "*_graph_validation.json", 5)
        summaries = glob_json(processed_dir, "*_eda_summary.json", 3)
        semantic_metrics = summaries[0].get("semantic_quality_metrics", {}) if summaries else {}
        violations, contradictions, temporal = [], [], []
        for validation in validations:
            violations.extend(validation.get("ontology_violations", [])[:10])
            contradictions.extend(validation.get("semantic_inconsistencies", [])[:10])
        for summary in summaries:
            temporal.extend((summary.get("semantic_quality_metrics", {}) or {}).get("temporal_inconsistencies", [])[:10])
        return {
            **step_detail,
            "validations": validations,
            "semantic_metrics": semantic_metrics,
            "violation_samples": violations[:20],
            "contradiction_samples": contradictions[:20],
            "temporal_issues": temporal[:10],
        }
    if layer_id == "canonical":
        registry = read_json(os.path.join(corpus_dir, "canonical_registry.json")) or {}
        canonical_nodes = registry.get("canonical_nodes", [])
        merge_history = registry.get("merge_history", [])
        pending_reviews = registry.get("pending_reviews", [])
        return {
            **step_detail,
            "registry_summary": {
                "total_nodes": len(canonical_nodes),
                "total_aliases": sum(len(node.get("aliases", [])) for node in canonical_nodes),
                "merge_count": len(merge_history),
                "pending_review_count": len(pending_reviews),
            },
            "merge_history_sample": merge_history[:15],
            "pending_review_sample": pending_reviews[:10],
        }
    if layer_id == "graph_build":
        return build_kg_preview(corpus_dir, step_detail)
    if layer_id == "graph_consist":
        kg = build_kg_preview(corpus_dir, details.get("graph_build", {}))
        validations = glob_json(processed_dir, "*_graph_validation.json", 5)
        weak, dupes, disconnected, violations = [], [], [], []
        for validation in validations:
            weak.extend(validation.get("weak_edges", [])[:10])
            dupes.extend(validation.get("duplicate_entities", [])[:10])
            disconnected.extend(validation.get("disconnected_nodes", [])[:10])
            violations.extend(validation.get("ontology_violations", [])[:10])
        return {
            **step_detail,
            "weak_edges": weak[:20],
            "duplicate_entities": dupes[:20],
            "disconnected_nodes": disconnected[:20],
            "ontology_violations": violations[:20],
            "graph_stats": {
                "density": kg.get("density", 0),
                "active_count": kg.get("graph_edges", 0),
                "suppressed_count": 0,
            },
        }
    if layer_id == "wiki":
        return build_wiki_preview(corpus_dir, step_detail)
    return step_detail


def compute_kpis(row: dict[str, Any], layers: list[dict[str, Any]], corpus_dir: str) -> dict[str, Any]:
    details = layer_detail_map(layers)
    graph, _ = graph_payload(corpus_dir)
    eda = build_eda_preview(corpus_dir, details.get("eda", {}))
    scorecards = eda.get("scorecards", [])
    validations = eda.get("graph_validations", [])

    entity_detail = details.get("entities", {})
    graph_detail = details.get("graph_build", {})
    validation_detail = details.get("validation", {})
    ontology_detail = details.get("ontology", {})

    nodes = graph.get("nodes", []) if graph else []
    edges = [edge for edge in graph.get("edges", []) if not edge.get("suppressed")] if graph else []

    trust_score = validation_detail.get("avg_trust_score")
    if trust_score is None and scorecards:
        trust_score = scorecards[0].get("graph_trust_score") or scorecards[0].get("overall_kg_quality_score")

    ontology_count = ontology_detail.get("ontology_violations")
    if ontology_count is None and validations:
        ontology_count = sum(len(v.get("ontology_violations", [])) for v in validations if isinstance(v, dict))

    return {
        "entities": int(entity_detail.get("entity_count") or row.get("entity_count") or len(nodes) or 0),
        "relationships": int(entity_detail.get("relationship_count") or graph_detail.get("graph_edges") or len(edges) or 0),
        "graph_nodes": int(graph_detail.get("graph_nodes") or len(nodes) or 0),
        "trust_score": float(trust_score or 0.0),
        "ontology_consistency": int(ontology_count or 0),
    }


def derive_logs(progress: dict[str, Any], layers: list[dict[str, Any]], status: str, overall_pct: int) -> list[dict[str, Any]]:
    logs = progress.get("logs") or []
    if logs:
        return logs[-100:]
    derived = []
    for layer in layers:
        if layer.get("status") in {"running", "done", "error"}:
            derived.append({
                "ts": layer.get("completed_at") or layer.get("started_at"),
                "status": layer.get("status"),
                "layer_id": layer.get("id"),
                "message": f"{layer.get('label')} {layer.get('status')}",
                "overall_pct": overall_pct,
            })
    if not derived:
        derived.append({"ts": None, "status": status, "message": f"Pipeline status: {status}", "overall_pct": overall_pct})
    return derived[-100:]


def build_snapshot(job_id: str, row: dict[str, Any]) -> dict[str, Any]:
    metadata = parse_jsonish(row.get("metadata"), {})
    progress = parse_jsonish(row.get("progress"), {})
    status = row.get("status") or "pending"
    corpus_dir = resolve_corpus_dir(job_id, metadata, row.get("graph_path"))
    layers = normalize_layers(progress, status)
    details = layer_detail_map(layers)
    overall_pct = int(progress.get("overall_pct") or (100 if status == "graph_done" else 0))
    kpis = compute_kpis(row, layers, corpus_dir)
    eda_preview = build_eda_preview(corpus_dir, details.get("eda", {}))
    kg_preview = build_kg_preview(corpus_dir, details.get("graph_build", {}))
    wiki_preview = build_wiki_preview(corpus_dir, details.get("wiki", {}))

    artifacts_available = {
        "eda": bool(eda_preview.get("visuals") or eda_preview.get("scorecards")),
        "kg": bool(kg_preview.get("node_sample") or kg_preview.get("graph_nodes")),
        "wiki": bool(wiki_preview.get("sample_pages") or wiki_preview.get("wiki_pages_sample")),
    }

    return {
        "job_id": job_id,
        "status": status,
        "db_status": status,
        "domain_label": row.get("domain_label") or metadata.get("domain_label") or "general",
        "overall_pct": overall_pct,
        "eta_seconds": progress.get("eta_seconds"),
        "terminal": status in TERMINAL_STATUSES,
        "layers": layers,
        "kpis": kpis,
        "previews": {
            "eda": eda_preview,
            "kg": kg_preview,
            "wiki": wiki_preview,
            "entities": [entity.get("label") for entity in kg_preview.get("central_entities", []) if entity.get("label")],
        },
        "logs": derive_logs(progress, layers, status, overall_pct),
        "artifacts_available": artifacts_available,
        "corpus_dir": corpus_dir,
        "graph_path": row.get("graph_path") or os.path.join(corpus_dir, "canonical_graph.json"),
        "file_count": row.get("file_count") or kpis.get("files", 0) or 0,
        "entity_count": row.get("entity_count") or kpis.get("entities", 0),
        "community_count": row.get("community_count") or 0,
        "error": row.get("error_message") or row.get("error"),
        "created_at": _to_iso(row.get("created_at")),
        "completed_at": _to_iso(row.get("completed_at")),
    }
