# Product Requirements Document (PRD)

### AI Orchestrator — Domain SLM Factory

**Author:** Engineering Team | **Date:** 2026-06-07 | **Version:** 1.0 | **Status:** Draft

---

## Document Control & Change Log

| Version | Date | Author | Changes | Approvers |

|---------|------|--------|---------|-----------|

| 1.0 | 2026-06-07 | Engineering Team | Initial PRD hydrated from codebase | — |

**Distribution List:** Engineering, Product, ML/AI Team Leads

**Review Cycle:** Monthly or upon major feature milestone

---

## 1. Executive Summary

The **AI Orchestrator — Domain SLM Factory** is a self-improving AI platform that transforms raw domain corpora into actionable, grounded intelligence. It ingests documents, databases, and web content; constructs knowledge graphs via NLP-driven entity extraction and community detection; optionally distills domain-specific Small Language Models (SLMs) via QLoRA fine-tuning; and orchestrates multi-model query execution with reinforcement-learned routing.

The system addresses a critical gap: enterprises possess vast domain knowledge locked in unstructured documents, databases, and tribal expertise. Generic LLMs hallucinate on domain-specific queries, while fine-tuning is prohibitively complex for non-ML teams. This platform automates the entire pipeline — from raw data to deployed domain model — with human-in-the-loop quality gates at every critical decision point.

The target users are domain experts, data teams, and technical analysts in knowledge-intensive verticals (CPG/supply chain, manufacturing, healthcare, finance, IT) who need AI-grounded answers without ML engineering expertise. The platform runs fully locally via Ollama for data-sensitive environments, with optional cloud LLM providers for enhanced capability.

The expected impact is a 10x reduction in time-to-insight for domain queries, elimination of hallucinated answers through graph-grounded synthesis, and continuous model improvement via LinUCB bandit feedback loops. The system is currently deployed as a self-hosted Docker Compose stack with a single-user auth model.

---

## 2. Problem Space & Opportunity

### 2.1 Problem Statement

**Current State:**

Domain experts query generic LLMs (ChatGPT, Claude) and receive plausible-sounding but ungrounded answers. They manually cross-reference outputs against internal documents, databases, and spreadsheets. Building domain-specific AI models requires ML engineering teams, GPU infrastructure, and months of iteration.

**Pain Points:**

* **Hallucination on domain queries:** Generic LLMs fabricate facts about proprietary processes, products, and relationships. Every answer requires manual verification.

* **Knowledge fragmentation:** Domain knowledge is scattered across PDFs, DOCX files, CSVs, databases, and internal wikis with no unified semantic layer.

* **SLM complexity barrier:** Fine-tuning a domain model requires ML expertise (dataset curation, LoRA config, evaluation, deployment) that domain teams lack.

* **No model accountability:** When multiple models are available, there's no systematic way to route tasks to the best-suited model or learn from past performance.

**Evidence:** The included synthetic CPG supply chain dataset (453 documents) demonstrates the use case: trade promotions, vendor scorecards, demand forecasts, and category playbooks that a generic LLM cannot accurately reason over without grounding.

### 2.2 Opportunity & Market Context

**Market Trends:**

- Enterprises adopting RAG and fine-tuning for domain AI (Gartner: 40% of enterprises will deploy domain-adapted LLMs by 2027)

- Shift toward local/private inference (Ollama, vLLM) for data sovereignty

- Emergence of Small Language Models (SLMs) as cost-effective alternatives to frontier models

- Growing demand for human-in-the-loop AI workflows with explainability

**Strategic Alignment:**

- Enables "AI for every domain team" without centralized ML bottleneck

- Positions as the operating system between raw enterprise data and domain-grounded AI answers

- Supports fully air-gapped deployments for regulated industries

---

## 3. Product Vision & Strategy

### 3.1 Vision Statement

Every domain team can transform their proprietary knowledge into a self-improving AI specialist — without writing ML code or exposing data to third parties.

### 3.2 Core Value Proposition

**For** domain experts and technical analysts in knowledge-intensive industries  

**Who** need AI-grounded answers over proprietary data without ML expertise  

**The** AI Orchestrator  

**Is a** self-hosted intelligent pipeline platform  

**That** automatically builds knowledge graphs, trains domain SLMs, and routes queries to the optimal model  

**Unlike** generic RAG tools or manual fine-tuning workflows  

**Our product** provides end-to-end automation from raw corpus to deployed domain model with human-in-the-loop quality gates and continuous bandit-based learning

### 3.3 Core Differentiators

* **Full-pipeline automation:** From raw file upload to deployed, queryable domain SLM in one workflow — no separate tooling needed.

* **Bandit-learned model routing:** LinUCB multi-armed bandit selects the optimal model per task type and improves with every user feedback signal.

* **Graph-grounded synthesis:** All answers cite knowledge graph entities, with hallucination detection that cross-references against the canonical graph.

* **Human-in-the-loop gates:** Approval gates at dedup, quality, graph, and model deployment prevent silent pipeline failures.

### 3.4 Product Principles

* **Local-first, cloud-optional:** Full functionality with only Ollama; cloud providers enhance but are never required.

* **Progressive complexity:** Simple upload-and-query for beginners; deep pipeline control (LoRA params, gate thresholds, custom templates) for power users.

* **Transparency over magic:** Every orchestrator decision is traceable — task classification, model selection reasoning, confidence scores, and hallucination rates are surfaced.

* **Self-improvement as default:** The system gets better with use via bandit learning, SLM retraining signals, and entity resolution feedback.

---

## 4. Project Classification & Context

### 4.1 Project Metadata

* **Technical Type:** Web Application (full-stack) + ML Pipeline

* **Deployment Model:** Self-hosted (Docker Compose), single-node or multi-container

* **Domain:** Enterprise AI / Knowledge Management / MLOps

* **Complexity:** High — spans NLP, ML training, real-time streaming, knowledge graphs, and multi-model orchestration

* **Stage:** Feature Enhancement (pipeline visibility overhaul recently completed)

### 4.2 Domain Context

**Industry Requirements:** Supports air-gapped deployment for regulated industries; no mandatory external API calls.

**Data Sensitivity:** Processes arbitrary enterprise documents — may contain PII, financial data, or trade secrets. All data stays within the deployment boundary (local filesystem + PostgreSQL).

**Governance Needs:** Approval gates provide audit points; query history logged in `query_history` table with full routing decisions.

**Ecosystem Context:** Integrates with Ollama for local inference, optional OpenAI/Anthropic/Groq for cloud models, PostgreSQL+pgvector for vector storage, Redis for task queue and pipeline state.

---

