"""
Layer 5 — Metadata Intelligence Engine.

Generates semantic metadata automatically for tabular corpora: per-column
semantic labels + datatype inference, table classification, and PK/FK
candidate prediction. Reuses the heuristic + optional-Ollama detectors already
built for database profiling so absurd enterprise column names (TMP_X1,
cust_ref, col_102) still get a best-effort semantic label and confidence.

Artifact: <corpus_dir>/metadata_intelligence.json
"""
import json
import logging
import os
from collections import Counter
from typing import Any, Dict, List

from app.modules.db.db_profiler import (
    detect_semantic_meaning,
    detect_table_semantic_meaning,
    detect_implicit_relationships,
)

logger = logging.getLogger(__name__)

ARTIFACT_NAME = "metadata_intelligence.json"

# Tabular source types that carry column structure in corpus["metadata"].
_TABULAR_SOURCE_TYPES = {"csv", "xlsx", "xls", "excel", "table", "parquet", "tsv"}


def _column_sample_values(table_rows: List[Dict[str, Any]], col: str, limit: int = 12) -> List[Any]:
    """Pull up to `limit` non-null sample values for a column from table_rows."""
    samples: List[Any] = []
    for row in table_rows:
        cells = row.get("cells", {}) or {}
        cell = cells.get(col)
        if isinstance(cell, dict):
            value = cell.get("value")
        else:
            value = cell
        if value is not None and str(value).strip() != "":
            samples.append(value)
        if len(samples) >= limit:
            break
    return samples


def _column_value_type(table_rows: List[Dict[str, Any]], col: str) -> str:
    """Most-common inferred value_type for a column (datatype inference)."""
    types: Counter = Counter()
    for row in table_rows:
        cells = row.get("cells", {}) or {}
        cell = cells.get(col)
        if isinstance(cell, dict) and cell.get("value_type"):
            types[str(cell.get("value_type"))] += 1
    if not types:
        return "unknown"
    return types.most_common(1)[0][0]


def run_metadata_intelligence(
    corpus_dir: str,
    all_corpora: Dict[str, Any],
    all_chunks_by_file: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """
    all_corpora: {file_id: (ext, corpus_dict)} as produced by the extract stage.
    Returns a summary dict and writes metadata_intelligence.json.
    """
    files_out: Dict[str, Any] = {}
    synthesized_tables: List[Dict[str, Any]] = []  # for PK/FK inference
    tabular_count = 0

    for file_id, payload in all_corpora.items():
        try:
            ext, corpus = payload if isinstance(payload, tuple) else ("", payload)
        except Exception:
            ext, corpus = "", {}
        corpus = corpus or {}
        source_type = str(corpus.get("source_type") or ext or "").lower()
        meta = corpus.get("metadata", {}) or {}
        columns: List[str] = meta.get("columns", []) or []
        table_rows: List[Dict[str, Any]] = corpus.get("table_rows", []) or []

        is_tabular = bool(columns) and (
            source_type in _TABULAR_SOURCE_TYPES or bool(table_rows)
        )
        if not is_tabular:
            files_out[file_id] = {
                "applicable": False,
                "source_type": source_type or "unstructured",
                "reason": "non-tabular corpus; column metadata not derivable",
            }
            continue

        tabular_count += 1
        col_profiles: List[Dict[str, Any]] = []
        for col in columns:
            samples = _column_sample_values(table_rows, col)
            semantic = detect_semantic_meaning(col, samples)
            col_profiles.append({
                "column": col,
                "semantic_label": semantic.get("semantic_label", "unknown"),
                "confidence": semantic.get("confidence", 0.0),
                "method": semantic.get("method", "heuristic"),
                "value_type": _column_value_type(table_rows, col),
                "sample_count": len(samples),
            })

        table_class = detect_table_semantic_meaning(file_id, col_profiles)

        # PK candidates: identifier-labelled columns or id-suffixed names.
        pk_candidates = [
            c["column"] for c in col_profiles
            if c["semantic_label"] == "identifier" or str(c["column"]).lower().endswith("id")
        ]

        files_out[file_id] = {
            "applicable": True,
            "source_type": source_type,
            "row_count": meta.get("row_count", len(table_rows)),
            "column_count": meta.get("column_count", len(columns)),
            "table_semantic_label": table_class.get("table_semantic_label", "unknown"),
            "table_confidence": table_class.get("confidence", 0.0),
            "columns": col_profiles,
            "pk_candidates": pk_candidates,
        }

        synthesized_tables.append({
            "table_name": file_id,
            "columns": [{"name": c["column"]} for c in col_profiles],
        })

    # FK candidates inferred across the synthesized table set (naming rules).
    fk_candidates: List[Dict[str, Any]] = []
    try:
        fk_candidates = detect_implicit_relationships({"tables": synthesized_tables})
    except Exception as exc:
        logger.warning("metadata_intelligence FK inference failed: %s", exc)

    # Attach FK candidates back to their source files.
    for fk in fk_candidates:
        src = fk.get("source_table")
        if src in files_out and files_out[src].get("applicable"):
            files_out[src].setdefault("fk_candidates", []).append(fk)

    labelled = sum(
        1
        for f in files_out.values()
        if f.get("applicable") and f.get("table_semantic_label") not in (None, "unknown")
    )
    artifact = {
        "files": files_out,
        "summary": {
            "file_count": len(files_out),
            "tabular_file_count": tabular_count,
            "classified_table_count": labelled,
            "fk_candidate_count": len(fk_candidates),
        },
    }

    try:
        with open(os.path.join(corpus_dir, ARTIFACT_NAME), "w", encoding="utf-8") as f:
            json.dump(artifact, f)
    except Exception as exc:
        logger.warning("metadata_intelligence write failed: %s", exc)

    return artifact["summary"]
