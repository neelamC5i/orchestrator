"""
Layer 7 — Semantic Learning Layer.

Learns enterprise semantics progressively from the extracted entities and
chunks: embedding-based semantic clustering of entity labels plus chunk-level
co-occurrence. Reuses the platform's FaissStore embedding function (which has a
deterministic fallback when sentence-transformers is unavailable, so this layer
is always functional).

Artifact: <corpus_dir>/semantic_learning.json
"""
import json
import logging
import os
from collections import Counter, defaultdict
from typing import Any, Callable, Dict, List

logger = logging.getLogger(__name__)

ARTIFACT_NAME = "semantic_learning.json"

_CLUSTER_THRESHOLD = 0.80   # cosine similarity to join an existing cluster
_MAX_ENTITIES = 400         # cap to keep embedding cost bounded
_MAX_COOCCURRENCE = 60      # top co-occurring pairs to keep


def _cosine(a, b) -> float:
    import numpy as np
    a = np.asarray(a, dtype="float32")
    b = np.asarray(b, dtype="float32")
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def run_semantic_learning(
    corpus_dir: str,
    all_entities_by_file: Dict[str, List[Dict[str, Any]]],
    all_chunks_by_file: Dict[str, List[Dict[str, Any]]],
    embed_fn: Callable[[str], Any],
) -> Dict[str, Any]:
    """Greedy cosine clustering of entity labels + chunk co-occurrence pairs."""
    # ── Collect unique entity labels with frequency ──────────────────────────
    label_freq: Counter = Counter()
    for ents in all_entities_by_file.values():
        for e in ents:
            text = str(e.get("text") or "").strip()
            if text:
                label_freq[text] += 1
    unique_labels = [lbl for lbl, _ in label_freq.most_common(_MAX_ENTITIES)]

    # ── Embed + greedy cluster ───────────────────────────────────────────────
    clusters: List[Dict[str, Any]] = []  # {centroid, members}
    for label in unique_labels:
        try:
            vec = embed_fn(label)
        except Exception:
            continue
        placed = False
        for cl in clusters:
            if _cosine(vec, cl["centroid"]) >= _CLUSTER_THRESHOLD:
                cl["members"].append(label)
                placed = True
                break
        if not placed:
            clusters.append({"centroid": vec, "members": [label]})

    cluster_out = [
        {"cluster_id": i, "members": cl["members"][:25], "size": len(cl["members"])}
        for i, cl in enumerate(sorted(clusters, key=lambda c: len(c["members"]), reverse=True))
    ]

    # ── Chunk-level co-occurrence (entities sharing a chunk_idx, per file) ────
    pair_counts: Counter = Counter()
    for file_id, ents in all_entities_by_file.items():
        by_chunk: Dict[Any, set] = defaultdict(set)
        for e in ents:
            text = str(e.get("text") or "").strip()
            cidx = e.get("chunk_idx")
            if text and cidx is not None:
                by_chunk[cidx].add(text)
        for members in by_chunk.values():
            members_list = sorted(members)
            for i in range(len(members_list)):
                for j in range(i + 1, len(members_list)):
                    pair_counts[(members_list[i], members_list[j])] += 1

    cooccurrence = [
        {"a": a, "b": b, "count": c}
        for (a, b), c in pair_counts.most_common(_MAX_COOCCURRENCE)
    ]

    mean_size = (
        round(sum(c["size"] for c in cluster_out) / len(cluster_out), 2)
        if cluster_out else 0.0
    )
    artifact = {
        "clusters": cluster_out,
        "cooccurrence": cooccurrence,
        "summary": {
            "unique_entity_count": len(unique_labels),
            "cluster_count": len(cluster_out),
            "mean_cluster_size": mean_size,
            "cooccurrence_pair_count": len(cooccurrence),
        },
    }

    try:
        with open(os.path.join(corpus_dir, ARTIFACT_NAME), "w", encoding="utf-8") as f:
            json.dump(artifact, f)
    except Exception as exc:
        logger.warning("semantic_learning write failed: %s", exc)

    return artifact["summary"]