## 5. Users & Stakeholders

### 5.1 User Personas

#### Persona 1: Domain Analyst

**Demographics:**

* Job Title/Role: Supply Chain Analyst / Business Intelligence Analyst

* Experience Level: Mid/Senior

* Technical Proficiency: Medium (comfortable with data, not with ML)

* Organization Size: Mid-Market to Enterprise

**Goals & Motivations:**

* Primary Goal: Get accurate, domain-specific answers over proprietary data

* Success Metrics: Time-to-insight, answer accuracy vs. manual research

* Motivations: Reduce hours spent cross-referencing documents manually

**Pain Points & Frustrations:**

* Generic AI hallucinating about internal products/processes

* Knowledge scattered across 10+ file formats and databases

* Can't build custom AI models without ML team support

**Context of Use:**

* Frequency: Daily

* Duration: 15–60 minute sessions

* Environment: Office/Remote desktop

* Adjacent Tools: Excel, Power BI, internal wikis, ERPs

**Quote:** "I need answers I can trust about OUR supply chain, not generic advice from the internet."

#### Persona 2: Platform Administrator

**Demographics:**

* Job Title/Role: Data Engineer / ML Engineer

* Experience Level: Senior

* Technical Proficiency: High

* Organization Size: Mid-Market to Enterprise

**Goals & Motivations:**

* Primary Goal: Deploy and maintain the AI platform; configure SLM training parameters

* Success Metrics: Pipeline success rate, model quality metrics, system uptime

* Motivations: Enable domain teams without constant ML support requests

**Pain Points & Frustrations:**

* Managing multiple model deployments and versions

* Ensuring data quality before model training

* Debugging pipeline failures in distributed systems

**Context of Use:**

* Frequency: Weekly (setup/maintenance)

* Duration: 1–2 hours

* Environment: Terminal + web dashboard

* Adjacent Tools: Docker, Ollama CLI, PostgreSQL, Redis

**Quote:** "I want to set it up once so the domain team can self-serve without pinging me every time."

### 5.2 User Journey Map

**Journey: First Corpus Ingestion to Grounded Answer**

| Stage | User Actions | Touchpoints | Pain Points | Opportunities |

|-------|-------------|-------------|-------------|---------------|

| 1. Workspace Setup | Select domain, upload files | Home page (`/`) | Unsure which files to include | Guided onboarding wizard |

| 2. Pipeline Processing | Monitor 14-layer pipeline, approve gates | Processing page (`/processing`) | Waiting for pipeline; unclear what each layer does | Real-time SSE + layer drill-down |

| 3. Query Composition | Build prompt with wiki context | Query page (`/query`) | Writing effective prompts | Topic pills from wiki, process path templates |

| 4. Orchestration | Watch 10-step execution | Processing page (orchestrator mode) | Understanding model selection | Decision trace tab |

| 5. Results | Read answer, review build plan | Recommendations (`/recommendations`) | Trusting the answer | Entity citations, hallucination rate |

| 6. Feedback | Thumbs up/down on sub-tasks | Recommendations page | Unclear impact of feedback | Show bandit learning progress |

### 5.3 Stakeholder Map

| Stakeholder | Role | Interest/Concern | Influence Level | Engagement Strategy |

|-------------|------|------------------|-----------------|---------------------|

| Domain Team Lead | End user champion | Answer quality, time savings | High | Weekly demos, feedback sessions |

| IT/Security | Infrastructure | Data residency, no external calls | High | Architecture review, air-gap proof |

| ML Engineering | Platform maintainer | Model quality, pipeline reliability | High | Config access, monitoring dashboard |

| Executive Sponsor | Budget holder | ROI, competitive advantage | Medium | Monthly metrics report |

---

## 6. Success Criteria & Metrics

### 6.1 Business Objectives

* **Reduce time-to-insight for domain queries:**

  - *Target:* 80% reduction vs. manual document research

  - *Timeline:* Measurable after first corpus ingestion

  - *Owner:* Product

* **Achieve grounded answer accuracy:**

  - *Target:* <10% hallucination rate on domain queries

  - *Timeline:* Within 2 weeks of corpus ingestion

  - *Owner:* ML Engineering

### 6.2 Key Performance Indicators (KPIs)

#### Engagement Metrics

* **Queries per session:** Average queries submitted per user session — Target: >3

* **Pipeline completion rate:** % of ingest jobs reaching `graph_done` — Target: >90%

#### Quality Metrics

* **Hallucination rate:** Per-query hallucination detection score — Target: <0.10

* **Bandit convergence:** Task types where bandit has >100 observations — Target: all 8 task types within 30 days

#### Operational Metrics

* **Pipeline duration:** Time from ingest to `graph_done` — Target: <5 min for 50-file corpus

* **Orchestrator latency:** End-to-end query-to-answer — Target: <30s (local), <15s (cloud)

* **SLM build success rate:** % of SLM builds completing without error — Target: >85%

### 6.3 Success Criteria for MVP Launch

**Must Have:**

- [x] 14-layer ingest pipeline with progress tracking

- [x] Knowledge graph construction with entity resolution

- [x] 10-step orchestrator with SSE streaming

- [x] LinUCB bandit model routing with feedback loop

- [x] SLM distillation and Ollama deployment

- [x] Human-in-the-loop approval gates

- [x] Wiki generation and entity review

**Launch Quality Gates:**

- [x] Full pipeline executes end-to-end on CPG sample corpus

- [x] Hallucination detector validates answers against graph

- [x] Docker Compose deployment works with single `docker compose up -d`

- [ ] Performance benchmarks documented

---

## 7. Product Scope

### 7.1 In Scope / Out of Scope

#### In Scope (Current)

| Capability | Description | Priority | Rationale |

|------------|-------------|----------|-----------|

| Multi-format corpus ingestion | PDF, DOCX, CSV, JSON, Parquet, TXT, XLSX, database schemas | P0 | Core data entry point |

| 14-layer processing pipeline | Extract → Clean → Chunk → NER → EDA → Graph → Wiki → FAISS | P0 | Transforms raw data to queryable knowledge |

| Knowledge graph construction | Entity extraction, community detection, canonical graph, cross-source linking | P0 | Foundation for grounded answers |

| SLM distillation (QLoRA) | Teacher synthesis → fine-tuning → validation → Ollama deploy | P0 | Domain specialization |

| 10-step query orchestration | Classification → decomposition → routing → execution → synthesis → evaluation | P0 | Core query engine |

| Bandit model routing | LinUCB per task type with user feedback reward signal | P0 | Self-improvement loop |

| Human-in-the-loop gates | Import, dedup, quality, graph, model approval gates | P0 | Quality control |

