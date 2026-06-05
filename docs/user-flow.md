Here's the full user-flow breakdown for the **AI Orchestrator / Domain Harnessing System**, organized by journey stage.

---

## Stage 0: Onboarding & Authentication

### F1 — Login
| | |
|---|---|
| **Intent** | Gain access to the platform |
| **Steps** | 1. Navigate to `/login` → 2. Enter username + password → 3. Credentials checked against `NEXT_PUBLIC_AUTH_USER` / `NEXT_PUBLIC_AUTH_PASS` env vars → 4. On success: cookie `orch_logged_in=true` + `localStorage.orch_user` set → 5. Redirect to `/dashboard` |
| **Decision Point** | Valid credentials? → Yes: proceed. No: error toast, stay on page |
| **Inputs** | Username, password |
| **Outputs** | Auth cookie, localStorage session, redirect |

### F2 — First-Run Onboarding Wizard
| | |
|---|---|
| **Intent** | Orient a new user to the platform's capabilities |
| **Steps** | 1. `OnboardingWizard` component detects first visit (localStorage flag) → 2. Multi-step guided overlay explains domain ingestion, processing, querying → 3. User clicks through or dismisses → 4. Flag set to prevent re-showing |
| **Decision Point** | Skip wizard? → Yes: dismiss. No: step through all slides |
| **Inputs** | None |
| **Outputs** | localStorage onboarding-complete flag |

---

## Stage 1: Workspace Setup (Domain Ingestion)

**Route:** `/` (home page)

### F3 — Domain Selection
| | |
|---|---|
| **Intent** | Define the knowledge domain to work with |
| **Steps** | 1. View existing domains in `WorkspaceCard` grid → 2. Select an existing domain **OR** type a new domain label → 3. Domain label stored in component state, passed to ingest |
| **Decision Point** | Use existing corpus? → Yes: skip upload, go to `/processing`. Create new? → proceed to F4/F5 |
| **Inputs** | Domain label string |
| **Outputs** | Selected domain context for downstream steps |

### F4 — File Upload
| | |
|---|---|
| **Intent** | Feed domain knowledge into the system |
| **Steps** | 1. Drag-drop or browse files (PDF, DOCX, CSV, JSON, Parquet, TXT) → 2. Files staged in browser → 3. Optional: toggle `force_reingest` to re-process even if domain exists → 4. Click "Start Ingestion" → 5. `POST /api/v1/data/ingest` (multipart form) → 6. Backend creates `ingest_jobs` row, spawns Celery task → 7. Returns `job_id` → 8. Redirect to `/processing` |
| **Decision Point** | Force reingest? → Yes: wipes prior corpus for this domain. No: skips if domain data exists |
| **Inputs** | Files, domain label, force_reingest flag |
| **Outputs** | `job_id`, Celery task queued |

### F5 — Database Connection (Alternative to File Upload)
| | |
|---|---|
| **Intent** | Ingest structured data from an external database |
| **Steps** | 1. Toggle "Connect Database" → 2. Select DB type (PostgreSQL, MySQL, SQLite, MongoDB) → 3. Enter host, port, credentials, database name → 4. Click "Test Connection" → `POST /api/v1/data/test-connection` → 5. On success: confirm → 6. DB creds bundled with ingest request → 7. Backend's `db_adapter.py` introspects schema, extracts rows as documents |
| **Decision Point** | Test passes? → Yes: include in ingest. No: fix credentials |
| **Inputs** | DB type, host, port, user, password, database name |
| **Outputs** | Validated connection, schema metadata |

### F6 — URL Scraping (Alternative Ingest)
| | |
|---|---|
| **Intent** | Pull content from a web page |
| **Steps** | 1. Enter a URL → 2. `POST /api/v1/data/scrape` → 3. Backend fetches page, extracts text → 4. Enqueues as ingest job |
| **Inputs** | URL string |
| **Outputs** | `job_id` for scraped content |

### F7 — Sample Corpus Loader
| | |
|---|---|
| **Intent** | Quick-start with demo data (nanoGPT/minGPT) |
| **Steps** | 1. Click "Load Sample Corpus" → 2. `POST /api/v1/data/sample-corpus` → 3. Backend downloads from GitHub, stages files → 4. Returns `job_id` |
| **Inputs** | None (preset) |
| **Outputs** | `job_id` with sample domain |

---

## Stage 2: Processing Pipeline

