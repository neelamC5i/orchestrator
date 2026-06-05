Now I have the complete picture. Here's the holistic development-level breakdown of the Processing Pipeline data flow.

---

## Processing Pipeline — Complete Development Data Flow

### Architecture Overview

```
┌─────────────┐   POST /data/ingest   ┌──────────────┐  .delay()  ┌──────────────┐
│  Next.js UI  │ ──────────────────▶  │  FastAPI      │ ────────▶ │  Celery       │
│  /processing │                      │  data.py      │           │  Worker       │
│              │ ◀────────────────── │  SSE stream   │           │  ingest_task  │
│  EventSource │   GET /progress/{id} │               │           │               │
└──────┬───────┘                      └──────┬────────┘           └───────┬───────┘
       │                                     │                           │
       │ POST /pipeline/{id}/approve/{step}  │   SQL poll (1.5s)         │ _update_steps()
       │────────────────────────────────────▶│◀──────────────────────────│
       │                                     │                           │
       │                              ┌──────▼────────┐           ┌─────▼──────┐
       │                              │  PostgreSQL   │           │ File System│
       │                              │  ingest_jobs  │           │ corpus_store/
       │                              └───────────────┘           │  {job_id}/ │
       │                                                          └────────────┘
       │ Gate configs
       │──────────────────────▶ Redis (gate:{id}:{step}, pipeline_config:{id})
```

---

### Phase 0: Ingestion Trigger

**Entry point:** `POST /api/v1/data/ingest` in `backend/app/routes/data.py`

```
INPUTS                          TRANSFORMS                         OUTPUTS
─────────────────────────────  ──────────────────────────────────  ──────────────────────────
files: UploadFile[]            1. Dedup check:                    job_id: UUID string
domain_label: str                 SELECT from ingest_jobs          corpus_dir: corpus_store/{id}/
force_reingest: bool              WHERE domain_label = X           ingest_jobs row (status=queued)
db_type/host/port/...             AND status = 'graph_done'        Celery task dispatched
                               2. If exists & !force → return
                                  reused job_id (short-circuit)
                               3. Generate UUID job_id
                               4. Write files to disk:
                                  corpus_store/{job_id}/{filename}
                               5. INSERT ingest_jobs row
                               6. run_ingest_pipeline.delay(job_id)
```

**Key decision:** `force_reingest` controls whether an existing completed corpus for the same domain is reused or rebuilt. The dedup query is `SELECT ... WHERE domain_label = :domain AND status = 'graph_done' ORDER BY created_at DESC LIMIT 1`.

---

### Phase 1: 9-Stage Celery Pipeline

**Entry point:** `run_ingest_pipeline()` in `backend/app/tasks/ingest_task.py`

Every stage writes progress to PostgreSQL via `_update_steps()` which serializes a JSONB payload:

```json
{
  "steps": [{"id": "extract", "label": "...", "status": "done|running|pending|error", "pct": 0}],
  "current_step": 2,
  "overall_pct": 45,
  "started_at": 1234567890.0
}
```

---

#### Stage 1 — Extract Corpus

**Module:** `backend/app/modules/ingestion/corpus.py` → `extract_corpus(file_path, ext)`

```
INPUT                              TRANSFORM                           OUTPUT
────────────────────────────────  ──────────────────────────────────  ────────────────────────────
Raw file bytes on disk            Adapter registry dispatch:           Dict per file:
  corpus_store/{id}/{filename}      pdf  → pypdf.PdfReader               plain_text: str
                                    docx → python-docx Document          text_blocks: [{block_id, text, page}]
File extension (pdf/docx/csv/       csv  → pandas.read_csv               table_rows: [{table_id, row_idx, cells}]
  json/xlsx/txt)                    xlsx → pandas.read_excel              metadata: {page_count, row_count, ...}
                                    json → json.load → DataFrame?        source_type: document|table|json
                                    txt  → raw read                      adapter: pdf|docx|csv|...
                                  Fallback: _raw_fallback_adapter
                                    (binary → utf-8 → latin-1)

                                  Persisted: processed/{file_id}_corpus.json
```

**Adapter chain:** Primary adapter → empty text check → fallback raw decode. Tables (CSV/Excel/JSON arrays) are converted to `table_rows` with typed cells (`_infer_type`: null/bool/int/float/string) AND a `plain_text` linearization via `_table_rows_to_text` (format: `table X row Y: col=val; col=val`).

---

#### Stage 2 — Clean & Chunk

**Module:** `backend/app/modules/pipeline/processing.py`