| Real-time pipeline monitoring | SSE streaming, 14-layer drill-down, KPI cards | P1 | User visibility |

| Wiki & entity management | Auto-generated wiki, entity merge review, cross-source link review | P1 | Knowledge curation |

| Custom templates | User-defined multi-step prompt templates | P1 | Workflow personalization |

| Quality dashboard | Per-corpus quality metrics, graph density, registry health | P1 | Observability |

| Dashboard analytics | Bandit arms, Nash equilibrium, session history, learning curves | P1 | Platform health monitoring |

#### Explicitly Out of Scope (Current)

* **Multi-user RBAC:** Auth is single-user env-based credentials; no user management system.

* **Team collaboration:** No shared workspaces, concurrent editing, or permission model.

* **Production auth:** No JWT/OAuth/SSO — cookie-based login only.

* **Database migrations:** No Alembic; schema managed via `init.sql` only.

* **CI/CD pipeline:** No automated testing, linting, or deployment automation.

* **Mobile support:** Desktop-first UI, not optimized for mobile viewports.

* **Multi-tenancy:** Single-tenant architecture with shared database.

### 7.2 Future Roadmap (Post-MVP)

**Phase 2 (Months 3–6):**

* Multi-user auth with JWT + RBAC

* Alembic database migrations

* Scheduled re-ingestion and incremental graph updates

* API rate limiting and usage tracking

**Phase 3 (Months 6–12):**

* Multi-tenant architecture with data isolation

* Integration marketplace (Slack, Teams, Jira connectors)

* Automated evaluation benchmarks per domain

* Model A/B testing framework

**Exploratory (12+ months):**

* Federated learning across tenant SLMs

* Real-time streaming ingestion (Kafka/event-driven)

* Visual graph editor for manual knowledge curation

### 7.3 Platform & Environment Requirements

#### Platform Support

* **Web:** Chrome 90+, Firefox 90+, Edge 90+ (desktop)

* **Backend runtime:** Python 3.12 on Linux (Docker) or Windows/macOS (dev)

* **Node.js:** 18+ for Next.js frontend

* **GPU (optional):** CUDA-capable GPU for QLoRA fine-tuning; falls back to CPU/Ollama without

#### Deployment Topology

* **Hosting:** Self-hosted Docker Compose (single node) or manual multi-service

* **Services:** 5 containers — PostgreSQL (pgvector:pg16), Redis 7, FastAPI backend, Celery worker, Next.js frontend

* **External dependency:** Ollama running on host (connects via `host.docker.internal:11434`)

* **Storage volumes:** `postgres_data`, `redis_data`, `slm_store`, `corpus_store`

---

## 8. User Experience & Design

### 8.1 UX Principles

* **Progressive disclosure:** Simple upload-and-query flow for beginners; deep pipeline controls hidden behind expandable panels.

* **Real-time feedback:** SSE streaming for all long-running operations — never leave the user staring at a spinner.

* **Transparency:** Every AI decision is traceable via Decision Trace tab; every pipeline step has drill-down artifacts.

* **Guided complexity:** Approval gates present decisions with previews (entity counts, quality scores) so users make informed choices.

### 8.2 Information Architecture

```

/login                     → Authentication

/ (home)                   → Workspace Setup (Step 1)

/processing                → Pipeline Monitoring + Orchestrator (Step 2)

/query                     → Prompt Builder (Step 3)

/planning                  → AI Suggestions (Step 4)

/recommendations           → Results & Feedback (Step 5)

/dashboard                 → Analytics & Learning Progress

/wiki                      → Knowledge Browser + Entity Reviews

/quality                   → Quality Metrics + Graph Repair

/templates                 → Custom Template Editor

```

### 8.3 Key User Flows

**Flow 1: Corpus Ingestion**

1. Select domain (preset or custom label)

2. Upload files (drag-drop) OR connect database OR enter URL

3. Click "Start Ingestion" → `POST /api/v1/data/ingest`

4. Auto-navigate to `/processing`

   - *Alternative:* Existing corpus for domain → short-circuit reuse

**Flow 2: Pipeline Monitoring with Gates**

1. SSE stream renders 14-layer progress in real-time

2. At each gate: modal with preview data + threshold controls

3. User approves → pipeline resumes

4. On completion: proceed to query or SLM build

   - *Alternative:* Pause pipeline, adjust config, resume

**Flow 3: Query Orchestration**

1. Select corpus from dropdown

2. Build prompt (wiki pills + process path + free text)

3. Configure scoring weights (Balanced/Quality/Speed/Reliable)

4. Launch → orchestrator streams 10 steps via SSE

5. Results rendered in tabbed view (Build Plan / Answer / Q&A / Trace)

6. Provide feedback (thumbs up/down) → bandit updates

**Flow 4: SLM Build & Deploy**

1. Coverage checker determines BUILD_NEW / EXTEND / ROUTE_MIXED

2. SLMStudio wizard: select teacher, student, LoRA config

3. Build task runs (teacher QA synthesis → QLoRA training → validation)

4. Review metrics (val_loss, hallucination_rate)

5. Approve & Install → model deployed to Ollama

### 8.4 Design System & Visual Standards

* **Design System:** Custom Tailwind tokens in `tailwind.config.js`

* **Colors:** `bg (#ffffff)`, `bg2 (#f8f8fc)`, `accent (#6c5cf7)`, `teal`, `amber`, `coral`, `purple`

* **Typography:** Sora (headings, UI) + DM Sans (body text)

* **Border Radius:** `card: 14px`, `sm: 9px`

* **Component Classes:** `.btn`, `.card`, `.mcard`, `.pill-*`, `.prog-bar`, `.model-row` (defined in `globals.css`)

* **Animations:** `layerRowEnter`, `detailSlide`, `flowPulse`, `fadeIn`, `slideInRight`

* **Icons:** Lucide React

### 8.5 Accessibility Requirements

* **WCAG Compliance Level:** AA (target)

* **Keyboard Navigation:** Tab order follows visual layout; modals trap focus

* **Color Contrast:** Custom palette designed for readability; dark text on light backgrounds

* **Focus Management:** Visible focus indicators on interactive elements

---

## 9. Functional Requirements (FR)

### 9.1 Core Data Management

#### FR1.0 Data Ingestion & Import

* **FR1.1 Multi-format file upload:** The system shall accept PDF, DOCX, CSV, JSON, JSONL, Parquet, XLSX, TXT, and MD files via drag-drop or file picker.

  - *Acceptance Criteria:* All listed formats parse without error; extracted text stored in `corpus_store/{job_id}/`

  - *Priority:* P0

  - *User Story:* "As a domain analyst, I need to upload my mixed-format documents so that the system can build a unified knowledge base."

