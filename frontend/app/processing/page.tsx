"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PipelineCanvas, { type PipelineNode, type NodeStatus } from "../components/PipelineCanvas";
import PipelineLayerList, { type PipelineLayer } from "../components/PipelineLayerList";
import LayerDetailPanel from "../components/LayerDetailPanel";
import ApprovalGate, { type GateStep } from "../components/ApprovalGate";
import AchievementToast, { fireAchievement } from "../components/AchievementToast";
import SLMStudio, { type SLMConfig } from "../components/SLMStudio";
import { API_BASE } from "../lib/api";

interface EpochEntry { epoch: number; loss: number; }

interface PipelineKpis {
  entities: number;
  relationships: number;
  graph_nodes: number;
  trust_score: number;
  ontology_consistency: number;
}

interface PipelineSnapshotLog {
  ts?: number | null;
  status?: string;
  layer_id?: string;
  message?: string;
  overall_pct?: number;
}

interface PipelineSnapshot {
  job_id: string;
  status: string;
  overall_pct: number;
  eta_seconds: number | null;
  terminal: boolean;
  layers: PipelineLayer[];
  kpis: PipelineKpis;
  previews: {
    eda?: Record<string, unknown>;
    kg?: Record<string, unknown>;
    wiki?: Record<string, unknown>;
    entities?: string[];
  };
  logs: PipelineSnapshotLog[];
  artifacts_available: Record<string, boolean>;
  file_count?: number;
  entity_count?: number;
  community_count?: number;
  error?: string | null;
}

function formatEta(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "";
  if (seconds < 60) return `~${seconds}s remaining`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `~${m}m ${s}s remaining`;
}

const INITIAL_NODES: PipelineNode[] = [
  { id: "import",   label: "Import Data",      icon: "📥", status: "pending" },
  { id: "clean",    label: "Clean & Organize",  icon: "🧹", status: "pending" },
  { id: "quality",  label: "Readiness Check",   icon: "📊", status: "pending" },
  { id: "graph",    label: "Knowledge Graph",   icon: "🕸️",  status: "pending" },
  { id: "build-ai", label: "Build Custom AI",   icon: "🧠", status: "pending" },
];

const RESULT_NODES: PipelineNode[] = [
  { id: "import",   label: "Import Data",      icon: "📥", status: "done" },
  { id: "clean",    label: "Clean & Organize",  icon: "🧹", status: "done" },
  { id: "quality",  label: "Readiness Check",   icon: "📊", status: "done" },
  { id: "graph",    label: "Knowledge Graph",   icon: "🕸️",  status: "done" },
  { id: "build-ai", label: "Build Custom AI",   icon: "🧠", status: "done" },
  { id: "ai",       label: "Select AI Models",  icon: "🤖", status: "pending" },
  { id: "answer",   label: "Generate Answer",   icon: "✨", status: "pending" },
];

const PIPELINE_TABS = [
  { id: "pipeline",   label: "Pipeline" },
  { id: "overview",   label: "Overview" },
  { id: "extraction", label: "Extraction" },
  { id: "metadata",   label: "Metadata" },
  { id: "eda",        label: "EDA" },
  { id: "kg",         label: "Knowledge Graph" },
  { id: "confidence", label: "Confidence" },
  { id: "validation", label: "Validation & Trust" },
  { id: "governance", label: "Governance & Ontology" },
  { id: "wiki",       label: "Wiki" },
] as const;

const TAB_LAYER_MAP: Record<string, string[]> = {
  pipeline:   [],
  overview:   ["upload", "extract", "clean", "chunk", "metadata", "entities", "semantic", "eda", "validation", "ontology", "canonical", "graph_build", "graph_consist", "wiki"],
  extraction: ["upload", "extract"],
  metadata:   ["metadata"],
  eda:        ["eda", "validation"],
  kg:         ["graph_build", "graph_consist"],
  confidence: ["semantic"],
  validation: ["validation", "ontology"],
  governance: ["ontology"],
  wiki:       ["wiki"],
};

function makeEmptyLayers(): PipelineLayer[] {
  return [
    { id: "upload",        label: "File Upload + Lineage",      status: "pending", pct: 0, detail: "", started_at: null, completed_at: null, error_code: null },
    { id: "extract",       label: "Ingestion & Extraction",     status: "pending", pct: 0, detail: "", started_at: null, completed_at: null, error_code: null },
    { id: "clean",         label: "Cleaning + Normalization",    status: "pending", pct: 0, detail: "", started_at: null, completed_at: null, error_code: null },
    { id: "chunk",         label: "Chunking + Segmentation",     status: "pending", pct: 0, detail: "", started_at: null, completed_at: null, error_code: null },
    { id: "metadata",      label: "Metadata Intelligence",       status: "pending", pct: 0, detail: "", started_at: null, completed_at: null, error_code: null },
    { id: "entities",      label: "Entity + Relationship",       status: "pending", pct: 0, detail: "", started_at: null, completed_at: null, error_code: null },
    { id: "semantic",      label: "Semantic Learning",           status: "pending", pct: 0, detail: "", started_at: null, completed_at: null, error_code: null },
    { id: "eda",           label: "EDA Intelligence",            status: "pending", pct: 0, detail: "", started_at: null, completed_at: null, error_code: null },
    { id: "validation",    label: "ML Validation & Accuracy",   status: "pending", pct: 0, detail: "", started_at: null, completed_at: null, error_code: null },
    { id: "ontology",      label: "Ontology & Governance",       status: "pending", pct: 0, detail: "", started_at: null, completed_at: null, error_code: null },
    { id: "canonical",     label: "Canonicalization",            status: "pending", pct: 0, detail: "", started_at: null, completed_at: null, error_code: null },
    { id: "graph_build",   label: "KG Construction",            status: "pending", pct: 0, detail: "", started_at: null, completed_at: null, error_code: null },
    { id: "graph_consist", label: "Graph Consistency",           status: "pending", pct: 0, detail: "", started_at: null, completed_at: null, error_code: null },
    { id: "wiki",          label: "Wiki + Explainability",      status: "pending", pct: 0, detail: "", started_at: null, completed_at: null, error_code: null },
  ];
}