```
INPUT                              TRANSFORM                           OUTPUT
────────────────────────────────  ──────────────────────────────────  ────────────────────────────
plain_text per file               clean_text():                       chunks: List[Dict] per file
                                    - collapse 3+ newlines → 2          [{idx, text, start_word,
                                    - collapse 2+ spaces → 1              end_word, word_count}]
                                    - strip control chars [\x00-\x08]
                                                                      validation: Dict per file
                                  chunk_text(cleaned, size=400,         {total_words, chunk_count,
                                             overlap=60):                coverage_pct,
                                    - word-level sliding window          overlap_correctness_pct,
                                    - stride = size - overlap = 340      data_loss_detected}
                                    - each chunk: {idx, text,
                                      start_word, end_word, word_count}

                                  validate_chunking():
                                    - interval merge for coverage
                                    - pairwise overlap correctness
```

**Key parameters:** 400-word chunks, 60-word overlap. Coverage and overlap correctness are computed as quality signals consumed downstream by EDA.

---

#### Stage 3 — NLP Entity Extraction

**Module:** `backend/app/modules/data_curation/nlp_entity_extractor.py`

```
INPUT                              TRANSFORM                           OUTPUT
────────────────────────────────  ──────────────────────────────────  ────────────────────────────
chunks per file                   Per chunk:                          entities: List[Dict]
                                    spaCy en_core_web_sm (if avail)     {text, label (NER tag),
                                    OR regex fallback:                    type (normalized),
                                      - money patterns                    chunk_idx, chunk_preview,
                                      - date patterns                     chunk_occurrences[]}
                                      - title-case phrases
                                      - 2-6 char acronyms              relationships: List[Dict]
                                                                         {source, target, relation,
                                  extract_relationships():                context, chunk_idx,
                                    - sentence split on [.!?]             chunk_preview}
                                    - co-occurrence within sentence
                                    - pairwise (i, j where j < i+4)
                                    - _infer_relation() keyword match
                                      → has_revenue|employs|owns|...
                                      → default: related_to

                                  Dedup: (text, label) → first chunk_idx kept
                                  Cap: entities unlimited, rels capped at 500

                                THEN confidence scoring:
                                  score_entities():
                                    conf = 0.35*freq + 0.35*length + 0.3*label - dups - noise
                                  score_relationships():
                                    conf = 0.32*prior + 0.28*context + 0.2*src + 0.2*tgt - dups
```

**Confidence scoring** (`backend/app/modules/kg/confidence_scoring.py`) enriches every entity/relationship with `eda_confidence` and `eda_signals` breakdown. Entity signals: frequency (mention count / 4), length (>=4 chars = 1.0), label specificity (ENTITY=0.65, specific=0.85), duplicate penalty, noise penalty. Relationship signals: relation prior (has_revenue=0.9, related_to=0.6), context length, endpoint confidence.

---

#### Stage 4 — EDA / Quality Analysis

**Module:** `backend/app/modules/eda/file_eda_service.py` → `run_file_eda()`

```
INPUT                              TRANSFORM                           OUTPUT (6 artifact files)
────────────────────────────────  ──────────────────────────────────  ────────────────────────────
file_id, ext, corpus              1. Re-score entities/relationships  {file_id}_eda_summary.json
entities, relationships           2. build_light_graph() → NetworkX     entity/rel stats, confidence
chunk_validation_report           3. graph_metrics() → density,         scores, cross-file analytics,
                                     centrality, isolated nodes         PDF quality, retry hooks
                                  4. validate_relationship_quality()
                                     → weak edges, duplicates,        {file_id}_graph_validation.json
                                     missing inverses                   weak edges, dupes, ontology
                                  5. analyze_semantic_consistency()      violations, disconnected nodes
                                     → contradictions, temporal
                                     issues, numeric anomalies        {file_id}_folder_analytics.json
                                  6. PDF-specific: page confidence      document clusters
                                  7. Entity quality:
                                     - duplicates, orphans,           {file_id}_kg_scorecard.json
                                     - ambiguous, low-confidence        overall_kg_quality_score,
                                     - conflicting types                trust, coherence, completeness,
                                  8. quality_scorecard() composite:      retrieval_readiness
                                     overall = 0.45*trust
                                       + 0.3*consistency              {file_id}_eda_visuals.json
                                       + 0.25*completeness              histograms, distributions
                                  9. Retry hooks: recommend
                                     reprocess if low-confidence      {file_id}_eda_artifacts.json
                                     entities/rels detected             bundle index pointing to above
```