* **FR1.2 Database connection ingestion:** The system shall connect to PostgreSQL, MySQL, SQLite, and MongoDB; introspect schema; and extract rows as documents.

  - *Acceptance Criteria:* `POST /data/test-connection` validates credentials; schema metadata extracted; rows converted to text blocks

  - *Priority:* P0

* **FR1.3 URL scraping:** The system shall fetch and extract text from a provided URL via `POST /data/scrape`.

  - *Priority:* P1

* **FR1.4 Domain deduplication:** The system shall detect existing completed corpora for the same `domain_label` and offer reuse (short-circuit) unless `force_reingest` is set.

  - *Priority:* P0

* **FR1.5 Sample corpus loader:** The system shall provide a one-click sample corpus (nanoGPT/minGPT from GitHub) for onboarding.

  - *Priority:* P2

#### FR2.0 Processing Pipeline (14 Layers)

* **FR2.1 Extract:** Parse raw files into text blocks, table rows, and metadata using format-specific adapters.

* **FR2.2 Clean:** Normalize whitespace, remove boilerplate, standardize encoding.

* **FR2.3 Chunk:** Word-based chunking (default 400 words, 60 overlap) with validation.

* **FR2.4 Metadata enrichment:** Attach source, page, position, domain label to each chunk.

* **FR2.5 Entity extraction:** spaCy NER + LLM-assisted relationship extraction.

* **FR2.6 Semantic embedding:** Generate vector embeddings via `nomic-embed-text` (Ollama).

* **FR2.7 EDA:** Per-file statistical analysis, scorecards, quality metrics.

* **FR2.8 Validation:** Data integrity checks, schema consistency.

* **FR2.9 Ontology mapping:** Canonical node/edge schema generation.

* **FR2.10 Canonical graph build:** Entity resolution, deduplication (MinHash LSH), community detection.

* **FR2.11 Graph consistency:** Cross-source linking, confidence scoring.

* **FR2.12 Wiki generation:** Auto-generate explainability pages per entity/community.

* **FR2.13 FAISS indexing:** Build semantic search index for retrieval.

* **FR2.14 Finalization:** Status update, artifact persistence, completion event.

  - *Acceptance Criteria (all):* Each layer reports status via JSONB progress; layer artifacts accessible via `/pipeline/{job_id}/layer/{id}`

  - *Priority:* P0

#### FR3.0 Pipeline Control Plane

* **FR3.1 Approval gates:** The system shall pause at configurable gates (import, dedup, quality, graph, model) and await user approval via `POST /pipeline/{job_id}/approve/{step}`.

* **FR3.2 Pipeline pause/resume:** Users can pause (`POST /pipeline/{job_id}/pause`) and resume the pipeline at any point.

* **FR3.3 Configuration override:** Users can modify pipeline parameters (thresholds, chunk size) via `PATCH /pipeline/{job_id}/config` stored in Redis.

* **FR3.4 Real-time progress:** SSE stream at `GET /data/progress/{job_id}` emits per-layer status updates with percentage completion.

  - *Priority:* P0

### 9.2 Knowledge Graph & Wiki

#### FR4.0 Knowledge Graph

* **FR4.1 Entity resolution:** Merge duplicate entities using embedding similarity (threshold: 0.72) with human review queue.

* **FR4.2 Cross-source linking:** Identify and propose connections between entities from different source files.

* **FR4.3 Confidence scoring:** Score entities and relationships based on frequency, source diversity, and semantic coherence.

* **FR4.4 Graph repair:** Allow users to suppress relations, split wrongly merged entities, and reprocess files.

  - *Priority:* P0

#### FR5.0 Wiki System

* **FR5.1 Auto-generated wiki pages:** The system shall generate markdown wiki pages for each entity/community with citations.

* **FR5.2 Entity merge review:** Present proposed merges for user approval/rejection.

* **FR5.3 Cross-source link review:** Present proposed cross-file links for user validation.

* **FR5.4 Wiki browsing:** Searchable, browsable wiki with entity-linked content.

  - *Priority:* P1

### 9.3 Query Orchestration

#### FR6.0 Orchestrator Engine (10 Steps)

* **FR6.1 Semantic cache:** Check for semantically similar prior queries (similarity threshold: 0.92) before executing.

* **FR6.2 Task classification:** Classify intent as DOMAIN, CAPABILITY, or HYBRID.

* **FR6.3 Coverage check:** Determine if existing SLM covers the query (ROUTE_MIXED / EXTEND / BUILD_NEW).

* **FR6.4 Query decomposition:** LLM-driven decomposition into typed sub-tasks (domain_qa, code_generation, data_analysis, time_series, general_reasoning, ui_building, financial, geospatial).

* **FR6.5 Model capability matching:** Select specialist models per sub-task using benchmark scores + bandit arms.

* **FR6.6 Sub-task execution:** Execute sub-tasks in parallel across local (Ollama) and cloud (OpenAI/Anthropic/Groq) models.

* **FR6.7 Answer synthesis:** Merge sub-task results with graph citations into a coherent final answer.

* **FR6.8 Hallucination detection:** Cross-reference synthesized answer against canonical knowledge graph.

* **FR6.9 Bandit update:** Update LinUCB arm weights based on execution metrics.

* **FR6.10 SSE streaming:** Stream all 10 steps as real-time events to the frontend.

  - *Priority:* P0

#### FR7.0 Model Routing

* **FR7.1 LinUCB bandit:** Multi-armed bandit selects models per task type; arms updated on user feedback (thumbs up = reward 1, thumbs down = reward 0).

* **FR7.2 Model capability catalog:** Static benchmark-based scoring per model per task type, combined with bandit dynamic scores.

* **FR7.3 Scoring weights:** User-configurable weights (quality, speed, reliability) influence model selection.

* **FR7.4 Nash equilibrium insights:** Compute game-theoretic equilibrium allocation across models per task type.

  - *Priority:* P0

### 9.4 SLM Factory

#### FR8.0 SLM Build & Deploy

* **FR8.1 Coverage checker:** Determine if domain is covered by existing SLM, needs extension, or requires new build.

* **FR8.2 Teacher synthesis:** Generate QA pairs using a teacher model (cloud or large local model) from corpus context.

* **FR8.3 QLoRA fine-tuning:** Train a domain SLM with configurable LoRA parameters (rank, alpha, dropout, target modules).

* **FR8.4 Validation:** Evaluate val_loss, hallucination_rate, task_completion_rate post-training.

