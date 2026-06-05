## Plan: Karpathy Graphify Backend Migration

Move ingestion to Karpathy-style artifacts as the primary runtime output while preserving all current frontend/backoffice behavior through dual-write and adapter-backed endpoint compatibility. The approach is: implement graphify-first generation, keep canonical artifacts available via compatibility generation, unify DB+file ingestion dispatch, and normalize endpoint readers so Build custom AI, model selection, planning, and results continue without behavior regressions.

**Steps**
1. Phase 1: Define artifact contract and shared resolver
1.1 Create a single backend artifact resolver used by routes to locate job artifacts from ingest_jobs.metadata.corpus_dir and fallback conventions.
1.2 Define normalized contract objects for graph, wiki articles, wiki pages, and training stats that can be populated from either graphify-out or canonical files.
1.3 Add explicit contract precedence: graphify-out (primary) -> canonical compatibility files (fallback) -> empty-safe response.
1.4 Dependency: blocks all route migrations.

2. Phase 2: Ingestion dual-write (graphify primary + canonical compatibility)
2.1 Update active ingestion path to execute Graphify pipeline and WikiSerializer in current task runtime, not backup code paths.
2.2 Persist ingest_jobs.graph_path deterministically to graphify graph output when available.
2.3 Keep writing canonical compatibility outputs used by existing EDA/wiki/repair contracts (canonical graph projection + wiki_pages JSON projection).
2.4 Ensure terminal status and progress step IDs remain unchanged (graph_done etc.) for processing UI compatibility.
2.5 Dependency: depends on Phase 1 contract definitions.

3. Phase 3: DB + file unified ingestion routing
3.1 Update ingestion dispatch logic so jobs with DB credentials run a unified flow (DB schema extraction + file corpus graphify merge in same job contract).
3.2 Keep current route and payload shape unchanged (/data/ingest) while selecting internal execution branch by presence of DB creds/files.
3.3 Ensure unified flow writes both graphify primary artifacts and canonical compatibility artifacts.
3.4 Dependency: parallel with late Phase 2 if shared writers are ready; otherwise depends on 2.3.

4. Phase 4: Endpoint compatibility migration (backend only)
4.1 Migrate graph/wiki/token/stat endpoints in /data to read via shared resolver and serve stable payloads regardless of storage format.
4.2 Migrate orchestrator enrichment to load graph context + wiki context from normalized sources (graphify wiki markdown or derived wiki_pages content) without changing response schema.
4.3 Migrate SLM suggestions/build prerequisites to consume normalized wiki corpus so custom AI build quality remains corpus-grounded.
4.4 Preserve /wiki routes behavior by generating/maintaining wiki_pages as compatibility output.
4.5 Dependency: depends on Phase 1 and 2.

5. Phase 5: Backward-compatibility hardening and guardrails
5.1 Add defensive fallback logic where routes currently hardcode corpus_store/{job_id} to use metadata-aware resolver first.
5.2 Add ingestion-time validation checks that required artifacts exist before marking terminal success (graph, wiki, embeddings).
5.3 Add API-level regression tests for endpoints used by Processing, Build AI, Plan, Results, and EDA.
5.4 Dependency: parallel with end of Phase 4.

6. Phase 6: Verification and rollout
6.1 Run integration matrix over three job types: file-only, DB-only, file+DB unified.
6.2 Validate strict non-regression for current frontend flows by checking endpoint payload shape and terminal statuses.
6.3 Validate Karpathy artifacts creation (graphify-out/graph.json, graphify-out/wiki/*.md, train.bin, val.bin) and compatibility artifacts (canonical_graph.json, wiki_pages/*).
6.4 Release behind env flag (GRAPHIFY_PRIMARY=true) for staged enablement, then default-on after validation.

**Relevant files**
- /home/neelam/orchestrator/backend/app/tasks/ingest_task.py - active ingestion runtime; add graphify-primary dual-write, graph_path persistence, unified DB/file path.
- /home/neelam/orchestrator/backend/app/routes/data.py - migrate graph/wiki/entities/wiki-stats endpoints to normalized resolver.
- /home/neelam/orchestrator/backend/app/routes/wiki.py - keep wiki_pages API contract; ensure compatibility projection source remains populated.
- /home/neelam/orchestrator/backend/app/routes/orchestrator.py - normalize graph/wiki context loading for results orchestration.
- /home/neelam/orchestrator/backend/app/routes/slm.py - normalize wiki source for suggestions/build readiness.
- /home/neelam/orchestrator/backend/app/routes/pipeline.py - remove brittle dependency on missing graph_path by resolver fallback.
- /home/neelam/orchestrator/backend/app/routes/eda.py - align stage-size wiki accounting with normalized artifact contract.
- /home/neelam/orchestrator/backend/app/modules/data_curation/graphify_engine/graphify_runner.py - primary graph/wiki generator.
- /home/neelam/orchestrator/backend/app/modules/data_curation/graphify_engine/wiki_serializer.py - train.bin/val.bin generation.
- /home/neelam/orchestrator/backend/app/modules/graph/graph_builder.py - canonical compatibility generation and repair metrics contract.
- /home/neelam/orchestrator/backend/app/modules/wiki/wiki_builder.py - compatibility wiki_pages generation for /wiki routes.
- /home/neelam/orchestrator/backend/app/modules/slm_factory/distillation_engine.py - ensure corpus wiki input compatibility remains stable.
- /home/neelam/orchestrator/backend/app/modules/slm_factory/slm_builder.py - verify build path still consumes normalized wiki_articles.
- /home/neelam/orchestrator/backend/app/tasks/slm_build_task.py - stop passing empty wiki_articles by loading normalized wiki corpus for build task.

**Verification**
1. API contract tests (shape + status) for:
- /api/v1/data/progress/{job_id}
- /api/v1/data/graph/{job_id}
- /api/v1/data/entities/{job_id}
- /api/v1/data/wiki/{job_id}
- /api/v1/data/wiki/{job_id}/stats
- /api/v1/wiki/{job_id}/pages
- /api/v1/orchestrator/ask
- /api/v1/slm/suggestions
2. Ingestion artifact tests for each mode (file-only, DB-only, file+DB): confirm presence of graphify primary + canonical compatibility outputs.
3. Non-regression checks for terminal pipeline statuses and step IDs consumed by processing UI.
4. End-to-end checks:
- Build custom AI from job_id uses non-empty normalized wiki corpus.
- Planning/recommendations produce graph-grounded outputs with no endpoint changes required by frontend.

**Decisions**
- Rollout mode: dual-write first (graphify primary + canonical compatibility).
- Compatibility target: strict backward compatibility for existing frontend flows.
- Scope includes DB+file unified ingestion in this backend update.
- Scope excludes frontend code changes unless an emergency compatibility patch is required.

**Further considerations**
1. Decommission timing recommendation: keep dual-write for one full release cycle with observability counters before removing canonical compatibility writers.
2. Performance recommendation: make compatibility projections async/non-blocking within task tail if graphify run time grows significantly.
3. Data migration recommendation: add one-time backfill utility to generate missing graphify outputs for historical jobs needed by current results pages.
