# Plan: Expand the Processing Section into a 14‑Layer Semantic Intelligence Pipeline

## Context

The Orchestrator platform runs a **9‑stage Celery ingest pipeline** (`run_ingest_pipeline` in
[ingest_task.py](backend/app/tasks/ingest_task.py)) that writes granular progress into the
`ingest_jobs.progress` JSONB column as a `steps[]` array, streamed to the frontend over SSE
([data.py](backend/app/routes/data.py) `stream_progress`). The Processing page
([processing/page.tsx](frontend/app/processing/page.tsx)) renders these as **5 high‑level visual
nodes**, then runs an approval gate → SLM‑build → orchestrator flow.

We want the Processing section to express the **14‑layer enterprise semantic architecture**
(Ingestion → Cleaning → Chunking → Metadata Intelligence → Entity/Relationship → Semantic Learning
→ EDA → ML Validation → Ontology/Governance → Canonicalization → Knowledge Graph → Graph Validation
→ Wiki/Explainability), while producing results in **exactly the same shape the rest of the app
already consumes**. Five of these layers are genuinely new (Metadata Intelligence, Semantic Learning,
ML Validation, Ontology/Governance, Graph Validation); the rest map onto existing stages.

**Hard constraint — no breaking changes.** The terminal status `graph_done`, the
`{entity_count, file_count}` extra payload, the `steps[]` shape, and every existing artifact‑writing
call (`GraphBuilder.upsert_canonical_graph` / `build_graph`, `WikiBuilder.build_pages_for_nodes`,
`FaissStore.add_chunks`, `processed/*_corpus.json`) must be preserved **verbatim**.

**Scope (confirmed with user):** Processing ingest pipeline only — layers 2‑14 + its UI. Real‑but‑
pragmatic backend for the 5 new layers (reuse existing utilities, write small JSON artifacts,
strictly non‑fatal). UI upgraded with the **already‑installed** stack (Tailwind, CSS, recharts,
lucide) — **no new npm dependencies**. Workspace upload, approval gates, SLM‑build phase,
orchestrator, planning, recommendations, `run_db_pipeline`, and `reindex_pipeline` are left untouched.

**Pre‑existing condition (do NOT fix here):** the live `run_ingest_pipeline` writes
`canonical_graph.json` + `wiki_pages/`, while some routes read `graphify-out/*`. This is unrelated to
our change; we preserve the existing calls as‑is so behavior is identical to today.

---

## Backend changes

### 1. Restructure `run_ingest_pipeline` — [ingest_task.py](backend/app/tasks/ingest_task.py)

Replace the 9‑entry `steps` literal (lines 92‑102) with this **14‑entry** array (indices 0‑13).
Existing ids (`extract`, `entities`, `eda`, `embed`) are preserved; labels carry the architecture
layer numbers 2‑15 (layer 1 = File Upload lives in Workspace; FAISS embedding is the operational tail).

```python
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
```

**Per‑layer mapping (existing code block → new layer index):**

| idx | id | Source |
|----|----|--------|
| 0 | extract | EXISTING stage 1 (158‑178) unchanged — writes `processed/{file_id}_corpus.json` |
| 1 | clean | SPLIT from stage 2: `cleaned_by_file[fid] = clean_text(raw_text)` only |
| 2 | chunk | SPLIT from stage 2: `chunk_text(...)` + `validate_chunking(...)` → `all_chunks_by_file`, `all_validations` |
| 3 | metadata_intel | **NEW** (§2.1), non‑fatal |
| 4 | entities | EXISTING stage 3 (198‑221) unchanged |
| 5 | semantic_learn | **NEW** (§2.2), non‑fatal |
| 6 | eda | EXISTING stage 4 (223‑243) unchanged |
| 7 | ml_validation | **NEW** (§2.3), non‑fatal |
| 8 | ontology | **NEW** (§2.4), non‑fatal — derive taxonomy/constraints from layer‑6 entities (NOT canonical graph; see ordering note) |
| 9 | canonical | MERGE existing stage 5 (canonical build) + stage 6 (resolution) |
| 10 | graph_build | MERGE existing stage 7 (cross‑link) + graph‑upsert half of stage 8 (`upsert_canonical_graph` + `build_graph`) — calls preserved verbatim |
| 11 | graph_validate | **NEW** (§2.5), non‑fatal — uses ontology artifact from idx 8 |
| 12 | wiki | EXISTING wiki half of stage 8 (`wiki_builder.build_pages_for_nodes`) — preserved verbatim |
| 13 | embed | EXISTING stage 9 (340‑355) unchanged — terminal action |