* **FR8.5 Ollama deployment:** Create Modelfile and register the SLM in Ollama for inference.

* **FR8.6 Approve & install gate:** Require user approval before deploying SLM to production.

* **FR8.7 SLM registry:** Store all built SLMs in PostgreSQL with domain embeddings for similarity-based lookup.

* **FR8.8 Graceful fallback:** If QLoRA unavailable (no GPU/torch), fall back to best Ollama model as domain SLM.

  - *Priority:* P0

### 9.5 User Interaction

#### FR9.0 Prompt Builder

* **FR9.1 Wiki topic pills:** Display clickable topic pills derived from corpus wiki for prompt enrichment.

* **FR9.2 Process paths:** Offer 5 pre-built paths (Builder, Researcher, Analyst, Auditor, Summarizer) with multi-step prompt structures.

* **FR9.3 Custom templates:** User-created templates with variable interpolation (`{query}`, `{topic}`, `{domain}`, `{prevOutput}`).

* **FR9.4 SLM suggestions:** AI-generated domain-specific query suggestions grounded in corpus context.

  - *Priority:* P1

#### FR10.0 Results & Feedback

* **FR10.1 Build Plan tab:** Structured HLD → LLD → implementation blueprint for Builder path queries.

* **FR10.2 Answer tab:** Full markdown-rendered synthesized answer with entity citations.

* **FR10.3 Q&A Chat tab:** Follow-up questions in corpus context.

* **FR10.4 Decision Trace tab:** Step-by-step orchestrator reasoning with model selection, confidence, latency.

* **FR10.5 User feedback:** Per-sub-task thumbs up/down feeding into bandit reward signal.

  - *Priority:* P0

#### FR11.0 Dashboard & Analytics

* **FR11.1 SLM stats:** Registry size, total queries, avg hallucination rate.

* **FR11.2 Bandit learning curves:** Arm weights over time per task type.

* **FR11.3 Nash equilibrium view:** Optimal model allocation visualization.

* **FR11.4 Session history:** Last 20 sessions with timestamps and domains (localStorage).

  - *Priority:* P1

---

## 10. Non-Functional Requirements (NFR)

### 10.1 Performance

#### NFR1.0 Response Time

* **NFR1.1 Page load:** All pages shall render within 2 seconds on broadband connection.

* **NFR1.2 API response (simple):** Metadata endpoints (`/models`, `/corpora`, `/status`) shall respond within 500ms.

* **NFR1.3 SSE first event:** Pipeline and orchestrator SSE streams shall emit first event within 2 seconds of request.

* **NFR1.4 Pipeline throughput:** 50-file corpus shall complete all 14 layers within 5 minutes.

#### NFR2.0 Scalability

* **NFR2.1 Concurrent users:** Single-instance target: 1 concurrent pipeline + 3 concurrent queries.

* **NFR2.2 Data volume:** Handle corpora up to 1,000 files / 500MB without pipeline failure.

* **NFR2.3 Database pool:** PostgreSQL pool sized at 20 connections + 40 overflow (configured in `database.py`).

* **NFR2.4 Celery concurrency:** Worker configured for 2 concurrent tasks.

### 10.2 Availability & Reliability

#### NFR3.0 Fault Tolerance

* **NFR3.1 Pipeline error handling:** Individual layer failures shall be caught, logged, and reported without crashing the entire pipeline.

* **NFR3.2 Model unavailability:** If a routed model is offline, the orchestrator shall fall back to the next-best available model.

* **NFR3.3 SSE resilience:** Frontend shall reconnect on SSE stream drops and resume from last known state.

* **NFR3.4 Database resilience:** `pool_pre_ping=True` ensures stale connections are detected and recycled.

#### NFR4.0 Data Persistence

* **NFR4.1 Pipeline progress:** JSONB progress persisted to PostgreSQL at each layer transition (survives backend restart).

* **NFR4.2 Corpus artifacts:** All intermediate artifacts persisted to `corpus_store/{job_id}/` filesystem.

* **NFR4.3 Docker volumes:** `postgres_data`, `redis_data`, `slm_store`, `corpus_store` survive container restarts.

### 10.3 Security

#### NFR5.0 Authentication

* **NFR5.1 Cookie-based auth:** Middleware checks `orch_logged_in=true` cookie on all routes except `/login`.

* **NFR5.2 Credential storage:** Login credentials stored as environment variables (`NEXT_PUBLIC_AUTH_USER`, `NEXT_PUBLIC_AUTH_PASS`).

* **NFR5.3 Session management:** No token expiry currently; cookie persists until manually cleared.

#### NFR6.0 Data Protection

* **NFR6.1 Local-first:** All data (corpus, SLMs, graphs) stored locally; no external transmission unless cloud APIs explicitly configured.

* **NFR6.2 API key handling:** Cloud provider keys stored in `.env`; never exposed to frontend.

* **NFR6.3 CORS:** FastAPI CORS middleware configured for cross-origin requests from frontend.

### 10.4 Maintainability & Operability

#### NFR7.0 Observability

* **NFR7.1 Health check:** `GET /health` endpoint for liveness probing.

* **NFR7.2 Structured logging:** Python `logging` module used throughout backend.

* **NFR7.3 Docker healthchecks:** PostgreSQL (`pg_isready`) and Redis (`redis-cli ping`) have container-level healthchecks.

* **NFR7.4 Pipeline logs:** Per-job log artifacts persisted to `corpus_store/{job_id}/logs/`.

#### NFR8.0 Deployment

* **NFR8.1 Docker Compose:** Single `docker compose up -d` deploys all 5 services.

* **NFR8.2 Standalone frontend:** `output: "standalone"` in Next.js config produces minimal production image.

* **NFR8.3 Environment configuration:** All settings configurable via `.env` file with sensible defaults.

* **NFR8.4 Hot reload:** Dev mode supports hot-reload for both backend (`--reload`) and frontend (`next dev`).

### 10.5 Compatibility

#### NFR9.0 Platform Compatibility

* **NFR9.1 Browser support:** Chrome 90+, Firefox 90+, Edge 90+ (desktop).

* **NFR9.2 Docker runtime:** Compatible with Docker Engine 20+ and Docker Compose v2.

* **NFR9.3 OS support:** Backend runs on Linux (production), macOS/Windows (development).

* **NFR9.4 Python version:** Requires Python 3.12 exactly (type hint syntax dependency).

---

## 11. Technical Architecture

### 11.1 System Architecture Overview

