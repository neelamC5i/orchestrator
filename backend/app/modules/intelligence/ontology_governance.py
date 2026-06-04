"""
Layer 10 — Ontology & Semantic Governance Layer.

Acts as the enterprise semantic rule engine. Derives an entity-type taxonomy
and a relationship-constraint table directly from the already-extracted
entities/relationships (available from the entity-extraction layer — no
canonical graph required yet, which preserves the architecture ordering), then
flags relationships whose endpoint types deviate from the dominant observed
signature for that relation.

Artifact: <corpus_dir>/ontology.json
"""
import json
import logging
import os
from collections import Counter, defaultdict
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

ARTIFACT_NAME = "ontology.json"


def _entity_type_index(all_entities_by_file: Dict[str, List[Dict[str, Any]]]) -> Dict[str, str]:
    """Map normalized entity text → its (most recent) type/label."""
    idx: Dict[str, str] = {}
    for ents in all_entities_by_file.values():
        for e in ents:
            text = str(e.get("text") or "").strip().lower()
            etype = str(e.get("type") or e.get("label") or "ENTITY")
            if text:
                idx[text] = etype
    return idx


def run_ontology_governance(
    corpus_dir: str,
    all_entities_by_file: Dict[str, List[Dict[str, Any]]],
    all_rels_by_file: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """Build taxonomy + relation constraints + violation flags."""
    # ── Entity-type taxonomy ─────────────────────────────────────────────────
    taxonomy: Counter = Counter()
    for ents in all_entities_by_file.values():
        for e in ents:
            taxonomy[str(e.get("type") or e.get("label") or "ENTITY")] += 1

    type_of = _entity_type_index(all_entities_by_file)

    # ── Observed (src_type → tgt_type) signatures per relation ───────────────
    signatures: Dict[str, Counter] = defaultdict(Counter)
    all_rels: List[Dict[str, Any]] = []
    for rels in all_rels_by_file.values():
        for r in rels:
            all_rels.append(r)
            relation = str(r.get("relation") or "related_to")
            src_t = type_of.get(str(r.get("source") or "").strip().lower(), "UNKNOWN")
            tgt_t = type_of.get(str(r.get("target") or "").strip().lower(), "UNKNOWN")
            signatures[relation][(src_t, tgt_t)] += 1

    relation_constraints: Dict[str, Any] = {}
    dominant: Dict[str, Any] = {}
    for relation, sig in signatures.items():
        ranked = sig.most_common()
        relation_constraints[relation] = [
            {"src_type": s, "tgt_type": t, "count": c} for (s, t), c in ranked[:10]
        ]
        if ranked:
            dominant[relation] = ranked[0][0]  # (src_type, tgt_type)

    # ── Violations: endpoint types deviating from the dominant signature ─────
    violations: List[Dict[str, Any]] = []
    for r in all_rels:
        relation = str(r.get("relation") or "related_to")
        if relation not in dominant:
            continue
        src_t = type_of.get(str(r.get("source") or "").strip().lower(), "UNKNOWN")
        tgt_t = type_of.get(str(r.get("target") or "").strip().lower(), "UNKNOWN")
        if (src_t, tgt_t) != dominant[relation] and "UNKNOWN" not in (src_t, tgt_t):
            violations.append({
                "source": r.get("source"),
                "target": r.get("target"),
                "relation": relation,
                "observed": [src_t, tgt_t],
                "expected": list(dominant[relation]),
            })

    artifact = {
        "taxonomy": dict(taxonomy),
        "relation_constraints": relation_constraints,
        "dominant_signatures": {k: list(v) for k, v in dominant.items()},
        "violations": violations[:250],
        "summary": {
            "type_count": len(taxonomy),
            "relation_count": len(relation_constraints),
            "violation_count": len(violations),
        },
    }

    try:
        with open(os.path.join(corpus_dir, ARTIFACT_NAME), "w", encoding="utf-8") as f:
            json.dump(artifact, f)
    except Exception as exc:
        logger.warning("ontology_governance write failed: %s", exc)

    return artifact["summary"]
