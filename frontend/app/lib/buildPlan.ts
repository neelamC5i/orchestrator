// Types and build-plan derivation extracted from recommendations/page.tsx

interface StepExplanation {
  what: string; why: string; what_we_found: string; decision_made: string;
  confidence: number; caveats: string[]; graph_entity_ids: string[];
}
interface OrchestratorStep {
  step_number: number; step_name: string; explanation: StepExplanation; duration_ms: number;
}
export interface ModelRec {
  model_name: string; provider: string; task_type: string; composite_score: number;
  benchmark_score: number; why_primary: string; why_not_alternatives: string[];
  is_primary: boolean; is_available_locally: boolean;
}
export interface SubTaskResult {
  task_type: string; query_fragment: string; assigned_model: string;
  response: string; confidence: number;
}
export interface OrchestratorOutput {
  session_id: string; query: string; intent: string; primary_task_type: string;
  coverage_action: string; slm_model_id: string | null; steps: OrchestratorStep[];
  model_recommendations: ModelRec[]; sub_task_results: SubTaskResult[];
  final_answer: string; hallucination_rate: number; total_tokens_used: number;
  tokens_saved_by_compression: number; build_in_progress: boolean; error?: string;
  cached_hit?: boolean;
}

export interface ArchLayer {
  name: string;
  components: string[];
  tech: string[];
  notes: string;
}

export interface LLDSpec {
  component: string;
  inputs: string;
  outputs: string;
  logic: string[];
  schema?: string;
  apiContract?: string;
}

export interface BuildStep {
  id: number;
  phase: string;
  title: string;
  // HLD
  hld: string;
  hldBullets: string[];
  // LLD
  lld: LLDSpec[];
  // Implementation
  implSteps: string[];
  kpis: string[];
  models: { name: string; provider: string; score: number; local: boolean; why: string; role: string }[];
  effort: string;
  priority: "critical" | "high" | "medium";
}