```

┌─────────────────────────────────────────────────────────────┐

│                    Next.js 15 Frontend (:3000)               │

│  Tailwind CSS · React 19 · Recharts · Lucide · SSE Client   │

└──────────────────────────┬──────────────────────────────────┘

                           │ REST / SSE (via rewrite proxy)

┌──────────────────────────▼──────────────────────────────────┐

│                    FastAPI Backend (:8000)                    │

│  13 API Routers · Pydantic Settings · Async SQLAlchemy       │

│                                                              │

│  ┌────────────────┐  ┌─────────────────────────────────┐    │

│  │ Data Routes    │  │ Orchestrator Engine              │    │

│  │ · ingest       │  │ · Task Classifier               │    │

│  │ · pipeline     │  │ · Coverage Checker              │    │

│  │ · wiki/quality │  │ · Model Capability Catalog      │    │

│  └───────┬────────┘  │ · LinUCB Bandit                 │    │

│          │           │ · Token Compressor (LLMLingua)   │    │

│          │           │ · Hallucination Detector         │    │

│          │           └──────────────┬──────────────────┘    │

└──────────┼──────────────────────────┼───────────────────────┘

           │                          │

    ┌──────▼──────┐           ┌───────▼───────┐

    │   Celery    │           │    Ollama     │

    │   Worker    │           │   (:11434)    │

    │ · ingest    │           │ mistral       │

    │ · slm_build │           │ nomic-embed   │

    └──────┬──────┘           │ domain SLMs   │

           │                  └───────────────┘

    ┌──────▼──────┐                   │

    │ PostgreSQL  │           ┌───────▼───────┐

    │ + pgvector  │           │ Cloud LLMs    │

    │ (:5432)     │           │ (optional)    │

    └──────┬──────┘           │ OpenAI/Claude │

           │                  │ Groq/Gemini   │

    ┌──────▼──────┐           └───────────────┘

    │    Redis    │

    │   (:6379)   │

    │ Broker +    │

    │ Gate State  │

    └─────────────┘

```

**Architecture Pattern:** Modular monolith backend with async task offloading (Celery) and event-driven frontend (SSE).

**Key Components:**

* **FastAPI Backend:** 13 routers handling REST + SSE, async SQLAlchemy for DB, direct Ollama/cloud LLM calls for orchestration.

* **Celery Worker:** Long-running data pipeline (14 layers) and SLM training jobs, communicating progress via PostgreSQL JSONB updates.

* **Redis:** Celery broker, pipeline gate state (`gate:{job_id}:{step}`), pause flags, config overrides, semantic cache.

* **PostgreSQL + pgvector:** Persistent storage for jobs, sessions, query history, bandit scores, SLM registry with vector similarity search.

* **Ollama:** Local inference engine for embeddings, orchestrator queries, and deployed domain SLMs.

### 11.2 Technology Stack

#### Frontend

* **Framework:** Next.js 15 (App Router, `"use client"` pages)

* **UI Library:** React 19 with functional components + hooks

* **Styling:** Tailwind CSS 3.4 with custom design tokens

* **Charts:** Recharts 2.12

* **Icons:** Lucide React

* **Markdown:** react-markdown 10.1

* **Build:** Standalone output for Docker deployment

#### Backend

* **Language/Runtime:** Python 3.12

* **Framework:** FastAPI 0.115 with async/await

* **Task Queue:** Celery 5.4 + Redis (Kombu 5.3)

* **ORM:** SQLAlchemy 2.0 (async mode) — raw SQL queries, no ORM models

* **Validation:** Pydantic v2 (via pydantic-settings)

#### ML/NLP Stack

* **Training:** PyTorch 2.4, Transformers 4.45, PEFT 0.13 (QLoRA), TRL 0.11

* **NLP:** spaCy (en_core_web_sm), NLTK

* **Vectors:** FAISS-cpu, pgvector 0.3

* **Embeddings:** nomic-embed-text via Ollama

* **Graphs:** NetworkX, community detection

#### Data Storage

* **Primary Database:** PostgreSQL 16 + pgvector (vector similarity, JSONB for progress)

* **Cache/Broker:** Redis 7 (Celery broker + pipeline state + semantic cache)

* **File Storage:** Local filesystem (`corpus_store/`, `slm_store/`)

* **Search Index:** FAISS (per-corpus in-memory + persisted)

#### LLM Providers

* **Local:** Ollama (mistral, qwen2.5, llama3, nomic-embed-text, domain SLMs)

* **Cloud (optional):** OpenAI (gpt-4o), Anthropic (claude-opus-4-5), Groq (llama-3.1-70b), Google (gemini-2.0-flash)

### 11.3 Data Model & Schema

**Core Entities:**

* **`ingest_jobs`** — Tracks pipeline execution state

  - Key fields: `job_id` (PK), `status`, `progress` (JSONB), `domain_label`, `file_count`, `entity_count`, `community_count`

  - Relationships: References `sessions.session_id`

* **`slm_registry`** — Catalog of trained domain SLMs

  - Key fields: `model_id` (PK), `domain_label`, `domain_embedding` (VECTOR(768)), `coverage_topics`, `base_model`, `val_loss`, `hallucination_rate`, `model_path`

  - Relationships: Self-referencing `parent_model_id` for model lineage

* **`sessions`** — User workspace sessions

  - Key fields: `session_id` (PK), `domain_tags`, `user_goal`, `corpus_path`, `assigned_slm`

* **`query_history`** — Audit log of all orchestrator queries

  - Key fields: `query`, `task_category`, `routing_plan` (JSONB), `slm_used`, `hallucination_rate`, `latency_ms`, `token_count_in/out`

* **`bandit_scores`** — LinUCB arm weights per task×model

  - Key fields: `task_type`, `model_id`, `score`, `query_count`

  - Constraint: UNIQUE(task_type, model_id)

**Data Flow:**

Upload → `corpus_store/{job_id}/` filesystem → 14-layer pipeline (Celery) → `ingest_jobs.progress` JSONB updates → canonical graph JSON → FAISS index → wiki pages → query via orchestrator → `query_history` log → `bandit_scores` update via feedback.

### 11.4 API Specifications

#### Key Endpoints

| Endpoint | Method | Purpose | Auth | Streaming |

|----------|--------|---------|------|-----------|

| `/api/v1/data/ingest` | POST | Upload corpus, start pipeline | Yes | No |

| `/api/v1/data/progress/{job_id}` | GET | Pipeline progress events | Yes | SSE |

| `/api/v1/data/test-connection` | POST | Validate DB credentials | Yes | No |

| `/api/v1/pipeline/{job_id}/snapshot` | GET | Processing page read model | Yes | No |

| `/api/v1/pipeline/{job_id}/layer/{id}` | GET | Per-layer artifact detail | Yes | No |

