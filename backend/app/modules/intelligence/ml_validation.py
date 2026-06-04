"""
Layer 9 — ML Validation & Accuracy Engine.

Validates semantic intelligence statistically using the per-entity /
per-relationship `eda_confidence` already attached by the confidence-scoring
stage. Produces precision/recall/F1 *proxies*, a hallucination-risk proxy, and
confidence histograms, plus an aggregate quality scorecard. Reuses
confidence_scoring.quality_scorecard / confidence_histogram.

Artifact: <corpus_dir>/ml_validation.json
"""
import json
import logging
import os
from typing import Any, Dict, List

from app.modules.kg.confidence_scoring import quality_scorecard, confidence_histogram

logger = logging.getLogger(__name__)

ARTIFACT_NAME = "ml_validation.json"

_CONF_THRESHOLD = 0.5  # entity/relation considered "accepted" at/above this


def _confidences(items: List[Dict[str, Any]]) -> List[float]:
    out: List[float] = []
    for it in items:
        try:
            out.append(float(it.get("eda_confidence", 0.0) or 0.0))
        except Exception:
            out.append(0.0)
    return out


def run_ml_validation(
    corpus_dir: str,
    all_entities_by_file: Dict[str, List[Dict[str, Any]]],
    all_rels_by_file: Dict[str, List[Dict[str, Any]]],
    eda_results: Dict[str, Any],
) -> Dict[str, Any]:
    """Aggregate confidence signals into accuracy proxies + scorecard."""
    all_entities: List[Dict[str, Any]] = [e for v in all_entities_by_file.values() for e in v]
    all_rels: List[Dict[str, Any]] = [r for v in all_rels_by_file.values() for r in v]

    ent_conf = _confidences(all_entities)
    rel_conf = _confidences(all_rels)

    ent_mean = round(sum(ent_conf) / len(ent_conf), 4) if ent_conf else 0.0
    rel_mean = round(sum(rel_conf) / len(rel_conf), 4) if rel_conf else 0.0

    # Precision proxy: share of items at/above the acceptance threshold.
    accepted_ents = sum(1 for c in ent_conf if c >= _CONF_THRESHOLD)
    accepted_rels = sum(1 for c in rel_conf if c >= _CONF_THRESHOLD)
    precision_proxy = round(
        (accepted_ents + accepted_rels) / max(1, len(ent_conf) + len(rel_conf)), 4
    )
    # Recall proxy: mean confidence of accepted items (coverage of the signal).
    accepted_vals = [c for c in (ent_conf + rel_conf) if c >= _CONF_THRESHOLD]
    recall_proxy = round(sum(accepted_vals) / len(accepted_vals), 4) if accepted_vals else 0.0
    f1_proxy = round(
        2 * precision_proxy * recall_proxy / max(1e-9, (precision_proxy + recall_proxy)), 4
    ) if (precision_proxy + recall_proxy) > 0 else 0.0

    # Hallucination-risk proxy: share of relationships below threshold (weakly
    # grounded edges are the primary hallucination vector downstream).
    weak_rels = sum(1 for c in rel_conf if c < _CONF_THRESHOLD)
    hallucination_risk = round(weak_rels / max(1, len(rel_conf)), 4) if rel_conf else 0.0

    scorecard = quality_scorecard(
        entity_mean=ent_mean,
        relation_mean=rel_mean,
        graph_density=0.0,                       # filled by graph-validation layer
        consistency_score=1.0 - hallucination_risk,
        completeness_score=precision_proxy,
        extraction_reliability=recall_proxy,
    )

    artifact = {
        "precision_proxy": precision_proxy,
        "recall_proxy": recall_proxy,
        "f1_proxy": f1_proxy,
        "hallucination_risk": hallucination_risk,
        "entity_mean_confidence": ent_mean,
        "relation_mean_confidence": rel_mean,
        "entity_count": len(ent_conf),
        "relation_count": len(rel_conf),
        "entity_confidence_histogram": confidence_histogram(ent_conf),
        "relation_confidence_histogram": confidence_histogram(rel_conf),
        "scorecard": scorecard,
    }

    try:
        with open(os.path.join(corpus_dir, ARTIFACT_NAME), "w", encoding="utf-8") as f:
            json.dump(artifact, f)
    except Exception as exc:
        logger.warning("ml_validation write failed: %s", exc)

    return {
        "f1_proxy": f1_proxy,
        "precision_proxy": precision_proxy,
        "recall_proxy": recall_proxy,
        "hallucination_risk": hallucination_risk,
    }
