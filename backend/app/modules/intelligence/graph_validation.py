"""
Layer 13 — Graph Validation & Consistency Engine.

Continuously validates the constructed knowledge graph: orphan nodes,
disconnected components, invalid cycles, weak/duplicate edges, and ontology
violations carried over from layer 10. Produces a single graph trust score.
Reuses GraphBuilder.get_canonical_graph / canonical_graph_metrics and
graph_validation_utils. networkx (already in requirements) is used for cycle
detection but imported lazily so the layer degrades gracefully without it.

Artifact: <corpus_dir>/graph_validation.json
"""
import json
import logging
import os
from typing import Any, Dict, List, Optional

from app.modules.eda.graph_validation_utils import graph_metrics, validate_relationship_quality
from app.modules.kg.confidence_scoring import quality_scorecard

logger = logging.getLogger(__name__)

ARTIFACT_NAME = "graph_validation.json"

_MAX_CYCLES = 50


def _detect_cycles(graph: Dict[str, Any]) -> Optional[List[List[str]]]:
    """Return up to _MAX_CYCLES simple cycles, or None if networkx unavailable."""
    try:
        import networkx as nx
    except Exception:
        return None
    try:
        g = nx.DiGraph()
        for n in graph.get("nodes", []):
            nid = n.get("id")
            if nid:
                g.add_node(str(nid))
        for e in graph.get("edges", []):
            s, t = e.get("source"), e.get("target")
            if s and t:
                g.add_edge(str(s), str(t))
        cycles: List[List[str]] = []
        for cyc in nx.simple_cycles(g):
            cycles.append([str(x) for x in cyc])
            if len(cycles) >= _MAX_CYCLES:
                break
        return cycles
    except Exception as exc:
        logger.warning("cycle detection failed: %s", exc)
        return []


def run_graph_validation(
    corpus_dir: str,
    graph_builder: Any,
    ontology_artifact: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Validate the canonical graph and compute a trust score."""
    graph = graph_builder.get_canonical_graph()
    metrics = graph_metrics(graph)
    rel_quality = validate_relationship_quality(graph, graph.get("edges", []))

    try:
        cg_metrics = graph_builder.canonical_graph_metrics()
    except Exception as exc:
        logger.warning("canonical_graph_metrics failed: %s", exc)
        cg_metrics = {}

    cycles = _detect_cycles(graph)
    cycle_count = len(cycles) if cycles is not None else 0

    ontology_violations = 0
    if isinstance(ontology_artifact, dict):
        # Accept either the flat summary dict or the full artifact (with "summary").
        ontology_violations = int(
            ontology_artifact.get(
                "violation_count",
                (ontology_artifact.get("summary", {}) or {}).get("violation_count", 0),
            )
        )

    # Trust score: penalise high-risk edges, orphans, contradictions.
    high_risk = float(cg_metrics.get("high_risk_edge_ratio", 0.0) or 0.0)
    contradiction = float(cg_metrics.get("contradiction_ratio", 0.0) or 0.0)
    node_count = max(1, metrics.get("node_count", 0))
    orphan_ratio = len(metrics.get("isolated_node_ids", [])) / node_count

    scorecard = quality_scorecard(
        entity_mean=1.0 - orphan_ratio,
        relation_mean=1.0 - high_risk,
        graph_density=float(metrics.get("graph_density", 0.0) or 0.0),
        consistency_score=1.0 - contradiction,
        completeness_score=1.0 - orphan_ratio,
        extraction_reliability=1.0 - high_risk,
    )
    trust_score = scorecard.get("graph_trust_score", 0.0)

    artifact = {
        "node_count": metrics.get("node_count", 0),
        "edge_count": metrics.get("edge_count", 0),
        "orphan_node_ids": metrics.get("isolated_node_ids", [])[:200],
        "orphan_node_count": len(metrics.get("isolated_node_ids", [])),
        "disconnected_component_count": metrics.get("disconnected_component_count", 0),
        "graph_density": metrics.get("graph_density", 0.0),
        "cycle_detection_available": cycles is not None,
        "cycle_count": cycle_count,
        "cycles": (cycles or [])[:20],
        "weak_edge_count": len(rel_quality.get("weak_edges", [])),
        "duplicate_relationship_count": len(rel_quality.get("duplicate_relationships", [])),
        "invalid_edge_count": len(rel_quality.get("invalid_edge_patterns", [])),
        "ontology_violation_count": ontology_violations,
        "trust_score": trust_score,
        "scorecard": scorecard,
        "canonical_metrics": cg_metrics,
    }

    try:
        with open(os.path.join(corpus_dir, ARTIFACT_NAME), "w", encoding="utf-8") as f:
            json.dump(artifact, f)
    except Exception as exc:
        logger.warning("graph_validation write failed: %s", exc)

    return {
        "trust_score": trust_score,
        "orphan_node_count": artifact["orphan_node_count"],
        "cycle_count": cycle_count,
        "ontology_violation_count": ontology_violations,
    }
