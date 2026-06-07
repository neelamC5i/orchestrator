"use client";

import { useEffect, useState, useCallback } from "react";
import { API_BASE as API, apiFetch } from "../lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Corpus { job_id: string; domain_label?: string; entity_count?: number; file_count?: number; }
interface GraphNode { id: string; label: string; type: string; count: number; community?: number; is_event_trigger?: boolean; }
interface GraphEdge { source: string; target: string; weight?: number; }
interface Graph { nodes: GraphNode[]; edges: GraphEdge[]; node_count: number; edge_count: number; }
interface Scorecard { confidence_score?: number; graph_trust_score?: number; semantic_coherence_score?: number; canonical_resolution_score?: number; completeness_score?: number; extraction_reliability_score?: number; [k: string]: unknown; }
interface GraphMetrics { node_count?: number; edge_count?: number; active_edge_count?: number; high_risk_edge_ratio?: number; contradiction_ratio?: number; edge_confidence_distribution?: { low: number; medium: number; high: number }; stats?: { density?: number; avg_degree?: number }; }
interface RegistryMetrics { canonical_node_count?: number; total_alias_count?: number; pending_review_count?: number; resolved_review_count?: number; entity_types?: string[]; }

// ── Force-directed graph layout ───────────────────────────────────────────────
function stableHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
function ellipsis(t: string, max = 18): string { return t.length > max ? t.slice(0, max - 1) + "…" : t; }

function nodeColor(type: string): string {
  const t = (type || "").toUpperCase();
  if (t === "ORG") return "#7c3aed";
  if (t === "PERSON") return "#d97706";
  if (t === "GPE" || t === "LOC") return "#0d9488";
  if (t === "EVENT") return "#ef4444";
  return "#2563eb";
}

interface PlacedNode extends GraphNode { x: number; y: number; vx: number; vy: number; r: number; labelShort: string; }

function buildLayout(graph: Graph, maxNodes = 80): { width: number; height: number; nodes: PlacedNode[]; edges: GraphEdge[]; pos: Record<string, PlacedNode> } {
  const W = 960, H = 520, PAD = 40;
  const cx = W / 2, cy = H / 2;

  const degree: Record<string, number> = {};
  graph.nodes.forEach((n) => { degree[n.id] = 0; });
  graph.edges.forEach((e) => { if (degree[e.source] != null) degree[e.source]++; if (degree[e.target] != null) degree[e.target]++; });

  const ranked = [...graph.nodes].sort((a, b) => (degree[b.id] || 0) - (degree[a.id] || 0));
  const picked = ranked.slice(0, maxNodes);
  const ids = new Set(picked.map((n) => n.id));
  const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).slice(0, 200);

  const adj: Record<string, Set<string>> = {};
  picked.forEach((n) => { adj[n.id] = new Set(); });
  edges.forEach((e) => { adj[e.source]?.add(e.target); adj[e.target]?.add(e.source); });

  const seeded: PlacedNode[] = picked.map((n) => {
    const h = stableHash(n.id);
    const a = (h % 360) * (Math.PI / 180);
    const r = 60 + (h % 200);
    return { ...n, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, vx: 0, vy: 0, r: 0, labelShort: "" };
  });

  const byId: Record<string, PlacedNode> = {};
  seeded.forEach((n) => { byId[n.id] = n; });

  const ITER = 140, REP = 3800, K = 0.02, RL = 88, GRAV = 0.003, DAMP = 0.85;
  for (let it = 0; it < ITER; it++) {
    for (let i = 0; i < seeded.length; i++) {
      const a = seeded[i];
      for (let j = i + 1; j < seeded.length; j++) {
        const b = seeded[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = Math.max(25, dx * dx + dy * dy);
        const d = Math.sqrt(d2);
        const f = REP / d2;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
      }
    }
    edges.forEach((e) => {
      const s = byId[e.source], t = byId[e.target];
      if (!s || !t) return;
      const dx = t.x - s.x, dy = t.y - s.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = K * (d - RL);
      const fx = (dx / d) * f, fy = (dy / d) * f;
      s.vx += fx; s.vy += fy; t.vx -= fx; t.vy -= fy;
    });
    seeded.forEach((n) => {
      n.vx += (cx - n.x) * GRAV; n.vy += (cy - n.y) * GRAV;
      n.vx *= DAMP; n.vy *= DAMP;
      n.x = Math.max(PAD, Math.min(W - PAD, n.x + n.vx));
      n.y = Math.max(PAD, Math.min(H - PAD, n.y + n.vy));
    });
  }

  const maxDeg = Math.max(1, ...picked.map((n) => degree[n.id] || 0));
  seeded.forEach((n) => {
    n.r = 4 + Math.round(((degree[n.id] || 0) / maxDeg) * 9);
    n.labelShort = ellipsis(n.label || "");
    byId[n.id] = n;
  });

  return { width: W, height: H, nodes: seeded, edges, pos: byId };
}