function mapLayersToCanvasNodes(layers: PipelineLayer[]): PipelineNode[] {
  const findStatus = (ids: string[]): NodeStatus => {
    const statuses = ids.map(id => layers.find(l => l.id === id)?.status ?? "pending");
    if (statuses.some(s => s === "error")) return "error";
    if (statuses.some(s => s === "running")) return "running";
    if (statuses.every(s => s === "done")) return "done";
    return "pending";
  };

  return [
    { id: "import",  label: "Import Data",     icon: "📥", status: findStatus(["upload", "extract"]) },
    { id: "clean",   label: "Clean & Organize", icon: "🧹", status: findStatus(["clean", "chunk", "metadata"]) },
    { id: "quality", label: "Readiness Check",  icon: "📊", status: findStatus(["entities", "semantic", "eda", "validation"]) },
    { id: "graph",   label: "Knowledge Graph",  icon: "🕸️",  status: findStatus(["ontology", "canonical", "graph_build", "graph_consist"]) },
    { id: "build-ai",label: "Build Custom AI",  icon: "🧠", status: findStatus(["wiki"]) },
  ];
}

function ProcessingPage() {
  const [query, setQuery] = useState<string>("");
  const router = useRouter();
  const searchParams = useSearchParams();

  // Canvas nodes (compact 5-node summary)
  const [nodes, setNodes] = useState<PipelineNode[]>(INITIAL_NODES);

  // 14-layer granular state
  const [layers, setLayers] = useState<PipelineLayer[]>(makeEmptyLayers());
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("pipeline");
  const [kpis, setKpis] = useState({ entities: 0, relationships: 0, graph_nodes: 0, trust_score: 0, ontology_consistency: 0 });
  const [snapshot, setSnapshot] = useState<PipelineSnapshot | null>(null);
  const [previews, setPreviews] = useState<PipelineSnapshot["previews"]>({});

  const [overallPct, setOverallPct] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [phase, setPhase] = useState<"ingest" | "orchestrator" | "done">("ingest");
  const [epochs, setEpochs] = useState<EpochEntry[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [stats, setStats] = useState({ files: 0, entities: 0, communities: 0, dupCount: 0, keptCount: 0 });
  const [topEntities, setTopEntities] = useState<string[]>([]);
  const [availableModels, setAvailableModels] = useState<{name:string;provider:string;is_available_locally:boolean}[]>([]);

  // Gate state
  const [gateStep, setGateStep] = useState<GateStep | null>(null);
  const [gateStats, setGateStats] = useState<Record<string, unknown>>({});
  const gateResolveRef = useRef<(() => void) | null>(null);
  const gatesShownRef = useRef<Set<string>>(new Set());

  // SLM Studio state
  const [showSLMStudio, setShowSLMStudio] = useState(false);
  const [slmStudioResolveRef] = useState(() => ({ current: null as ((cfg: SLMConfig | null) => void) | null }));

  // SLM approve modal
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [approving, setApproving] = useState(false);
  const [buildModelId, setBuildModelId] = useState<string | null>(null);
  const [slmRecord, setSlmRecord] = useState<{ val_loss?: number; hallucination_rate?: number } | null>(null);

  // Build AI phase state
  const [slmBuildStatus, setSlmBuildStatus] = useState<"idle"|"exists"|"queued"|"building"|"done"|"failed">("idle");
  const [slmStudioMode, setSlmStudioMode] = useState<"build"|"reconfigure"|"orchestrator">("build");
  const [slmExistsRecord, setSlmExistsRecord] = useState<{ model_id: string; domain_label: string; model_path?: string; val_loss?: number; ollama_model_name?: string } | null>(null);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const slmPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pipeline review gate — user must review layers before model selector
  const [pipelineReviewPending, setPipelineReviewPending] = useState(false);
  const deferredGraphDoneRef = useRef<{ entities: string[]; entityCount: number } | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const jobIdRef = useRef<string>("");

  const addLog = (msg: string) => setLog(prev => [...prev.slice(-80), msg]);

  const setNodeStatus = (id: string, status: NodeStatus, metric?: string) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, status, metric } : n));
  };

  const showGate = (step: GateStep, gateStatsData: Record<string, unknown>): Promise<void> => {
    return new Promise((resolve) => {
      setGateStep(step);
      setGateStats(gateStatsData);
      gateResolveRef.current = resolve;
    });
  };

  const fetchKpis = useCallback(async (jobId: string) => {
    const API = API_BASE;
    try {
      const res = await fetch(`${API}/api/v1/pipeline/${jobId}/kpis`);
      if (res.ok) {
        const data = await res.json();
        setKpis(data.kpis ?? kpis);
      }
    } catch { /* non-critical */ }
  }, []);

  // Map backend step data into PipelineLayer format
  const mapBackendSteps = useCallback((backendSteps: Record<string, unknown>[]): PipelineLayer[] => {
    return backendSteps.map(s => ({
      id: s.id as string,
      label: s.label as string,
      status: (s.status as PipelineLayer["status"]) ?? "pending",
      pct: (s.pct as number) ?? 0,
      detail: (s.detail as string) ?? "",
      started_at: (s.started_at as number | null) ?? null,
      completed_at: (s.completed_at as number | null) ?? null,
      error_code: (s.error_code as string | null) ?? null,
    }));
  }, []);

  // Extract KPI values from the layer detail JSON
  const extractKpisFromLayers = useCallback((pipelineLayers: PipelineLayer[]) => {
    const newKpis = { entities: 0, relationships: 0, graph_nodes: 0, trust_score: 0, ontology_consistency: 0 };
    for (const layer of pipelineLayers) {
      if (layer.status !== "done" || !layer.detail) continue;
      try {
        const d = JSON.parse(layer.detail);
        if (layer.id === "entities") {
          newKpis.entities = d.entity_count ?? 0;
          newKpis.relationships = d.relationship_count ?? 0;
        } else if (layer.id === "graph_build") {
          newKpis.graph_nodes = d.graph_nodes ?? 0;
        } else if (layer.id === "validation") {
          newKpis.trust_score = d.avg_trust_score ?? 0;
        } else if (layer.id === "ontology") {
          newKpis.ontology_consistency = d.ontology_violations ?? 0;
        }
      } catch { /* skip */ }
    }
    setKpis(newKpis);
  }, []);

  const formatPipelineLog = useCallback((entry: PipelineSnapshotLog): string => {
    const time = entry.ts ? new Date(entry.ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
    const pct = entry.overall_pct !== undefined ? ` ${entry.overall_pct}%` : "";
    const prefix = time ? `[${time}]` : `[${entry.status ?? "pipeline"}]`;
    return `${prefix}${pct} ${entry.message ?? entry.status ?? "Pipeline update"}`;
  }, []);

  const applySnapshot = useCallback((data: PipelineSnapshot, opts?: { reviewTerminal?: boolean }) => {
    const mappedLayers = mapBackendSteps(data.layers as unknown as Record<string, unknown>[]);
    const nextPreviews = data.previews ?? {};
    setSnapshot(data);
    setPreviews(nextPreviews);
    setLayers(mappedLayers);
    setNodes(mapLayersToCanvasNodes(mappedLayers));
    setKpis(data.kpis ?? { entities: 0, relationships: 0, graph_nodes: 0, trust_score: 0, ontology_consistency: 0 });
    setOverallPct(data.overall_pct ?? 0);
    setEtaSeconds(data.eta_seconds ?? null);
    setStats(p => ({
      ...p,
      files: data.file_count ?? p.files,
      entities: data.entity_count ?? data.kpis?.entities ?? p.entities,
      communities: data.community_count ?? p.communities,
    }));

    const entities = nextPreviews.entities ?? [];
    if (entities.length > 0) setTopEntities(entities);
    if (data.logs?.length) setLog(data.logs.map(formatPipelineLog).slice(-100));

    if (opts?.reviewTerminal && data.status === "graph_done") {
      deferredGraphDoneRef.current = {
        entities,
        entityCount: data.entity_count ?? data.kpis?.entities ?? 0,
      };
      setPipelineReviewPending(true);
      setPhase("ingest");
    }
  }, [formatPipelineLog, mapBackendSteps]);

  const fetchSnapshot = useCallback(async (API: string, jobId: string, opts?: { reviewTerminal?: boolean }) => {
    const res = await fetch(`${API}/api/v1/pipeline/${jobId}/snapshot`);
    if (!res.ok) throw new Error(`Snapshot HTTP ${res.status}`);
    const data = await res.json() as PipelineSnapshot;
    applySnapshot(data, opts);
    return data;
  }, [applySnapshot]);

  // Fetch available models on mount
  useEffect(() => {
    const API = API_BASE;
    fetch(`${API}/api/v1/models`)
      .then(r => r.json())
      .then(d => {
        const raw: {model_id?:string; name?:string; provider?:string; status?:string}[] = d.models ?? d ?? [];
        setAvailableModels(raw.map(m => ({
          name: m.name ?? m.model_id ?? "",
          provider: m.provider ?? "ollama",
          is_available_locally: m.status === "local",
        })));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const urlJobId = searchParams.get("job_id");
    const urlQuery = searchParams.get("query");
    const urlDomain = searchParams.get("domain_label");
    if (urlJobId && urlQuery) {
      sessionStorage.setItem("job_id", urlJobId);
      sessionStorage.setItem("query", urlQuery);
      if (urlDomain) sessionStorage.setItem("domain_label", urlDomain);
    }
    const sessionQuery = sessionStorage.getItem("query");
    setQuery(sessionQuery ?? "");
    const jobId = sessionStorage.getItem("job_id");
    const domainLabel = sessionStorage.getItem("domain_label") ?? "general";
    const reuseCorpus = sessionStorage.getItem("reuse_corpus") === "true";
    if (!jobId) { router.push("/"); return; }

    jobIdRef.current = jobId;
    const API = API_BASE;

    let disposed = false;
    let streamed = false;
    let streamEs: EventSource | null = null;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    let sseRetryCount = 0;
    const SSE_MAX_RETRIES = 5;

    const attachStream = () => {
      if (streamed || disposed) return;
      streamed = true;
      setNodeStatus("import", "running");
      addLog("Import pipeline started — streaming progress...");

      const connectSSE = () => {
        if (disposed) return;
        streamEs = new EventSource(`${API}/api/v1/data/progress/${jobId}`);
        esRef.current = streamEs;
        sseRetryCount = 0;

      refreshTimer = setInterval(() => {
        fetchSnapshot(API, jobId).catch(() => {});
      }, 5000);

      streamEs.onmessage = async (e) => {
        const ev = JSON.parse(e.data);
        setOverallPct(ev.overall_pct ?? 0);
        setEtaSeconds(ev.eta_seconds ?? null);
        if (ev.file_count) setStats(p => ({ ...p, files: ev.file_count }));
        if (ev.entity_count) setStats(p => ({ ...p, entities: ev.entity_count }));
        if (ev.community_count) setStats(p => ({ ...p, communities: ev.community_count }));

        const status = ev.status;
        if (ev.logs?.length) {
          setLog((ev.logs as PipelineSnapshotLog[]).map(formatPipelineLog).slice(-100));
        } else {
          addLog(`[${status}] ${ev.overall_pct ?? 0}%`);
        }

        if (ev.pipeline_steps?.steps?.length > 0) {
          const mappedLayers = mapBackendSteps(ev.pipeline_steps.steps);
          setLayers(mappedLayers);
          setNodes(mapLayersToCanvasNodes(mappedLayers));
          extractKpisFromLayers(mappedLayers);
        }

        if (ev.pipeline_steps?.steps) {
          const stepsData = ev.pipeline_steps.steps as Record<string, unknown>[];
          const uploadDone = stepsData.find(s => s.id === "upload" && s.status === "done");
          if (uploadDone && !gatesShownRef.current.has("upload_ach")) {
            gatesShownRef.current.add("upload_ach");
            fireAchievement("📥", "Data imported!", "Files uploaded and tracked");
          }
          const entitiesDone = stepsData.find(s => s.id === "entities" && s.status === "done");
          if (entitiesDone && !gatesShownRef.current.has("entities_ach")) {
            gatesShownRef.current.add("entities_ach");
            fireAchievement("🔍", "Entities extracted!", "NLP pipeline complete");
          }
          const graphDone = stepsData.find(s => s.id === "graph_build" && s.status === "done");
          if (graphDone && !gatesShownRef.current.has("graph_ach")) {
            gatesShownRef.current.add("graph_ach");
            fireAchievement("🕸️", "Knowledge graph built!", "Graph construction complete");
          }
        }

        if (status === "graph_done") {
          fireAchievement("🕸️", "Pipeline complete!", `${ev.entity_count ?? 0} entities — review all layers before continuing`);
          await fetchSnapshot(API, jobId, { reviewTerminal: true }).catch(() => {});
          streamEs?.close();
          if (refreshTimer) clearInterval(refreshTimer);
          addLog("Pipeline complete — review all layers, then confirm to continue.");
        } else if (status === "failed") {
          await fetchSnapshot(API, jobId, { reviewTerminal: true }).catch(() => {});
          addLog(`Pipeline failed: ${ev.error ?? ""}`);
          streamEs?.close();
          if (refreshTimer) clearInterval(refreshTimer);
        }
      };

        streamEs.onerror = () => {
          streamEs?.close();
          if (disposed) return;
          sseRetryCount++;
          if (sseRetryCount > SSE_MAX_RETRIES) {
            addLog("SSE connection lost — max retries reached. Use the browser refresh to retry.");
            return;
          }
          const delay = Math.min(1000 * Math.pow(2, sseRetryCount - 1), 15000);
          addLog(`SSE connection lost — reconnecting in ${Math.round(delay / 1000)}s (attempt ${sseRetryCount}/${SSE_MAX_RETRIES})...`);
          setTimeout(connectSSE, delay);
        };
      };

      connectSSE();

    const bootstrap = async () => {
      try {
        const snap = await fetchSnapshot(API, jobId, { reviewTerminal: !reuseCorpus });
        if (disposed) return;

        if (reuseCorpus) {
          const q = sessionStorage.getItem("query");
          if (!q) { router.push("/query"); return; }
          setNodes(RESULT_NODES.map(n => n.id === "ai" ? { ...n, status: "running" as NodeStatus } : n));
          setPhase("orchestrator");
          addLog("Reusing existing knowledge base — starting AI model selection...");
          startOrchestrator(API, q, domainLabel);
          return;
        }

        if (snap.terminal) {
          addLog(snap.status === "graph_done"
            ? "Pipeline loaded from completed snapshot — review all layers, then confirm to continue."
            : `Pipeline loaded with status ${snap.status}.`);
          return;
        }

        attachStream();
      } catch (err: unknown) {
        addLog(err instanceof Error ? `Snapshot load failed: ${err.message}` : "Snapshot load failed");
        if (!reuseCorpus) attachStream();
      }
    };

    bootstrap();

    return () => {
      disposed = true;
      if (refreshTimer) clearInterval(refreshTimer);
      streamEs?.close();
      esRef.current?.close();
    };

    if (reuseCorpus) {
      const q = sessionStorage.getItem("query");
      if (!q) { router.push("/query"); return; }
      setNodes(RESULT_NODES.map(n => n.id === "ai" ? { ...n, status: "running" as NodeStatus } : n));
      setLayers(makeEmptyLayers().map(l => ({ ...l, status: "done", pct: 100 })));
      setOverallPct(100);
      setPhase("orchestrator");
      addLog("Reusing existing knowledge base — starting AI model selection…");
      fetchKpis(jobId);
      startOrchestrator(API, q, domainLabel);
      return;
    }

    setNodeStatus("import", "running");
    addLog("Import pipeline started — streaming progress…");

    const es = new EventSource(`${API}/api/v1/data/progress/${jobId}`);
    esRef.current = es;

    es.onmessage = async (e) => {
      const ev = JSON.parse(e.data);
      setOverallPct(ev.overall_pct ?? 0);
      setEtaSeconds(ev.eta_seconds ?? null);
      if (ev.file_count)      setStats(p => ({ ...p, files: ev.file_count }));
      if (ev.entity_count)    setStats(p => ({ ...p, entities: ev.entity_count }));
      if (ev.community_count) setStats(p => ({ ...p, communities: ev.community_count }));

      const status = ev.status;
      addLog(`[${status}] ${ev.overall_pct ?? 0}%`);

      // Consume granular ev.steps[] array from SSE
      if (ev.pipeline_steps?.steps && ev.pipeline_steps.steps.length > 0) {
        const mappedLayers = mapBackendSteps(ev.pipeline_steps.steps);
        setLayers(mappedLayers);
        setNodes(mapLayersToCanvasNodes(mappedLayers));
        extractKpisFromLayers(mappedLayers);
      } else {
        // Fallback: drive canvas from current_step (backwards compat)
        const currentStep = ev.current_step ?? 0;
        if (status === "ingesting") {
          if (currentStep === 0) {
            setNodeStatus("import", "running", `${ev.file_count ?? 0} docs`);
          } else if (currentStep === 1) {
            if (!gatesShownRef.current.has("import")) {
              gatesShownRef.current.add("import");
              setNodeStatus("import", "done", `${ev.file_count ?? 0} docs`);
              fireAchievement("📥", "Data imported!", `${ev.file_count ?? 0} documents loaded`);
            }
            setNodeStatus("clean", "running");
          } else if (currentStep === 2 || currentStep === 3) {
            setNodeStatus("import", "done", `${ev.file_count ?? 0} docs`);
            if (!gatesShownRef.current.has("clean")) {
              gatesShownRef.current.add("clean");
              fireAchievement("🧹", "Cleaning complete!", "Chunks extracted and deduplicated");
            }
            setNodeStatus("clean", "done");
            setNodeStatus("quality", "running");
          } else if (currentStep >= 4) {
            setNodeStatus("import", "done", `${ev.file_count ?? 0} docs`);
            setNodeStatus("clean", "done");
            if (!gatesShownRef.current.has("quality")) {
              gatesShownRef.current.add("quality");
              fireAchievement("📊", "Readiness check done!", "Documents scored and filtered");
            }
            setNodeStatus("quality", "done");
            setNodeStatus("graph", "running");
          }
        }
      }

      // Achievements tied to specific layers completing
      if (ev.pipeline_steps?.steps) {
        const stepsData = ev.pipeline_steps.steps as Record<string, unknown>[];
        const uploadDone = stepsData.find((s: Record<string, unknown>) => s.id === "upload" && s.status === "done");
        if (uploadDone && !gatesShownRef.current.has("upload_ach")) {
          gatesShownRef.current.add("upload_ach");
          fireAchievement("📥", "Data imported!", `Files uploaded and tracked`);
        }
        const entitiesDone = stepsData.find((s: Record<string, unknown>) => s.id === "entities" && s.status === "done");
        if (entitiesDone && !gatesShownRef.current.has("entities_ach")) {
          gatesShownRef.current.add("entities_ach");
          fireAchievement("🔍", "Entities extracted!", "NLP pipeline complete");
        }
        const graphDone = stepsData.find((s: Record<string, unknown>) => s.id === "graph_build" && s.status === "done");
        if (graphDone && !gatesShownRef.current.has("graph_ach")) {
          gatesShownRef.current.add("graph_ach");
          fireAchievement("🕸️", "Knowledge graph built!", "Graph construction complete");
        }
      }

      // "graph_done" — pipeline complete, enter review mode
      if (status === "graph_done") {
        let entities: string[] = ev.top_entities ?? [];
        if (entities.length === 0) {
          try {
            const previewRes = await fetch(`${API}/api/v1/pipeline/${jobId}/entities/preview?limit=20`);
            if (previewRes.ok) {
              const preview = await previewRes.json();
              entities = preview.entities ?? [];
            }
          } catch { /* preview is non-critical */ }
        }
        setTopEntities(entities);
        setStats(p => ({ ...p, entities: ev.entity_count ?? p.entities, communities: ev.community_count ?? p.communities }));
        fireAchievement("🕸️", "Pipeline complete!", `${ev.entity_count ?? 0} entities — review all layers before continuing`);

        fetchKpis(jobId);
        es.close();

        deferredGraphDoneRef.current = { entities, entityCount: ev.entity_count ?? 0 };
        setPipelineReviewPending(true);
        addLog("Pipeline complete — review all layers, then confirm to continue.");
      } else if (status === "failed") {
        addLog(`❌ Pipeline failed: ${ev.error ?? ""}`);
        es.close();
      }
    };

    es.onerror = () => { addLog("⚠ SSE connection lost — retrying…"); };
    return () => { es.close(); esRef.current?.close(); };
  }, []);

  const confirmPipelineReview = async () => {
    setPipelineReviewPending(false);
    const deferred = deferredGraphDoneRef.current;
    if (!deferred) return;

    const jobId = jobIdRef.current;
    const API = API_BASE;

    setNodeStatus("graph", "waiting-approval");
    await showGate("graph", { entityCount: deferred.entityCount, topEntities: deferred.entities });
    setNodeStatus("graph", "done", `${deferred.entityCount} entities`);

    addLog("Knowledge graph confirmed — checking for existing custom AI…");
    setNodeStatus("build-ai", "running", "checking…");

    try {
      const forCorpusRes = await fetch(`${API}/api/v1/slm/for-corpus?job_id=${jobId}`);
      const forCorpus = await forCorpusRes.json();

      setSlmExistsRecord(forCorpus.exists ? forCorpus : null);
      setNodeStatus("build-ai", "waiting-approval");
      setShowModelSelector(true);
      addLog(forCorpus.exists
        ? `ℹ️ Custom AI found: ${forCorpus.model_id}`
        : "No Custom AI yet — configure your AI in the builder…");
    } catch {
      setSlmExistsRecord(null);
      setNodeStatus("build-ai", "waiting-approval");
      setShowModelSelector(true);
    }
  };

  const startSlmBuildPolling = (API: string, domainLabel: string, taskId: string | null, navigateAfter: boolean) => {
    if (slmPollRef.current) clearInterval(slmPollRef.current);
    slmPollRef.current = setInterval(async () => {
      try {
        const params = new URLSearchParams({ domain_label: domainLabel });
        if (taskId) params.set("task_id", taskId);
        const res = await fetch(`${API}/api/v1/slm/status?${params}`);
        const data = await res.json();
        if (data.status === "done") {
          clearInterval(slmPollRef.current!); slmPollRef.current = null;
          setSlmBuildStatus("done");
          setNodeStatus("build-ai", "done", "AI ready");
          addLog(`✓ Custom AI built: ${data.model_id}`);
          fireAchievement("🧠", "Custom AI ready!", "Your domain AI is built and ready");
          if (navigateAfter) router.push("/query");
        } else if (data.status === "failed") {
          clearInterval(slmPollRef.current!); slmPollRef.current = null;
          setSlmBuildStatus("failed");
          setNodeStatus("build-ai", "done", "used fallback");
          if (navigateAfter) router.push("/query");
        }
      } catch { /* keep polling */ }
    }, 5000);
  };

  const triggerSlmBuild = async (cfg: SLMConfig, quickRebuild: boolean) => {
    const API = API_BASE;
    const jobId = sessionStorage.getItem("job_id") ?? "";
    const domainLabel = sessionStorage.getItem("domain_label") ?? "general";
    setSlmBuildStatus("queued");
    setNodeStatus("build-ai", "running", "building…");
    try {
      const res = await fetch(`${API}/api/v1/slm/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain_label: domainLabel,
          coverage_topics: topEntities.slice(0, 10),
          corpus_hash: jobId,
          quick_rebuild: quickRebuild,
          teacher_model: cfg.teacher_model,
          advisor_model: cfg.advisor_model,
          student_model: cfg.student_model === "" ? undefined : cfg.student_model,
          lora_r: cfg.lora_r,
          num_epochs: cfg.num_epochs,
          learning_rate: cfg.learning_rate,
          qa_pairs_target: cfg.qa_pairs_target,
          curriculum_stages: cfg.curriculum_stages,
        }),
      });
      const data = await res.json();
      const label = quickRebuild ? "Quick rebuild" : "SLM build";
      addLog(`🧠 ${label} queued — task ${data.task_id ?? "(bg)"}`);
      startSlmBuildPolling(API, domainLabel, data.task_id ?? null, true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      addLog(`⚠ SLM build failed: ${msg}`);
      setSlmBuildStatus("failed");
      setNodeStatus("build-ai", "done", "failed");
      router.push("/query");
    }
  };

  const startOrchestrator = async (API: string, orchestratorQuery: string, domainLabel: string) => {
    const systemPrompt = sessionStorage.getItem("system_prompt") ?? "";
    const modelOverrides = (() => {
      try { return JSON.parse(sessionStorage.getItem("orch_model_overrides") ?? "null"); } catch { return null; }
    })();
    try {
      const body: Record<string, unknown> = {
        query: orchestratorQuery,
        domain_label: domainLabel,
        job_id: sessionStorage.getItem("job_id"),
        system_prompt: systemPrompt,
      };
      if (modelOverrides) body.model_overrides = modelOverrides;

      const res = await fetch(`${API}/api/v1/orchestrator/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.body) { addLog("⚠ No SSE body from orchestrator"); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try { await handleOrchestratorEvent(JSON.parse(line.slice(6))); } catch { /* skip */ }
          }
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      addLog(`⚠ Orchestrator error: ${msg}`);
    }
  };

  const handleOrchestratorEvent = async (event: Record<string, unknown>) => {
    addLog(`[${event.type ?? event.phase}] ${JSON.stringify(event).slice(0, 120)}`);

    if (event.type === "model_context") {
      sessionStorage.setItem("orch_model_context", JSON.stringify(event.data));
    }
    if (event.type === "warning") {
      try {
        const existing = JSON.parse(sessionStorage.getItem("orch_warnings") || "[]");
        existing.push(event.message ?? event.code ?? "unknown warning");
        sessionStorage.setItem("orch_warnings", JSON.stringify(existing));
      } catch { /**/ }
    }

    if (event.phase === "slm_build") {
      if (event.type === "step" && event.step === 3 && event.val_loss !== undefined) {
        setEpochs(prev => [...prev, { epoch: prev.length + 1, loss: event.val_loss as number }]);
      }
      if (event.type === "done") {
        setBuildModelId(event.model_id as string);
        setSlmRecord({ val_loss: event.val_loss as number, hallucination_rate: event.hallucination_rate as number });
        setShowApproveModal(true);
        fireAchievement("🧠", "Your Custom AI is ready!", `Model ${event.model_id ?? ""} trained and awaiting deployment`);
      }
    }

    if (event.type === "step" || event.type === "progress") {
      if (event.step === 4 || event.phase === "recommend") {
        setNodeStatus("ai", "running", "scoring models…");
      }
      if (event.step === 5 || event.phase === "execute") {
        setNodeStatus("ai", "done");
        setNodeStatus("answer", "running");
      }
    }

    if (event.type === "output") {
      setNodeStatus("ai", "done");
      setNodeStatus("answer", "done");
      setPhase("done");
      setOverallPct(100);
      fireAchievement("✨", "Answer ready!", "Your AI has generated a response — tap Results to view");

      const outputData = event.data as Record<string, unknown>;
      sessionStorage.setItem("orchestrator_output", JSON.stringify(outputData));
      const currentJobId = sessionStorage.getItem("job_id") ?? "";
      const currentQuery = sessionStorage.getItem("query") ?? "";
      const currentDomain = sessionStorage.getItem("domain_label") ?? "general";
      const sessionRecord = {
        job_id: currentJobId, query: currentQuery, domain_label: currentDomain,
        timestamp: new Date().toISOString(),
        slm_model_id: outputData.slm_model_id ?? null,
        final_answer: outputData.final_answer ?? "",
        intent: outputData.intent ?? "",
        coverage_action: outputData.coverage_action ?? "",
        hallucination_rate: outputData.hallucination_rate ?? 0,
        output: outputData,
      };
      try {
        const existing = JSON.parse(localStorage.getItem("orch_sessions") ?? "[]");
        const filtered = existing.filter((s: Record<string, unknown>) => s.job_id !== currentJobId);
        localStorage.setItem("orch_sessions", JSON.stringify([sessionRecord, ...filtered].slice(0, 20)));
      } catch { /**/ }

      router.push("/planning");
    }
  };

  const approveInstall = async () => {
    if (!buildModelId) return;
    setApproving(true);
    const API = API_BASE;
    try {
      await fetch(`${API}/api/v1/slm/approve-install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_id: buildModelId }),
      });
      fireAchievement("🚀", "AI deployed!", `${buildModelId} is now live in your system`);
      setShowApproveModal(false);
    } finally {
      setApproving(false);
    }
  };

  // Filter layers based on active tab
  const filteredLayers = activeTab === "pipeline" || activeTab === "overview"
    ? layers
    : layers.filter(l => (TAB_LAYER_MAP[activeTab] ?? []).includes(l.id));

  const activeLayer = activeLayerId ? layers.find(l => l.id === activeLayerId) ?? null : null;
  const activeInitialArtifacts = activeLayer?.id === "eda"
    ? previews.eda
    : activeLayer?.id === "graph_build"
      ? previews.kg
      : activeLayer?.id === "wiki"
        ? previews.wiki
        : undefined;

  return (
    <div>
      {/* Modals */}
      {gateStep && (
        <ApprovalGate
          step={gateStep}
          stats={gateStats as Record<string, unknown>}
          onProceed={(cfg) => {
            if (cfg) {
              try {
                const existing = JSON.parse(sessionStorage.getItem("orch_pipeline_config") ?? "{}");
                sessionStorage.setItem("orch_pipeline_config", JSON.stringify({ ...existing, ...cfg }));
              } catch { /**/ }
            }
            setGateStep(null);
            gateResolveRef.current?.();
            gateResolveRef.current = null;
          }}
          onSkip={() => {
            setGateStep(null);
            gateResolveRef.current?.();
            gateResolveRef.current = null;
          }}
        />
      )}

      {showModelSelector && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6">
          <div className="bg-card border border-dborder rounded-2xl overflow-hidden max-w-md w-full shadow-2xl">
            <div className="px-6 pt-6 pb-4 border-b border-dborder">
              <div className="text-[10px] font-bold uppercase tracking-widest text-t3 mb-0.5">Step 2 · Build AI</div>
              <div className="text-[16px] font-semibold text-t1 font-sora">
                {slmExistsRecord ? "Your AI model is ready" : "Build your custom AI"}
              </div>
              <div className="text-[11px] text-t3 mt-1">
                {slmExistsRecord
                  ? "A domain-specific AI was already trained for this corpus. Use it or configure a new one."
                  : "Train a small AI model on your corpus using knowledge distillation — no cloud required."}
              </div>
            </div>
            <div className="px-6 py-5">
              {slmExistsRecord ? (
                <div className="bg-bg3 border border-dborder rounded-xl p-4 mb-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/25 flex items-center justify-center text-lg flex-shrink-0">🧠</div>
                    <div className="min-w-0">
                      <div className="text-[12px] font-semibold text-t1">{slmExistsRecord.domain_label}</div>
                      <div className="text-[10px] font-mono text-t3 truncate">{slmExistsRecord.model_id}</div>
                    </div>
                    <span className="ml-auto text-[9px] px-2 py-0.5 bg-gg/10 text-gg border border-gg/20 rounded font-semibold flex-shrink-0">Ready</span>
                  </div>
                  {slmExistsRecord.val_loss !== undefined && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-center bg-card border border-dborder rounded-lg p-2">
                        <div className="text-[14px] font-bold text-gg">{((1 - Math.min(slmExistsRecord.val_loss, 1)) * 100).toFixed(0)}%</div>
                        <div className="text-[9px] text-t3 uppercase tracking-wider">Accuracy</div>
                      </div>
                      <div className="text-center bg-card border border-dborder rounded-lg p-2">
                        <div className="text-[14px] font-bold text-accent">{slmExistsRecord.val_loss.toFixed(3)}</div>
                        <div className="text-[9px] text-t3 uppercase tracking-wider">Val Loss</div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-accent/5 border border-accent/20 rounded-xl p-4 mb-4">
                  <div className="flex gap-3">
                    <span className="text-2xl flex-shrink-0">🧠</span>
                    <div>
                      <div className="text-[12px] font-semibold text-t1 mb-1">Train a domain expert AI</div>
                      <div className="text-[11px] text-t2 leading-relaxed">
                        Your documents will be used to generate Q&amp;A pairs via knowledge distillation. A small model (SmolLM2 or Qwen2.5) is then fine-tuned on those pairs and deployed locally.
                      </div>
                      <div className="mt-2 flex gap-3 text-[10px] text-t3">
                        <span>⏱ 15–60 min</span>
                        <span>💾 Runs locally</span>
                        <span>🔒 No cloud</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {slmExistsRecord ? (
                  <>
                    <button
                      onClick={() => {
                        setShowModelSelector(false);
                        setSlmBuildStatus("exists");
                        setNodeStatus("build-ai", "done", "AI ready");
                        sessionStorage.setItem("selected_model_id", slmExistsRecord!.model_id);
                        addLog(`✓ Using existing AI: ${slmExistsRecord!.model_id}`);
                        fireAchievement("🧠", "Custom AI ready!", `Using ${slmExistsRecord!.model_id}`);
                        router.push("/query");
                      }}
                      className="w-full btn btn-p py-3 text-[13px] font-semibold"
                    >
                      ✓ Use this AI →
                    </button>
                    <button
                      onClick={() => {
                        setShowModelSelector(false);
                        setSlmStudioMode("reconfigure");
                        setShowSLMStudio(true);
                        addLog("Opening AI Builder to reconfigure…");
                      }}
                      className="w-full btn py-2.5 text-[12px] border border-dborder2 text-t2 hover:border-accent/40"
                    >
                      ⚙ Reconfigure &amp; Build New
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => {
                        setShowModelSelector(false);
                        setSlmStudioMode("build");
                        setShowSLMStudio(true);
                        addLog("Opening AI Builder…");
                      }}
                      className="w-full btn btn-p py-3 text-[13px] font-semibold"
                    >
                      🧠 Build Your AI →
                    </button>
                    <button
                      onClick={() => {
                        setShowModelSelector(false);
                        setNodeStatus("build-ai", "done", "skipped");
                        addLog("AI build skipped — proceeding to Query Builder…");
                        router.push("/query");
                      }}
                      className="w-full btn py-2.5 text-[12px] border border-dborder2 text-t3 hover:border-t2"
                    >
                      Skip for now
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showSLMStudio && (
        slmStudioMode === "orchestrator" ? (
          <SLMStudio
            availableModels={availableModels}
            onStart={(cfg) => { slmStudioResolveRef.current?.(cfg); }}
            onSkip={() => { slmStudioResolveRef.current?.(null); }}
          />
        ) : (
          <SLMStudio
            availableModels={availableModels}
            onStart={(cfg) => { setShowSLMStudio(false); triggerSlmBuild(cfg, slmStudioMode === "reconfigure"); }}
            onSkip={() => {
              setShowSLMStudio(false);
              setNodeStatus("build-ai", "done", "skipped");
              addLog("SLM Studio skipped — proceeding to Query Builder…");
              router.push("/query");
            }}
          />
        )
      )}

      <AchievementToast />

      {/* Page header */}
      <div className="bg-card border-b border-dborder px-0 py-7 mb-7">
        <div className="w-full px-8">
          <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-t3 mb-1.5 flex items-center gap-2">
            <span className="inline-block w-4 h-px bg-accent" />
            Step 2 · Pipeline
          </div>
          <div className="font-sora text-2xl font-semibold text-t1">Building Your AI</div>
          <div className="text-[12px] text-t2 mt-1">
            {etaSeconds !== null && phase === "ingest" ? formatEta(etaSeconds) : "Pipeline running — review each step as it completes"}
          </div>
        </div>
      </div>

      <div className="w-full px-8">

        {/* Compact pipeline canvas (5-node summary) */}
        <div className="bg-white border border-dborder rounded-2xl mb-6 overflow-hidden">
          <PipelineCanvas
            nodes={nodes}
            onNodeClick={(node) => {
              addLog(`Clicked node: ${node.id}`);
            }}
          />
        </div>

        {/* Tab navigation */}
        <div className="flex items-center gap-0.5 mb-5 overflow-x-auto border-b border-dborder pb-px">
          {PIPELINE_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setActiveLayerId(null);

                // Auto-open detail for single-layer tabs
                const tabLayers = TAB_LAYER_MAP[tab.id] ?? [];
                if (tabLayers.length === 1) {
                  const targetLayer = layers.find(l => l.id === tabLayers[0]);
                  if (targetLayer && targetLayer.status !== "pending") {
                    setActiveLayerId(targetLayer.id);
                  }
                }
              }}
              className={`
                px-3 py-2 text-[11px] font-medium whitespace-nowrap transition-all duration-150 border-b-2 -mb-px
                ${activeTab === tab.id
                  ? "border-accent text-accent"
                  : "border-transparent text-t3 hover:text-t2 hover:border-dborder"
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Main content: layer list + detail panel */}
        <div className={`flex gap-6 ${activeLayer ? "flex-col lg:flex-row" : ""}`}>
          {/* Left: Layer list */}
          <div className={activeLayer ? "w-full lg:w-1/2" : "w-full"}>
            <PipelineLayerList
              layers={filteredLayers}
              kpis={kpis}
              activeLayerId={activeLayerId}
              jobId={jobIdRef.current}
              onLayerClick={(layer) => {
                setActiveLayerId(activeLayerId === layer.id ? null : layer.id);
              }}
              reviewPending={pipelineReviewPending}
              onConfirmReview={confirmPipelineReview}
            />
          </div>

          {/* Right: Detail panel */}
          {activeLayer && (
            <div className="w-full lg:w-1/2">
              <LayerDetailPanel
                layer={activeLayer}
                jobId={jobIdRef.current}
                initialArtifacts={activeInitialArtifacts}
                onClose={() => setActiveLayerId(null)}
              />
            </div>
          )}
        </div>

        {/* Build AI progress */}
        {(slmBuildStatus === "queued" || slmBuildStatus === "building") && (
          <div className="card mb-6 mt-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse flex-shrink-0" />
              <div>
                <div className="text-[12px] font-semibold text-t1">Building your Custom AI…</div>
                <div className="text-[10px] text-t3 mt-0.5">Training may take 10–60 min. You&apos;ll be taken to the Query Builder when done.</div>
              </div>
            </div>
            <button
              onClick={() => { if (slmPollRef.current) clearInterval(slmPollRef.current); router.push("/query"); }}
              className="btn btn-sm text-t3 flex-shrink-0"
            >Skip to Query Builder →</button>
          </div>
        )}
        {slmBuildStatus === "done" && (
          <div className="card mb-6 mt-6 flex items-center gap-2">
            <span>🧠</span>
            <div className="text-[12px] text-t1">Custom AI ready — redirecting to Query Builder…</div>
          </div>
        )}
        {slmBuildStatus === "failed" && (
          <div className="card mb-6 mt-6 flex items-center gap-2">
            <span>⚠️</span>
            <div className="text-[12px] text-t2">AI build failed — you can still use the Query Builder with a general model.</div>
          </div>
        )}

        {/* Epoch loss chart */}
        {epochs.length > 0 && (
          <div className="card mb-6">
            <div className="sect">Training Loss</div>
            <div className="flex items-end gap-1 h-20">
              {epochs.map((e, i) => (
                <div key={i} className="flex flex-col items-center flex-1">
                  <div className="w-full bg-accent rounded-sm"
                    style={{ height: `${Math.max(4, (1 - Math.min(e.loss / 3, 1)) * 60)}px` }} />
                  <span className="text-[9px] text-t3 mt-1">{e.epoch}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Live log */}
        <div className="mb-8">
          <div className="sect">Live log</div>
          <div className="bg-bg rounded-sm border border-dborder p-3 max-h-48 overflow-auto">
            {log.map((l, i) => (
              <p key={i} className="text-[11px] text-t3 font-mono leading-relaxed">{l}</p>
            ))}
            {log.length === 0 && (
              <div className="thinking-bar">
                <span className="w-1.5 h-1.5 rounded-full bg-purple animate-blink" />
                Waiting for events…
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI Ready to Deploy modal */}
      {showApproveModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-dborder rounded-2xl p-7 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gg/10 border border-gg/30 flex items-center justify-center text-xl">🧠</div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-t3">Custom AI Ready</div>
                <div className="font-sora text-[16px] font-bold text-t1">Your Custom AI is Ready</div>
              </div>
            </div>
            <div className="bg-bg3 rounded-xl p-4 mb-4 space-y-2">
              <div className="flex justify-between text-[12px]">
                <span className="text-t3">Model</span>
                <span className="font-semibold text-t1 font-mono text-[11px]">{buildModelId}</span>
              </div>
              {slmRecord?.val_loss !== undefined && (
                <div className="flex justify-between text-[12px]">
                  <span className="text-t3">Training quality</span>
                  <span className="font-semibold text-gg">{slmRecord.val_loss.toFixed(3)}</span>
                </div>
              )}
              {slmRecord?.hallucination_rate !== undefined && (
                <div className="flex justify-between text-[12px]">
                  <span className="text-t3">Accuracy score</span>
                  <span className="font-semibold text-gg">{((1 - slmRecord.hallucination_rate) * 100).toFixed(1)}%</span>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={approveInstall} disabled={approving}
                className="btn btn-p flex-1 disabled:opacity-50">
                {approving ? "Deploying…" : "🚀 Deploy to My System"}
              </button>
              <button onClick={() => setShowApproveModal(false)} className="btn px-5">
                Not Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg flex items-center justify-center text-t2 text-sm">Loading…</div>}>
      <ProcessingPage />
    </Suspense>
  );
}