**Route:** `/processing`

### F8 — Live Pipeline Monitoring
| | |
|---|---|
| **Intent** | Watch the 9-stage Celery ingest pipeline execute |
| **Steps** | 1. `PipelineCanvas` renders node graph → 2. SSE stream from `GET /api/v1/data/progress/{job_id}` updates node statuses in real-time → 3. Stages: parse → chunk → dedup (MinHash LSH) → quality score → NLP entity extraction → Graphify community detection → FAISS index build → wiki generation → finalize |
| **Decision Point** | At each approval gate (see F9): wait for human approval or auto-approve |
| **Inputs** | `job_id` |
| **Outputs** | Stage-by-stage progress events, visual node states |

### F9 — Approval Gates (Human-in-the-Loop)
| | |
|---|---|
| **Intent** | Let the user control pipeline thresholds at critical stages |
| **Steps** | Pipeline pauses at each gate → `ApprovalGate` component renders with controls: |
| | **Import Gate:** Review file count, parsed tokens → approve/reject |
| | **Dedup Gate:** Adjust dedup sensitivity slider → approve |
| | **Quality Gate:** Set minimum quality threshold → approve |
| | **Graph Gate:** Preview top-20 entities (`GET /pipeline/{job_id}/entities/preview`) → approve |
| | **Model Gate:** Choose base model for SLM → approve |
| | User clicks "Approve" → `POST /api/v1/pipeline/{job_id}/approve/{step}` → pipeline resumes |
| **Decision Points** | At each gate: approve (continue), adjust thresholds (`PATCH /pipeline/{job_id}/config`), or pause (`POST /pipeline/{job_id}/pause`) |
| **Inputs** | Threshold values, approval action |
| **Outputs** | Gate state updated in Redis, pipeline unblocked |

### F10 — SLM Studio (Model Distillation Config)
| | |
|---|---|
| **Intent** | Configure and launch a domain-specific Small Language Model build |
| **Steps** | 1. `SLMStudio` panel opens during/after pipeline → 2. Select teacher model (cloud LLM for generating training data) → 3. Select student model (local base for fine-tuning) → 4. Configure LoRA params (rank, alpha, dropout) → 5. Set QA pair volume → 6. Click "Build SLM" → `POST /api/v1/slm/build` → 7. Celery task: teacher synthesis → QLoRA training → validation → registry entry |
| **Decision Points** | Build SLM now? → Yes: configure + launch. No: skip, use existing models. Coverage check result (BUILD_NEW / EXTEND / ROUTE_MIXED) guides the recommendation |
| **Inputs** | Teacher model, student model, LoRA config, QA volume |
| **Outputs** | SLM registered in `slm_registry`, adapter saved to `slm_store/` |

### F11 — SLM Deployment Approval
| | |
|---|---|
| **Intent** | Deploy a built SLM to Ollama for local inference |
| **Steps** | 1. SLM build completes → status shows val_loss, hallucination_rate → 2. User reviews metrics → 3. Click "Approve & Install" → `POST /api/v1/slm/approve-install` → 4. Backend creates Ollama Modelfile, loads model |
| **Decision Point** | Metrics acceptable? → Yes: deploy. No: rebuild with different config |
| **Inputs** | `model_id` |
| **Outputs** | Model available in Ollama for routing |

---

## Stage 3: Query Composition

**Route:** `/query`

### F12 — Corpus Selection
| | |
|---|---|
| **Intent** | Choose which ingested corpus to query against |
| **Steps** | 1. `GET /api/v1/data/corpora` loads available domains → 2. Select corpus from dropdown → 3. `job_id` stored in session state |
| **Decision Point** | Which domain corpus? → user picks one |
| **Inputs** | None (browse list) |
| **Outputs** | Selected `job_id` |

### F13 — Prompt Builder
| | |
|---|---|
| **Intent** | Construct a precise, domain-grounded query |
| **Steps** | 1. `PromptBuilder` component loads → 2. Wiki topic pills shown (from `GET /data/wiki/{job_id}`) → click to inject into prompt → 3. Process path selector: BUILDER / RESEARCHER / ANALYST / AUDITOR / SUMMARIZER → 4. Type or refine prompt text → 5. Optional: load from saved custom template |
| **Decision Points** | Which process path? (defines output structure). Use topic pills? Use custom template? |
| **Inputs** | Free-text query, selected topics, process path |
| **Outputs** | Composed prompt string, process path enum |