**Terminal call unchanged except index:**
`_update_steps(job_id, steps, 13, "graph_done", {"entity_count": total_ents, "file_count": len(all_corpora)})`
All intermediate `_update_steps(..., "ingesting")` calls keep the same pattern with renumbered indices.

**Ordering note:** the architecture lists Ontology (10) before Canonicalization (11). Resolve by having
the Ontology layer derive its taxonomy + relationship‑constraint table from the **already‑extracted**
`all_entities_by_file` / `all_rels_by_file` (available from layer 6). Defer any graph‑structural
validation to layer 13 (which has the canonical graph). Do **not** call `validate_canonical_graph` in
layer 10.

**Non‑fatal template** for all 5 new layers (mirrors the existing EDA/cross‑link try/except style):
```python
steps[N]["status"] = "running"; _update_steps(job_id, steps, N, "ingesting")
try:
    art = run_<layer>(...)
    steps[N]["detail"] = f"<summary from art>"
except Exception as exc:
    logger.warning("<layer> failed: %s", exc); steps[N]["detail"] = "skipped"
steps[N]["status"] = "done"; steps[N]["pct"] = 100
_update_steps(job_id, steps, N + 1, "ingesting")
```

### 2. Five new modules — new package `backend/app/modules/intelligence/`

Each: pure functions, write one JSON artifact under `corpus_dir`, return a summary dict for the step
`detail`. Reuse confirmed existing utilities.

- **2.1 `metadata_intelligence.py`** — `run_metadata_intelligence(corpus_dir, all_corpora, all_chunks_by_file) -> dict`.
  Reuses [db_profiler.py](backend/app/modules/db/db_profiler.py) `detect_semantic_meaning`,
  `detect_table_semantic_meaning`, `detect_implicit_relationships`. For tabular corpora derive
  pseudo‑columns from `corpus["table_rows"]` headers + sample values; classify table; infer PK/FK
  candidates. Writes `metadata_intelligence.json`.
- **2.2 `semantic_learning.py`** — `run_semantic_learning(corpus_dir, all_entities_by_file, all_chunks_by_file, embed_fn) -> dict`.
  Reuses `FaissStore.embed_text` + numpy: entity‑label embeddings → greedy cosine clustering (~0.8),
  chunk‑level co‑occurrence pairs. Writes `semantic_learning.json`.
- **2.3 `ml_validation.py`** — `run_ml_validation(corpus_dir, all_entities_by_file, all_rels_by_file, eda_results) -> dict`.
  Reuses [confidence_scoring.py](backend/app/modules/kg/confidence_scoring.py) `quality_scorecard`,
  `confidence_histogram`. Aggregates `eda_confidence` → precision/recall/F1 proxies + hallucination‑risk
  proxy + histograms. Writes `ml_validation.json`.
- **2.4 `ontology_governance.py`** — `run_ontology_governance(corpus_dir, all_entities_by_file, all_rels_by_file) -> dict`.
  Pure derivation: entity‑type taxonomy (type→count), relationship constraints (observed src_type→tgt_type
  signatures per relation), constraint violations. Writes `ontology.json`.
- **2.5 `graph_validation.py`** — `run_graph_validation(corpus_dir, graph_builder, ontology_artifact=None) -> dict`.
  Reuses `GraphBuilder.get_canonical_graph()` + `GraphBuilder.canonical_graph_metrics()` +
  [graph_validation_utils.py](backend/app/modules/eda/graph_validation_utils.py) `graph_metrics`
  (orphans/components) and `validate_relationship_quality`. Optional `networkx` (in requirements, import
  inside try/except) for `nx.simple_cycles`. Computes trust score via `quality_scorecard`. Writes
  `graph_validation.json`.