// ── ScoreBar ──────────────────────────────────────────────────────────────────
function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? "#16a34a" : pct >= 45 ? "#d97706" : "#e11d48";
  return (
    <div className="mb-3">
      <div className="flex justify-between text-[11px] text-t2 mb-1"><span>{label}</span><span style={{ color }}>{pct}%</span></div>
      <div className="prog-bar"><div className="prog-fill" style={{ width: `${pct}%`, background: color }} /></div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function QualityPage() {
  const [corpora, setCorpora] = useState<Corpus[]>([]);
  const [selectedJob, setSelectedJob] = useState("");
  const [graph, setGraph] = useState<Graph | null>(null);
  const [graphMetrics, setGraphMetrics] = useState<GraphMetrics | null>(null);
  const [registryMetrics, setRegistryMetrics] = useState<RegistryMetrics | null>(null);
  const [scorecards, setScorecards] = useState<Array<{ file_id: string; scorecard: Scorecard }>>([]);
  const [tab, setTab] = useState<"graph" | "stats" | "entities" | "quality">("graph");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<PlacedNode | null>(null);

  useEffect(() => {
    apiFetch(`${API}/api/v1/data/corpora`)
      .then((r) => r.json())
      .then((d) => {
        const list: Corpus[] = Array.isArray(d) ? d : d.corpora ?? [];
        setCorpora(list);
        if (list.length > 0) setSelectedJob(list[0].job_id);
        try { localStorage.setItem("orch_corpora", JSON.stringify(list)); } catch { /**/ }
      })
      .catch(() => {});
  }, []);

  const loadData = useCallback(() => {
    if (!selectedJob) return;
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch(`${API}/api/v1/data/graph/${selectedJob}`).then((r) => r.ok ? r.json() : null),
      apiFetch(`${API}/api/v1/quality/${selectedJob}/metrics`).then((r) => r.ok ? r.json() : null),
    ])
      .then(([graphData, qualityData]) => {
        if (graphData) setGraph(graphData);
        if (qualityData) {
          setGraphMetrics(qualityData.graph_metrics ?? null);
          setRegistryMetrics(qualityData.registry_metrics ?? null);
          setScorecards(qualityData.file_scorecards ?? []);
        }
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [selectedJob]);

  useEffect(() => { loadData(); }, [loadData]);

  // Averaged scorecard
  const avgScorecard: Scorecard = {};
  if (scorecards.length > 0) {
    const keys: (keyof Scorecard)[] = ["confidence_score", "graph_trust_score", "semantic_coherence_score", "canonical_resolution_score", "completeness_score", "extraction_reliability_score"];
    for (const k of keys) {
      const vals = scorecards.map((s) => Number(s.scorecard?.[k] ?? 0));
      avgScorecard[k] = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
  }

  // Build graph layout
  const layout = graph && graph.nodes.length > 0 ? buildLayout(graph) : null;

  // Entity type breakdown from graph
  const typeCounts: Record<string, number> = {};
  (graph?.nodes ?? []).forEach((n) => { const t = n.type || "ENTITY"; typeCounts[t] = (typeCounts[t] || 0) + 1; });
  const typeTotal = Object.values(typeCounts).reduce((a, b) => a + b, 0) || 1;

  const density = graph && graph.node_count > 1
    ? (graph.edge_count / (graph.node_count * (graph.node_count - 1))).toFixed(4)
    : "—";

  // Community breakdown
  const commCounts: Record<number, number> = {};
  (graph?.nodes ?? []).forEach((n) => { const c = n.community ?? 0; commCounts[c] = (commCounts[c] || 0) + 1; });

  const TABS = [
    ["graph",    "Knowledge Graph"],
    ["stats",    "Graph Stats"],
    ["entities", `Entities${graph ? ` (${graph.node_count})` : ""}`],
    ["quality",  "Quality Scorecard"],
  ] as const;

  return (
    <div className="flex flex-col min-h-screen bg-bg2">

      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-dborder bg-bg1 flex-shrink-0">
        <div>
          <div className="text-[15px] font-semibold font-sora text-t1">Knowledge Graph Quality</div>
          <div className="text-[11px] text-t3 mt-0.5">GraphRAG canonical graph · entity insights · quality scorecard</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            className="bg-bg3 border border-dborder rounded-lg px-3 py-1.5 text-[12px] text-t1 focus:outline-none"
            value={selectedJob}
            onChange={(e) => setSelectedJob(e.target.value)}
          >
            {corpora.map((c) => (
              <option key={c.job_id} value={c.job_id}>{c.domain_label ?? c.job_id.slice(0, 12)}</option>
            ))}
          </select>
          <button onClick={loadData} className="btn btn-sm">Refresh</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-dborder bg-bg1 flex-shrink-0 px-2">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="px-5 py-2.5 text-[11px] font-medium transition-colors border-b-2"
            style={{
              borderBottomColor: tab === key ? "var(--color-accent, #4f46e5)" : "transparent",
              color: tab === key ? "#4f46e5" : "var(--color-t2, #5a6077)",
              background: "transparent",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 p-6 max-w-6xl mx-auto w-full">
        {loading && <div className="text-[12px] text-t3 flex items-center gap-2"><span className="inline-block w-2 h-2 rounded-full bg-accent animate-pulse" />Loading…</div>}
        {error && <div className="text-[12px] text-coral">Error: {error}</div>}

        {/* ── GRAPH TAB ──────────────────────────────────────────────────── */}
        {!loading && tab === "graph" && (
          <div>
            {/* Summary stat row */}
            <div className="grid grid-cols-4 gap-3 mb-5">
              {[
                { label: "Nodes",  value: graph?.node_count ?? "—",  color: "#4f46e5" },
                { label: "Edges",  value: graph?.edge_count ?? "—",  color: "#0d9488" },
                { label: "Density", value: density,                  color: "#d97706" },
                { label: "Communities", value: Object.keys(commCounts).length || "—", color: "#7c3aed" },
              ].map((s) => (
                <div key={s.label} className="card text-center py-4">
                  <div className="font-sora text-2xl font-bold" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-[10px] text-t3 mt-1 uppercase tracking-widest">{s.label}</div>
                </div>
              ))}
            </div>

            {!graph || graph.nodes.length === 0 ? (
              <div className="card flex items-center justify-center py-16">
                <div className="text-center">
                  <div className="text-[36px] mb-3 opacity-30">🕸</div>
                  <p className="text-[13px] text-t3">No graph data yet — complete an ingest pipeline to generate the knowledge graph.</p>
                </div>
              </div>
            ) : layout ? (
              <div className="card overflow-hidden p-0">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-dborder text-[10px] text-t3">
                  <span>Showing {layout.nodes.length} / {graph.node_count} nodes · {layout.edges.length} / {graph.edge_count} edges · force-directed layout</span>
                  <span>Hover nodes for details</span>
                </div>
                <div className="relative" style={{ background: "var(--color-bg3, #f4f6fc)" }}>
                  <svg
                    viewBox={`0 0 ${layout.width} ${layout.height}`}
                    className="w-full block"
                    style={{ height: 480 }}
                  >
                    <defs>
                      <radialGradient id="qGlow" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="#eef2ff" stopOpacity="0.6" />
                        <stop offset="100%" stopColor="#eef2ff" stopOpacity="0" />
                      </radialGradient>
                    </defs>
                    <rect width={layout.width} height={layout.height} fill="url(#qGlow)" />

                    {layout.edges.map((e, i) => {
                      const s = layout.pos[e.source], t = layout.pos[e.target];
                      if (!s || !t) return null;
                      return (
                        <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                          stroke="#94a3b8" strokeOpacity="0.4" strokeWidth="1.1">
                          <title>{`${s.label} → ${t.label}${e.weight ? ` (weight: ${e.weight})` : ""}`}</title>
                        </line>
                      );
                    })}

                    {layout.nodes.map((n) => (
                      <g key={n.id}
                        onMouseEnter={() => setHoveredNode(n)}
                        onMouseLeave={() => setHoveredNode(null)}
                        style={{ cursor: "pointer" }}
                      >
                        <circle cx={n.x} cy={n.y} r={n.r + 5} fill={nodeColor(n.type)} opacity="0.10" />
                        <circle cx={n.x} cy={n.y} r={n.r} fill={nodeColor(n.type)} fillOpacity="0.88" stroke="#f8fafc" strokeWidth="1.2">
                          <title>{`${n.label} (${n.type}) · count: ${n.count}`}</title>
                        </circle>
                        <rect
                          x={n.x + n.r + 4} y={n.y - 7}
                          width={Math.max(20, (n.labelShort?.length || 0) * 6.2)}
                          height="14" rx="4"
                          fill="rgba(248,250,252,.92)" stroke="rgba(148,163,184,.4)"
                        />
                        <text x={n.x + n.r + 8} y={n.y + 3.5} fontSize="9" fill="#334155" style={{ userSelect: "none" }}>
                          {n.labelShort}
                        </text>
                      </g>
                    ))}
                  </svg>

                  {/* Hover tooltip */}
                  {hoveredNode && (
                    <div className="absolute top-3 right-3 card py-2.5 px-3 text-[11px] pointer-events-none" style={{ minWidth: 160 }}>
                      <div className="font-semibold text-t1 mb-1">{hoveredNode.label}</div>
                      <div className="text-t3">Type: <span className="text-t2">{hoveredNode.type}</span></div>
                      <div className="text-t3">Count: <span className="text-t2">{hoveredNode.count}</span></div>
                      {hoveredNode.community != null && <div className="text-t3">Community: <span className="text-t2">{hoveredNode.community}</span></div>}
                    </div>
                  )}

                  {/* Legend */}
                  <div className="absolute bottom-3 left-3 card py-2 px-3 flex items-center gap-3 text-[10px]">
                    {[["ORG", "#7c3aed"], ["PERSON", "#d97706"], ["GPE/LOC", "#0d9488"], ["OTHER", "#2563eb"]].map(([t, c]) => (
                      <span key={t} className="flex items-center gap-1">
                        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: c }} />{t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* ── STATS TAB ──────────────────────────────────────────────────── */}
        {!loading && tab === "stats" && (
          <div className="space-y-5">
            {/* Graph health cards */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "High-risk edge ratio", value: graphMetrics?.high_risk_edge_ratio != null ? `${(graphMetrics.high_risk_edge_ratio * 100).toFixed(1)}%` : "—", color: "#e11d48" },
                { label: "Contradiction ratio",  value: graphMetrics?.contradiction_ratio != null ? `${(graphMetrics.contradiction_ratio * 100).toFixed(1)}%` : "—", color: "#d97706" },
                { label: "Graph density",        value: density, color: "#0d9488" },
              ].map((s) => (
                <div key={s.label} className="card text-center py-4">
                  <div className="font-sora text-[22px] font-bold" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-[10px] text-t3 mt-1 uppercase tracking-widest">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Edge confidence distribution */}
            {graphMetrics?.edge_confidence_distribution && (
              <div className="card">
                <div className="sect mb-3">Edge Confidence Distribution</div>
                {Object.entries(graphMetrics.edge_confidence_distribution).map(([level, cnt]) => {
                  const total = Object.values(graphMetrics.edge_confidence_distribution!).reduce((a, b) => a + b, 0) || 1;
                  return (
                    <div key={level} className="mb-2">
                      <div className="flex justify-between text-[11px] text-t2 mb-1 capitalize"><span>{level}</span><span>{cnt}</span></div>
                      <div className="prog-bar">
                        <div className="prog-fill" style={{ width: `${(Number(cnt) / total) * 100}%`, background: level === "high" ? "#16a34a" : level === "medium" ? "#d97706" : "#e11d48" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {/* Entity type breakdown */}
              <div className="card">
                <div className="sect mb-3">Entity Type Breakdown</div>
                {Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, cnt]) => (
                  <div key={type} className="mb-2">
                    <div className="flex justify-between text-[11px] text-t2 mb-1">
                      <span>{type}</span><span>{cnt} ({Math.round(cnt / typeTotal * 100)}%)</span>
                    </div>
                    <div className="prog-bar">
                      <div className="prog-fill" style={{ width: `${(cnt / typeTotal) * 100}%`, background: nodeColor(type) }} />
                    </div>
                  </div>
                ))}
                {Object.keys(typeCounts).length === 0 && <p className="text-[11px] text-t3">No graph data.</p>}
              </div>

              {/* Community breakdown */}
              <div className="card">
                <div className="sect mb-3">Community Breakdown</div>
                {Object.entries(commCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([comm, cnt]) => (
                  <div key={comm} className="mb-2">
                    <div className="flex justify-between text-[11px] text-t2 mb-1"><span>Community {comm}</span><span>{cnt} nodes</span></div>
                    <div className="prog-bar">
                      <div className="prog-fill" style={{ width: `${(cnt / (graph?.node_count || 1)) * 100}%` }} />
                    </div>
                  </div>
                ))}
                {Object.keys(commCounts).length === 0 && <p className="text-[11px] text-t3">No community data.</p>}
              </div>
            </div>

            {/* Registry metrics */}
            {registryMetrics && (
              <div className="card">
                <div className="sect mb-3">Entity Registry</div>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "Canonical nodes", value: registryMetrics.canonical_node_count ?? "—", color: "#4f46e5" },
                    { label: "Aliases",          value: registryMetrics.total_alias_count ?? "—",   color: "#0d9488" },
                    { label: "Pending reviews",  value: registryMetrics.pending_review_count ?? "—", color: "#d97706" },
                    { label: "Resolved",         value: registryMetrics.resolved_review_count ?? "—", color: "#16a34a" },
                  ].map((s) => (
                    <div key={s.label} className="mcard text-center">
                      <div className="font-sora text-[20px] font-bold" style={{ color: s.color }}>{s.value}</div>
                      <div className="text-[10px] text-t3 mt-1 uppercase tracking-widest">{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── ENTITIES TAB ───────────────────────────────────────────────── */}
        {!loading && tab === "entities" && (
          <div>
            {!graph || graph.nodes.length === 0 ? (
              <div className="card py-10 text-center"><p className="text-[12px] text-t3">No entities found. Run an ingest pipeline first.</p></div>
            ) : (
              <div className="space-y-1.5">
                {[...graph.nodes].sort((a, b) => b.count - a.count).map((n) => {
                  const s = { bg: nodeColor(n.type) + "18", color: nodeColor(n.type), border: nodeColor(n.type) + "50" };
                  return (
                    <div key={n.id} className="flex items-center gap-2.5 px-3 py-2 bg-bg3 border border-dborder rounded-lg">
                      <span className="text-[12px] font-medium text-t1 flex-1 truncate">{n.label}</span>
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0" style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>{n.type}</span>
                      {n.community != null && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(79,70,229,.10)", color: "#4f46e5", border: "1px solid rgba(79,70,229,.25)", flexShrink: 0 }}>comm {n.community}</span>
                      )}
                      <span className="text-[10px] text-t3 flex-shrink-0">×{n.count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── QUALITY TAB ────────────────────────────────────────────────── */}
        {!loading && tab === "quality" && (
          <div className="space-y-5">
            {scorecards.length === 0 ? (
              <div className="card py-10 text-center"><p className="text-[12px] text-t3">No quality scorecards found. Run the full ingest pipeline to generate EDA artifacts.</p></div>
            ) : (
              <>
                <div className="card">
                  <div className="sect mb-4">Averaged Quality Scorecard ({scorecards.length} file{scorecards.length !== 1 ? "s" : ""})</div>
                  <ScoreBar label="Confidence" value={Number(avgScorecard.confidence_score ?? 0)} />
                  <ScoreBar label="Graph Trust" value={Number(avgScorecard.graph_trust_score ?? 0)} />
                  <ScoreBar label="Semantic Coherence" value={Number(avgScorecard.semantic_coherence_score ?? 0)} />
                  <ScoreBar label="Canonical Resolution" value={Number(avgScorecard.canonical_resolution_score ?? 0)} />
                  <ScoreBar label="Completeness" value={Number(avgScorecard.completeness_score ?? 0)} />
                  <ScoreBar label="Extraction Reliability" value={Number(avgScorecard.extraction_reliability_score ?? 0)} />
                </div>

                <div>
                  <div className="sect mb-3">Per-File Scorecards</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {scorecards.map((fs) => (
                      <div key={fs.file_id} className="card">
                        <div className="text-[12px] font-semibold text-t1 mb-3 truncate">{fs.file_id}</div>
                        <ScoreBar label="Confidence" value={Number(fs.scorecard?.confidence_score ?? 0)} />
                        <ScoreBar label="Graph Trust" value={Number(fs.scorecard?.graph_trust_score ?? 0)} />
                        <ScoreBar label="Completeness" value={Number(fs.scorecard?.completeness_score ?? 0)} />
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