### F14 — Scoring Weights Configuration
| | |
|---|---|
| **Intent** | Control how models are scored/selected |
| **Steps** | 1. Choose preset: Balanced / Quality-First / Speed-First / Reliable → 2. Or manually adjust sliders: quality weight, speed weight, reliability weight → 3. Weights stored in `sessionStorage` |
| **Decision Point** | Preset or custom? |
| **Inputs** | Weight values (0–1 each) |
| **Outputs** | `ModelWeights` object for orchestrator |

### F15 — Launch Analysis
| | |
|---|---|
| **Intent** | Submit the query to the orchestrator |
| **Steps** | 1. Click "Analyze" → 2. Query + weights + job_id + process path bundled → stored in `sessionStorage` → 3. Redirect to `/processing` (orchestrator mode) or `/planning` |
| **Inputs** | Prompt, weights, job_id, process path |
| **Outputs** | Session state set, navigation triggered |

---

## Stage 4: Planning & Suggestions

**Route:** `/planning`

### F16 — Domain-Aware Suggestion Cards
| | |
|---|---|
| **Intent** | Get AI-generated query suggestions grounded in the corpus |
| **Steps** | 1. `GET /api/v1/slm/suggestions?domain_label=X&job_id=Y` → 2. Backend generates 10 suggestions using graph context → 3. Cards rendered with path type badges (BUILDER, RESEARCHER, etc.) → 4. User selects a card → 5. Card's prompt injected into query flow |
| **Decision Point** | Use suggestion as-is? → Yes: proceed to orchestrator. Modify first? → go back to query page. Custom query? → skip suggestions |
| **Inputs** | Domain label, job_id |
| **Outputs** | Selected suggestion prompt + path type |

---

## Stage 5: Orchestration & Results

**Route:** `/processing` (orchestrator SSE mode) → `/recommendations`

### F17 — 10-Step Orchestrator Pipeline
| | |
|---|---|
| **Intent** | Execute the full AI reasoning pipeline |
| **Steps** | 1. `POST /api/v1/orchestrator/ask` (SSE stream) → 2. Steps execute sequentially: Task Classification → Model Capability Match → Knowledge Graph Lookup → Token Compression (LLMLingua) → Bandit Route Selection → Model Dispatch (local/cloud) → Response Synthesis → Hallucination Check → Confidence Scoring → Output Assembly → 3. Each step streams events to the frontend `PipelineCanvas` → 4. Final output: `OrchestratorOutput` with sub-task results, traces, build plan |
| **Decision Points** | Task type (DOMAIN/CAPABILITY/HYBRID) auto-classified → LinUCB bandit picks model → Nash equilibrium validates allocation |
| **Inputs** | `AskRequest` (query, model_weights, job_id, process_path) |
| **Outputs** | `OrchestratorOutput` (answer, sub-tasks, model trace, build plan) |

### F18 — Results Tabs
| | |
|---|---|
| **Intent** | Consume and interact with orchestrator output |
| **Tabs:** | |
| | **Build Plan** — HLD → LLD → implementation blueprint (for BUILDER path) |
| | **Answer** — Full markdown-rendered synthesized answer |
| | **Q&A Chat** — Follow-up questions in corpus context (iterative) |
| | **Decision Trace** — Step-by-step reasoning: which model, why, confidence, latency |
| **Decision Points** | Which tab to focus? Ask follow-up? Provide feedback? |
| **Inputs** | Orchestrator output |
| **Outputs** | Rendered views, follow-up queries |

### F19 — User Feedback
| | |
|---|---|
| **Intent** | Train the bandit model selector via human signal |
| **Steps** | 1. On Decision Trace tab → thumbs up/down per sub-task → 2. `POST /api/v1/feedback` with model_id, task_type, reward → 3. Backend updates LinUCB arm weights in `bandit_scores` |
| **Decision Point** | Helpful? → thumbs up (reward=1). Not helpful? → thumbs down (reward=0) |
| **Inputs** | model_id, task_type, binary reward |
| **Outputs** | Updated bandit arm weights (improves future routing) |

---

## Stage 6: Knowledge Exploration (Post-Interaction)

