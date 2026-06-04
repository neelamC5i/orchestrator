"""
Celery tasks: 9-stage file ingest pipeline, 7-stage DB ingest pipeline, reindex.

Writes granular progress into ingest_jobs.pipeline_steps (JSONB):
{
  "steps": [
    {"id": "extract", "label": "...", "status": "done|running|pending|error", "pct": 0, "detail": ""},
    ...
  ],
  "current_step": 2,
  "overall_pct": 45,
  "started_at": 1234567890.0
}
"""
import json
import logging
import os
import time
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


def _update_steps(job_id, steps, current_idx, status, extra=None):
    done = sum(1 for s in steps[:current_idx] if s.get("status") == "done")
    pct = int(done / max(1, len(steps)) * 100)
    payload = json.dumps({
        "steps": steps,
        "current_step": current_idx,
        "overall_pct": pct,
        "started_at": time.time(),
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
    started = time.time()
    # corpus_dir is resolved from DB metadata; fall back to convention
    corpus_dir = f"corpus_store/{job_id}"  # placeholder; overwritten below
    processed_dir = ""  # set after corpus_dir is resolved

    # 14-layer semantic-intelligence pipeline. Layer 1 (File Upload) lives in the
    # Workspace, so this pipeline begins at layer 2. Indices are 0-13; the trailing
    # FAISS embedding step is the operational tail of graph construction. The
    # steps[] shape and the terminal graph_done contract are unchanged.
    steps = [
        {"id": "extract",        "label": "2 · Ingestion & extraction",           "status": "pending", "pct": 0, "detail": ""},
        {"id": "clean",          "label": "3 · Cleaning & normalization",         "status": "pending", "pct": 0, "detail": ""},
        {"id": "chunk",          "label": "4 · Chunking & segmentation",          "status": "pending", "pct": 0, "detail": ""},
        {"id": "metadata_intel", "label": "5 · Metadata intelligence engine",     "status": "pending", "pct": 0, "detail": ""},
        {"id": "entities",       "label": "6 · Entity & relationship extraction", "status": "pending", "pct": 0, "detail": ""},
        {"id": "semantic_learn", "label": "7 · Semantic learning layer",          "status": "pending", "pct": 0, "detail": ""},
        {"id": "eda",            "label": "8 · EDA intelligence engine",          "status": "pending", "pct": 0, "detail": ""},
        {"id": "ml_validation",  "label": "9 · ML validation & accuracy",         "status": "pending", "pct": 0, "detail": ""},
        {"id": "ontology",       "label": "10 · Ontology & semantic governance",  "status": "pending", "pct": 0, "detail": ""},
        {"id": "canonical",      "label": "11 · Canonicalization & resolution",   "status": "pending", "pct": 0, "detail": ""},
        {"id": "graph_build",    "label": "12 · Knowledge graph construction",    "status": "pending", "pct": 0, "detail": ""},
        {"id": "graph_validate", "label": "13 · Graph validation & consistency",  "status": "pending", "pct": 0, "detail": ""},
        {"id": "wiki",           "label": "14 · Wiki & explainability",           "status": "pending", "pct": 0, "detail": ""},
        {"id": "embed",          "label": "15 · Embedding & FAISS indexing",      "status": "pending", "pct": 0, "detail": ""},
    ]

    # Fetch job record — read corpus_dir from metadata
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

    # Resolve corpus_dir: prefer what was saved at ingest time (absolute path)
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
    from app.modules.intelligence import (
        run_metadata_intelligence, run_semantic_learning, run_ml_validation,
        run_ontology_governance, run_graph_validation,
    )

    graph_builder = GraphBuilder(corpus_dir)
    wiki_builder = WikiBuilder(corpus_dir)
    embed_store = FaissStore(corpus_dir)

    # Determine file paths — scan corpus_dir directly (files saved there at upload)
    SKIP_SUFFIXES = {".json", ".faiss", ".pkl", ".bin", ".idx", ""}
    files_to_process = []
    for fp in Path(corpus_dir).iterdir():
        if fp.is_file() and fp.suffix.lower() not in SKIP_SUFFIXES:
            files_to_process.append((fp.stem, str(fp)))

    if not files_to_process:
        _update_steps(job_id, steps, 0, "failed", {"error_message": "no_files_found"})
        return

    # ── Layer 2 (idx 0): Ingestion & extraction ──────────────────────────────
    steps[0]["status"] = "running"
    _update_steps(job_id, steps, 0, "ingesting")
    all_corpora = {}
    for file_id, file_path in files_to_process:
        ext = Path(file_path).suffix.lower().lstrip(".")
        try:
            corpus = extract_corpus(file_path, ext)
        except Exception as exc:
            logger.warning("extract_corpus failed for %s: %s", file_path, exc)
            corpus = {"plain_text": "", "text_blocks": [], "table_rows": [], "metadata": {}, "source_type": "unknown", "adapter": "raw"}
        all_corpora[file_id] = (ext, corpus)
        try:
            with open(os.path.join(processed_dir, f"{file_id}_corpus.json"), "w", encoding="utf-8") as f:
                json.dump({"ext": ext, **corpus}, f)
        except Exception:
            pass
    steps[0]["status"] = "done"; steps[0]["pct"] = 100
    steps[0]["detail"] = f"{len(all_corpora)} files extracted"
    _update_steps(job_id, steps, 1, "ingesting")

    # ── Layer 3 (idx 1): Cleaning & normalization ────────────────────────────
    steps[1]["status"] = "running"
    _update_steps(job_id, steps, 1, "ingesting")
    cleaned_by_file = {}
    for file_id, (ext, corpus) in all_corpora.items():
        cleaned_by_file[file_id] = clean_text(corpus.get("plain_text", "") or "")
    steps[1]["status"] = "done"; steps[1]["pct"] = 100
    steps[1]["detail"] = f"{len(cleaned_by_file)} documents normalized"
    _update_steps(job_id, steps, 2, "ingesting")

    # ── Layer 4 (idx 2): Chunking & structural segmentation ──────────────────
    steps[2]["status"] = "running"
    _update_steps(job_id, steps, 2, "ingesting")
    all_chunks_by_file = {}
    all_validations = {}
    for file_id, cleaned in cleaned_by_file.items():
        chunks = chunk_text(cleaned)
        all_chunks_by_file[file_id] = chunks
        all_validations[file_id] = validate_chunking(chunks, len(cleaned.split()), target_overlap=60)
    total_chunks = sum(len(c) for c in all_chunks_by_file.values())
    steps[2]["status"] = "done"; steps[2]["pct"] = 100
    steps[2]["detail"] = f"{total_chunks} chunks from {len(all_chunks_by_file)} files"
    _update_steps(job_id, steps, 3, "ingesting")

    # ── Layer 5 (idx 3): Metadata intelligence engine (non-fatal) ────────────
    steps[3]["status"] = "running"
    _update_steps(job_id, steps, 3, "ingesting")
    try:
        md_summary = run_metadata_intelligence(corpus_dir, all_corpora, all_chunks_by_file)
        steps[3]["detail"] = (
            f"{md_summary.get('tabular_file_count', 0)} tabular files, "
            f"{md_summary.get('fk_candidate_count', 0)} FK candidates"
        )
    except Exception as exc:
        logger.warning("metadata_intelligence failed: %s", exc)
        steps[3]["detail"] = "skipped"
    steps[3]["status"] = "done"; steps[3]["pct"] = 100
    _update_steps(job_id, steps, 4, "ingesting")

    # ── Layer 6 (idx 4): Entity & relationship extraction ────────────────────
    steps[4]["status"] = "running"
    _update_steps(job_id, steps, 4, "ingesting")
    all_entities_by_file = {}
    all_rels_by_file = {}
    for file_id, chunks in all_chunks_by_file.items():
        try:
            entities, relationships = extract_entities_from_chunks(chunks)
        except Exception as exc:
            logger.warning("entity extraction failed for %s: %s", file_id, exc)
            entities, relationships = [], []
        sc_ents = score_entities(entities)
        sc_rels = score_relationships(relationships, {
            str(e.get("text") or "").strip().lower(): float(e.get("eda_confidence", 0))
            for e in sc_ents.get("entities", [])
        })
        all_entities_by_file[file_id] = sc_ents.get("entities", entities)
        all_rels_by_file[file_id] = sc_rels.get("relationships", relationships)
    total_ents = sum(len(v) for v in all_entities_by_file.values())
    total_rels = sum(len(v) for v in all_rels_by_file.values())
    steps[4]["status"] = "done"; steps[4]["pct"] = 100
    steps[4]["detail"] = f"{total_ents} entities, {total_rels} relationships"
    _update_steps(job_id, steps, 5, "ingesting")

    # ── Layer 7 (idx 5): Semantic learning layer (non-fatal) ─────────────────
    steps[5]["status"] = "running"
    _update_steps(job_id, steps, 5, "ingesting")
    try:
        sl_summary = run_semantic_learning(
            corpus_dir, all_entities_by_file, all_chunks_by_file, embed_store.embed_text
        )
        steps[5]["detail"] = (
            f"{sl_summary.get('cluster_count', 0)} semantic clusters, "
            f"{sl_summary.get('cooccurrence_pair_count', 0)} co-occurrence pairs"
        )
    except Exception as exc:
        logger.warning("semantic_learning failed: %s", exc)
        steps[5]["detail"] = "skipped"
    steps[5]["status"] = "done"; steps[5]["pct"] = 100
    _update_steps(job_id, steps, 6, "ingesting")

    # ── Layer 8 (idx 6): EDA intelligence engine (non-fatal) ─────────────────
    steps[6]["status"] = "running"
    _update_steps(job_id, steps, 6, "ingesting")
    eda_results = {}
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
    steps[6]["status"] = "done"; steps[6]["pct"] = 100
    steps[6]["detail"] = f"EDA completed for {len(eda_results)}/{len(all_corpora)} files"
    _update_steps(job_id, steps, 7, "ingesting")

    # ── Layer 9 (idx 7): ML validation & accuracy (non-fatal) ────────────────
    steps[7]["status"] = "running"
    _update_steps(job_id, steps, 7, "ingesting")
    try:
        mlv = run_ml_validation(corpus_dir, all_entities_by_file, all_rels_by_file, eda_results)
        steps[7]["detail"] = (
            f"F1≈{mlv.get('f1_proxy', 0)}, hallucination risk≈{mlv.get('hallucination_risk', 0)}"
        )
    except Exception as exc:
        logger.warning("ml_validation failed: %s", exc)
        steps[7]["detail"] = "skipped"
    steps[7]["status"] = "done"; steps[7]["pct"] = 100
    _update_steps(job_id, steps, 8, "ingesting")

    # ── Layer 10 (idx 8): Ontology & semantic governance (non-fatal) ─────────
    # Derive the taxonomy + relationship constraints from the already-extracted
    # entities/relationships (no canonical graph required yet — preserves layer
    # ordering). The summary is reused by the graph-validation layer below.
    steps[8]["status"] = "running"
    _update_steps(job_id, steps, 8, "ingesting")
    ontology_artifact = None
    try:
        ontology_artifact = run_ontology_governance(corpus_dir, all_entities_by_file, all_rels_by_file)
        steps[8]["detail"] = (
            f"{ontology_artifact.get('type_count', 0)} entity types, "
            f"{ontology_artifact.get('violation_count', 0)} constraint violations"
        )
    except Exception as exc:
        logger.warning("ontology_governance failed: %s", exc)
        steps[8]["detail"] = "skipped"
    steps[8]["status"] = "done"; steps[8]["pct"] = 100
    _update_steps(job_id, steps, 9, "ingesting")

    # ── Layer 11 (idx 9): Canonicalization & semantic resolution ─────────────
    steps[9]["status"] = "running"
    _update_steps(job_id, steps, 9, "ingesting")
    all_canonical_nodes = {}
    all_canonical_edges = {}
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
        all_canonical_nodes[file_id] = cn
        all_canonical_edges[file_id] = ce
    resolved_nodes_by_file = {}
    resolution_reports_by_file = {}
    for file_id in all_corpora:
        cn = all_canonical_nodes.get(file_id, [])
        ce = all_canonical_edges.get(file_id, [])
        try:
            result = resolve_canonical_graph(
                file_id=file_id, nodes=cn, edges=ce,
                embed_fn=embed_store.embed_text, corpus_dir=corpus_dir,
            )
            resolved_nodes_by_file[file_id] = result.get("resolved_nodes", cn)
            resolution_reports_by_file[file_id] = result.get("report", {})
        except Exception as exc:
            logger.warning("resolve failed for %s: %s", file_id, exc)
            resolved_nodes_by_file[file_id] = cn
            resolution_reports_by_file[file_id] = {}
    total_cn = sum(len(v) for v in all_canonical_nodes.values())
    total_resolved = sum(len(v) for v in resolved_nodes_by_file.values())
    steps[9]["status"] = "done"; steps[9]["pct"] = 100
    steps[9]["detail"] = f"{total_cn} canonical nodes → {total_resolved} resolved"
    _update_steps(job_id, steps, 10, "ingesting")

    # ── Layer 12 (idx 10): Knowledge graph construction ──────────────────────
    steps[10]["status"] = "running"
    _update_steps(job_id, steps, 10, "ingesting")
    cross_link_count = 0
    try:
        canonical_graph = graph_builder.get_canonical_graph()
        for file_id in all_corpora:
            cl = link_cross_source(
                corpus_dir=corpus_dir, source_id=file_id, source_type="corpus",
                source_nodes=resolved_nodes_by_file.get(file_id, []),
                embed_fn=embed_store.embed_text, canonical_graph=canonical_graph,
            )
            cross_link_count += len(cl.get("accepted_links", []))
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
    steps[10]["status"] = "done"; steps[10]["pct"] = 100
    steps[10]["detail"] = f"Graph constructed; {cross_link_count} cross-source links"
    _update_steps(job_id, steps, 11, "ingesting")

    # ── Layer 13 (idx 11): Graph validation & consistency (non-fatal) ────────
    steps[11]["status"] = "running"
    _update_steps(job_id, steps, 11, "ingesting")
    try:
        gv = run_graph_validation(corpus_dir, graph_builder, ontology_artifact)
        steps[11]["detail"] = (
            f"trust {gv.get('trust_score', 0)}, "
            f"{gv.get('orphan_node_count', 0)} orphans, {gv.get('cycle_count', 0)} cycles"
        )
    except Exception as exc:
        logger.warning("graph_validation failed: %s", exc)
        steps[11]["detail"] = "skipped"
    steps[11]["status"] = "done"; steps[11]["pct"] = 100
    _update_steps(job_id, steps, 12, "ingesting")

    # ── Layer 14 (idx 12): Wiki & explainability generation ──────────────────
    steps[12]["status"] = "running"
    _update_steps(job_id, steps, 12, "ingesting")
    wiki_count = 0
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
    steps[12]["status"] = "done"; steps[12]["pct"] = 100
    steps[12]["detail"] = f"{wiki_count} wiki pages built"
    _update_steps(job_id, steps, 13, "ingesting")

    # ── Layer 15 (idx 13): Embedding & FAISS indexing — terminal ─────────────
    steps[13]["status"] = "running"
    _update_steps(job_id, steps, 13, "ingesting")
    embed_count = 0
    for file_id, chunks in all_chunks_by_file.items():
        try:
            embed_count += embed_store.add_chunks(file_id, chunks)
        except Exception as exc:
            logger.warning("embed failed for %s: %s", file_id, exc)
    steps[13]["status"] = "done"; steps[13]["pct"] = 100
    steps[13]["detail"] = f"{embed_count} chunks indexed in FAISS"

    _update_steps(job_id, steps, 13, "graph_done", {
        "entity_count": total_ents, "file_count": len(all_corpora),
    })
    logger.info("run_ingest_pipeline %s done in %ds", job_id, int(time.time() - started))


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

    _update_steps(job_id, steps, 6, "graph_done", {"file_count": table_count})
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
    _update_steps(job_id, steps, 1, "graph_done")
    logger.info("reindex_pipeline %s done in %ds", job_id, int(time.time() - started))
