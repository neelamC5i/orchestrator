# AI Orchestrator — Domain SLM Factory

A self-improving AI orchestrator that ingests your domain corpus, builds a knowledge graph, distills a domain-specific Small Language Model (SLM) via QLoRA, and generates grounded answers with per-task model recommendations.

---

## Architecture

```
User Query
    │
    ▼
┌─────────────────────────────────────────────────────┐
│                   Next.js Frontend (port 3000)       │
│  Step 1: Upload corpus  →  Step 2: Processing       │
│  Step 3: Recommendations (4 tabs)                   │
└──────────────────────┬──────────────────────────────┘
                       │ REST / SSE
┌──────────────────────▼──────────────────────────────┐
│                FastAPI Backend (port 8000)           │
│                                                     │
│  ┌──────────────┐   ┌────────────────────────────┐  │
│  │ Ingest API   │   │ Orchestrator API           │  │
│  │ (Celery task)│   │  1. Task Classification    │  │
│  │              │   │  2. Coverage Check         │  │
│  │ • Parse docs │   │  3. SLM Build (if needed)  │  │
│  │ • Dedup      │   │  4. Query Decomposition    │  │
│  │ • Quality    │   │  5. Model Recommendations  │  │
│  │ • Knowledge  │   │  6. Sub-task Execution     │  │
│  │   Graph      │   │  7. Answer Synthesis       │  │
│  └──────┬───────┘   └────────────┬───────────────┘  │
└─────────┼────────────────────────┼──────────────────┘
          │                        │
   ┌──────▼──────┐        ┌────────▼────────┐
   │ PostgreSQL  │        │  Ollama          │
   │ + pgvector  │        │  (mistral, etc.) │
   └─────────────┘        └─────────────────┘
          │
   ┌──────▼──────┐
   │    Redis    │
   │ (Celery     │
   │  broker)    │
   └─────────────┘
```

### Key Modules

| Module | Path | Purpose |
|--------|------|---------|
| Ingest Pipeline | `backend/app/modules/data_curation/` | Parse → deduplicate → quality filter → graphify |
| Knowledge Graph | `backend/app/modules/data_curation/graphify_engine/` | Entity extraction, community detection (NetworkX) |
| SLM Factory | `backend/app/modules/slm_factory/` | Distillation, QLoRA fine-tuning, Ollama deploy |
| Orchestrator | `backend/app/modules/orchestrator/` | 10-step SSE pipeline, multi-model routing |
| Task Classifier | `backend/app/modules/task_classifier.py` | Intent detection (DOMAIN / CAPABILITY / HYBRID) |
| Model Catalog | `backend/app/modules/model_capability_catalog.py` | Benchmark-based model selection with bandit scores |
| Hallucination Detector | `backend/app/modules/evaluation/` | Graph-grounded fact checking |

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | 3.12 | Backend + Celery worker |
| Node.js | 18+ | Next.js frontend |
| PostgreSQL | 16 | With pgvector extension |
| Redis | 7+ | Celery broker |
| Ollama | latest | Local inference engine |

---

## Quick Start — Local (Manual)

### 1. Clone & set up environment

```bash
git clone <repo-url>
cd orchestrator
cp .env.example .env
# Edit .env — minimum required: DATABASE_URL, REDIS_URL, OLLAMA_BASE_URL
```

### 2. Start PostgreSQL (with pgvector)

```bash
# Option A — Docker (recommended)
docker run -d \
  --name orchestrator_postgres \
  -e POSTGRES_USER=orchestrator \
  -e POSTGRES_PASSWORD=orchestrator_secret \
  -e POSTGRES_DB=orchestrator \
  -p 5432:5432 \
  pgvector/pgvector:pg16

# Option B — existing Postgres
# Run: backend/db/init.sql to create schema and enable pgvector
psql -U orchestrator -d orchestrator -f backend/db/init.sql
```

### 3. Start Redis

```bash
# Docker
docker run -d --name orchestrator_redis -p 6379:6379 redis:7-alpine

# Or if installed locally
redis-server
```

### 4. Start Ollama and pull required models

```bash
# Start Ollama (runs on port 11434)
ollama serve &

# Pull required models
ollama pull mistral:latest          # main inference model
ollama pull nomic-embed-text        # embeddings

# Optional — better quality at higher VRAM cost
ollama pull qwen2.5:7b
ollama pull llama3:8b
```

### 5. Set up backend

```bash
cd backend

# Create virtual environment
python3.12 -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Copy env
cp ../.env .env
```

### 6. Start backend (FastAPI)

```bash
# From backend/ with venv activated
PYTHONPATH=$(pwd) uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

The API will be available at `http://localhost:8000`.  
Swagger docs: `http://localhost:8000/docs`

### 7. Start Celery worker

Open a new terminal:

```bash
cd backend
source .venv/bin/activate
PYTHONPATH=$(pwd) celery -A app.tasks worker --loglevel=info --concurrency=2
```

### 8. Start frontend

Open a new terminal:

```bash
cd frontend
npm install
npm run dev -- --port 3000
```

Frontend available at `http://localhost:3000`.

---

## Quick Start — Docker Compose