### 3. New read‑only endpoint — [data.py](backend/app/routes/data.py)

Add `GET /api/v1/data/intelligence/{job_id}` that reads the 5 new JSON artifacts from `corpus_dir`
(via existing `_resolve_corpus_dir`) and returns them in one payload. Additive, non‑breaking; used by
the upgraded UI for charts. Missing files return `{}` for that layer.

---

## Frontend changes

### 4. Drive the canvas from streamed `steps[]` — [processing/page.tsx](frontend/app/processing/page.tsx)

The SSE already streams the full `steps[]` array (id/label/status/pct/detail). Replace the fragile
hardcoded `current_step` 0‑8 thresholds (lines 156‑186) with **direct rendering of `ev.steps`** — robust
to the index change. Keep these unchanged: the `graph_done` gate (`showGate("graph", …)`), the
`build-ai` → `ai` → `answer` phase, `RESULT_NODES`, SLM Studio, achievements, and orchestrator startup.

- Map the 14 streamed layer statuses into the visual pipeline.
- On `graph_done`, behave exactly as today (fire achievement, show graph gate, transition to build‑ai).
- Achievement toasts: fire on key layer completions (extraction, chunking, entities, graph_build,
  graph_validate) keyed off `ev.steps` status transitions, replacing the old index‑based triggers.

### 5. Upgrade `PipelineCanvas` — [PipelineCanvas.tsx](frontend/app/components/PipelineCanvas.tsx)

Render the 14 layers as a semantic flow using current stack only (Tailwind + CSS animations +
lucide icons). Per‑layer: status dot, label, live `detail` text, glowing "running" edge animation.
Add an **expandable panel per layer** that, after `graph_done`, fetches
`/api/v1/data/intelligence/{job_id}` and renders with **recharts**: confidence histograms (ML
Validation), ontology taxonomy bars (Ontology), trust score + orphan/cycle counts (Graph Validation),
cluster/co‑occurrence summary (Semantic Learning), PK/FK + column‑label table (Metadata Intelligence).
Preserve the existing `NodeStatus`/`PipelineNode` types and the component's current props so other
callers don't break.

---

## Verification (end‑to‑end with Playwright CLI)

1. **Backend unit sanity:** run each new `run_*` function against a small fixture corpus; confirm each
   writes its JSON artifact and never raises (force a bad input to confirm non‑fatal path).
2. **Pipeline contract:** start an ingest job; poll `ingest_jobs.progress` — confirm `steps[]` has 14
   entries advancing 0→13, terminal status `graph_done`, and `entity_count`/`file_count` set. Confirm
   `canonical_graph.json`, `wiki_pages/`, and the FAISS index are still produced (same as today).
3. **Downstream intact:** confirm `/api/v1/data/corpora` lists the new corpus, and an
   `/api/v1/orchestrator/ask` run still completes (proves `graph_done` + artifacts unchanged).
4. **Playwright full flow:** Workspace → upload sample files → Start Ingestion → Processing page shows
   all 14 layers progressing → graph gate appears → approve → build‑ai/orchestrator phase → answer.
   Assert each of the 14 layer labels renders, the intelligence panels load charts, and navigation
   reaches the recommendations output. Use the existing `/api/v1/data/sample-corpus` loader for a
   deterministic corpus if no upload fixture is handy.
5. Run any existing frontend/backend test suites to confirm no regressions.

## Files touched
- `backend/app/tasks/ingest_task.py` (restructure `run_ingest_pipeline` only)
- `backend/app/modules/intelligence/{metadata_intelligence,semantic_learning,ml_validation,ontology_governance,graph_validation}.py` (new)
- `backend/app/routes/data.py` (add one read‑only endpoint)
- `frontend/app/processing/page.tsx` (steps‑driven rendering; phases preserved)
- `frontend/app/components/PipelineCanvas.tsx` (14‑layer view + intelligence panels)
