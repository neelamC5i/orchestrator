"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { API_BASE } from "../lib/api";

interface StepExplanation {
  what: string; why: string; what_we_found: string; decision_made: string;
  confidence: number; caveats: string[]; graph_entity_ids: string[];
}
interface OrchestratorStep {
  step_number: number; step_name: string; explanation: StepExplanation; duration_ms: number;
}
interface ModelRec {
  model_name: string; provider: string; task_type: string; composite_score: number;
  benchmark_score: number; why_primary: string; why_not_alternatives: string[];
  is_primary: boolean; is_available_locally: boolean;
}
interface SubTaskResult {
  task_type: string; query_fragment: string; assigned_model: string;
  response: string; confidence: number;
}
interface OrchestratorOutput {
  session_id: string; query: string; intent: string; primary_task_type: string;
  coverage_action: string; slm_model_id: string | null; steps: OrchestratorStep[];
  model_recommendations: ModelRec[]; sub_task_results: SubTaskResult[];
  final_answer: string; hallucination_rate: number; total_tokens_used: number;
  tokens_saved_by_compression: number; build_in_progress: boolean; error?: string;
}
interface ChatMessage { role: "user" | "assistant"; content: string; }

// ── Probabilistic transparency types ──────────────────────────────────────────
// These come from the pre-stream model_context event emitted by the orchestrator
// route before any model inference starts.  They describe the system's confidence
// and learning state at the moment the query was received.

interface ModelContextArm {
  model_id: string;
  provider: string;
  observations: number;     // estimated real queries seen
  explore_width: number;    // UCB uncertainty; decreases as model learns
  estimated_reward: number; // learned reward coefficient (0–1 range)
  state: "Exploring" | "Learning" | "Confident";
}
interface ModelContext {
  embedding_available: boolean;
  arms: ModelContextArm[];
  available_model_count: number;
}
interface OrchestratorWarning {
  code: string;
  message: string;
}

interface ArchLayer {
  name: string;
  components: string[];
  tech: string[];
  notes: string;
}

interface LLDSpec {
  component: string;
  inputs: string;
  outputs: string;
  logic: string[];
  schema?: string;
  apiContract?: string;
}

interface BuildStep {
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

function deriveBuildPlan(output: OrchestratorOutput): BuildStep[] {
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

// ── Probabilistic UI components ───────────────────────────────────────────────

/** High / Medium / Low badge derived from actual hallucination_rate. */
function ConfidenceBadge({ hallucination_rate }: { hallucination_rate: number }) {
  const h = hallucination_rate;
  const label = h < 0.05 ? "High" : h < 0.15 ? "Medium" : "Low";
  const dot   = h < 0.05 ? "●" : h < 0.15 ? "◐" : "○";
  const cls   = h < 0.05
    ? "bg-gg/10 text-gg border-gg/30"
    : h < 0.15
    ? "bg-amber/10 text-amber border-amber/30"
    : "bg-coral/10 text-coral border-coral/30";
  const tip   = h < 0.05
    ? "Hallucination rate < 5% — high factual reliability"
    : h < 0.15
    ? `Hallucination rate ${(h * 100).toFixed(1)}% — verify key figures`
    : `Hallucination rate ${(h * 100).toFixed(1)}% — treat as estimate, confirm with domain experts`;
  return (
    <span title={tip} className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-md border cursor-help ${cls}`}>
      <span>{dot}</span>{label} confidence
    </span>
  );
}

/** Per-sub-task confidence dot. */
function SubConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const cls = pct >= 80 ? "text-gg" : pct >= 60 ? "text-amber" : "text-coral";
  const tip = pct >= 80 ? "High sub-task confidence — matched your document corpus"
    : pct >= 60 ? "Medium — partial knowledge match"
    : "Low — model inferred from general knowledge, not your documents";
  return (
    <span title={tip} className={`text-[10px] font-mono font-bold cursor-help ${cls}`}>{pct}%</span>
  );
}

/** Shows chosen model, bandit learning state, embedding availability. */
function ModelChoiceCard({ context, primaryModel }: { context: ModelContext; primaryModel: string | null }) {
  const primaryArm = context.arms.find(a => a.model_id === primaryModel) ?? context.arms[0];
  if (!primaryArm) return null;
  const stateColor = primaryArm.state === "Confident"
    ? "text-gg border-gg/30 bg-gg/5"
    : primaryArm.state === "Learning"
    ? "text-amber border-amber/30 bg-amber/5"
    : "text-blue border-blue/30 bg-blue/5";
  const stateIcon = primaryArm.state === "Confident" ? "✓" : primaryArm.state === "Learning" ? "⟳" : "🔍";
  const stateDesc = primaryArm.state === "Confident"
    ? `${primaryArm.observations} queries seen — routing optimised`
    : primaryArm.state === "Learning"
    ? `${primaryArm.observations} queries seen — confidence improving`
    : `${primaryArm.observations < 5 ? "First few queries" : `${primaryArm.observations} queries seen`} — still learning your domain`;
  return (
    <div className="bg-bg3 border border-dborder rounded-xl px-4 py-3 mb-4 flex flex-wrap gap-3 items-center text-[11px]">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-t3 flex-shrink-0 font-semibold">AI used:</span>
        <span className="font-mono font-semibold text-t1 truncate">{primaryArm.model_id}</span>
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded border flex-shrink-0 ${stateColor}`}>
          {stateIcon} {primaryArm.state}
        </span>
        {!context.embedding_available && (
          <span title="nomic-embed-text not available — results ranked by keyword match only" className="text-[9px] px-2 py-0.5 rounded border bg-coral/5 text-coral border-coral/30 flex-shrink-0 cursor-help">
            ⚠ No semantic embedding
          </span>
        )}
      </div>
      <div className="flex items-center gap-4 text-[10px] text-t3 flex-shrink-0">
        <span title="Estimated reward the bandit has learned for this model (0–1 scale)">
          Reward: <span className="font-mono text-t2">{(primaryArm.estimated_reward * 100).toFixed(0)}%</span>
        </span>
        <span title="UCB exploration width — lower = more confident in this model's routing">
          Certainty: <span className={`font-mono font-semibold ${primaryArm.explore_width < 0.01 ? "text-gg" : primaryArm.explore_width < 0.05 ? "text-amber" : "text-coral"}`}>
            {primaryArm.explore_width < 0.01 ? "High" : primaryArm.explore_width < 0.05 ? "Medium" : "Low"}
          </span>
        </span>
        <span className="text-t3 italic hidden sm:inline">{stateDesc}</span>
      </div>
    </div>
  );
}

/** Warnings banner — shown when orchestrator emitted uncertainty/fallback warnings. */
function WarningsBanner({ warnings }: { warnings: OrchestratorWarning[] }) {
  if (!warnings.length) return null;
  return (
    <div className="mb-4 space-y-1.5">
      {warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-2.5 bg-amber/5 border border-amber/25 rounded-xl px-3.5 py-2.5 text-[11px]">
          <span className="text-amber flex-shrink-0 mt-0.5">⚠</span>
          <span className="text-t2">{w.message}</span>
        </div>
      ))}
    </div>
  );
}

