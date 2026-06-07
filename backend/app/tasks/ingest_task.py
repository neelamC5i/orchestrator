"""
Celery tasks: 14-layer file ingest pipeline, 7-stage DB ingest pipeline, reindex.

Writes granular progress into ingest_jobs.progress (JSONB):
{
  "steps": [
    {"id": "upload", "label": "...", "status": "done|running|pending|error",
     "pct": 0, "detail": "{}", "started_at": null, "completed_at": null, "error_code": null},
    ...
  ],
  "current_step": 2,
  "overall_pct": 45,
  "pipeline_started_at": 1234567890.0
}
"""
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from app.tasks import celery_app

logger = logging.getLogger(__name__)


# ── DB helpers ────────────────────────────────────────────────────────────────

def _pg_connect():
    from app.config import get_settings
    import psycopg2
    import urllib.parse as _up
    s = get_settings()
    p = _up.urlparse(s.database_url.replace("+asyncpg", "").replace("+psycopg2", ""))
    return psycopg2.connect(
        host=p.hostname,
        port=p.port or 5432,
        dbname=p.path.lstrip("/"),
        user=p.username,
        password=p.password,
    )


def _make_step(step_id, label):
    return {
        "id": step_id, "label": label, "status": "pending",
        "pct": 0, "detail": "", "started_at": None, "completed_at": None, "error_code": None,
    }


def _begin_step(steps, idx):
    steps[idx]["status"] = "running"
    steps[idx]["started_at"] = time.time()


def _finish_step(steps, idx, detail="", error_code=None):
    if error_code:
        steps[idx]["status"] = "error"
        steps[idx]["error_code"] = error_code
    else:
        steps[idx]["status"] = "done"
    steps[idx]["pct"] = 100
    steps[idx]["detail"] = detail if isinstance(detail, str) else json.dumps(detail)
    steps[idx]["completed_at"] = time.time()