**Non-fatal:** EDA failure doesn't stop the pipeline. Each file gets independent analysis. The scorecard produces 8 composite scores, with `overall_kg_quality_score` being the top-level quality metric.

---

#### Stage 5 — Canonical Graph Construction

**Module:** `backend/app/modules/kg/knowledge_schema.py`

```
INPUT                              TRANSFORM                           OUTPUT
────────────────────────────────  ──────────────────────────────────  ────────────────────────────
entities per file                 build_canonical_nodes():             canonical_nodes: List[Dict]
relationships per file              - SHA1 hash → stable canonical_id    {canonical_id, label,
                                    - format: ce_{sha1[:16]}              entity_type, ner_label,
                                    - dedup by canonical_id               aliases[], confidence=0.65,
                                    - merge aliases across dupes          provenance[{file_id,
                                                                            chunk_idx, chunk_preview}],
                                  build_canonical_edges():                temporal{valid_from/to}}
                                    - mention_to_canonical map
                                    - resolve source/target labels      canonical_edges: List[Dict]
                                      → canonical IDs                    {canonical_relation_id,
                                    - filter self-loops                    source_canonical_id,
                                    - format: cr_{sha1[:16]}               target_canonical_id,
                                                                           relation, confidence=0.55,
                                  validate_canonical_graph():              provenance[], temporal}
                                    - required field checks
                                    - duplicate ID detection
                                    - dangling edge detection           validation_result: Dict
                                    - EDA weak-evidence cross-check       {valid, error_count, errors[]}
```

**ID scheme:** `canonical_entity_id(type, label)` = `ce_` + SHA1(`{type}:{normalized_label}`)[:16]. This means the same entity text always gets the same ID regardless of which file it appears in — enabling cross-file resolution in the next stage.

---

#### Stage 6 — Entity Resolution

**Module:** `backend/app/modules/kg/entity_resolution.py` → `resolve_canonical_graph()`

```
INPUT                              TRANSFORM                           OUTPUT
────────────────────────────────  ──────────────────────────────────  ────────────────────────────
canonical_nodes per file          Load canonical_registry.json         resolved_nodes: List[Dict]
canonical_edges per file            (global node registry)               (with remapped canonical_ids)
embed_fn (FaissStore.embed_text)
corpus_dir                        Per node, compare against global:    resolved_edges: List[Dict]
                                    1. Exact ID match → merge             (with remapped IDs)
                                    2. Otherwise: pairwise scoring
                                       score = 0.45*embedding           canonical_registry.json updated:
                                             + 0.35*jaccard               {canonical_nodes[],
                                             + 0.20*exact_norm              merge_history[],
                                             ± confidence_hint             pending_reviews[]}
                                       × type_compatibility(0 or 1)
                                                                        resolution_report: Dict
                                    Decision thresholds:                  {merged_count, created_count,
                                      ≥ 0.72 → AUTO-MERGE                 pending_review_count,
                                      ≥ 0.58 → PENDING REVIEW             decisions[]}
                                      < 0.58 → NEW ENTITY

                                  _merge_node(): union aliases,
                                    extend provenance, blend
                                    confidence (0.8*existing + 0.2*new)

                                  Remap all edges to resolved IDs
                                  Save updated registry
```

**Persistence:** The global entity registry at `corpus_store/{job_id}/canonical_registry.json` accumulates across files. This is what enables cross-file entity linking — a "Microsoft" in file A and "Microsoft Corp" in file B get merged if their embedding similarity + Jaccard similarity exceed 0.72.

**Human review:** Scores between 0.58–0.72 create `pending_reviews` entries. These surface in the Wiki UI (`/wiki` page) for manual approve/reject via `apply_review_decision()`.

---

#### Stage 7 — Cross-Source Linking

**Module:** `backend/app/modules/kg/cross_source_linker.py` → `link_cross_source()`

```
INPUT                              TRANSFORM                           OUTPUT
────────────────────────────────  ──────────────────────────────────  ────────────────────────────
resolved_nodes per file           3-gate scoring pipeline:             {file_id}_cross_links.json:
canonical_graph (global)            Gate 1: lexical ≥ 0.55               accepted[], review[], rejected[]
embed_fn                              (exact_norm | containment
                                       | token_jaccard)              cross_link_reviews.json:
                                    Gate 2: semantic ≥ 0.50               review queue (pending decisions)
                                      (type-based label matching,
                                       heuristic keyword detection)    Accepted edges:
                                    Gate 3: embedding ≥ 0.68             {source_canonical_id,
                                      (cosine similarity)                 target_canonical_id,
                                                                          relation: "cross_source_related",
                                  Final score:                             confidence, edge_type: CROSS_SOURCE,
                                    0.45*lexical + 0.20*semantic           provenance[]}
                                    + 0.35*embedding + eda_boost

                                  Decision thresholds:
                                    ≥ 0.84 → ACCEPT
                                    ≥ 0.72 → REVIEW
                                    < 0.72 → REJECT

                                  Dedup: skip if edge already
                                    exists in canonical graph
```