function ProviderBadge({ provider, local }: { provider: string; local: boolean }) {
  const map: Record<string, string> = {
    ollama:     "bg-gg/10 text-gg border-gg/30",
    openai:     "bg-blue/10 text-blue border-blue/30",
    anthropic:  "bg-purple/10 text-purple border-purple/30",
    groq:       "bg-amber/10 text-amber border-amber/30",
  };
  return (
    <span className={`inline-flex items-center text-[9px] font-bold px-2 py-0.5 rounded-md border ${map[provider] ?? "bg-bg4 text-t3 border-dborder"}`}>
      {local && <span className="mr-1">●</span>}{provider}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, string> = {
    critical: "pill-coral bg-coral/10 text-coral border-coral/30",
    high:     "pill-a",
    medium:   "apill",
  };
  return <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-lg border ${priority === "critical" ? "bg-coral/10 text-coral border-coral/30" : priority === "high" ? "bg-amber/10 text-amber border-amber/30" : "bg-bg4 text-t3 border-dborder"}`}>{priority}</span>;
}

function Pyramid() {
  return (
    <div className="flex flex-col items-center gap-1 pb-7 pt-1">
      {[
        { label: "✓ Result",             w: 80  },
        { label: "✓ Model selection",    w: 190 },
        { label: "✓ SLM engine",         w: 280 },
        { label: "✓ Data + GraphRAG",    w: 390 },
      ].map((t, i) => (
        <div
          key={i}
          className="flex items-center justify-center h-9 rounded-[10px] text-[12px] font-semibold px-5 bg-gg/10 border border-gg/30 text-gg"
          style={{ width: t.w }}
        >
          {t.label}
        </div>
      ))}
    </div>
  );
}

export default function RecommendationsPage() {
  const router = useRouter();
  const [output, setOutput] = useState<OrchestratorOutput | null>(null);
  const [buildPlan, setBuildPlan] = useState<BuildStep[]>([]);
  const [planPath, setPlanPath] = useState<"BUILDER"|"RESEARCHER"|"ANALYST"|"AUDITOR"|"SUMMARIZER">("BUILDER");
  const [planAnswers, setPlanAnswers] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<string>("answer");
  const [expandedStep, setExpandedStep] = useState<number | null>(1);
  const [traceExpanded, setTraceExpanded] = useState<number | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [selectedKpis, setSelectedKpis] = useState<Set<string>>(new Set());
  const [kpiApplied, setKpiApplied] = useState(false);
  const [existingSysPrompt, setExistingSysPrompt] = useState("");
  const [tweakQuery, setTweakQuery] = useState("");
  const [tweakOpen, setTweakOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  // Probabilistic transparency state
  const [modelContext, setModelContext] = useState<ModelContext | null>(null);
  const [orcWarnings, setOrcWarnings] = useState<OrchestratorWarning[]>([]);
  const [activeWeights, setActiveWeights] = useState<Record<string, number> | null>(null);
  const [feedbackSent, setFeedbackSent] = useState<Record<string, "correct" | "incorrect">>({});
  // Per-step inline tweak
  const [stepTweakInput, setStepTweakInput] = useState<Record<number, string>>({});
  const [stepTweakLoading, setStepTweakLoading] = useState<Record<number, boolean>>({});
  const [stepTweakReplies, setStepTweakReplies] = useState<Record<number, string>>({});
  const [stepTweakError, setStepTweakError] = useState<Record<number, string>>({});

  useEffect(() => {
    const jid = sessionStorage.getItem("job_id");
    setJobId(jid);
    setExistingSysPrompt(sessionStorage.getItem("system_prompt") ?? "");
    // Load intent path from planning wizard
    try {
      const choices = JSON.parse(sessionStorage.getItem("orch_plan_choices") ?? "{}");
      if (choices.path) setPlanPath(choices.path);
      if (choices.answers) setPlanAnswers(choices.answers);
      // BUILDER defaults to blueprint tab; others default to answer
      if (choices.path === "BUILDER") setActiveTab("plan");
      else setActiveTab("answer");
    } catch { /**/ }

    const raw = sessionStorage.getItem("orchestrator_output");
    setTweakQuery(sessionStorage.getItem("query") ?? "");
    // Load probabilistic context emitted before the main output
    try {
      const mc = sessionStorage.getItem("orch_model_context");
      if (mc) setModelContext(JSON.parse(mc));
    } catch { /**/ }
    try {
      const w = sessionStorage.getItem("orch_warnings");
      if (w) setOrcWarnings(JSON.parse(w));
    } catch { /**/ }
    try {
      const sw = sessionStorage.getItem("scoring_weights");
      if (sw) setActiveWeights(JSON.parse(sw));
    } catch { /**/ }
    if (raw) {
      try {
        const parsed: OrchestratorOutput = JSON.parse(raw);
        setOutput(parsed);
        const plan = deriveBuildPlan(parsed);
        setBuildPlan(plan);
        // Persist KPIs to localStorage so query page can display them
        const allKpis = plan.flatMap(s => s.kpis.map(k => ({ kpi: k, phase: s.phase })));
        try { localStorage.setItem("orch_last_kpis", JSON.stringify(allKpis)); } catch { /**/ }
        if (parsed.final_answer) {
          setChatMessages([{ role: "assistant", content: parsed.final_answer }]);
        }
      } catch { router.push("/query"); }
    } else { router.push("/query"); }
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  // Detect whether the user input is a question or a modification request
  const isModificationRequest = (text: string): boolean => {
    const t = text.toLowerCase().trim();
    const modWords = [
      "add ", "remove ", "delete ", "include ", "exclude ", "change ", "update ", "replace ",
      "modify ", "use ", "switch ", "rename ", "drop ", "insert ", "append ", "move ",
      "i need ", "i want ", "please add", "please change", "please update", "make it ",
      "instead of ", "rather than ", "also add", "don't use", "avoid ",
    ];
    return modWords.some(w => t.startsWith(w) || t.includes(" " + w.trim() + " "));
  };

  const askAboutStep = async (step: BuildStep) => {
    const question = (stepTweakInput[step.id] ?? "").trim();
    if (!question) return;
    setStepTweakLoading(p => ({ ...p, [step.id]: true }));
    setStepTweakError(p => ({ ...p, [step.id]: "" }));
    setStepTweakReplies(p => ({ ...p, [step.id]: "" }));
    const API = API_BASE;
    const domainLabel = sessionStorage.getItem("domain_label") ?? "general";
    const originalQuery = sessionStorage.getItem("original_query") ?? sessionStorage.getItem("query") ?? "";

    // Full step context for the LLM — keep under 2800 chars to stay within max_length=4096
    const trunc = (s: string, n: number) => s.length > n ? s.slice(0, n) + "…" : s;
    const stepContextLines = [
      `Step ${step.id}: ${step.title} (${step.phase})`,
      `HLD: ${trunc(step.hld, 400)}`,
      `Bullets: ${step.hldBullets.slice(0, 3).join(" | ")}`,
      step.lld[0] ? `LLD: ${step.lld[0].component} — ${step.lld[0].logic.slice(0, 2).join("; ")}` : "",
      `KPIs: ${step.kpis.slice(0, 3).join(", ")}`,
      `Models: ${step.models.slice(0, 3).map(m => `${m.name} score=${m.score.toFixed(3)} role=${m.role} reason="${trunc(m.why, 80)}"`).join(" | ")}`,
    ].filter(Boolean);
    const stepContext = stepContextLines.join("\n");

    const isModification = isModificationRequest(question);

    try {
      if (!isModification) {
        // ── Q&A mode: just answer the question with full step context ──
        const systemPrompt = `You are an expert software architect reviewing a solution blueprint. Answer questions concisely and specifically about the given step. When asked about model recommendations, explain the scores, capabilities, and why that model fits the role. Never regenerate the blueprint — just answer the question.`;
        const raw = `${stepContext}\n\n---\nUser question: ${question}`;
        const queryWithContext = raw.length > 4000 ? raw.slice(0, 4000) : raw;
        const res = await fetch(`${API}/api/v1/orchestrator/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: queryWithContext, domain_label: domainLabel, job_id: jobId, system_prompt: systemPrompt }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!res.body) throw new Error("No response body");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "", answer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n"); buf = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.type === "output" && ev.data?.final_answer) answer = ev.data.final_answer;
              } catch { /* skip */ }
            }
          }
        }
        setStepTweakReplies(p => ({ ...p, [step.id]: answer || "No answer returned." }));
        setStepTweakInput(p => ({ ...p, [step.id]: "" }));

      } else {
        // ── Regeneration mode: regenerate ONLY this step ──
        setStepTweakReplies(p => ({ ...p, [step.id]: "⏳ Regenerating this step…" }));
        const systemPrompt = `You are an expert software architect. The user wants to modify a specific step in a solution blueprint. Regenerate ONLY this step incorporating the user's change. Keep the same JSON structure. The original project query was: "${originalQuery}"`;
        const rawRegen = `${stepContext}\n\n---\nModification request: "${question}"\nRegenerate this step only, incorporating the change into HLD, LLD, implementation steps, KPIs and model recommendations.`;
        const regenQuery = rawRegen.length > 4000 ? rawRegen.slice(0, 4000) : rawRegen;
        const res = await fetch(`${API}/api/v1/orchestrator/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: regenQuery, domain_label: domainLabel, job_id: jobId, system_prompt: systemPrompt }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!res.body) throw new Error("No response body");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "", newBuildPlan: BuildStep[] | null = null, finalAnswer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n"); buf = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.type === "output" && ev.data) {
                  if (ev.data.build_plan?.length) newBuildPlan = ev.data.build_plan;
                  if (ev.data.final_answer) finalAnswer = ev.data.final_answer;
                }
              } catch { /* skip */ }
            }
          }
        }
        // Patch only the matching step in buildPlan; fall back to showing answer if no plan returned
        if (newBuildPlan) {
          const updatedStep = newBuildPlan.find(s => s.id === step.id) ?? newBuildPlan[0];
          if (updatedStep) {
            setBuildPlan(prev => prev.map(s => s.id === step.id ? { ...updatedStep, id: step.id } : s));
            setStepTweakReplies(p => ({ ...p, [step.id]: `✅ Step "${step.title}" has been updated with your change.` }));
          }
        } else {
          setStepTweakReplies(p => ({ ...p, [step.id]: finalAnswer || "Step regenerated — please scroll up to review." }));
        }
        setStepTweakInput(p => ({ ...p, [step.id]: "" }));
      }
    } catch (e: any) {
      setStepTweakError(p => ({ ...p, [step.id]: e.message ?? "Request failed" }));
      setStepTweakReplies(p => ({ ...p, [step.id]: "" }));
    } finally {
      setStepTweakLoading(p => ({ ...p, [step.id]: false }));
    }
  };

  const regenerateSolution = async () => {
    const newQuery = tweakQuery.trim();
    if (!newQuery || !jobId || regenerating) return;
    setRegenerating(true);
    setRegenError(null);
    const API = API_BASE;
    const domainLabel = sessionStorage.getItem("domain_label") ?? "general";
    const systemPrompt = sessionStorage.getItem("system_prompt") ?? "";
    try {
      const res = await fetch(`${API}/api/v1/orchestrator/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: newQuery, domain_label: domainLabel, job_id: jobId, system_prompt: systemPrompt }),
      });
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      if (!res.body) throw new Error("No response body from orchestrator");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === "output" && ev.data) {
                const newOutput: OrchestratorOutput = ev.data;
                sessionStorage.setItem("query", newQuery);
                sessionStorage.setItem("orchestrator_output", JSON.stringify(newOutput));
                setOutput(newOutput);
                setBuildPlan(deriveBuildPlan(newOutput));
                if (newOutput.final_answer) setChatMessages([{ role: "assistant", content: newOutput.final_answer }]);
                setTweakOpen(false);
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch (e: any) {
      setRegenError(e.message ?? "Regeneration failed");
    } finally {
      setRegenerating(false);
    }
  };

  const sendFeedback = async (modelId: string, taskType: string, idx: number, isCorrect: boolean) => {
    const key = `${idx}`;
    setFeedbackSent(p => ({ ...p, [key]: isCorrect ? "correct" : "incorrect" }));
    const API = API_BASE;
    try {
      await fetch(`${API}/api/v1/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: output?.session_id ?? "",
          model_id: modelId,
          task_type: taskType,
          is_correct: isCorrect,
          domain_label: sessionStorage.getItem("domain_label") ?? "general",
        }),
      });
    } catch { /**/ }  // non-fatal — UI state already updated
  };

  const startNewSession = () => {
    sessionStorage.removeItem("query");
    sessionStorage.removeItem("orchestrator_output");
    sessionStorage.removeItem("system_prompt");
    sessionStorage.removeItem("reuse_corpus");
    // Keep job_id and domain_label so the query page auto-selects the same corpus
    router.push("/query");
  };

  const downloadPDF = () => {
    window.print();
  };

  const sendChat = async () => {
    if (!chatInput.trim() || !output) return;
    const msg = chatInput.trim();
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", content: msg }]);
    setIsChatting(true);
    try {
      const API = API_BASE;
      const res = await fetch(`${API}/api/v1/orchestrator/ask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: msg, session_id: output.session_id, job_id: jobId,
          domain_label: output.slm_model_id ?? sessionStorage.getItem("domain_label") ?? "general",
        }),
      });
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "", answer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try { const ev = JSON.parse(line.slice(6)); if (ev.type === "output") answer = ev.data?.final_answer ?? ""; } catch { /**/ }
          }
        }
      }
      setChatMessages(prev => [...prev, { role: "assistant", content: answer || "I couldn't generate a response." }]);
    } catch {
      setChatMessages(prev => [...prev, { role: "assistant", content: "Error communicating with the model." }]);
    } finally { setIsChatting(false); }
  };

  if (!output) return <div className="flex items-center justify-center h-screen text-t3 text-sm">Loading…</div>;

  return (
    <div>
      {/* ── Regenerating overlay ── */}
      {regenerating && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-card rounded-2xl border border-dborder shadow-xl px-10 py-8 flex flex-col items-center gap-4 max-w-sm w-full mx-4">
            <div className="w-10 h-10 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            <div className="text-[14px] font-semibold text-t1">Regenerating solution…</div>
            <div className="text-[12px] text-t3 text-center">Re-running the AI with your updated prompt.<br/>The knowledge graph stays intact.</div>
          </div>
        </div>
      )}

      {/* ── Tweak prompt panel ── */}
      <div className="bg-card border-b border-dborder px-8 py-3 no-print">
        <button
          onClick={() => { setTweakOpen(o => !o); setRegenError(null); }}
          className="flex items-center gap-2 text-[12px] text-t3 hover:text-t1 transition-colors"
        >
          <span className="text-[14px]">✏️</span>
          <span className="font-medium">Refine prompt</span>
          <span className="ml-1 text-[10px]">{tweakOpen ? "▲" : "▼"}</span>
        </button>
        {tweakOpen && (
          <div className="mt-3 flex flex-col gap-3">
            <div className="text-[11px] text-t3">Edit your original prompt below and click <strong>Regenerate</strong> — the corpus and knowledge graph stay intact, only the AI answer and blueprint are updated.</div>
            <textarea
              value={tweakQuery}
              onChange={e => setTweakQuery(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-dborder bg-bg2 text-t1 text-[13px] px-4 py-3 resize-y focus:outline-none focus:border-accent"
              placeholder="Describe what you want to build or ask…"
            />
            {regenError && <div className="text-[11px] text-coral">⚠ {regenError}</div>}
            <div className="flex gap-2 items-center">
              <button
                onClick={regenerateSolution}
                disabled={!tweakQuery.trim() || regenerating}
                className="btn btn-p btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ↺ Regenerate solution
              </button>
              <button onClick={() => { setTweakOpen(false); setTweakQuery(output?.query ?? ""); setRegenError(null); }} className="btn btn-sm">
                Cancel
              </button>
              <span className="text-[11px] text-t3 ml-auto">Current: "{output.query.slice(0, 60)}{output.query.length > 60 ? '…' : ''}"</span>
            </div>
          </div>
        )}
      </div>

      {/* Page header */}
      <div className="bg-card border-b border-dborder px-0 py-7 mb-7 no-print">
        <div className="w-full px-8 flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-t3 mb-1.5 flex items-center gap-2">
              <span className="inline-block w-4 h-px bg-accent" />
              Step 3 of 3 · Complete
            </div>
            <div className="font-sora text-2xl font-semibold text-t1">
              {planPath === "BUILDER" ? "Solution Blueprint" : planPath === "ANALYST" ? "Analysis Report" : planPath === "AUDITOR" ? "Compliance Report" : planPath === "SUMMARIZER" ? "Executive Summary" : "Your Answer"}
            </div>
            <div className="text-[12px] text-t2 mt-1 italic">"{output.query}"</div>
          </div>
          <div className="flex gap-2 pt-1 flex-shrink-0">
            <button onClick={downloadPDF} className="btn btn-sm" title="Download as PDF">
              ⬇ PDF
            </button>
            <button onClick={() => router.push("/dashboard")} className="btn btn-sm">
              Dashboard
            </button>
            <button onClick={startNewSession} className="btn btn-sm btn-p">
              + New Session
            </button>
          </div>
        </div>
      </div>

      <div className="w-full px-8">
        <Pyramid />

        {/* Meta row */}
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="apill">Intent: <span className="text-accent">{output.intent}</span></span>
          <span className="apill">Coverage: <span className="text-amber">{output.coverage_action}</span></span>
          {output.slm_model_id && <span className="apill-done apill">Custom AI: {output.slm_model_id}</span>}
          {output.build_in_progress && <span className="apill bg-amber/10 text-amber border-amber/30">⏳ AI build queued</span>}
          <span className={`apill ${output.hallucination_rate < 0.05 ? "apill-done" : "bg-coral/10 text-coral border-coral/30"}`}>
            Accuracy: {((1 - output.hallucination_rate) * 100).toFixed(1)}%
          </span>
          <ConfidenceBadge hallucination_rate={output.hallucination_rate} />
        </div>

        {/* Model choice + uncertainty transparency */}
        {modelContext && (
          <ModelChoiceCard
            context={modelContext}
            primaryModel={output.slm_model_id ?? (output.model_recommendations?.find(r => r.is_primary)?.model_name ?? null)}
          />
        )}

        {/* Tabs — adaptive by intent path */}
        <div className="flex gap-1 mb-6 border-b border-dborder">
          {(planPath === "BUILDER" ? [
            { key: "plan",   label: "Solution Blueprint" },
            { key: "answer", label: "Answer" },
            { key: "chat",   label: "Chat" },
            { key: "trace",  label: "Reasoning Trail" },
          ] : planPath === "ANALYST" ? [
            { key: "answer", label: "Analysis Report" },
            { key: "plan",   label: "Key Findings" },
            { key: "chat",   label: "Chat" },
            { key: "trace",  label: "Reasoning Trail" },
          ] : planPath === "AUDITOR" ? [
            { key: "answer", label: "Compliance Report" },
            { key: "plan",   label: "Gap Analysis" },
            { key: "chat",   label: "Chat" },
            { key: "trace",  label: "Reasoning Trail" },
          ] : planPath === "SUMMARIZER" ? [
            { key: "answer", label: "Executive Summary" },
            { key: "plan",   label: "Full Detail" },
            { key: "chat",   label: "Chat" },
            { key: "trace",  label: "Reasoning Trail" },
          ] : [
            { key: "answer", label: "Answer" },
            { key: "plan",   label: "Sources & Blueprint" },
            { key: "chat",   label: "Chat" },
            { key: "trace",  label: "Reasoning Trail" },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-[12px] font-semibold rounded-t transition-colors ${
                activeTab === tab.key
                  ? "bg-bg3 text-accent border-b-2 border-accent"
                  : "text-t3 hover:text-t2"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* BUILD PLAN TAB */}
        {activeTab === "plan" && (
          <div className="space-y-3">
            {/* Architecture overview bar */}
            <div className="bg-bg3 border border-dborder rounded-card px-5 py-4 mb-2">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-t3 mb-3">System Architecture — End to End</div>
              <div className="flex items-center gap-1 flex-wrap">
                {[
                  { label: "Files / DB", color: "bg-bg4 border-dborder text-t2" },
                  { label: "→", color: "text-t3 border-0 bg-transparent" },
                  { label: "Chunker + Embedder", color: "bg-blue/10 border-blue/30 text-blue" },
                  { label: "→", color: "text-t3 border-0 bg-transparent" },
                  { label: "Knowledge Graph", color: "bg-purple/10 border-purple/30 text-purple" },
                  { label: "→", color: "text-t3 border-0 bg-transparent" },
                  { label: "SLM Factory", color: "bg-amber/10 border-amber/30 text-amber" },
                  { label: "→", color: "text-t3 border-0 bg-transparent" },
                  { label: "Orchestrator (9-step)", color: "bg-accent/10 border-accent/30 text-accent" },
                  { label: "→", color: "text-t3 border-0 bg-transparent" },
                  { label: "GraphRAG Retriever", color: "bg-teal/10 border-teal/30 text-teal" },
                  { label: "→", color: "text-t3 border-0 bg-transparent" },
                  { label: "Next.js UI", color: "bg-gg/10 border-gg/30 text-gg" },
                ].map((n, i) => (
                  n.label === "→"
                    ? <span key={i} className="text-t3 text-[11px]">→</span>
                    : <span key={i} className={`text-[10px] font-semibold px-2.5 py-1 rounded-md border ${n.color}`}>{n.label}</span>
                ))}
              </div>
            </div>

            {buildPlan.map(step => (
              <div
                key={step.id}
                className={`bg-card2 border rounded-card overflow-hidden transition-colors ${expandedStep === step.id ? "border-accent" : "border-dborder hover:border-dborder2"}`}
              >
                {/* Step header */}
                <button className="w-full flex items-start gap-4 px-5 py-4 text-left" onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}>
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center text-[13px] font-bold text-accent">{step.id}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-[10px] text-t3 font-mono uppercase">{step.phase}</span>
                      <PriorityBadge priority={step.priority} />
                      <span className="text-[10px] text-t3">~{step.effort}</span>
                    </div>
                    <p className="text-[13px] font-semibold text-t1">{step.title}</p>
                    {expandedStep !== step.id && <p className="text-[11px] text-t3 mt-1 line-clamp-1">{step.hld.slice(0, 120)}…</p>}
                  </div>
                  <span className="text-t3 flex-shrink-0 mt-1 text-[11px]">{expandedStep === step.id ? "▲" : "▼"}</span>
                </button>

                {expandedStep === step.id && (
                  <div className="border-t border-dborder">

                    {/* HLD */}
                    <div className="px-5 pt-4 pb-3 border-b border-dborder/50">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-blue mb-2 flex items-center gap-2">
                        <span className="w-3 h-px bg-blue/60" />HLD — High Level Design
                      </div>
                      <p className="text-[12px] text-t2 leading-relaxed mb-3">{step.hld}</p>
                      <ul className="space-y-1.5">
                        {step.hldBullets.map((b, i) => (
                          <li key={i} className="flex items-start gap-2 text-[11px] text-t2">
                            <span className="text-accent mt-0.5 flex-shrink-0">◆</span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* LLD */}
                    <div className="px-5 pt-4 pb-3 border-b border-dborder/50">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-purple mb-3 flex items-center gap-2">
                        <span className="w-3 h-px bg-purple/60" />LLD — Low Level Design
                      </div>
                      <div className="space-y-4">
                        {step.lld.map((spec, si) => (
                          <div key={si} className="bg-bg border border-dborder rounded-sm p-3">
                            <div className="text-[11px] font-bold text-purple mb-2 font-mono">{spec.component}</div>
                            <div className="grid grid-cols-2 gap-2 text-[10px] mb-2">
                              <div><span className="text-t3 font-semibold">IN: </span><span className="text-t2 font-mono">{spec.inputs}</span></div>
                              <div><span className="text-t3 font-semibold">OUT: </span><span className="text-t2 font-mono">{spec.outputs}</span></div>
                            </div>
                            <ul className="space-y-1 mb-2">
                              {spec.logic.map((l, li) => (
                                <li key={li} className="flex items-start gap-2 text-[11px] text-t2">
                                  <span className="text-purple/60 flex-shrink-0 font-mono">{li + 1}.</span>
                                  <span>{l}</span>
                                </li>
                              ))}
                            </ul>
                            {spec.schema && (
                              <pre className="bg-bg3 border border-dborder rounded-sm p-2 text-[10px] text-gg font-mono overflow-auto mt-2">{spec.schema}</pre>
                            )}
                            {spec.apiContract && (
                              <pre className="bg-bg3 border border-accent/20 rounded-sm p-2 text-[10px] text-accent font-mono overflow-auto mt-2">{spec.apiContract}</pre>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Implementation steps */}
                    <div className="px-5 pt-4 pb-3 border-b border-dborder/50">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-gg mb-2 flex items-center gap-2">
                        <span className="w-3 h-px bg-gg/60" />Implementation Steps
                      </div>
                      <ol className="space-y-1.5">
                        {step.implSteps.map((s, i) => (
                          <li key={i} className="flex items-start gap-2 text-[11px] text-t2">
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gg/10 border border-gg/30 flex items-center justify-center text-[9px] font-bold text-gg">{i + 1}</span>
                            <span className="mt-0.5">{s.replace(/^\d+\.\s*/, "")}</span>
                          </li>
                        ))}
                      </ol>
                    </div>

                    {/* KPIs */}
                    <div className="px-5 pt-3 pb-4 border-b border-dborder/50">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-amber mb-2 flex items-center gap-2">
                        <span className="w-3 h-px bg-amber/60" />Success KPIs
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {step.kpis.map((k, i) => (
                          <span key={i} className="text-[10px] px-2.5 py-1 bg-amber/5 border border-amber/20 rounded-md text-amber">{k}</span>
                        ))}
                      </div>
                    </div>

                    {/* Models */}
                    <div className="px-5 pt-3 pb-4 border-b border-dborder/50">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-t3 mb-2 flex items-center gap-2">
                        <span className="w-3 h-px bg-t3/40" />Recommended Models
                      </div>
                      <div className="space-y-1.5">
                        {step.models.map((m, i) => (
                          <div key={i} className={`model-row ${i === 0 ? "border-teal chosen" : ""}`}>
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: i === 0 ? "#2dd4a0" : "#5c5a78" }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-[12px] font-medium font-mono ${i === 0 ? "text-teal" : "text-t1"}`}>{m.name}</span>
                                <ProviderBadge provider={m.provider} local={m.local} />
                                <span className="text-[9px] px-1.5 py-0.5 rounded border text-t3 border-dborder">{m.role}</span>
                                {i === 0 && <span className="ft-badge bg-teal/10 text-teal border border-teal/30">PRIMARY</span>}
                              </div>
                              <p className="text-[10px] text-t3 mt-0.5">{m.why}</p>
                            </div>
                            <span className={`text-[14px] font-bold font-mono ${m.score >= 0.8 ? "text-gg" : m.score >= 0.6 ? "text-t2" : "text-coral"}`}>{m.score.toFixed(3)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* ── Per-step tweak / Q&A box ── */}
                    <div className="px-5 pt-4 pb-5">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-accent mb-2 flex items-center gap-2">
                        <span className="w-3 h-px bg-accent/60" />Ask or tweak this step
                      </div>
                      {/* Previous reply */}
                      {stepTweakReplies[step.id] && (
                        <div className="mb-3 bg-accent/5 border border-accent/20 rounded-xl px-4 py-3">
                          <div className="text-[9px] font-bold text-accent uppercase tracking-widest mb-1">AI response</div>
                          <div className="text-[12px] text-t2 leading-relaxed prose prose-sm max-w-none prose-headings:text-t2 prose-headings:font-semibold prose-headings:mt-2 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-strong:text-t1 prose-code:text-accent prose-code:bg-bg3 prose-code:px-1 prose-code:rounded">
                            <ReactMarkdown>{stepTweakReplies[step.id]}</ReactMarkdown>
                          </div>
                          <button
                            onClick={() => setStepTweakReplies(p => ({ ...p, [step.id]: "" }))}
                            className="text-[10px] text-t3 hover:text-t1 mt-2"
                          >✕ Clear</button>
                        </div>
                      )}
                      <div className="flex gap-2 items-end">
                        <textarea
                          value={stepTweakInput[step.id] ?? ""}
                          onChange={e => setStepTweakInput(p => ({ ...p, [step.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askAboutStep(step); } }}
                          rows={2}
                          placeholder={`Ask a question (e.g. "Why was general_v10 chosen?") or request a change (e.g. "Add a user_name column to recommendations table")…`}
                          className="flex-1 rounded-xl border border-dborder bg-bg2 text-t1 text-[12px] px-3 py-2.5 resize-none focus:outline-none focus:border-accent"
                        />
                        <button
                          onClick={() => askAboutStep(step)}
                          disabled={!stepTweakInput[step.id]?.trim() || stepTweakLoading[step.id]}
                          className="flex-shrink-0 h-[58px] px-4 rounded-xl bg-accent text-white text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                        >
                          {stepTweakLoading[step.id] ? (
                            <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          ) : isModificationRequest(stepTweakInput[step.id] ?? "") ? "Update" : "Ask"}
                        </button>
                      </div>
                      {stepTweakError[step.id] && (
                        <p className="text-[11px] text-coral mt-1">⚠ {stepTweakError[step.id]}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ANSWER TAB */}
        {activeTab === "answer" && (
          <div>
            <WarningsBanner warnings={orcWarnings} />
            {output.final_answer ? (
              <div className="card">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-2 h-2 rounded-full bg-gg" />
                  <p className="text-[10px] font-semibold text-t3 uppercase tracking-widest">Direct answer</p>
                  {output.slm_model_id && <span className="ml-auto apill font-mono">{output.slm_model_id}</span>}
                </div>
                <div className="text-[13px] text-t1 leading-relaxed prose prose-sm max-w-none prose-headings:text-t1 prose-headings:font-bold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5 prose-strong:text-t1 prose-code:text-accent prose-code:bg-bg3 prose-code:px-1 prose-code:rounded prose-pre:bg-bg3 prose-pre:rounded-xl prose-pre:p-3">
                  <ReactMarkdown>{output.final_answer}</ReactMarkdown>
                </div>
                {output.sub_task_results?.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-dborder">
                    <div className="sect">Sub-task breakdown</div>
                    <div className="space-y-3">
                      {output.sub_task_results.map((r, i) => (
                        <div key={i} className="bg-bg3 rounded-sm p-3 border border-dborder">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="apill font-mono">{r.task_type}</span>
                            <span className="text-[10px] text-t3 font-mono">{r.assigned_model}</span>
                            <SubConfidenceBadge confidence={r.confidence} />
                            <span className="ml-auto text-[9px] text-t3 italic">
                              {r.confidence >= 0.8 ? "From your documents" : r.confidence >= 0.5 ? "Partial match" : "Model estimate"}
                            </span>
                          </div>
                          <p className="text-[10px] text-t3 italic mb-1.5">{r.query_fragment}</p>
                          <div className="text-[12px] text-t2 leading-relaxed prose prose-sm max-w-none prose-headings:text-t2 prose-headings:font-semibold prose-headings:mt-2 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-strong:text-t1 prose-code:text-accent prose-code:bg-bg3 prose-code:px-1 prose-code:rounded">
                            <ReactMarkdown>{(r.response?.length ?? 0) > 500 ? r.response!.slice(0, 500) + "…" : (r.response ?? "")}</ReactMarkdown>
                          </div>
                          {/* Human feedback loop — updates LinUCB bandit reward */}
                          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-dborder/50">
                            <span className="text-[10px] text-t3 flex-shrink-0">Accurate?</span>
                            <button
                              onClick={() => sendFeedback(r.assigned_model, r.task_type, i, true)}
                              disabled={!!feedbackSent[String(i)]}
                              title="Mark as correct — bandit will route more queries to this model"
                              className={`text-[12px] px-2 py-0.5 rounded transition-colors ${feedbackSent[String(i)] === "correct" ? "bg-gg/20 text-gg" : "text-t3 hover:text-gg disabled:opacity-40"}`}
                            >👍</button>
                            <button
                              onClick={() => sendFeedback(r.assigned_model, r.task_type, i, false)}
                              disabled={!!feedbackSent[String(i)]}
                              title="Mark as incorrect — bandit will reduce routing to this model"
                              className={`text-[12px] px-2 py-0.5 rounded transition-colors ${feedbackSent[String(i)] === "incorrect" ? "bg-coral/20 text-coral" : "text-t3 hover:text-coral disabled:opacity-40"}`}
                            >👎</button>
                            {feedbackSent[String(i)] && (
                              <span className="text-[10px] text-t3 italic">
                                {feedbackSent[String(i)] === "correct" ? "✓ Noted — AI will favour this model" : "✓ Noted — AI will explore alternatives"}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="card border-amber/30">
                <p className="text-amber font-semibold text-[15px] mb-2">⏳ Corpus Processing In Progress</p>
                <p className="text-[12px] text-t2 leading-relaxed mb-4">
                  The system is ingesting your data and building the knowledge graph.<br />
                  Use the <span className="text-accent font-medium">Q&A Chat</span> tab to ask questions right now.
                </p>
                {output.error && <p className="text-[11px] text-coral mt-2 font-mono">{output.error}</p>}
              </div>
            )}
          </div>
        )}

        {/* Q&A CHAT TAB */}
        {activeTab === "chat" && (
          <div className="flex flex-col" style={{ height: "540px" }}>
            <p className="text-[11px] text-t3 mb-3">
              Ask questions about your data using available models.
              {jobId && <span className="text-gg ml-2">● corpus context loaded</span>}
            </p>
            <div className="flex-1 overflow-auto bg-bg rounded-sm border border-dborder p-4 space-y-3 mb-3">
              {chatMessages.length === 0 && (
                <div className="text-center mt-4">
                  <p className="text-t3 text-[11px] mb-3">Try these questions:</p>
                  <div className="space-y-2 max-w-lg mx-auto">
                    {[
                      "What's the demand impact if US tariffs on personal care products increase 25%?",
                      "Which suppliers face highest risk from a Red Sea route closure?",
                      "What safety stock should I hold given current risks?",
                      "How should I adjust demand forecasts if a disruption hits East Asia?",
                      "Give me a step-by-step plan to build this intelligence system.",
                    ].map(q => (
                      <button key={q} onClick={() => setChatInput(q)}
                        className="block w-full text-left text-[11px] bg-bg3 hover:bg-bg4 border border-dborder rounded-sm px-3 py-2.5 text-t3 hover:text-t2 transition-colors">
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-2xl rounded-card px-4 py-3 text-[12px] ${msg.role === "user" ? "bg-accent text-white" : "bg-card2 border border-dborder text-t1"}`}>
                    {msg.role === "assistant" && <p className="text-[10px] text-accent mb-1.5 font-semibold">AI Orchestrator</p>}
                    <div className="leading-relaxed prose prose-sm max-w-none prose-headings:font-bold prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-strong:font-semibold prose-code:bg-black/10 prose-code:px-1 prose-code:rounded">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ))}
              {isChatting && (
                <div className="thinking-bar">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple animate-blink" />
                  Thinking…
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="flex gap-2">
              <input
                className="flex-1 prompt-box resize-none"
                style={{ minHeight: "unset" }}
                placeholder="Ask about your data…"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              />
              <button onClick={sendChat} disabled={isChatting || !chatInput.trim()} className="btn btn-p px-6 disabled:opacity-40">
                Send
              </button>
            </div>
          </div>
        )}

        {/* DECISION TRACE TAB */}
        {activeTab === "trace" && (
          <div className="space-y-2">
            {(output.steps ?? []).length === 0 && (
              <div className="text-[12px] text-t3 text-center py-10">No reasoning trace available for this session.</div>
            )}
            {(output.steps ?? []).map((step, i) => {
              const expl = step.explanation ?? {} as typeof step.explanation;
              const confidence = expl.confidence ?? 0;
              return (
              <div key={i} className="bg-card2 border border-dborder rounded-card overflow-hidden">
                <button className="w-full flex items-center justify-between px-4 py-3 text-left"
                  onClick={() => setTraceExpanded(traceExpanded === i ? null : i)}>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-purple/10 border border-purple/30 text-[11px] font-bold text-purple">
                      {step.step_number}
                    </div>
                    <div>
                      <p className="text-[12px] font-semibold text-t1">{step.step_name}</p>
                      <p className="text-[10px] text-t3">{step.duration_ms ?? 0}ms</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="prog-bar w-16"><div className="prog-fill" style={{ width: `${confidence * 100}%` }} /></div>
                    <span className={`text-[11px] font-mono font-semibold ${confidence >= 0.8 ? "text-gg" : confidence >= 0.6 ? "text-amber" : "text-coral"}`}>
                      {(confidence * 100).toFixed(0)}%
                    </span>
                    <span className="text-t3 text-[11px]">{traceExpanded === i ? "▲" : "▼"}</span>
                  </div>
                </button>
                {traceExpanded === i && (
                  <div className="px-4 pb-4 pt-3 border-t border-dborder space-y-2 text-[11px]">
                    {([["WHAT", expl.what], ["WHY", expl.why],
                      ["FOUND", expl.what_we_found], ["DECISION", expl.decision_made]] as [string, string][])
                      .filter(([, value]) => value)
                      .map(([label, value]) => (
                        <div key={label} className="flex gap-3">
                          <span className="text-t3 font-bold w-16 flex-shrink-0">{label}</span>
                          <span className="text-t2">{value}</span>
                        </div>
                      ))}
                    {(expl.caveats ?? []).length > 0 && (
                      <div className="flex gap-3">
                        <span className="text-t3 font-bold w-16 flex-shrink-0">CAVEATS</span>
                        <span className="text-amber italic">{expl.caveats.join(" · ")}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
            })}

            {/* Shapley Source Attribution */}
            {output.sub_task_results && output.sub_task_results.length > 0 && (
              <div className="mt-6">
                <div className="sect mb-3">Source Attribution (Shapley)</div>
                <div className="text-[11px] text-t3 mb-3">Estimated contribution of each sub-task to the final answer</div>
                <div className="space-y-2">
                  {output.sub_task_results.map((r, i) => {
                    // Approximate Shapley value: weight by response length relative to total
                    const totalLen = output.sub_task_results.reduce((acc, x) => acc + (x.response?.length ?? 0), 0);
                    const contribution = totalLen > 0 ? (r.response?.length ?? 0) / totalLen : 1 / output.sub_task_results.length;
                    const pct = Math.round(contribution * 100);
                    const colors = ["#6c5cf7","#0d9e74","#d97706","#e63755","#60a5fa","#2dd4a0"];
                    const color = colors[i % colors.length];
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <div className="w-32 flex-shrink-0 text-[11px] font-semibold text-t2 truncate">{r.task_type ?? `Task ${i+1}`}</div>
                        <div className="flex-1 h-2 bg-bg3 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
                        </div>
                        <div className="text-[11px] font-bold w-8 text-right" style={{ color }}>{pct}%</div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 text-[10px] text-t3 italic">Attribution estimated from sub-task response weight. Exact Shapley values require marginal contribution sampling.</div>
              </div>
            )}

            {/* Model auction results (bandit scores) */}
            {output.model_recommendations.length > 0 && (
              <div className="mt-6">
                <div className="sect mb-1">Model Auction Results</div>
                <div className="text-[11px] text-t3 mb-3">Models competed for each task using LinUCB bandit scoring. Highest UCB score wins.</div>
                <div className="sect">All model recommendations</div>
                {/* Active scoring weights banner */}
                {activeWeights && (() => {
                  const total = Object.values(activeWeights).reduce((s: number, v) => s + (v as number), 0) || 1;
                  const labels: Record<string, string> = {
                    benchmark: "Quality", availability: "Avail.", bandit: "Reliability",
                    speed: "Speed", ctx_fit: "Ctx fit", task_fit: "Task fit",
                  };
                  const nonZero = Object.entries(activeWeights).filter(([, v]) => (v as number) > 0);
                  const isDefault =
                    Math.abs((activeWeights.benchmark ?? 0) - 0.30) < 0.01 &&
                    Math.abs((activeWeights.speed ?? 0) - 0.15) < 0.01;
                  return (
                    <div className={`flex flex-wrap items-center gap-2 mb-2 px-3 py-2 rounded-card text-[10px] ${isDefault ? "bg-bg3 border border-dborder2 text-t3" : "bg-accent/10 border border-accent/30 text-accent"}`}>
                      <span className="font-semibold">{isDefault ? "Default weights:" : "Your scoring weights:"}</span>
                      {nonZero.map(([key, val]) => (
                        <span key={key} className="font-mono">
                          {labels[key] ?? key} {Math.round((val as number) / total * 100)}%
                        </span>
                      ))}
                      <a href="/query" className="ml-auto underline opacity-60 hover:opacity-100">adjust →</a>
                    </div>
                  );
                })()}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {output.model_recommendations.map((rec, i) => (
                    <div key={i} className={`model-row ${rec.is_primary ? "chosen" : ""}`}>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: rec.is_primary ? "#2dd4a0" : "#5c5a78" }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[12px] font-medium font-mono ${rec.is_primary ? "text-teal" : "text-t1"}`}>{rec.model_name}</span>
                          <ProviderBadge provider={rec.provider} local={rec.is_available_locally} />
                        </div>
                        <p className="text-[10px] text-t3">{rec.provider} · {rec.task_type}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[13px] font-mono text-accent font-bold">{rec.composite_score.toFixed(3)}</p>
                        {rec.is_available_locally && <p className="text-[9px] text-gg">● local</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-10 pt-6 border-t border-dborder flex justify-between items-center mb-8">
          <button onClick={() => router.push("/query")} className="btn btn-sm text-t3 hover:text-t1">← New query</button>
          <div className="text-[10px] text-t3 text-right">
            Session: <span className="font-mono">{output.session_id?.slice(0, 8)}…</span>
            {output.total_tokens_used > 0 && <span className="ml-3">{output.total_tokens_used.toLocaleString()} tokens</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