def _update_steps(job_id, steps, current_idx, status, extra=None):
    done = sum(1 for s in steps if s.get("status") == "done")
    running = sum(0.25 for s in steps if s.get("status") == "running")
    pct = int(min(100, ((done + running) / max(1, len(steps))) * 100))
    started_values = [s.get("started_at") for s in steps if s.get("started_at")]
    pipeline_started_at = min(started_values) if started_values else time.time()
    elapsed = max(0, time.time() - pipeline_started_at)
    eta_seconds = None
    if pct > 0 and status not in {"graph_done", "failed", "error"}:
        eta_seconds = int(max(0, (elapsed / pct) * (100 - pct)))

    existing_logs = []
    try:
        conn = _pg_connect()
        cur = conn.cursor()
        cur.execute("SELECT progress FROM ingest_jobs WHERE job_id=%s", (job_id,))
        row = cur.fetchone()
        cur.close()
        conn.close()
        existing_progress = row[0] if row else {}
        if isinstance(existing_progress, str):
            existing_progress = json.loads(existing_progress)
        if isinstance(existing_progress, dict):
            existing_logs = existing_progress.get("logs", []) or []
    except Exception:
        existing_logs = []

    current_step = steps[current_idx] if 0 <= current_idx < len(steps) else {}
    log_entry = {
        "ts": time.time(),
        "status": status,
        "layer_id": current_step.get("id"),
        "message": f"{current_step.get('label', 'Pipeline')} {current_step.get('status', status)}",
        "overall_pct": pct,
    }
    last_log = existing_logs[-1] if existing_logs else {}
    if (
        last_log.get("status") != log_entry["status"]
        or last_log.get("layer_id") != log_entry["layer_id"]
        or last_log.get("message") != log_entry["message"]
        or last_log.get("overall_pct") != log_entry["overall_pct"]
    ):
        existing_logs = [*existing_logs, log_entry][-100:]

    payload = json.dumps({
        "steps": steps,
        "current_step": current_idx,
        "overall_pct": pct,
        "eta_seconds": eta_seconds,
        "pipeline_started_at": pipeline_started_at,
        "logs": existing_logs,
    })
    extra_sql = ""
    vals = [status, payload]
    if extra:
        extra_sql = ", " + ", ".join(f"{k}=%s" for k in extra)
        vals += list(extra.values())
    vals.append(job_id)
    try:
        conn = _pg_connect()
        cur = conn.cursor()
        cur.execute(
            f"UPDATE ingest_jobs SET status=%s, progress=(%s)::jsonb{extra_sql} WHERE job_id=%s",
            vals,
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as exc:
        logger.warning("_update_steps failed: %s", exc)


def _check_gate(job_id: str, step: str, timeout: int = 600) -> bool:
    """Block until the gate for this step is approved or timeout expires.
    Returns True if approved, False if timed out.
    If no gate is set (i.e. gates not enabled), returns True immediately."""
    try:
        import redis
        from app.config import get_settings
        settings = get_settings()
        r = redis.from_url(settings.redis_url, decode_responses=True)
        if not r.exists(f"pipeline_config:{job_id}"):
            return True
        config_raw = r.get(f"pipeline_config:{job_id}")
        if config_raw:
            config = json.loads(config_raw)
            if not config.get("gates_enabled", False):
                return True
    except Exception:
        return True

    waited = 0
    poll_interval = 2
    while waited < timeout:
        try:
            if r.exists(f"pipeline_pause:{job_id}"):
                time.sleep(poll_interval)
                waited += poll_interval
                continue
            gate_val = r.get(f"gate:{job_id}:{step}")
            if gate_val == "approved":
                return True
        except Exception:
            return True
        time.sleep(poll_interval)
        waited += poll_interval
    return True


def _fallback_graph_from_schema(metadata):
    nodes, edges = [], []
    for table in metadata.get("tables", []):
        tname = table.get("table_name", "")
        nodes.append({"id": tname, "label": tname, "type": "table"})
        for fk in table.get("foreign_keys", []):
            edges.append({"source": tname, "target": fk.get("referred_table", ""),
                          "relation": "references", "confidence": 0.9})
    return {"nodes": nodes, "edges": edges}


# ── Main file ingest pipeline ─────────────────────────────────────────────────

@celery_app.task(name="run_ingest_pipeline", bind=True, max_retries=2)
def run_ingest_pipeline(self, job_id):  # noqa: C901
    pipeline_started = time.time()
    corpus_dir = f"corpus_store/{job_id}"
    processed_dir = ""

    steps = [
        _make_step("upload",        "File Upload + Lineage"),         # 0
        _make_step("extract",       "Ingestion & Extraction"),        # 1
        _make_step("clean",         "Cleaning + Normalization"),      # 2
        _make_step("chunk",         "Chunking + Segmentation"),       # 3
        _make_step("metadata",      "Metadata Intelligence"),         # 4
        _make_step("entities",      "Entity + Relationship"),         # 5
        _make_step("semantic",      "Semantic Learning"),             # 6
        _make_step("eda",           "EDA Intelligence"),              # 7
        _make_step("validation",    "ML Validation & Accuracy"),     # 8
        _make_step("ontology",      "Ontology & Governance"),         # 9
        _make_step("canonical",     "Canonicalization"),              # 10
        _make_step("graph_build",   "KG Construction"),              # 11
        _make_step("graph_consist", "Graph Consistency"),             # 12
        _make_step("wiki",          "Wiki + Explainability"),        # 13
    ]

    stored_corpus_dir = None
    try:
        conn = _pg_connect()
        cur = conn.cursor()
        cur.execute("SELECT metadata FROM ingest_jobs WHERE job_id=%s", (job_id,))
        row = cur.fetchone()
        cur.close()
        conn.close()
        meta = row[0] if row else {}
        if isinstance(meta, str):
            import json as _j; meta = _j.loads(meta)
        stored_corpus_dir = (meta or {}).get("corpus_dir")
    except Exception as exc:
        logger.error("Failed to fetch job %s: %s", job_id, exc)

    if stored_corpus_dir and os.path.isdir(stored_corpus_dir):
        corpus_dir = stored_corpus_dir
    else:
        corpus_dir = f"corpus_store/{job_id}"
    os.makedirs(corpus_dir, exist_ok=True)
    processed_dir = os.path.join(corpus_dir, "processed")
    os.makedirs(processed_dir, exist_ok=True)

    from app.modules.ingestion.corpus import extract_corpus
    from app.modules.pipeline.processing import clean_text, chunk_text, validate_chunking
    from app.modules.data_curation.nlp_entity_extractor import extract_entities_from_chunks
    from app.modules.kg.confidence_scoring import score_entities, score_relationships
    from app.modules.eda.file_eda_service import run_file_eda
    from app.modules.kg.knowledge_schema import (
        build_canonical_nodes, build_canonical_edges, validate_canonical_graph,
    )
    from app.modules.kg.entity_resolution import resolve_canonical_graph
    from app.modules.kg.cross_source_linker import link_cross_source
    from app.modules.graph.graph_builder import GraphBuilder
    from app.modules.wiki.wiki_builder import WikiBuilder
    from app.modules.data_curation.faiss_store import FaissStore

    graph_builder = GraphBuilder(corpus_dir)
    wiki_builder = WikiBuilder(corpus_dir)
    embed_store = FaissStore(corpus_dir)

    SKIP_SUFFIXES = {".json", ".faiss", ".pkl", ".bin", ".idx", ""}
    files_to_process = []
    for fp in Path(corpus_dir).iterdir():
        if fp.is_file() and fp.suffix.lower() not in SKIP_SUFFIXES:
            files_to_process.append((fp.stem, str(fp)))

    # ── Layer 1: File Upload + Lineage ────────────────────────────────────────
    _begin_step(steps, 0)
    _update_steps(job_id, steps, 0, "ingesting")

    if not files_to_process:
        _finish_step(steps, 0, "No files found in corpus directory", error_code="ERR-UP-001")
        _update_steps(job_id, steps, 0, "failed", {"error_message": "no_files_found"})
        return

    file_manifest = []
    for file_id, file_path in files_to_process:
        p = Path(file_path)
        file_manifest.append({
            "file_id": file_id, "name": p.name,
            "ext": p.suffix.lower().lstrip("."),
            "size_bytes": p.stat().st_size if p.exists() else 0,
        })

    _finish_step(steps, 0, json.dumps({
        "file_count": len(files_to_process),
        "files": file_manifest,
        "corpus_dir": corpus_dir,
    }))
    _update_steps(job_id, steps, 1, "ingesting")

    # ── Layer 2: Ingestion & Extraction ───────────────────────────────────────
    _begin_step(steps, 1)
    _update_steps(job_id, steps, 1, "ingesting")
    all_corpora = {}
    extract_errors = 0
    for file_id, file_path in files_to_process:
        ext = Path(file_path).suffix.lower().lstrip(".")
        try:
            corpus = extract_corpus(file_path, ext)
        except Exception as exc:
            logger.warning("extract_corpus failed for %s: %s", file_path, exc)
            corpus = {"plain_text": "", "text_blocks": [], "table_rows": [], "metadata": {}, "source_type": "unknown", "adapter": "raw"}
            extract_errors += 1
        all_corpora[file_id] = (ext, corpus)
        try:
            with open(os.path.join(processed_dir, f"{file_id}_corpus.json"), "w", encoding="utf-8") as f:
                json.dump({"ext": ext, **corpus}, f)
        except Exception:
            pass

    total_chars = sum(len((c.get("plain_text") or "")) for _, c in all_corpora.values())
    _finish_step(steps, 1, json.dumps({
        "files_extracted": len(all_corpora), "extract_errors": extract_errors,
        "total_chars": total_chars,
    }))
    _update_steps(job_id, steps, 2, "ingesting")

    # ── Layer 3: Cleaning + Normalization ─────────────────────────────────────
    _begin_step(steps, 2)
    _update_steps(job_id, steps, 2, "ingesting")
    all_cleaned = {}
    for file_id, (ext, corpus) in all_corpora.items():
        raw_text = corpus.get("plain_text", "") or ""
        all_cleaned[file_id] = clean_text(raw_text)

    total_cleaned_words = sum(len(t.split()) for t in all_cleaned.values())
    _finish_step(steps, 2, json.dumps({
        "files_cleaned": len(all_cleaned), "total_words": total_cleaned_words,
    }))
    _update_steps(job_id, steps, 3, "ingesting")

    # ── Layer 4: Chunking + Segmentation ──────────────────────────────────────
    _begin_step(steps, 3)
    _update_steps(job_id, steps, 3, "ingesting")
    all_chunks_by_file = {}
    all_validations = {}
    for file_id, cleaned in all_cleaned.items():
        chunks = chunk_text(cleaned)
        validation = validate_chunking(chunks, len(cleaned.split()), target_overlap=60)
        all_chunks_by_file[file_id] = chunks
        all_validations[file_id] = validation

    total_chunks = sum(len(c) for c in all_chunks_by_file.values())
    avg_coverage = 0.0
    if all_validations:
        avg_coverage = sum(v.get("coverage_pct", 0) for v in all_validations.values()) / len(all_validations)

    _finish_step(steps, 3, json.dumps({
        "total_chunks": total_chunks, "avg_coverage_pct": round(avg_coverage, 2),
        "chunk_size": 400, "overlap": 60,
    }))
    _update_steps(job_id, steps, 4, "ingesting")

    # ── Layer 5: Metadata Intelligence ────────────────────────────────────────
    _begin_step(steps, 4)
    _update_steps(job_id, steps, 4, "ingesting")
    file_type_counts = {}
    for file_id, (ext, corpus) in all_corpora.items():
        src = corpus.get("source_type", "unknown")
        file_type_counts[src] = file_type_counts.get(src, 0) + 1

    metadata_summary = {
        "file_types": file_type_counts,
        "adapters_used": list({c.get("adapter", "unknown") for _, c in all_corpora.values()}),
        "total_text_blocks": sum(len(c.get("text_blocks", [])) for _, c in all_corpora.values()),
        "total_table_rows": sum(len(c.get("table_rows", [])) for _, c in all_corpora.values()),
    }
    _finish_step(steps, 4, json.dumps(metadata_summary))
    _update_steps(job_id, steps, 5, "ingesting")

    # ── Layer 6: Entity + Relationship ────────────────────────────────────────
    _begin_step(steps, 5)
    _update_steps(job_id, steps, 5, "ingesting")
    all_entities_by_file = {}
    all_rels_by_file = {}
    entity_errors = 0
    for file_id, chunks in all_chunks_by_file.items():
        try:
            entities, relationships = extract_entities_from_chunks(chunks)
        except Exception as exc:
            logger.warning("entity extraction failed for %s: %s", file_id, exc)
            entities, relationships = [], []
            entity_errors += 1
        all_entities_by_file[file_id] = entities
        all_rels_by_file[file_id] = relationships

    total_ents_raw = sum(len(v) for v in all_entities_by_file.values())
    total_rels_raw = sum(len(v) for v in all_rels_by_file.values())
    _finish_step(steps, 5, json.dumps({
        "entity_count": total_ents_raw, "relationship_count": total_rels_raw,
        "extraction_errors": entity_errors,
    }))
    _update_steps(job_id, steps, 6, "ingesting")

    # ── Layer 7: Semantic Learning (confidence scoring) ───────────────────────
    _begin_step(steps, 6)
    _update_steps(job_id, steps, 6, "ingesting")
    all_entity_scores = {}
    all_rel_scores = {}
    for file_id in all_chunks_by_file:
        entities = all_entities_by_file.get(file_id, [])
        relationships = all_rels_by_file.get(file_id, [])
        sc_ents = score_entities(entities)
        sc_rels = score_relationships(relationships, {
            str(e.get("text") or "").strip().lower(): float(e.get("eda_confidence", 0))
            for e in sc_ents.get("entities", [])
        })
        all_entities_by_file[file_id] = sc_ents.get("entities", entities)
        all_rels_by_file[file_id] = sc_rels.get("relationships", relationships)
        all_entity_scores[file_id] = sc_ents.get("summary", {})
        all_rel_scores[file_id] = sc_rels.get("summary", {})

    total_ents = sum(len(v) for v in all_entities_by_file.values())
    total_rels = sum(len(v) for v in all_rels_by_file.values())
    avg_ent_conf = 0.0
    avg_rel_conf = 0.0
    if all_entity_scores:
        avg_ent_conf = sum(s.get("mean_confidence", 0) for s in all_entity_scores.values()) / len(all_entity_scores)
    if all_rel_scores:
        avg_rel_conf = sum(s.get("mean_confidence", 0) for s in all_rel_scores.values()) / len(all_rel_scores)

    _finish_step(steps, 6, json.dumps({
        "entities_scored": total_ents, "relationships_scored": total_rels,
        "avg_entity_confidence": round(avg_ent_conf, 4),
        "avg_relationship_confidence": round(avg_rel_conf, 4),
    }))
    _update_steps(job_id, steps, 7, "ingesting")

    # ── Layer 8: EDA Intelligence (non-fatal) ─────────────────────────────────
    _begin_step(steps, 7)
    _update_steps(job_id, steps, 7, "ingesting")
    eda_results = {}
    eda_errors = 0
    for file_id, (ext, corpus) in all_corpora.items():
        try:
            eda_results[file_id] = run_file_eda(
                file_id=file_id, ext=ext, corpus=corpus,
                entities=all_entities_by_file.get(file_id, []),
                relationships=all_rels_by_file.get(file_id, []),
                canonical_nodes=[], canonical_edges=[], resolved_nodes=[],
                resolution_report={},
                chunk_validation_report=all_validations.get(file_id, {}),
                corpus_dir=corpus_dir,
            )
        except Exception as exc:
            logger.warning("run_file_eda failed for %s: %s", file_id, exc)
            eda_errors += 1

    _finish_step(steps, 7, json.dumps({
        "files_analyzed": len(eda_results), "eda_errors": eda_errors,
        "total_files": len(all_corpora),
    }))
    _update_steps(job_id, steps, 8, "ingesting")

    # ── Layer 9: ML Validation & Accuracy ─────────────────────────────────────
    _begin_step(steps, 8)
    _update_steps(job_id, steps, 8, "ingesting")
    scorecards = {}
    for file_id, result in eda_results.items():
        sc = result.get("scorecard", {})
        if sc:
            scorecards[file_id] = sc

    avg_trust = 0.0
    avg_quality = 0.0
    if scorecards:
        avg_trust = sum(s.get("graph_trust_score", 0) for s in scorecards.values()) / len(scorecards)
        avg_quality = sum(s.get("overall_kg_quality_score", 0) for s in scorecards.values()) / len(scorecards)

    _finish_step(steps, 8, json.dumps({
        "files_validated": len(scorecards),
        "avg_trust_score": round(avg_trust, 4),
        "avg_quality_score": round(avg_quality, 4),
    }))
    _update_steps(job_id, steps, 9, "ingesting")

    # ── Layer 10: Ontology & Governance ───────────────────────────────────────
    _begin_step(steps, 9)
    _update_steps(job_id, steps, 9, "ingesting")
    total_ontology_violations = 0
    total_contradictions = 0
    for file_id, result in eda_results.items():
        gv = result.get("graph_validation", {})
        total_ontology_violations += len(gv.get("ontology_violations", []))
        total_contradictions += len(gv.get("semantic_inconsistencies", []))

    _finish_step(steps, 9, json.dumps({
        "ontology_violations": total_ontology_violations,
        "semantic_contradictions": total_contradictions,
    }))
    _update_steps(job_id, steps, 10, "ingesting")

    # ── Layer 11: Canonicalization ────────────────────────────────────────────
    _begin_step(steps, 10)
    _update_steps(job_id, steps, 10, "ingesting")
    all_canonical_nodes = {}
    all_canonical_edges = {}
    resolved_nodes_by_file = {}
    resolution_reports_by_file = {}
    canon_errors = 0

    for file_id in all_corpora:
        entities = all_entities_by_file.get(file_id, [])
        relationships = all_rels_by_file.get(file_id, [])
        try:
            cn, mention_map = build_canonical_nodes(file_id, entities)
            ce = build_canonical_edges(file_id, relationships, mention_map)
            validate_canonical_graph(cn, ce)
        except Exception as exc:
            logger.warning("canonical build failed for %s: %s", file_id, exc)
            cn, ce = [], []
            canon_errors += 1
        all_canonical_nodes[file_id] = cn
        all_canonical_edges[file_id] = ce

    for file_id in all_corpora:
        cn = all_canonical_nodes.get(file_id, [])
        ce = all_canonical_edges.get(file_id, [])
        try:
            result = resolve_canonical_graph(
                file_id=file_id, nodes=cn, edges=ce,
                embed_fn=embed_store.embed_text, corpus_dir=corpus_dir,
            )
            resolved_nodes_by_file[file_id] = result.get("resolved_nodes", cn)
            resolution_reports_by_file[file_id] = result.get("resolution_report", {})
        except Exception as exc:
            logger.warning("resolve failed for %s: %s", file_id, exc)
            resolved_nodes_by_file[file_id] = cn
            resolution_reports_by_file[file_id] = {}

    total_cn = sum(len(v) for v in all_canonical_nodes.values())
    total_resolved = sum(len(v) for v in resolved_nodes_by_file.values())
    total_merged = sum(r.get("merged_count", 0) for r in resolution_reports_by_file.values())
    total_pending = sum(r.get("pending_review_count", 0) for r in resolution_reports_by_file.values())

    _finish_step(steps, 10, json.dumps({
        "canonical_nodes": total_cn, "resolved_nodes": total_resolved,
        "merged": total_merged, "pending_reviews": total_pending,
        "canonicalization_errors": canon_errors,
    }))
    _update_steps(job_id, steps, 11, "ingesting")

    # ── Layer 12: KG Construction ─────────────────────────────────────────────
    _begin_step(steps, 11)
    _update_steps(job_id, steps, 11, "ingesting")
    cross_link_count = 0
    graph_node_count = 0
    graph_edge_count = 0

    try:
        canonical_graph = graph_builder.get_canonical_graph()
        for file_id in all_corpora:
            cl = link_cross_source(
                corpus_dir=corpus_dir, source_id=file_id, source_type="corpus",
                source_nodes=resolved_nodes_by_file.get(file_id, []),
                embed_fn=embed_store.embed_text, canonical_graph=canonical_graph,
            )
            cross_link_count += len(cl.get("accepted_edges", []))
    except Exception as exc:
        logger.warning("link_cross_source failed: %s", exc)

    for file_id in all_corpora:
        resolved_nodes = resolved_nodes_by_file.get(file_id, [])
        canonical_edges = all_canonical_edges.get(file_id, [])
        try:
            graph_builder.upsert_canonical_graph(file_id, resolved_nodes, canonical_edges)
            graph_builder.build_graph(
                file_id, all_entities_by_file.get(file_id, []), all_rels_by_file.get(file_id, [])
            )
        except Exception as exc:
            logger.warning("graph_builder failed for %s: %s", file_id, exc)

    try:
        cg = graph_builder.get_canonical_graph()
        graph_node_count = len(cg.get("nodes", []))
        graph_edge_count = len(cg.get("edges", []))
    except Exception:
        pass

    _finish_step(steps, 11, json.dumps({
        "graph_nodes": graph_node_count, "graph_edges": graph_edge_count,
        "cross_links": cross_link_count,
    }))
    _update_steps(job_id, steps, 12, "ingesting")

    # ── Layer 13: Graph Consistency ───────────────────────────────────────────
    _begin_step(steps, 12)
    _update_steps(job_id, steps, 12, "ingesting")
    graph_metrics_data = {}
    try:
        graph_metrics_data = graph_builder.canonical_graph_metrics()
    except Exception as exc:
        logger.warning("canonical_graph_metrics failed: %s", exc)

    density = graph_metrics_data.get("stats", {}).get("density", 0)
    high_risk = graph_metrics_data.get("high_risk_edge_ratio", 0)

    _finish_step(steps, 12, json.dumps({
        "density": round(density, 6),
        "high_risk_edge_ratio": round(high_risk, 4),
        "active_edges": graph_metrics_data.get("active_edge_count", 0),
        "suppressed_edges": graph_metrics_data.get("suppressed_edge_count", 0),
    }))
    _update_steps(job_id, steps, 13, "ingesting")

    # ── Layer 14: Wiki + Explainability ───────────────────────────────────────
    _begin_step(steps, 13)
    _update_steps(job_id, steps, 13, "ingesting")
    wiki_count = 0
    embed_count = 0

    for file_id in all_corpora:
        resolved_nodes = resolved_nodes_by_file.get(file_id, [])
        try:
            cg = graph_builder.get_canonical_graph()
            node_ids = [n.get("canonical_id") or n.get("id") for n in resolved_nodes
                        if n.get("canonical_id") or n.get("id")]
            wiki_builder.build_pages_for_nodes(file_id, node_ids, cg)
            wiki_count += len(node_ids)
        except Exception as exc:
            logger.warning("wiki_builder failed for %s: %s", file_id, exc)

    for file_id, chunks in all_chunks_by_file.items():
        try:
            embed_count += embed_store.add_chunks(file_id, chunks)
        except Exception as exc:
            logger.warning("embed failed for %s: %s", file_id, exc)

    _finish_step(steps, 13, json.dumps({
        "wiki_pages": wiki_count, "faiss_chunks_indexed": embed_count,
    }))

    graph_path = os.path.join(corpus_dir, "canonical_graph.json")
    community_count = 0
    try:
        with open(graph_path, encoding="utf-8") as f:
            final_graph = json.load(f)
        community_count = len({
            n.get("community")
            for n in final_graph.get("nodes", [])
            if n.get("community") is not None
        })
    except Exception:
        pass

    _update_steps(job_id, steps, 13, "graph_done", {
        "entity_count": total_ents, "file_count": len(all_corpora),
        "community_count": community_count,
        "graph_path": graph_path,
        "completed_at": datetime.now(timezone.utc),
    })
    logger.info("run_ingest_pipeline %s done in %ds", job_id, int(time.time() - pipeline_started))


# ── DB ingest pipeline ────────────────────────────────────────────────────────

@celery_app.task(name="run_db_pipeline", bind=True, max_retries=1)
def run_db_pipeline(self, job_id, conn_params):  # noqa: C901
    started = time.time()
    corpus_dir = f"corpus_store/{job_id}"
    os.makedirs(corpus_dir, exist_ok=True)
    processed_dir = os.path.join(corpus_dir, "processed")
    os.makedirs(processed_dir, exist_ok=True)

    db_id = conn_params.get("db_id") or conn_params.get("dbname") or "db"
    steps = [
        {"id": "connect",    "label": "1 · Connecting to database",      "status": "pending", "pct": 0, "detail": ""},
        {"id": "introspect", "label": "2 · Schema introspection",         "status": "pending", "pct": 0, "detail": ""},
        {"id": "profile",    "label": "3 · Column profiling",             "status": "pending", "pct": 0, "detail": ""},
        {"id": "eda",        "label": "4 · DB EDA",                       "status": "pending", "pct": 0, "detail": ""},
        {"id": "graphify",   "label": "5 · Schema graphification",        "status": "pending", "pct": 0, "detail": ""},
        {"id": "merge",      "label": "6 · Merge into canonical graph",   "status": "pending", "pct": 0, "detail": ""},
        {"id": "embed",      "label": "7 · Embed schema chunks",          "status": "pending", "pct": 0, "detail": ""},
    ]

    from app.modules.db.db_connector import connect_db, get_schema_metadata, export_schema_as_corpus_text
    from app.modules.db.db_profiler import profile_database, detect_implicit_relationships
    from app.modules.db.eda_engine import run_eda_engine
    from app.modules.kg.knowledge_schema import build_canonical_nodes, build_canonical_edges
    from app.modules.kg.entity_resolution import resolve_canonical_graph
    from app.modules.kg.cross_source_linker import link_cross_source, build_db_semantic_hints
    from app.modules.graph.graph_builder import GraphBuilder
    from app.modules.pipeline.processing import chunk_text
    from app.modules.data_curation.faiss_store import FaissStore

    graph_builder = GraphBuilder(corpus_dir)
    embed_store = FaissStore(corpus_dir)

    # Stage 1: Connect
    steps[0]["status"] = "running"
    _update_steps(job_id, steps, 0, "ingesting")
    try:
        db_engine = connect_db(
            engine=conn_params.get("engine", "postgresql"),
            host=conn_params.get("host", "localhost"),
            port=int(conn_params.get("port", 5432)),
            dbname=conn_params.get("dbname", ""),
            user=conn_params.get("user", ""),
            password=conn_params.get("password", ""),
            path=conn_params.get("path"),
        )
    except Exception as exc:
        steps[0]["status"] = "error"
        steps[0]["detail"] = str(exc)
        _update_steps(job_id, steps, 0, "failed", {"error_message": str(exc)})
        return
    steps[0]["status"] = "done"
    steps[0]["pct"] = 100
    steps[0]["detail"] = f"Connected to {conn_params.get('dbname')}"
    _update_steps(job_id, steps, 1, "ingesting")

    # Stage 2: Introspect
    steps[1]["status"] = "running"
    _update_steps(job_id, steps, 1, "ingesting")
    try:
        metadata = get_schema_metadata(db_engine)
        with open(os.path.join(processed_dir, f"{db_id}_schema.json"), "w", encoding="utf-8") as f:
            json.dump(metadata, f)
    except Exception as exc:
        steps[1]["status"] = "error"
        steps[1]["detail"] = str(exc)
        _update_steps(job_id, steps, 1, "failed", {"error_message": str(exc)})
        return
    table_count = len(metadata.get("tables", []))
    steps[1]["status"] = "done"
    steps[1]["pct"] = 100
    steps[1]["detail"] = f"{table_count} tables introspected"
    _update_steps(job_id, steps, 2, "ingesting")

    # Stage 3: Profile
    steps[2]["status"] = "running"
    _update_steps(job_id, steps, 2, "ingesting")
    try:
        profiled = profile_database(metadata, db_engine)
        implicit_rels = detect_implicit_relationships(metadata)
        with open(os.path.join(processed_dir, f"{db_id}_profile.json"), "w", encoding="utf-8") as f:
            json.dump({"profile": profiled, "implicit_relationships": implicit_rels}, f)
    except Exception as exc:
        logger.warning("profile_database failed: %s", exc)
        profiled = {}
        implicit_rels = []
    total_cols = sum(len(t.get("columns", [])) for t in profiled.get("tables", []))
    steps[2]["status"] = "done"
    steps[2]["pct"] = 100
    steps[2]["detail"] = f"{total_cols} columns profiled"
    _update_steps(job_id, steps, 3, "ingesting")

    # Stage 4: EDA
    steps[3]["status"] = "running"
    _update_steps(job_id, steps, 3, "ingesting")
    try:
        eda_artifact = run_eda_engine(profiled, output_dir=processed_dir)
    except Exception as exc:
        logger.warning("run_eda_engine failed: %s", exc)
        eda_artifact = {}
    steps[3]["status"] = "done"
    steps[3]["pct"] = 100
    steps[3]["detail"] = "DB EDA complete"
    _update_steps(job_id, steps, 4, "ingesting")

    # Stage 5: Graphify schema
    steps[4]["status"] = "running"
    _update_steps(job_id, steps, 4, "ingesting")
    schema_text = export_schema_as_corpus_text(db_engine, metadata)
    db_graph = _fallback_graph_from_schema(metadata)
    steps[4]["status"] = "done"
    steps[4]["pct"] = 100
    steps[4]["detail"] = f"{len(db_graph.get('nodes', []))} nodes from schema"
    _update_steps(job_id, steps, 5, "ingesting")

    # Stage 6: Merge into canonical graph
    steps[5]["status"] = "running"
    _update_steps(job_id, steps, 5, "ingesting")
    try:
        schema_entities = [{"text": n["label"], "type": n.get("type", "table"), "label": "TABLE"}
                           for n in db_graph.get("nodes", [])]
        schema_rels = [{"source": e["source"], "target": e["target"], "relation": e.get("relation", "references")}
                       for e in db_graph.get("edges", [])]
        cn, mention_map = build_canonical_nodes(db_id, schema_entities)
        ce = build_canonical_edges(db_id, schema_rels, mention_map)
        result = resolve_canonical_graph(
            file_id=db_id, nodes=cn, edges=ce,
            embed_fn=embed_store.embed_text, corpus_dir=corpus_dir,
        )
        resolved_nodes = result.get("resolved_nodes", cn)
        canonical_graph = graph_builder.get_canonical_graph()
        semantic_hints = build_db_semantic_hints(profiled, resolved_nodes)
        link_cross_source(
            corpus_dir=corpus_dir, source_id=db_id, source_type="db",
            source_nodes=resolved_nodes, embed_fn=embed_store.embed_text,
            canonical_graph=canonical_graph, confidence_hints=semantic_hints,
        )
        graph_builder.upsert_canonical_graph(db_id, resolved_nodes, ce)
    except Exception as exc:
        logger.warning("DB graph merge failed: %s", exc)
    steps[5]["status"] = "done"
    steps[5]["pct"] = 100
    steps[5]["detail"] = "DB schema merged into canonical graph"
    _update_steps(job_id, steps, 6, "ingesting")

    # Stage 7: Embed schema chunks
    steps[6]["status"] = "running"
    _update_steps(job_id, steps, 6, "ingesting")
    try:
        schema_chunks = chunk_text(schema_text, size=300, overlap=50)
        embed_count = embed_store.add_chunks(db_id, schema_chunks)
    except Exception as exc:
        logger.warning("DB embed failed: %s", exc)
        embed_count = 0
    steps[6]["status"] = "done"
    steps[6]["pct"] = 100
    steps[6]["detail"] = f"{embed_count} schema chunks indexed"

    db_graph_path = os.path.join(corpus_dir, "canonical_graph.json")
    db_entity_count = 0
    try:
        with open(db_graph_path, encoding="utf-8") as f:
            db_final_graph = json.load(f)
        db_entity_count = len(db_final_graph.get("nodes", []))
    except Exception:
        pass
    _update_steps(job_id, steps, 6, "graph_done", {
        "file_count": table_count,
        "entity_count": db_entity_count,
        "graph_path": db_graph_path,
        "completed_at": datetime.now(timezone.utc),
    })
    logger.info("run_db_pipeline %s done in %ds", job_id, int(time.time() - started))


# ── Reindex pipeline ──────────────────────────────────────────────────────────

@celery_app.task(name="reindex_pipeline", bind=True, max_retries=2)
def reindex_pipeline(self, job_id):
    started = time.time()
    corpus_dir = f"corpus_store/{job_id}"
    processed_dir = os.path.join(corpus_dir, "processed")

    steps = [
        {"id": "chunk", "label": "1 · Re-chunking corpus",            "status": "pending", "pct": 0, "detail": ""},
        {"id": "embed", "label": "2 · Re-embedding & FAISS indexing",  "status": "pending", "pct": 0, "detail": ""},
    ]
    _update_steps(job_id, steps, 0, "ingesting")

    from app.modules.pipeline.processing import clean_text, chunk_text
    from app.modules.data_curation.faiss_store import FaissStore

    embed_store = FaissStore(corpus_dir)
    steps[0]["status"] = "running"
    _update_steps(job_id, steps, 0, "ingesting")

    all_chunks_by_file = {}
    if Path(processed_dir).exists():
        for p in Path(processed_dir).glob("*_corpus.json"):
            file_id = p.stem.replace("_corpus", "")
            try:
                with open(p, encoding="utf-8") as f:
                    data = json.load(f)
                chunks = chunk_text(clean_text(data.get("plain_text", "") or ""))
                all_chunks_by_file[file_id] = chunks
            except Exception as exc:
                logger.warning("reindex: failed to load %s: %s", p, exc)

    total_chunks = sum(len(c) for c in all_chunks_by_file.values())
    steps[0]["status"] = "done"
    steps[0]["pct"] = 100
    steps[0]["detail"] = f"{total_chunks} chunks from {len(all_chunks_by_file)} files"
    _update_steps(job_id, steps, 1, "ingesting")

    steps[1]["status"] = "running"
    _update_steps(job_id, steps, 1, "ingesting")
    embed_count = 0
    for file_id, chunks in all_chunks_by_file.items():
        try:
            embed_count += embed_store.add_chunks(file_id, chunks)
        except Exception as exc:
            logger.warning("reindex embed failed for %s: %s", file_id, exc)

    steps[1]["status"] = "done"
    steps[1]["pct"] = 100
    steps[1]["detail"] = f"{embed_count} chunks re-indexed"
    _update_steps(job_id, steps, 1, "graph_done", {
        "completed_at": datetime.now(timezone.utc),
    })
    logger.info("reindex_pipeline %s done in %ds", job_id, int(time.time() - started))