### F20 — Wiki Browser (`/wiki`)
| | |
|---|---|
| **Intent** | Explore generated knowledge articles |
| **Steps** | 1. Select corpus → `GET /api/v1/wiki/{job_id}/pages` → 2. Browse/search articles → 3. Click article → `GET /api/v1/wiki/{job_id}/page/{canonical_id}` → 4. View entity-linked markdown content |
| **Inputs** | job_id, search query |
| **Outputs** | Wiki page content |

### F21 — Entity Merge Review Queue (`/wiki`)
| | |
|---|---|
| **Intent** | Curate entity resolution by approving/rejecting merge proposals |
| **Steps** | 1. `GET /api/v1/wiki/{job_id}/reviews` → 2. Each review shows two entities proposed for merge → 3. User approves or rejects → `POST /api/v1/wiki/{job_id}/review/{review_id}` |
| **Decision Point** | Same entity? → Approve merge. Different? → Reject |
| **Inputs** | review_id, accept/reject |
| **Outputs** | Entity graph updated |

### F22 — Cross-Source Link Reviews (`/wiki` context)
| | |
|---|---|
| **Intent** | Validate inferred connections between different source files |
| **Steps** | 1. `GET /api/v1/links/{job_id}/reviews` → 2. Review proposed cross-source links → 3. Approve/reject → `POST /api/v1/links/{job_id}/review/{review_id}` |
| **Inputs** | review_id, accept/reject |
| **Outputs** | Cross-link graph updated |

---

## Stage 7: Quality & Observability (Post-Interaction)

### F23 — Quality Dashboard (`/quality`)
| | |
|---|---|
| **Intent** | Assess data and graph quality metrics |
| **Steps** | 1. Select corpus → `GET /api/v1/quality/{job_id}/metrics` → 2. View: file-level scorecards, graph density/connectivity, registry metrics → 3. Identify low-quality sources |
| **Inputs** | job_id |
| **Outputs** | Scorecards, graph stats, registry health |

### F24 — Graph Repair (`/quality` context)
| | |
|---|---|
| **Intent** | Fix knowledge graph errors |
| **Steps** | 1. Identify bad relation → `POST /api/v1/repair/{job_id}/suppress-relation` → 2. Or split wrongly merged entity → `POST /api/v1/repair/{job_id}/split-entity` → 3. Or re-process a file → `POST /api/v1/repair/{job_id}/reprocess/{file_id}` |
| **Decision Point** | Suppress, split, or reprocess? |
| **Inputs** | Relation/entity IDs |
| **Outputs** | Graph corrected |

### F25 — Dashboard Analytics (`/dashboard`)
| | |
|---|---|
| **Intent** | Monitor platform health and learning progress |
| **Steps** | 1. View SLM stats (`GET /api/v1/slm/stats`) → 2. View bandit learning curves (`GET /api/v1/slm/learning-progress`) → 3. View Nash equilibrium insights (`GET /api/v1/models/insights/{task_type}`) → 4. Review session history (localStorage) → 5. See achievement toasts for milestones |
| **Inputs** | None (auto-loads) |
| **Outputs** | Charts, metrics, arm states, session log |

---

## Stage 8: Templates & Customization

### F26 — Custom Template Editor (`/templates`)
| | |
|---|---|
| **Intent** | Create reusable multi-step prompt templates |
| **Steps** | 1. Navigate to `/templates` → 2. Create new template: name, steps, variables → 3. Save to localStorage → 4. Templates available in `PromptBuilder` dropdown |
| **Decision Point** | Create new or edit existing? |
| **Inputs** | Template name, step definitions, variable placeholders |
| **Outputs** | Saved template (localStorage) |

---

## Visual Journey Map

```
Login ──► Dashboard ──► Workspace ──► Processing ──► Query ──► Planning ──► Results
  │           │            │              │             │          │           │
  │           │         Upload/DB      Approval      Prompt    Suggestion   Build Plan
  │           │         Connect +      Gates +       Builder +   Cards      Answer
  │           │         Domain Pick    SLM Studio    Weights                Q&A Chat
  │           │                                                             Trace +
  │           │                                                             Feedback
  │           │
  │           └──► Wiki ──► Entity Reviews ──► Cross-Link Reviews
  │           └──► Quality ──► Graph Repair
  │           └──► Templates
  │
  └──► Onboarding Wizard (first visit only)
```

Each arrow represents a navigation + data handoff (typically via `sessionStorage` or URL params carrying the `job_id`). The system's self-improving loop closes when **F19 (Feedback)** updates the bandit arms, which changes **F17 (Orchestrator)** model routing on the next query.