```bash
# Copy and configure env
cp .env.example .env

# Start all services (Postgres, Redis, backend, Celery worker, frontend)
docker compose up -d

# Ollama must run on the host — Docker backend connects via host.docker.internal:11434
ollama serve &
ollama pull mistral:latest
ollama pull nomic-embed-text
```

---

## Using the App

### Step 1 — Home Page (`localhost:3000`)

1. Upload your domain corpus (`.jsonl`, `.txt`, `.pdf`, `.csv`)
   - For testing, use the included `synthetic_supply_chain.jsonl` (453 CPG documents)
2. Enter your query, for example:
   > Build a supply chain intelligence system for my CPG products, it should have an event trigger as well (like tariffs increase, global war disruption, routes closure etc) which can help in forecasting my supply chain demands
3. Click **Analyze**

### Step 2 — Processing Page (auto-navigates)

Displays the live pipeline:
- Parsing & normalizing files
- Deduplication (MinHash LSH)
- Quality scoring & filtering
- Building knowledge graph
- Domain SLM build (teacher synthesis → QLoRA or Ollama fallback → deploy)

Takes ~2–4 minutes on first run (graph build + SLM). Subsequent queries on the same domain are instant (registry cache hit).

### Step 3 — Recommendations Page (auto-navigates)

Four tabs:

| Tab | Content |
|-----|---------|
| 📋 Build Plan | 7-step blueprint with priority, effort, and model recommendation per step |
| 💡 Answer | Full domain answer from knowledge graph + sub-task breakdown |
| 💬 Q&A Chat | Follow-up questions answered in context of your corpus |
| 🔍 Decision Trace | Orchestrator steps, confidence scores, model selection reasoning |

---

## API Reference

### Ingest
```
POST /api/v1/data/ingest
  Form: files (multipart), domain_label (string)
  Returns: { job_id, status }

GET /api/v1/data/status/{job_id}
  Returns: { status, overall_pct, steps, entity_count, ... }

GET /api/v1/data/progress/{job_id}   ← SSE stream
  Streams: progress events until graph_done or failed
```

### Orchestrator
```
POST /api/v1/orchestrator/ask   ← SSE stream
  Body: { query, job_id?, session_id?, domain_label? }
  Streams: step events + final output event

  Final output includes:
    - intent, coverage_action, slm_model_id
    - sub_task_results (per-task model + response)
    - model_recommendations (ranked, with reasoning)
    - final_answer (synthesized)
    - hallucination_rate
```

### SLM Registry
```
GET  /api/v1/slm/registry          — list all registered SLMs
POST /api/v1/slm/approve-install   — deploy SLM to Ollama after review
  Body: { model_id }
```

### Models
```
GET /api/v1/models/list            — list all available models (Ollama + cloud)
```

---

## Configuration

Key settings in `.env` (or `backend/app/config.py`):

```env
# Required
DATABASE_URL=postgresql+asyncpg://orchestrator:orchestrator_secret@localhost:5432/orchestrator
REDIS_URL=redis://localhost:6379
OLLAMA_BASE_URL=http://localhost:11434

# Optional — cloud model providers (leave blank to use only local Ollama models)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk_...
HF_TOKEN=hf_...                   # HuggingFace token for model downloads

# Storage
SLM_STORE_PATH=./slm_store        # where trained SLM adapters are stored
CORPUS_STORE_PATH=./corpus_store  # where ingested corpora are stored
```

**Without any API keys**, the system runs fully locally using Ollama. All sub-tasks fall back to the best locally available Ollama model. Model recommendations still show cloud models as the ideal option with a note that they require API keys.

---

## Model Support

### Local (Ollama) — works out of the box
| Model | Best for |
|-------|---------|
| `mistral:latest` | General reasoning, domain Q&A |
| `nomic-embed-text` | Embeddings (required) |
| `qwen2.5:7b` | Code generation, data analysis |
| `llama3:8b` | General reasoning |

### Cloud (optional — add API keys)
| Model | Provider | Best for |
|-------|----------|---------|
| `gpt-4o`, `gpt-4o-mini` | OpenAI | General reasoning, code |
| `claude-opus-4-5` | Anthropic (via OpenAI-compat) | UI building, reasoning |
| `gemini-2.0-flash` | Google (via OpenAI-compat) | Data analysis |
| `llama-3.1-70b` | Groq | Fast inference |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 19, Tailwind CSS, Recharts |
| Backend | FastAPI (Python 3.12), async/await, SSE |
| Task Queue | Celery + Redis |
| Database | PostgreSQL 16 + pgvector |
| Local Inference | Ollama |
| Knowledge Graph | NetworkX, community detection |
| Embeddings | nomic-embed-text (via Ollama) |
| Fine-tuning | QLoRA via PEFT + transformers (optional — requires GPU + torch) |

---

## Notes

- **QLoRA fine-tuning** requires `torch` and `transformers` installed, plus a CUDA GPU. Without them, the system automatically falls back to the best available Ollama model as the domain SLM — all other features work identically.
- **pgvector** must be enabled in PostgreSQL. The `init.sql` script handles this automatically. The Docker image `pgvector/pgvector:pg16` includes it pre-installed.
- The **SLM registry** caches domain models by embedding similarity. Re-running the same domain query reuses the existing SLM (no rebuild).