| `/api/v1/pipeline/{job_id}/approve/{step}` | POST | Approve gate | Yes | No |

| `/api/v1/pipeline/{job_id}/config` | PATCH | Override pipeline config | Yes | No |

| `/api/v1/orchestrator/ask` | POST | Execute query orchestration | Yes | SSE |

| `/api/v1/slm/build` | POST | Start SLM training | Yes | No |

| `/api/v1/slm/approve-install` | POST | Deploy SLM to Ollama | Yes | No |

| `/api/v1/slm/registry` | GET | List all trained SLMs | Yes | No |

| `/api/v1/models` | GET | List available models | Yes | No |

| `/api/v1/feedback` | POST | Submit bandit feedback | Yes | No |

| `/api/v1/wiki/{job_id}/reviews` | GET | Entity merge review queue | Yes | No |

| `/api/v1/quality/{job_id}/metrics` | GET | Quality dashboard data | Yes | No |

| `/health` | GET | Liveness probe | No | No |

---

## 12. Dependencies, Assumptions & Constraints

### 12.1 Dependencies

| Dependency | Type | Owner | Required By | Risk Level | Mitigation |

|------------|------|-------|-------------|------------|------------|

| Ollama | External | Ollama OSS | Runtime | High | System non-functional without local inference engine |

| PostgreSQL + pgvector | External | Self-hosted | Data layer | High | Docker image bundles pgvector; `init.sql` creates schema |

| Redis | External | Self-hosted | Task queue + state | High | Pipeline cannot start without broker |

| spaCy en_core_web_sm | External | spaCy | NER layer | Medium | Downloaded at Docker build time |

| CUDA GPU (optional) | Hardware | Deployment | QLoRA training | Low | Graceful fallback to Ollama model |

| Cloud API keys (optional) | External | OpenAI/Anthropic/Groq | Enhanced routing | Low | System fully functional with Ollama only |

### 12.2 Assumptions

* **Ollama availability:** Ollama is running and accessible at configured URL before backend starts.

  - *Impact if false:* Embedding generation fails; all LLM calls fail.

  - *Validation:* Backend auto-pulls `nomic-embed-text` at startup (logged warning if Ollama unreachable).

* **Single-user deployment:** Only one user operates the system at a time.

  - *Impact if false:* sessionStorage conflicts; no data isolation between concurrent users.

* **Filesystem persistence:** `corpus_store/` and `slm_store/` directories are writable and persistent across restarts.

  - *Impact if false:* Pipeline artifacts lost; SLM models unavailable.

### 12.3 Constraints

**Technical Constraints:**

* Python 3.12 required (type syntax: `list[str]`, `dict | None`)

* No ORM models — schema managed via raw SQL (`init.sql`); no Alembic migrations

* Celery tasks use synchronous `psycopg2` for progress writes (async event loop incompatibility)

* Frontend uses `"use client"` on all pages (no SSR for data-fetching pages)

**Resource Constraints:**

* Minimum 8GB RAM for backend + Celery + Ollama (16GB recommended)

* QLoRA training requires NVIDIA GPU with 8GB+ VRAM (optional)

* Docker Compose deployment assumes single-node architecture

**Known Technical Debt:**

* `docker-compose.yml` Celery command references `app.worker` but module is `app.tasks`

* No database migration tool (schema changes require manual SQL)

* Duplicate SSE bootstrap logic in `processing/page.tsx`

* Large monolithic route files (`data.py` ~871 lines, `ingest_task.py` ~843 lines)

* Auth is client-side only (credentials in environment variables, exposed via `NEXT_PUBLIC_*`)

---

## 13. Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation Strategy | Owner | Status |

|------|------------|--------|---------------------|-------|--------|

| Ollama model unavailable at query time | Medium | High | Adapter registry returns graceful error; frontend shows fallback message | Backend | Open |

| Pipeline hangs on large corpus (>500 files) | Medium | Medium | Per-layer timeouts; pause/resume capability; chunked processing | Backend | Open |

| QLoRA OOM on small GPU | Medium | Low | Graceful fallback to best Ollama model; config for batch size reduction | ML | Mitigated |

| Single-user auth credentials leaked | Low | High | Move to proper JWT auth in Phase 2; document security limitations | Security | Open |

| PostgreSQL connection exhaustion under load | Low | High | Pool configured (20+40 overflow); `pool_pre_ping` detects stale connections | Backend | Mitigated |

| FAISS index corruption on concurrent writes | Low | Medium | Single Celery worker (concurrency=2) serializes writes per job | Backend | Mitigated |

| Docker Compose Celery entrypoint mismatch | High | Medium | Fix command from `app.worker` to `app.tasks` in compose file | DevOps | Open |

---

## 14. Testing & Quality Assurance

### 14.1 Testing Strategy

#### Unit Testing

* **Coverage Target:** Critical modules (read_model, orchestrator, bandit)

* **Framework:** pytest

* **Current:** `tests/test_pipeline_read_model.py` covers snapshot builder artifact fallbacks

#### Integration Testing

* **Scope:** API endpoints with database, Celery task execution, SSE streaming

* **Tools:** pytest + httpx (async client), FastAPI TestClient

#### End-to-End Testing

* **Coverage:** Full flow from upload through pipeline to query results

* **Current status:** No automated E2E tests; manual testing via sample corpus

#### Performance Testing

* **Target:** Pipeline completion <5 min for 50-file corpus; orchestrator <30s per query

* **Current status:** Not automated; informal benchmarks documented in README (~2–4 min)

### 14.2 Acceptance Criteria (Definition of Done)

- [ ] Pipeline executes all 14 layers on sample CPG corpus without error

- [ ] SSE events stream correctly to frontend for both pipeline and orchestrator

- [ ] Approval gates pause and resume pipeline on user action

- [ ] SLM build completes and model is accessible via Ollama

- [ ] Orchestrator returns grounded answer with entity citations

- [ ] Hallucination detector produces meaningful scores

- [ ] Bandit arms update on feedback submission

- [ ] Docker Compose deployment starts all 5 services successfully

---

## 15. Rollout & Go-to-Market

### 15.1 Launch Strategy

| Phase | Timeline | Audience | Features | Success Criteria |

|-------|----------|----------|----------|------------------|

| Internal Alpha | Current | Engineering team | Full pipeline + orchestrator | End-to-end flow works on CPG data |

| Limited Beta | +1 month | 3–5 domain teams | All current features | >90% pipeline success rate; <10% hallucination |

| GA | +3 months | All internal teams | + Multi-user auth + migrations | Self-service onboarding without engineering support |

### 15.2 Support Readiness

* **Documentation:** README with quick start, API reference, architecture diagram