**Non-fatal:** This stage silently catches exceptions. The `_eda_evidence_boost()` adds up to +0.08 based on relationship evidence overlap from the EDA stage.

---

#### Stage 8 — Graph Upsert + Wiki Build

**Module:** `backend/app/modules/graph/graph_builder.py` → `GraphBuilder` + `backend/app/modules/wiki/wiki_builder.py` → `WikiBuilder`

```
INPUT                              TRANSFORM                           OUTPUT
────────────────────────────────  ──────────────────────────────────  ────────────────────────────
resolved_nodes per file           GraphBuilder.upsert_canonical_graph():  canonical_graph.json:
canonical_edges per file            - Load/create canonical_graph.json      {nodes[], edges[], stats{
entities (raw) per file             - Node upsert: match by canonical_id      density, avg_degree}}
relationships (raw) per file        - Edge upsert: match by edge_key
                                      (src|relation|tgt)               graphs/{file_id}_graph.json:
                                    - Merge: union aliases, extend         per-file graph (raw entities)
                                      provenance, max confidence
                                    - Stats: density = E/(N*(N-1)),     wiki_pages/{canonical_id}.json:
                                      avg_degree = 2E/N                   {canonical_id, title,
                                                                            entity_type, aliases[],
                                  GraphBuilder.build_graph():               summary (auto-generated),
                                    - Per-file graph (raw entities)         key_facts[] (with citations),
                                    - Sequential node IDs (n0, n1...)       timeline[],
                                                                            related_entities[],
                                  WikiBuilder.build_pages_for_nodes():       sources[], version}
                                    - Per canonical_id:
                                      - Collect local edges             wiki_pages/index.json:
                                      - Generate facts (claims)           page listing with metadata
                                      - Generate summary text
                                      - Extract timeline (occurred_at)
                                      - Collect related entities
                                      - Version increment
                                    - Save page JSON + update index
```

**Dual graph system:** The pipeline maintains two graph representations simultaneously: (1) per-file raw entity graphs in `graphs/`, and (2) a single merged canonical graph at `canonical_graph.json`. The wiki is built from the canonical graph, ensuring entity pages reflect cross-file knowledge.

---

#### Stage 9 — FAISS Embedding & Indexing

**Module:** `backend/app/modules/data_curation/faiss_store.py` → `FaissStore`

```
INPUT                              TRANSFORM                           OUTPUT
────────────────────────────────  ──────────────────────────────────  ────────────────────────────
chunks per file                   Model: all-MiniLM-L6-v2              faiss/index.faiss
  [{idx, text, ...}]               (SentenceTransformer, dim=384)        IndexFlatIP (inner product)
                                  Fallback: SHA256 hash-based
                                    deterministic embedding            faiss/chunks.pkl
                                                                         [{file_id, text, chunk_idx}]
                                  Per file:
                                    _embed_batch(texts, batch=32)
                                    index.add(embeddings)
                                    Append metadata to chunks list

                                  Final: _save() writes both files
```

**Final status update:** After stage 9 completes, `_update_steps()` sets `status='graph_done'` with `entity_count` and `file_count` in the `ingest_jobs` row. This terminal status stops the SSE stream.

---

### Phase 2: Frontend SSE Consumer

**File:** `frontend/app/processing/page.tsx`