export function deriveBuildPlan(output: OrchestratorOutput): BuildStep[] {
  const recs = output.model_recommendations ?? [];
  const domain = (sessionStorage.getItem("domain_label") ?? "general").replace(/_/g, " ");
  const query = output.query ?? "";
  const subTasks = output.sub_task_results ?? [];
  const finalAnswer = output.final_answer ?? "";

  /* ── 1. Detect project type from the query ── */
  const q = query.toLowerCase();
  type PT = "CHATBOT"|"RECOMMENDER"|"ANALYTICS"|"SEARCH"|"CLASSIFIER"|"PIPELINE"|"CONTENT_GEN"|"GENERAL";
  const projectType: PT =
    /chatbot|chat.bot|bot|assistant|conversational|dialogue|support.bot|help.desk|customer.service/.test(q) ? "CHATBOT" :
    /recommend|suggestion|personali[sz]|collaborative|content.filter/.test(q) ? "RECOMMENDER" :
    /analytic|dashboard|report|metric|kpi|insight|visuali[sz]|\bBI\b/.test(q) ? "ANALYTICS" :
    /search|retriev|find|index|semantic.search|vector.search/.test(q) ? "SEARCH" :
    /classif|categori[sz]|label|tag|detect|sentiment|moderate/.test(q) ? "CLASSIFIER" :
    /pipeline|etl|ingest|process|transform|workflow|orchestrat/.test(q) ? "PIPELINE" :
    /generat|content|write|summar|translat|creat.*content/.test(q) ? "CONTENT_GEN" :
    "GENERAL";

  const projectLabel: Record<PT, string> = {
    CHATBOT: "Chatbot / Conversational AI",
    RECOMMENDER: "Recommendation Engine",
    ANALYTICS: "Analytics & BI Dashboard",
    SEARCH: "Semantic Search Engine",
    CLASSIFIER: "Content Classifier",
    PIPELINE: "Data / AI Pipeline",
    CONTENT_GEN: "Content Generation System",
    GENERAL: "AI-Powered Application",
  };

  /* ── 2. Model helpers ── */
  const modelsByType = (types: string[]): BuildStep["models"] => {
    const seen = new Set<string>();
    const results: BuildStep["models"] = [];
    for (const r of recs.filter(m => types.includes(m.task_type))) {
      if (!seen.has(r.model_name)) {
        seen.add(r.model_name);
        results.push({ name: r.model_name, provider: r.provider, score: r.composite_score, local: r.is_available_locally, why: r.why_primary || `Top scorer for ${r.task_type}`, role: r.is_primary ? "Primary" : "Fallback" });
      }
    }
    if (results.length === 0) {
      results.push({ name: "mistral:latest", provider: "ollama", score: 0.78, local: true, why: "Strong reasoning, structured JSON output", role: "Primary" });
      results.push({ name: "llama3.2:latest", provider: "ollama", score: 0.74, local: true, why: "Fast inference, good instruction following", role: "Fallback" });
    }
    return results.slice(0, 3);
  };

  const bestFor = (taskType: string): string => {
    const r = recs.find(m => m.task_type === taskType && m.is_primary) ?? recs.find(m => m.task_type === taskType);
    return r ? `${r.model_name} (score: ${(r.composite_score * 100).toFixed(0)}%)` : "mistral:latest (default)";
  };

  /* ── 3. Pull actual content from sub-task responses ── */
  const subContent = (keywords: string[]): string => {
    const kw = keywords.map(k => k.toLowerCase());
    const match = subTasks.find(t =>
      kw.some(k => t.query_fragment.toLowerCase().includes(k) || t.task_type.toLowerCase().includes(k))
    );
    if (match?.response) return match.response.slice(0, 600).replace(/\n+/g, " ").trim();
    // fall back to final answer excerpt
    return finalAnswer.slice(0, 300).replace(/\n+/g, " ").trim();
  };

  const allSubResponses = subTasks.map(t =>
    `[${t.task_type}] ${t.response.slice(0, 300).replace(/\n+/g, " ")}`.trim()
  );

  /* ── 4. Project-specific DB schema ── */
  type TableDef = { name: string; columns: string; sizing: string; indexes: string };
  const dbTables: Record<PT, TableDef[]> = {
    CHATBOT: [
      { name: "users", columns: "id UUID PK, username TEXT, email TEXT UNIQUE, created_at TIMESTAMPTZ, metadata JSONB", sizing: "~100K rows, 50 MB", indexes: "UNIQUE(email), INDEX(created_at)" },
      { name: "conversations", columns: "id UUID PK, user_id UUID FK→users, title TEXT, created_at TIMESTAMPTZ, last_message_at TIMESTAMPTZ, status ENUM('active','archived'), context JSONB", sizing: "~1M rows, 200 MB", indexes: "INDEX(user_id, last_message_at), INDEX(status)" },
      { name: "messages", columns: "id UUID PK, conversation_id UUID FK→conversations, role ENUM('user','assistant','system'), content TEXT, token_count INT, model_used TEXT, confidence FLOAT, created_at TIMESTAMPTZ", sizing: "~10M rows/year, 2 GB", indexes: "INDEX(conversation_id, created_at), INDEX(role)" },
      { name: `knowledge_base_${domain.replace(/\s+/g,"_")}`, columns: "id UUID PK, source_file TEXT, chunk_text TEXT, chunk_index INT, embedding VECTOR(768), metadata JSONB, created_at TIMESTAMPTZ", sizing: "~500K chunks, 4 GB (includes vectors)", indexes: "HNSW index on embedding for cosine search, INDEX(source_file)" },
      { name: "intents", columns: "id UUID PK, name TEXT, description TEXT, examples TEXT[], confidence_threshold FLOAT DEFAULT 0.7, domain TEXT", sizing: "~200 rows", indexes: "UNIQUE(name, domain)" },
      { name: "feedback", columns: "id UUID PK, message_id UUID FK→messages, rating INT CHECK(1-5), comment TEXT, created_at TIMESTAMPTZ", sizing: "~500K rows", indexes: "INDEX(message_id), INDEX(rating)" },
    ],
    RECOMMENDER: [
      { name: "users", columns: "id UUID PK, attributes JSONB, preferences JSONB, created_at TIMESTAMPTZ", sizing: "~1M rows, 500 MB", indexes: "INDEX(created_at)" },
      { name: "items", columns: "id UUID PK, title TEXT, description TEXT, category TEXT, attributes JSONB, embedding VECTOR(768), created_at TIMESTAMPTZ", sizing: "~500K rows, 2 GB", indexes: "HNSW on embedding, INDEX(category)" },
      { name: "interactions", columns: "id UUID PK, user_id UUID FK→users, item_id UUID FK→items, event_type ENUM('view','click','purchase','rate'), weight FLOAT, occurred_at TIMESTAMPTZ", sizing: "~50M rows/year, 10 GB", indexes: "INDEX(user_id, occurred_at), INDEX(item_id, event_type)" },
      { name: "recommendations", columns: "id UUID PK, user_id UUID FK→users, item_id UUID FK→items, score FLOAT, model_version TEXT, generated_at TIMESTAMPTZ, shown BOOL, clicked BOOL", sizing: "~5M rows/month", indexes: "INDEX(user_id, generated_at), INDEX(shown, clicked)" },
      { name: "user_embeddings", columns: "user_id UUID FK→users, embedding VECTOR(768), updated_at TIMESTAMPTZ", sizing: "~1M rows, 3 GB", indexes: "HNSW on embedding, INDEX(updated_at)" },
    ],
    ANALYTICS: [
      { name: "events", columns: "id UUID PK, user_id UUID, event_name TEXT, properties JSONB, session_id UUID, occurred_at TIMESTAMPTZ, ingested_at TIMESTAMPTZ", sizing: "~100M rows/year, 50 GB — partition by month", indexes: "INDEX(event_name, occurred_at), INDEX(user_id, occurred_at), PARTITION by occurred_at" },
      { name: "sessions", columns: "id UUID PK, user_id UUID, started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ, page_count INT, duration_sec INT, source TEXT, metadata JSONB", sizing: "~10M rows/year", indexes: "INDEX(user_id, started_at), INDEX(source)" },
      { name: "metrics", columns: "id UUID PK, name TEXT, value FLOAT, dimensions JSONB, granularity ENUM('minute','hour','day'), period_start TIMESTAMPTZ", sizing: "~50M rows, materialized view driven", indexes: "INDEX(name, period_start), INDEX(granularity)" },
      { name: "dashboards", columns: "id UUID PK, owner_id UUID, title TEXT, config JSONB, is_public BOOL, created_at TIMESTAMPTZ", sizing: "~10K rows", indexes: "INDEX(owner_id), INDEX(is_public)" },
      { name: "reports", columns: "id UUID PK, title TEXT, query_sql TEXT, schedule JSONB, last_run TIMESTAMPTZ, result_path TEXT, status TEXT", sizing: "~1K rows", indexes: "INDEX(last_run, status)" },
    ],
    SEARCH: [
      { name: "documents", columns: "id UUID PK, title TEXT, content TEXT, source_url TEXT, domain TEXT, published_at TIMESTAMPTZ, metadata JSONB", sizing: "~1M rows, 10 GB", indexes: "GIN on content (full-text), INDEX(domain, published_at)" },
      { name: "chunks", columns: "id UUID PK, document_id UUID FK→documents, chunk_index INT, text TEXT, embedding VECTOR(768), token_count INT", sizing: "~10M rows, 30 GB", indexes: "HNSW on embedding, INDEX(document_id)" },
      { name: "search_queries", columns: "id UUID PK, user_id UUID, query_text TEXT, query_embedding VECTOR(768), results_returned INT, clicked_ids UUID[], latency_ms INT, created_at TIMESTAMPTZ", sizing: "~5M rows/year", indexes: "INDEX(user_id, created_at), INDEX(created_at)" },
      { name: "relevance_feedback", columns: "id UUID PK, query_id UUID FK→search_queries, doc_id UUID FK→documents, relevance INT CHECK(0-2), created_at TIMESTAMPTZ", sizing: "~500K rows", indexes: "INDEX(query_id), INDEX(doc_id)" },
    ],
    CLASSIFIER: [
      { name: "items", columns: "id UUID PK, content TEXT, source TEXT, submitted_at TIMESTAMPTZ, metadata JSONB", sizing: "~10M rows, 5 GB", indexes: "INDEX(submitted_at, source)" },
      { name: "classifications", columns: "id UUID PK, item_id UUID FK→items, label TEXT, confidence FLOAT, model_version TEXT, classified_at TIMESTAMPTZ, is_human_reviewed BOOL", sizing: "~10M rows", indexes: "INDEX(item_id), INDEX(label, classified_at), INDEX(is_human_reviewed)" },
      { name: "labels", columns: "id UUID PK, name TEXT UNIQUE, description TEXT, parent_label TEXT, domain TEXT", sizing: "~500 rows", indexes: "UNIQUE(name)" },
      { name: "model_versions", columns: "id UUID PK, name TEXT, training_data_size INT, accuracy FLOAT, f1_score FLOAT, deployed_at TIMESTAMPTZ, is_active BOOL", sizing: "~50 rows", indexes: "INDEX(is_active)" },
      { name: "human_review_queue", columns: "id UUID PK, item_id UUID FK→items, classification_id UUID FK→classifications, priority INT, assigned_to TEXT, reviewed_at TIMESTAMPTZ, final_label TEXT", sizing: "~100K rows active", indexes: "INDEX(priority DESC, reviewed_at), INDEX(assigned_to)" },
    ],
    PIPELINE: [
      { name: "pipeline_runs", columns: "id UUID PK, pipeline_name TEXT, status ENUM('queued','running','done','failed'), started_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, config JSONB, error TEXT", sizing: "~1M rows/year", indexes: "INDEX(pipeline_name, status), INDEX(started_at)" },
      { name: "tasks", columns: "id UUID PK, run_id UUID FK→pipeline_runs, task_name TEXT, status TEXT, attempt INT, started_at TIMESTAMPTZ, duration_ms INT, output_path TEXT, logs TEXT", sizing: "~10M rows/year", indexes: "INDEX(run_id, task_name), INDEX(status)" },
      { name: "artifacts", columns: "id UUID PK, task_id UUID FK→tasks, artifact_type TEXT, path TEXT, size_bytes BIGINT, checksum TEXT, created_at TIMESTAMPTZ, metadata JSONB", sizing: "~5M rows", indexes: "INDEX(task_id), INDEX(artifact_type)" },
      { name: "data_sources", columns: "id UUID PK, name TEXT, connection_config JSONB, last_synced_at TIMESTAMPTZ, schema JSONB, record_count BIGINT", sizing: "~1K rows", indexes: "UNIQUE(name)" },
    ],
    CONTENT_GEN: [
      { name: "templates", columns: "id UUID PK, name TEXT, prompt_template TEXT, variables JSONB, domain TEXT, created_at TIMESTAMPTZ", sizing: "~10K rows", indexes: "INDEX(domain)" },
      { name: "generation_jobs", columns: "id UUID PK, template_id UUID FK→templates, input_vars JSONB, status TEXT, model_used TEXT, output_content TEXT, token_count INT, cost_usd FLOAT, created_at TIMESTAMPTZ", sizing: "~10M rows/year", indexes: "INDEX(template_id, status), INDEX(created_at)" },
      { name: "generated_content", columns: "id UUID PK, job_id UUID FK→generation_jobs, version INT, content TEXT, quality_score FLOAT, is_published BOOL, published_at TIMESTAMPTZ", sizing: "~10M rows, 20 GB", indexes: "INDEX(job_id, version), INDEX(is_published)" },
      { name: "quality_reviews", columns: "id UUID PK, content_id UUID FK→generated_content, reviewer TEXT, score FLOAT, feedback TEXT, reviewed_at TIMESTAMPTZ", sizing: "~500K rows", indexes: "INDEX(content_id), INDEX(score)" },
    ],
    GENERAL: [
      { name: "users", columns: "id UUID PK, email TEXT UNIQUE, name TEXT, role TEXT, metadata JSONB, created_at TIMESTAMPTZ", sizing: "~100K rows", indexes: "UNIQUE(email)" },
      { name: "sessions", columns: "id UUID PK, user_id UUID FK→users, payload JSONB, created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ", sizing: "~1M rows", indexes: "INDEX(user_id), INDEX(expires_at)" },
      { name: `${domain.replace(/\s+/g,"_")}_records`, columns: "id UUID PK, user_id UUID FK→users, content JSONB, embedding VECTOR(768), status TEXT, created_at TIMESTAMPTZ", sizing: "~1M rows, 5 GB", indexes: "HNSW on embedding, INDEX(user_id, status)" },
      { name: "audit_log", columns: "id UUID PK, user_id UUID, action TEXT, resource TEXT, before JSONB, after JSONB, occurred_at TIMESTAMPTZ", sizing: "~10M rows/year", indexes: "INDEX(user_id, occurred_at), INDEX(action)" },
    ],
  };

  const tables = dbTables[projectType];

  /* ── 5. Project-specific API endpoints ── */
  type EndpointDef = { method: string; path: string; desc: string; auth: boolean };
  const apiEndpoints: Record<PT, EndpointDef[]> = {
    CHATBOT: [
      { method: "POST", path: "/api/conversations", desc: "Create a new conversation session", auth: true },
      { method: "GET", path: "/api/conversations/:id/messages", desc: "Fetch message history for a conversation", auth: true },
      { method: "POST", path: "/api/conversations/:id/messages", desc: "Send a user message, get streaming AI reply (SSE)", auth: true },
      { method: "GET", path: "/api/conversations", desc: "List all conversations for current user (paginated)", auth: true },
      { method: "DELETE", path: "/api/conversations/:id", desc: "Archive / delete a conversation", auth: true },
      { method: "POST", path: "/api/knowledge-base/ingest", desc: "Ingest new documents into the knowledge base", auth: true },
      { method: "GET", path: "/api/knowledge-base/search", desc: "Semantic search over knowledge base chunks", auth: true },
      { method: "POST", path: "/api/feedback", desc: "Submit thumbs up/down + comment on a message", auth: true },
    ],
    RECOMMENDER: [
      { method: "GET", path: "/api/recommendations/:userId", desc: "Get top-N personalized recommendations for a user", auth: true },
      { method: "POST", path: "/api/events", desc: "Track a user interaction event (view, click, purchase)", auth: true },
      { method: "GET", path: "/api/items/:id/similar", desc: "Get items similar to a given item (embedding similarity)", auth: false },
      { method: "PUT", path: "/api/users/:id/preferences", desc: "Update user preference vector", auth: true },
      { method: "POST", path: "/api/embeddings/recompute", desc: "Trigger re-embedding of all items (admin)", auth: true },
    ],
    ANALYTICS: [
      { method: "POST", path: "/api/events", desc: "Ingest analytics events (batch or single)", auth: false },
      { method: "GET", path: "/api/metrics", desc: "Query aggregated metrics by name + time range", auth: true },
      { method: "GET", path: "/api/dashboards/:id", desc: "Fetch dashboard config + latest data", auth: true },
      { method: "POST", path: "/api/reports/run", desc: "Execute a report query, get results CSV/JSON", auth: true },
      { method: "GET", path: "/api/sessions", desc: "Session-level analytics with funnel breakdown", auth: true },
    ],
    SEARCH: [
      { method: "GET", path: "/api/search", desc: "Semantic + keyword hybrid search, returns ranked results", auth: false },
      { method: "POST", path: "/api/index/documents", desc: "Ingest new documents, chunk + embed async", auth: true },
      { method: "DELETE", path: "/api/index/documents/:id", desc: "Remove document and its chunks from index", auth: true },
      { method: "POST", path: "/api/search/feedback", desc: "Submit relevance feedback for result ranking improvement", auth: true },
      { method: "GET", path: "/api/search/suggest", desc: "Auto-complete / query suggestions", auth: false },
    ],
    CLASSIFIER: [
      { method: "POST", path: "/api/classify", desc: "Classify a single item, returns label + confidence", auth: true },
      { method: "POST", path: "/api/classify/batch", desc: "Classify a batch of items (async job)", auth: true },
      { method: "GET", path: "/api/jobs/:id", desc: "Get batch classification job status", auth: true },
      { method: "POST", path: "/api/labels", desc: "Create or update a classification label", auth: true },
      { method: "POST", path: "/api/review", desc: "Submit human review decision for an item", auth: true },
      { method: "GET", path: "/api/models/active", desc: "Get active model version + benchmark scores", auth: false },
    ],
    PIPELINE: [
      { method: "POST", path: "/api/pipelines/:name/run", desc: "Trigger a pipeline run with optional config override", auth: true },
      { method: "GET", path: "/api/runs/:id", desc: "Get pipeline run status + task-level progress", auth: true },
      { method: "GET", path: "/api/runs/:id/logs", desc: "Stream run logs as SSE or download as text", auth: true },
      { method: "DELETE", path: "/api/runs/:id", desc: "Cancel a running pipeline", auth: true },
      { method: "GET", path: "/api/artifacts/:id", desc: "Download an artifact produced by a task", auth: true },
    ],
    CONTENT_GEN: [
      { method: "POST", path: "/api/generate", desc: "Generate content from a template + variables", auth: true },
      { method: "GET", path: "/api/jobs/:id", desc: "Get generation job status + result", auth: true },
      { method: "GET", path: "/api/templates", desc: "List available prompt templates", auth: true },
      { method: "POST", path: "/api/templates", desc: "Create a new prompt template", auth: true },
      { method: "POST", path: "/api/content/:id/publish", desc: "Publish approved generated content", auth: true },
      { method: "POST", path: "/api/content/:id/review", desc: "Submit quality review score + feedback", auth: true },
    ],
    GENERAL: [
      { method: "POST", path: "/api/auth/login", desc: "Authenticate user, return JWT", auth: false },
      { method: "GET", path: "/api/users/me", desc: "Get current user profile", auth: true },
      { method: "POST", path: `/api/${domain.replace(/\s+/g,"-")}`, desc: `Create a new ${domain} record`, auth: true },
      { method: "GET", path: `/api/${domain.replace(/\s+/g,"-")}`, desc: `List ${domain} records (paginated, filterable)`, auth: true },
      { method: "POST", path: "/api/ai/query", desc: "Send query to AI pipeline, stream response (SSE)", auth: true },
    ],
  };

  const endpoints = apiEndpoints[projectType];

  /* ── 6. Tech stack per project type ── */
  const stack: Record<PT, { backend: string; db: string; ai: string; frontend: string; infra: string }> = {
    CHATBOT:      { backend: "FastAPI (Python) or Node/Express", db: "PostgreSQL 16 + pgvector + Redis (session cache)", ai: "Ollama (local) or OpenAI API — streaming SSE", frontend: "React/Next.js with SSE streaming, WebSocket fallback", infra: "Docker Compose → K8s; Nginx reverse proxy; Redis for rate limiting" },
    RECOMMENDER:  { backend: "FastAPI or Django REST", db: "PostgreSQL 16 + pgvector (item embeddings) + Redis (rec cache)", ai: "Sentence-transformers for embeddings, LLM for explanations", frontend: "React SPA, infinite scroll, A/B test hooks", infra: "Celery for async rec generation, scheduled nightly re-ranking" },
    ANALYTICS:    { backend: "FastAPI or Go/Gin (high throughput ingest)", db: "ClickHouse or Postgres with TimescaleDB + materialized views", ai: "LLM for NL→SQL query translation, anomaly detection", frontend: "Recharts/D3.js dashboards, React Query for polling", infra: "Kafka/Redis Streams for event ingest; S3 for report exports" },
    SEARCH:       { backend: "FastAPI, async batch indexing via Celery", db: "PostgreSQL 16 + pgvector + Elasticsearch (optional BM25 hybrid)", ai: "nomic-embed-text (768-dim) for embeddings, LLM for re-ranking", frontend: "Algolia-style search UI, instant results, faceted filters", infra: "HNSW index (pgvector), nightly re-index job" },
    CLASSIFIER:   { backend: "FastAPI, async classification via Celery", db: "PostgreSQL 16 (classifications + review queue)", ai: "Fine-tuned classifier model + LLM fallback for edge cases", frontend: "Review queue UI, label management, accuracy dashboard", infra: "GPU inference server (Ollama), model versioning in registry" },
    PIPELINE:     { backend: "FastAPI + Celery/Prefect/Airflow", db: "PostgreSQL 16 (pipeline state) + S3/MinIO (artifacts)", ai: "LLM for data validation and schema inference", frontend: "DAG visualizer, run history, log streaming (SSE)", infra: "Kubernetes with CronJobs, Prometheus + Grafana monitoring" },
    CONTENT_GEN:  { backend: "FastAPI, async generation via Celery", db: "PostgreSQL 16 + S3 for content storage", ai: "Ollama LLMs for generation, embedding model for dedup check", frontend: "Template editor, content preview, review workflow", infra: "GPU server for fast generation, CDN for content delivery" },
    GENERAL:      { backend: "FastAPI (Python 3.12), async/await throughout", db: "PostgreSQL 16 + pgvector (embeddings) + Redis (cache)", ai: "Ollama (local LLMs), nomic-embed-text for embeddings", frontend: "Next.js 15 App Router, Tailwind CSS", infra: "Docker Compose, Nginx, Celery workers" },
  };

  const techStack = stack[projectType];

  /* ── 7. Build the plan steps ── */
  const primaryRec = recs.find(r => r.is_primary);
  const primaryModel = primaryRec?.model_name ?? "mistral:latest";

  return [
    /* ── STEP 1: Requirements & Project Overview ── */
    {
      id: 1, phase: "Requirements", priority: "critical", effort: "0.5–1 day",
      title: `Project Scope — ${projectLabel[projectType]} for '${domain}'`,
      hld: finalAnswer
        ? finalAnswer.slice(0, 400).replace(/\n+/g, " ").trim() + (finalAnswer.length > 400 ? "…" : "")
        : `Build a ${projectLabel[projectType]} powered by '${domain}' corpus. The system ingests domain knowledge, exposes AI-driven APIs, and delivers intelligent responses grounded in your data.`,
      hldBullets: [
        `Goal: ${query}`,
        `Domain corpus: ${domain}`,
        `System type: ${projectLabel[projectType]}`,
        `Tech stack: ${techStack.backend}`,
        `AI layer: ${techStack.ai}`,
        `Database: ${techStack.db}`,
        ...allSubResponses.slice(0, 2).map(r => r.slice(0, 120) + (r.length > 120 ? "…" : "")),
      ],
      lld: [{
        component: "Project Requirements",
        inputs: `query="${query}", domain="${domain}"`,
        outputs: "Scope document, tech decisions, architecture blueprint",
        logic: [
          `1. Functional: ${projectLabel[projectType]} with domain-aware AI responses from '${domain}' corpus`,
          "2. Non-functional: <2s response time, 99.9% uptime, local-first AI (no cloud dependency)",
          "3. AI requirements: LLM inference via Ollama, embedding via nomic-embed-text, GraphRAG context",
          `4. Integration: ${endpoints.slice(0,3).map(e => `${e.method} ${e.path}`).join(", ")}`,
          "5. Scalability: Celery async workers, Redis caching, connection pooling",
        ],
        schema: `Project: ${projectLabel[projectType]}\nDomain: ${domain}\nCorpus: knowledge base documents\nPrimary model: ${primaryModel}`,
      }],
      implSteps: [
        `1. Define scope: ${projectLabel[projectType]} for domain '${domain}'`,
        "2. Set up monorepo: backend/ (FastAPI), frontend/ (Next.js), infra/ (Docker)",
        "3. Initialize PostgreSQL: CREATE DATABASE + CREATE EXTENSION vector",
        "4. Set up Redis: docker run -d -p 6379:6379 redis:7-alpine",
        "5. Configure Ollama: pull mistral:latest + nomic-embed-text:latest",
        "6. Create .env: DATABASE_URL, REDIS_URL, OLLAMA_URL, SECRET_KEY",
        "7. Set up Celery broker: CELERY_BROKER_URL=redis://localhost:6379/0",
        "8. Run initial DB migrations: create all tables from schema",
      ],
      kpis: [
        "All services start without errors",
        "DB migrations applied cleanly",
        "Ollama health: GET /api/tags returns model list",
        "Redis ping: PONG",
      ],
      models: modelsByType(["domain_qa", "general_reasoning"]),
    },

    /* ── STEP 2: Data Architecture & Database Schema ── */
    {
      id: 2, phase: "Database", priority: "critical", effort: "1–2 days",
      title: "Data Architecture & Database Schema",
      hld: `Full PostgreSQL schema for ${projectLabel[projectType]}. ${tables.length} core tables with defined relationships, indexes, and sizing estimates. Uses pgvector for embedding storage and cosine similarity search. ${subContent(["data","schema","database","storage","table"])}`,
      hldBullets: [
        `Database: ${techStack.db}`,
        `Tables: ${tables.map(t => t.name).join(", ")}`,
        "Vector store: pgvector extension — VECTOR(768) columns for embeddings",
        "Relationships: " + tables.slice(0,3).map(t => t.name).join(" → "),
        "All tables use UUID PKs, TIMESTAMPTZ for timestamps, JSONB for flexible metadata",
        "Indexes designed for primary access patterns (see LLD per table)",
      ],
      lld: tables.map(t => ({
        component: `Table: ${t.name}`,
        inputs: `DDL from schema design, sizing: ${t.sizing}`,
        outputs: "Created table with indexes, FK constraints",
        logic: [
          `Columns: ${t.columns}`,
          `Sizing estimate: ${t.sizing}`,
          `Indexes: ${t.indexes}`,
          "Constraints: NOT NULL on required fields, CHECK constraints on enums/ranges",
          "FK actions: ON DELETE CASCADE for child records, ON DELETE SET NULL for optional refs",
        ],
        schema: `CREATE TABLE ${t.name} (\n  ${t.columns.split(", ").join(",\n  ")}\n);\n${t.indexes.split(", ").map(i => `CREATE ${i};`).join("\n")}`,
      })),
      implSteps: [
        "1. CREATE EXTENSION IF NOT EXISTS vector; -- enable pgvector",
        "2. Run migration scripts in order: users → core entities → junction tables",
        ...tables.map((t, i) => `${i + 3}. CREATE TABLE ${t.name} (...) — ${t.sizing}`),
        `${tables.length + 3}. Set up pg_cron for automated cleanup of expired records`,
        `${tables.length + 4}. Load corpus: chunk documents → embed with nomic-embed-text → INSERT into knowledge table`,
        `${tables.length + 5}. Verify: SELECT COUNT(*), pg_size_pretty(pg_total_relation_size()) per table`,
      ],
      kpis: [
        `All ${tables.length} tables created with FK constraints valid`,
        "pgvector HNSW index built on embedding columns",
        "Sample cosine search query returns results in <50ms",
        "Corpus chunks loaded and embedded",
      ],
      models: modelsByType(["data_analysis"]),
    },

    /* ── STEP 3: Backend & API Layer ── */
    {
      id: 3, phase: "Backend", priority: "critical", effort: "2–4 days",
      title: "Backend Service & REST API",
      hld: `${techStack.backend} backend exposing ${endpoints.length} endpoints. Async throughout — all I/O awaited, Celery for heavy tasks. JWT authentication, CORS configured, rate limiting via Redis. ${subContent(["backend","api","server","service","endpoint"])}`,
      hldBullets: [
        `Framework: ${techStack.backend}`,
        "Auth: JWT bearer tokens, refresh token rotation, Redis blacklist",
        `Endpoints: ${endpoints.length} routes (see LLD)`,
        "Async: all DB calls use asyncpg/asyncio, Celery for AI tasks",
        "Middleware: CORS, request logging, rate limit (100 req/min per IP via Redis)",
        "Error handling: standardized {error: {code, message, details}} response format",
      ],
      lld: [
        {
          component: "API Endpoints",
          inputs: "HTTP requests with JWT Authorization header",
          outputs: "JSON responses or SSE streams",
          logic: endpoints.map(e => `${e.method.padEnd(6)} ${e.path.padEnd(40)} — ${e.desc}${e.auth ? " [JWT]" : " [public]"}`),
          apiContract: endpoints.map(e => `${e.method} ${e.path}\n  Auth: ${e.auth ? "Bearer JWT required" : "public"}\n  → ${e.desc}`).join("\n\n"),
        },
        {
          component: "Authentication Middleware",
          inputs: "Authorization: Bearer <JWT>",
          outputs: "request.user = decoded JWT payload or 401",
          logic: [
            "JWT: RS256 signed, 1h expiry, claims: {sub, email, role}",
            "Refresh tokens: 30-day expiry, stored in Redis with user_id key",
            "Middleware: verify signature → check Redis blacklist → inject user to request",
            "Rate limit: lua script in Redis → sliding window 100 req/min per IP",
          ],
          schema: "JWT payload: {sub: uuid, email: str, role: str, iat: int, exp: int}",
        },
        {
          component: "AI Inference Service",
          inputs: "query: str, context: str, model: str, stream: bool",
          outputs: "Generated text or SSE stream of tokens",
          logic: [
            `Primary model: ${bestFor("domain_qa")}`,
            `Fallback model: ${bestFor("general_reasoning")}`,
            "Streaming: POST to Ollama /api/generate with stream=true, forward SSE chunks",
            "Context injection: system_prompt + compressed GraphRAG context + user query",
            "Timeout: 60s hard limit, 3s for first token (or return timeout 408)",
          ],
        },
      ],
      implSteps: [
        "1. pip install fastapi uvicorn asyncpg sqlalchemy[asyncio] python-jose[cryptography] redis celery",
        "2. Create router structure: /auth, /users, /" + domain.replace(/\s+/g,"-") + ", /ai",
        ...endpoints.slice(0,5).map((e, i) => `${i+3}. Implement ${e.method} ${e.path} — ${e.desc}`),
        `${endpoints.slice(0,5).length + 3}. Add rate limiting middleware: SlowAPI or custom Redis lua script`,
        `${endpoints.slice(0,5).length + 4}. Add request logging: structlog → JSON logs to stdout`,
        `${endpoints.slice(0,5).length + 5}. Add health endpoint: GET /health → {status, db, redis, ollama}`,
        `${endpoints.slice(0,5).length + 6}. Write integration tests: pytest + httpx AsyncClient`,
      ],
      kpis: [
        `All ${endpoints.length} endpoints return expected HTTP status codes`,
        "JWT auth rejects expired/invalid tokens with 401",
        "Rate limiter blocks after 100 req/min",
        "P95 response time < 200ms for non-AI endpoints",
        `AI streaming endpoint delivers first token in < 3s`,
      ],
      models: modelsByType(["code_generation", "general_reasoning"]),
    },

    /* ── STEP 4: AI / ML Integration ── */
    {
      id: 4, phase: "AI / ML", priority: "critical", effort: "2–3 days",
      title: `AI Integration — LLM Selection & ${projectLabel[projectType]} Intelligence`,
      hld: `AI layer for ${projectLabel[projectType]}: embedding pipeline, GraphRAG retrieval, LLM inference with domain context. Models selected by LinUCB bandit scoring against ${domain} corpus. ${subContent(["model","llm","ai","intelligence","embedding","context"])}`,
      hldBullets: [
        `Embedding model: nomic-embed-text (768-dim vectors, best for domain retrieval)`,
        `Primary LLM: ${bestFor("domain_qa")} — top scorer for domain Q&A`,
        `Code/logic tasks: ${bestFor("code_generation")}`,
        `Reasoning tasks: ${bestFor("general_reasoning")}`,
        "GraphRAG: embed query → pgvector top-K → 2-hop entity expansion → compress to 2000 tokens",
        "All LLM calls: system_prompt + compressed context + task-specific query",
      ],
      lld: [
        {
          component: "Embedding Pipeline",
          inputs: "text chunks from corpus documents",
          outputs: "VECTOR(768) stored in knowledge table",
          logic: [
            "Model: nomic-embed-text:latest via Ollama POST /api/embeddings",
            "Batch size: 32 chunks per call (memory-efficient)",
            `Dimension: 768 — matches pgvector VECTOR(768) column`,
            "Update strategy: re-embed only changed/new chunks (checksum comparison)",
            "Async: Celery task with progress tracking",
          ],
        },
        {
          component: "LLM Model Scorecard",
          inputs: `Query type: domain-specific queries about ${domain}`,
          outputs: "Ranked model recommendations with scores",
          logic: [
            "── Model Recommendations from this session ──",
            ...recs.slice(0, 6).map(r =>
              `${r.is_primary ? "★ PRIMARY" : "○ FALLBACK"} ${r.model_name} [${r.task_type}]\n  Score: ${(r.composite_score * 100).toFixed(0)}% | Local: ${r.is_available_locally ? "yes" : "no"}\n  Why: ${r.why_primary || "High composite score"}`
            ),
            recs.length === 0 ? "No recs available — using defaults" : "",
          ].filter(Boolean),
          schema: recs.slice(0,4).map(r => `${r.model_name}: task=${r.task_type}, score=${(r.composite_score*100).toFixed(0)}%, primary=${r.is_primary}`).join("\n"),
        },
        {
          component: `GraphRAG Context Builder`,
          inputs: "user query (text + embedding), knowledge graph",
          outputs: "compressed_context (≤2000 tokens) with entity neighborhoods",
          logic: [
            "1. Embed query → VECTOR(768) via nomic-embed-text",
            "2. pgvector: SELECT chunk_text, 1-(embedding<=>$query_vec) AS score ORDER BY score DESC LIMIT 10",
            "3. Expand to 2-hop entity neighborhood in knowledge graph",
            "4. Load community summaries for retrieved entity clusters",
            "5. Compress: greedy sentence selection by cosine score until ≤2000 tokens",
            "6. Prepend as 'Knowledge Graph Context:' block to every LLM call",
          ],
          apiContract: `retrieve(query_text, top_k=10) → {context: str, entity_count: int, token_count: int}`,
        },
      ],
      implSteps: [
        "1. Pull models: ollama pull nomic-embed-text:latest && ollama pull mistral:latest && ollama pull llama3.2:latest",
        "2. Implement embed_text(text) → list[float]: POST ollama /api/embeddings",
        "3. Implement embed_batch(texts, batch_size=32): async batched embedding",
        "4. Implement graphrag_retrieve(query, top_k): pgvector search + entity expansion",
        "5. Implement llm_chat(prompt, model, stream): POST ollama /api/chat with optional stream",
        `6. Wire up: user query → embed → graphrag → build_prompt(context, query, system_prompt) → ${primaryModel}`,
        "7. Add model fallback: if primary model times out → retry with fallback model",
        "8. Add response caching: Redis TTL=3600 for identical (query_hash, model) pairs",
        "9. Log model used, tokens, latency per request to model_usage table",
      ],
      kpis: [
        `${bestFor("domain_qa")} first-token latency < 3s`,
        "Embedding throughput: ≥50 chunks/min on CPU",
        "GraphRAG retrieval: <200ms for top-10 search",
        `Context compression: ≤2000 tokens, >60% information retention`,
        `Hallucination rate on ${domain} queries: <5%`,
      ],
      models: recs.length > 0
        ? recs.slice(0, 3).map(r => ({ name: r.model_name, provider: r.provider, score: r.composite_score, local: r.is_available_locally, why: r.why_primary || `Task: ${r.task_type}`, role: r.is_primary ? "Primary" : "Fallback" }))
        : modelsByType(["domain_qa", "general_reasoning"]),
    },

    /* ── STEP 5: Frontend / UI ── */
    {
      id: 5, phase: "Frontend", priority: "high", effort: "2–3 days",
      title: "Frontend Application & User Interface",
      hld: `${techStack.frontend}. The UI connects to the backend API, streams AI responses via SSE, and provides an intuitive interface for ${projectLabel[projectType]}. ${subContent(["frontend","ui","interface","client","dashboard","page"])}`,
      hldBullets: [
        `Stack: ${techStack.frontend}`,
        "Auth: JWT stored in httpOnly cookie, auto-refresh via interceptor",
        "API client: fetch wrapper with auth headers, SSE streaming support",
        "State: React useState/useContext for local, React Query for server state",
        "Styling: Tailwind CSS, consistent design tokens",
        "Streaming: ReadableStream reader for real-time AI response display",
      ],
      lld: [
        {
          component: "Page Structure",
          inputs: "User interactions, API responses",
          outputs: "Rendered UI components",
          logic: [
            ...(() => {
              const pages: Record<PT, string[]> = {
                CHATBOT: ["/ → Chat interface: conversation list + message thread + streaming reply", "/login → Auth page", "/settings → Corpus upload + model config", "/history → Past conversations with search"],
                RECOMMENDER: ["/ → Personalized feed: recommendation cards + interaction tracking", "/items/:id → Item detail + similar items", "/profile → User preferences + history", "/admin → Analytics + model performance"],
                ANALYTICS: ["/ → Main dashboard: KPI cards + charts (Recharts/D3)", "/events → Event stream viewer", "/reports → Report builder + scheduler", "/dashboards/:id → Shareable dashboard"],
                SEARCH: ["/ → Search bar + instant results (debounced 300ms)", "/results → Full results page with facets + pagination", "/doc/:id → Document viewer with highlighted matches", "/admin → Index management"],
                CLASSIFIER: ["/ → Review queue: items awaiting classification", "/labels → Label taxonomy management", "/models → Model versions + accuracy metrics", "/bulk → Bulk upload + classification"],
                PIPELINE: ["/ → Pipeline list + last run status", "/runs/:id → Run detail: DAG view + task logs", "/artifacts → Artifact browser", "/settings → Pipeline config + schedules"],
                CONTENT_GEN: ["/ → Template gallery", "/generate → Template editor + live preview", "/content → Generated content library", "/review → Review queue + approval workflow"],
                GENERAL: ["/ → Home / landing", "/app → Main application view", "/query → AI query interface with streaming", "/history → Past sessions"],
              };
              return pages[projectType];
            })(),
            "API client: fetch(`${API_URL}/api/...`) with Authorization header injection",
            "SSE streaming: const reader = response.body.getReader(); while(true) { await reader.read(); }",
          ],
          apiContract: `NEXT_PUBLIC_API_URL=http://192.168.42.62:8000\nAll requests: headers: { Authorization: 'Bearer ' + getToken() }`,
        },
        {
          component: "Streaming AI Response Component",
          inputs: "POST /api/ai endpoint SSE stream",
          outputs: "Incrementally rendered text as tokens arrive",
          logic: [
            "1. POST request with {query, context, stream: true}",
            "2. response.body.getReader() → read chunks → TextDecoder",
            "3. Parse SSE: lines starting with 'data: ' → JSON.parse(line.slice(6))",
            "4. Append to state: setResponse(prev => prev + event.text)",
            "5. On [DONE] event: finalize, save to history",
            "6. Error: show retry button on network failure",
          ],
        },
      ],
      implSteps: [
        "1. npx create-next-app@latest frontend --typescript --tailwind --app",
        "2. Create API client: lib/api.ts with auth headers + SSE streaming helper",
        "3. Implement auth: /login page + JWT storage in httpOnly cookie via /api/auth/login",
        "4. Build main page components (see page structure above)",
        "5. Add StreamingText component: handles SSE reader + incremental render",
        "6. Implement React Query hooks: useQuery for data, useMutation for writes",
        "7. Add error boundary + loading skeletons for all async components",
        "8. Responsive layout: Tailwind breakpoints (sm/md/lg), mobile-first",
        "9. Build: next build → output: standalone → deploy as node server.js",
      ],
      kpis: [
        "First Contentful Paint < 1.5s",
        "Streaming response: first token visible < 3s",
        "Lighthouse score > 85 (Performance, Accessibility)",
        "All pages functional on mobile (320px+)",
      ],
      models: modelsByType(["code_generation"]),
    },

    /* ── STEP 6: Infrastructure & Security ── */
    {
      id: 6, phase: "Infrastructure", priority: "high", effort: "1–2 days",
      title: "Infrastructure, Security & Deployment",
      hld: `${techStack.infra}. Containerized deployment with Docker Compose for local/dev, Kubernetes for production. SSL termination at Nginx. Secrets management via environment variables. ${subContent(["infrastructure","deploy","docker","server","security","hosting"])}`,
      hldBullets: [
        `Infra: ${techStack.infra}`,
        "Containerization: Docker multi-stage builds, Alpine base images",
        "Reverse proxy: Nginx — SSL termination, gzip, static file serving",
        "Secrets: .env files (dev), Kubernetes Secrets or Vault (prod)",
        "Security: HTTPS only, HSTS, rate limiting, input validation (Pydantic), SQL injection prevention (parameterized queries)",
        "Monitoring: Prometheus metrics endpoint + Grafana dashboards",
      ],
      lld: [
        {
          component: "Docker Compose Stack",
          inputs: "docker-compose.yml",
          outputs: "Running services: backend, frontend, db, redis, ollama",
          logic: [
            "services: backend (FastAPI), frontend (Next.js), db (postgres:16), redis (redis:7-alpine), ollama (ollama/ollama)",
            "Networks: internal (db + redis), public (backend + frontend + nginx)",
            "Volumes: postgres_data, redis_data, ollama_models, corpus_store",
            "Health checks: all services have HEALTHCHECK defined",
            "Restart policy: restart: unless-stopped for all production services",
          ],
          schema: `backend: ports 8000, depends_on: db, redis, ollama\nfrontend: ports 3001, depends_on: backend\nnginx: ports 80:443, depends_on: frontend, backend\ndb: postgres:16, volume: postgres_data\nredis: redis:7-alpine\nollama: ollama/ollama, volume: ollama_models, GPU passthrough if available`,
        },
        {
          component: "Security Checklist",
          inputs: "Application code + infrastructure",
          outputs: "Hardened deployment",
          logic: [
            "✓ HTTPS: Let's Encrypt via Certbot on Nginx (prod) / self-signed (dev)",
            "✓ CORS: allow_origins=[frontend_url], not wildcard in production",
            "✓ Rate limiting: 100 req/min per IP via Redis sliding window",
            "✓ Input validation: Pydantic models on all request bodies",
            "✓ SQL: parameterized queries only, no f-string SQL",
            "✓ JWT: RS256 algorithm, 1h expiry, Redis blacklist for logout",
            "✓ Secrets: never in code — always from environment variables",
            "✓ Dependencies: pip audit + npm audit in CI",
          ],
        },
      ],
      implSteps: [
        "1. Write Dockerfile for backend: python:3.12-slim, multi-stage, non-root user",
        "2. Write Dockerfile for frontend: node:20-alpine, npm run build, standalone output",
        "3. Write docker-compose.yml with all services + health checks",
        "4. Configure Nginx: upstream blocks for backend (8000) + frontend (3001), SSL",
        "5. Set up .env.production: all secrets as environment variables",
        "6. Add Prometheus metrics: /metrics endpoint via prometheus-fastapi-instrumentator",
        "7. docker compose up --build -d && docker compose ps (all healthy)",
        "8. Run security scan: trivy image <image_name> for CVE check",
        "9. Test rate limiting: ab -n 200 -c 20 http://localhost:8000/health",
      ],
      kpis: [
        "All containers start and pass health checks",
        "SSL grade A on SSL Labs (prod)",
        "Zero critical CVEs in container images",
        "Rate limiter active and blocking at threshold",
        "Backup: pg_dump scheduled daily",
      ],
      models: modelsByType(["general_reasoning"]),
    },

    /* ── STEP 7: Testing & Launch ── */
    {
      id: 7, phase: "Testing & Launch", priority: "medium", effort: "1–2 days",
      title: "Testing Strategy, CI/CD & Launch Checklist",
      hld: `End-to-end test suite + CI/CD pipeline for ${projectLabel[projectType]}. Unit tests for all business logic, integration tests for all API endpoints, E2E tests for critical user flows. Automated deployment on merge to main. ${subContent(["test","quality","ci","deploy","launch","checklist"])}`,
      hldBullets: [
        "Unit tests: pytest (backend), Jest (frontend) — target >80% coverage",
        "Integration tests: pytest + httpx AsyncClient for all API endpoints",
        "E2E tests: Playwright for critical user journeys",
        `AI quality tests: 20-question eval set for ${domain} domain, target <5% hallucination`,
        "CI: GitHub Actions — lint → type-check → test → build → deploy",
        "Monitoring: Grafana dashboard for latency, error rate, AI quality metrics",
      ],
      lld: [
        {
          component: "Test Suite",
          inputs: "Codebase + test fixtures",
          outputs: "Coverage report, test results",
          logic: [
            "Unit: test each service function in isolation (mock DB + Ollama)",
            `Integration: test all ${endpoints.length} API endpoints with real DB (test DB, rollback after each)`,
            "AI eval: 20 curated question/answer pairs from ${domain} corpus → check hallucination rate",
            "Load test: k6 script, 100 VUs, 5 min — target P95 < 500ms, 0 errors",
            "Security: OWASP ZAP baseline scan on staging URL",
          ],
          apiContract: `pytest tests/ --cov=app --cov-report=html\nnpx playwright test\nk6 run tests/load/scenario.js`,
        },
        {
          component: "Launch Checklist",
          inputs: "Staging environment passing all tests",
          outputs: "Production deployment go/no-go",
          logic: [
            "✓ All unit + integration tests passing",
            "✓ Ollama models loaded: ollama list | grep required models",
            "✓ DB migrations applied: alembic current == head",
            "✓ SSL certificate valid, HTTPS only",
            `✓ ${domain} corpus ingested: SELECT COUNT(*) FROM knowledge table > 0`,
            "✓ AI quality: hallucination rate < 5% on eval set",
            "✓ Backup verified: pg_dump restore test passes",
            "✓ Monitoring: Grafana dashboard showing metrics",
            "✓ Rate limiting: tested and active",
          ],
        },
      ],
      implSteps: [
        "1. pip install pytest pytest-asyncio httpx pytest-cov",
        "2. Write unit tests: tests/test_services.py + tests/test_ai.py",
        `3. Write integration tests for all ${endpoints.length} endpoints: tests/test_api.py`,
        "4. Write AI eval: tests/test_ai_quality.py — 20 Q&A pairs, assert hallucination_rate < 0.05",
        "5. Set up GitHub Actions: .github/workflows/ci.yml (lint → test → build)",
        "6. Set up Playwright: npx playwright install + tests/e2e/",
        "7. Run: pytest --cov=app --cov-report=html && open htmlcov/index.html",
        "8. Deploy: docker compose pull && docker compose up -d --no-deps --build",
        "9. Smoke test: curl https://your-domain/health → {status: 'ok'}",
        "10. Monitor: open Grafana dashboard, verify all metrics flowing",
      ],
      kpis: [
        "Unit test coverage > 80%",
        `All ${endpoints.length} API endpoints tested and passing`,
        `AI hallucination rate on ${domain}: < 5%`,
        "P95 latency < 500ms (non-AI), < 5s (AI streaming first token)",
        "Zero 5xx errors under load test (100 VUs, 5 min)",
      ],
      models: modelsByType(["code_generation", "general_reasoning"]),
    },
  ];
}