* **User flow docs:** 26 documented user flows (F1–F26) in `docs/user-flow.md`

* **Technical docs:** Pipeline data flow breakdown in `docs/processing-pipeline-data-flow.md`

* **Onboarding:** Built-in `OnboardingWizard` component for first-time users

---

## 16. Success Measurement & Iteration

### 16.1 Instrumentation & Analytics

**Events Tracked (Backend):**

* `query_history` table: query, task_type, routing_plan, latency, hallucination_rate, tokens — Why: measure quality and performance trends

* `bandit_scores` table: per-task-type model selection convergence — Why: validate self-improvement loop

* `ingest_jobs` table: pipeline duration, error rates — Why: reliability monitoring

**Events Tracked (Frontend):**

* Session history in localStorage (last 20) — Why: usage patterns

* Achievement toasts on milestones — Why: user engagement signals

### 16.2 Continuous Improvement Process

* **Feedback Loops:** Bandit rewards (per-query), entity review decisions (per-corpus), pipeline success/failure rates

* **Iteration Cadence:** Weekly pipeline improvements (current TASKS.md pattern)

* **Self-improvement:** LinUCB bandit automatically improves model routing with each feedback signal; no manual retraining required

---

## 17. Innovation & Novel Approaches

### Pattern 1: Bandit-Learned Model Routing (LinUCB)

**Description:** Instead of static model selection, a contextual multi-armed bandit learns the optimal model per task type from user feedback, achieving Nash equilibrium allocation over time.

**Rationale:** Different models excel at different task types (code vs. reasoning vs. domain QA). Static routing cannot adapt to new models or changing quality. LinUCB explores new models while exploiting known-good ones.

**Trade-offs:** Requires sufficient feedback volume to converge (cold-start problem); initial queries may route to suboptimal models.

### Pattern 2: Coverage-Aware SLM Factory

**Description:** Before answering a query, the system checks if the existing domain SLM covers the required knowledge. Three outcomes: ROUTE_MIXED (use existing), EXTEND_EXISTING (add training data), BUILD_NEW (train from scratch).

**Rationale:** Avoids unnecessary retraining; enables incremental domain model growth; ensures queries only reach models with proven coverage.

### Pattern 3: Graph-Grounded Hallucination Detection

**Description:** After answer synthesis, the hallucination detector cross-references cited facts against the canonical knowledge graph. Entities and relationships not present in the graph are flagged.

**Rationale:** Provides quantitative hallucination scores (not just vibes); enables user trust through transparency; feeds back into quality improvement.

### Pattern 4: 14-Layer Pipeline with Human-in-the-Loop Gates

**Description:** The processing pipeline is decomposed into 14 auditable layers with configurable approval gates at critical decision points. Users can pause, inspect artifacts, adjust thresholds, and resume.

**Rationale:** Balances automation with control; prevents silent data quality degradation; builds user trust through progressive disclosure of pipeline internals.

---

## 18. Appendices

### Appendix A: Glossary

| Term | Definition |

|------|------------|

| SLM | Small Language Model — a domain-specific fine-tuned model (typically 1–8B params) |

| QLoRA | Quantized Low-Rank Adaptation — efficient fine-tuning technique |

| LinUCB | Linear Upper Confidence Bound — contextual bandit algorithm for exploration/exploitation |

| Knowledge Graph | NetworkX-based entity-relationship graph built from corpus via NER + community detection |

| Canonical Graph | The deduplicated, entity-resolved, confidence-scored version of the raw knowledge graph |

| Corpus | Collection of uploaded domain documents stored in `corpus_store/{job_id}/` |

| Gate | A pipeline checkpoint requiring user approval before proceeding |

| SSE | Server-Sent Events — HTTP streaming protocol for real-time progress updates |

| pgvector | PostgreSQL extension enabling vector similarity search for embeddings |

| FAISS | Facebook AI Similarity Search — in-memory vector index for semantic retrieval |

| Bandit Arm | A model option within the LinUCB multi-armed bandit; each task type has its own set of arms |

| Nash Equilibrium | Game-theoretic optimal allocation of queries across models (computed per task type) |

| Process Path | Pre-defined prompt structure (Builder/Researcher/Analyst/Auditor/Summarizer) |

| Domain Label | User-assigned identifier for a knowledge domain (e.g., "cpg_supply_chain") |

### Appendix B: Key File Reference

| File | Purpose |

|------|---------|

| `backend/app/main.py` | FastAPI entry point, 13 router registrations |

| `backend/app/tasks/ingest_task.py` | 14-layer Celery pipeline + 7-stage DB pipeline |

| `backend/app/modules/orchestrator/orchestrator.py` | 10-step query engine |

| `backend/app/modules/slm_factory/slm_builder.py` | QLoRA training orchestration |

| `backend/app/modules/slm_factory/bandit.py` | LinUCB implementation |

| `backend/app/routes/pipeline.py` | Pipeline control plane (gates, pause, config) |

| `backend/app/routes/data.py` | Ingest API + SSE progress streaming |

| `backend/db/init.sql` | PostgreSQL schema (5 tables + pgvector) |

| `frontend/app/processing/page.tsx` | Pipeline monitoring + orchestrator UI (1,165 lines) |

| `frontend/app/components/LayerDetailPanel.tsx` | Per-layer artifact drill-down |

| `frontend/app/components/PromptBuilder.tsx` | Guided prompt composition |

| `frontend/app/components/SLMStudio.tsx` | SLM training configuration wizard |

| `docs/user-flow.md` | 26 documented user flows (F1–F26) |

| `docs/processing-pipeline-data-flow.md` | Technical pipeline data flow |

| `docker-compose.yml` | Full stack deployment (5 services) |

### Appendix C: Open Questions & Decisions Needed

| Question | Options | Decision Maker | Due Date | Status |

|----------|---------|----------------|----------|--------|

| Multi-user auth approach | JWT + RBAC / OAuth2 / SSO integration | Engineering Lead | Phase 2 | Open |

| Database migration strategy | Alembic / raw SQL versioning / Prisma-style | Engineering Lead | Phase 2 | Open |

| Fix Docker Compose Celery entrypoint | Change to `app.tasks` / Create `app/worker.py` shim | DevOps | Immediate | Open |

| SLM registry cleanup policy | TTL-based / manual / LRU eviction | ML Engineering | Phase 2 | Open |

| Frontend state management | Keep sessionStorage / Migrate to Zustand / Context API | Frontend Lead | Phase 2 | Open |

| Port standardization | 3000 everywhere / 3001 for dev | Engineering | Immediate | Open |

---

**End of PRD**