```
EventSource connects to GET /api/v1/data/progress/{job_id}
  │
  │  Every 1.5s, backend polls ingest_jobs:
  │    SELECT status, progress, entity_count, ... WHERE job_id = :id
  │    Emit SSE event: {type, status, steps[], current_step, overall_pct, ...}
  │
  ▼
  Parse event.steps[] → map to PipelineCanvas nodes
  │
  ├─ Step reaches "done" → check gate triggers:
  │    ├─ import done  → show ApprovalGate(step="import")   ─┐
  │    ├─ clean done   → show ApprovalGate(step="dedup")    ─┤ Overlay modal
  │    ├─ quality done → show ApprovalGate(step="quality")  ─┤ with controls
  │    ├─ graph done   → show ApprovalGate(step="graph")    ─┤
  │    └─ model stage  → show ApprovalGate(step="model")    ─┘
  │         │
  │         ▼ User clicks "Proceed"
  │         POST /api/v1/pipeline/{job_id}/approve/{step}
  │           → Redis: SET gate:{job_id}:{step} = "approved"
  │         Optional: PATCH /api/v1/pipeline/{job_id}/config
  │           → Redis: SET pipeline_config:{job_id} = {thresholds}
  │
  ├─ graph_done status → trigger SLM Studio flow
  │    ├─ GET /api/v1/slm/for-corpus?job_id=X
  │    ├─ If no SLM: show SLMStudio component
  │    │    → POST /api/v1/slm/build (teacher, student, LoRA config)
  │    │    → Poll GET /api/v1/slm/status until complete
  │    └─ If SLM exists: show approve/deploy modal
  │         → POST /api/v1/slm/approve-install
  │
  └─ Terminal: status ∈ {graph_done, failed, error} → close EventSource
```

**Gate tracking:** `gatesShownRef` (a `Set<string>`) prevents re-triggering gates on SSE reconnect. Each gate is shown exactly once per session.

---

### Phase 3: Pipeline Control Plane

**File:** `backend/app/routes/pipeline.py`

All state is stored in Redis with TTLs:

| Redis Key | Value | TTL | Purpose |
|---|---|---|---|
| `gate:{job_id}:{step}` | `"approved"` | 3600s | Gate clearance signal |
| `pipeline_config:{job_id}` | JSON `{quality_threshold, dedup_sensitivity, selected_model}` | 86400s | User-set thresholds |
| `pipeline_pause:{job_id}` | `"1"` | 3600s | Pause flag |

The `GET /{job_id}/state` endpoint combines PostgreSQL job status + Redis gate states into a unified topology response.

---

### Filesystem Artifacts Summary

After a complete pipeline run, `corpus_store/{job_id}/` contains:

```
corpus_store/{job_id}/
├── {original_filename.pdf}           ← uploaded raw files
├── processed/
│   ├── {file_id}_corpus.json         ← Stage 1: extracted corpus
│   ├── {file_id}_eda_summary.json    ← Stage 4: EDA summary
│   ├── {file_id}_graph_validation.json
│   ├── {file_id}_folder_analytics.json
│   ├── {file_id}_kg_scorecard.json   ← Quality scorecard (8 scores)
│   ├── {file_id}_eda_visuals.json    ← Histogram/distribution data
│   ├── {file_id}_eda_artifacts.json  ← Bundle index
│   ├── {file_id}_cross_links.json    ← Stage 7: cross-source results
│   └── cross_link_reviews.json       ← Review queue
├── canonical_registry.json           ← Stage 6: global entity registry
├── canonical_graph.json              ← Stage 8: merged knowledge graph
├── graphs/
│   └── {file_id}_graph.json          ← Stage 8: per-file raw graph
├── wiki_pages/
│   ├── index.json                    ← Wiki page index
│   └── {canonical_id}.json           ← Individual wiki pages
├── graphify-out/
│   ├── graph.json                    ← Graphify community graph
│   └── wiki/*.md                     ← Graphify markdown articles
└── faiss/
    ├── index.faiss                   ← Stage 9: FAISS vector index
    └── chunks.pkl                    ← Chunk metadata
```

---

### DB Pipeline Variant

`run_db_pipeline()` follows a parallel 7-stage path for database sources:

**Connect → Introspect → Profile → EDA → Schema Graphify → Merge to Canonical → Embed**

Key differences: schema metadata replaces file text extraction, `_fallback_graph_from_schema()` creates nodes from tables and edges from foreign keys, `build_db_semantic_hints()` enriches cross-source linking with column-level semantic labels (identifier/time/measure/descriptor), and `detect_implicit_relationships()` finds naming-convention-based FK candidates.

---

### Error Handling & Resilience

- **Non-fatal stages:** EDA (Stage 4), cross-source linking (Stage 7) catch all exceptions and continue.
- **Fatal stages:** Extract (Stage 1) — if zero files found, pipeline sets `status=failed` immediately.
- **Per-file isolation:** Entity extraction, canonical building, resolution, graph upsert, wiki build, and embedding all run per-file with independent try/except. One file failure doesn't block others.
- **Celery retries:** `max_retries=2` on the file pipeline, `max_retries=1` on the DB pipeline.
- **Retry/Repair endpoints:** `POST /data/retry/{job_id}` does reindex-only if graph exists, full re-run otherwise. `POST /data/repair/{job_id}` always does a full re-run.