"use client";

import { useMemo, useRef, useState } from "react";
import { ObservatoryData, GraphifyData, GraphifyNode, GraphifyEdge } from "./types";
import KpiCard from "./KpiCard";
import InspectorPanel from "./InspectorPanel";
import { fmtPct } from "./common";

// ── palette ──────────────────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  ORG: "#3b82f6",
  GPE: "#22c55e",
  LOC: "#14b8a6",
  PRODUCT: "#f97316",
  PERSON: "#a855f7",
  EVENT: "#ef4444",
  FAC: "#eab308",
  NORP: "#ec4899",
  LAW: "#6b7280",
  ENTITY: "#94a3b8",
  TABLE: "#0ea5e9",
};
const COMM_PALETTE = [
  "#3b82f6", "#22c55e", "#f97316", "#a855f7",
  "#ef4444", "#14b8a6", "#eab308", "#ec4899",
  "#0ea5e9", "#84cc16", "#f43f5e", "#8b5cf6",
];
function typeColor(t: string) {
  return TYPE_COLORS[t?.toUpperCase()] ?? TYPE_COLORS[t] ?? "#94a3b8";
}
function commColor(c: number) {
  return COMM_PALETTE[c % COMM_PALETTE.length];
}

// ── SVG viewport ─────────────────────────────────────────────────────────────
const VW = 900;
const VH = 500;
const MAX_NODES = 250;
const MAX_EDGES = 600;

function layoutNodes(nodes: GraphifyNode[]): Map<string, { x: number; y: number }> {
  const communities = new Map<number, GraphifyNode[]>();
  for (const n of nodes) {
    const c = n.community ?? 0;
    if (!communities.has(c)) communities.set(c, []);
    communities.get(c)!.push(n);
  }
  const commList = [...communities.entries()];
  const commCount = commList.length;
  const cx = VW / 2;
  const cy = VH / 2;
  const outerR = Math.min(VW, VH) * 0.37;
  const positions = new Map<string, { x: number; y: number }>();

  commList.forEach(([, commNodes], commIdx) => {
    const commAngle =
      commCount === 1 ? 0 : (commIdx / commCount) * Math.PI * 2 - Math.PI / 2;
    const commX = commCount === 1 ? cx : cx + outerR * Math.cos(commAngle);
    const commY = commCount === 1 ? cy : cy + outerR * Math.sin(commAngle);
    const innerR =
      commNodes.length === 1
        ? 0
        : Math.min(80, 14 + commNodes.length * 9);
    commNodes.forEach((node, ni) => {
      const nodeAngle = (ni / Math.max(1, commNodes.length)) * Math.PI * 2 - Math.PI / 2;
      positions.set(node.id, {
        x: Math.max(18, Math.min(VW - 18, commX + innerR * Math.cos(nodeAngle))),
        y: Math.max(18, Math.min(VH - 18, commY + innerR * Math.sin(nodeAngle))),
      });
    });
  });
  return positions;
}

// ── component ─────────────────────────────────────────────────────────────────
interface Props {
  data: ObservatoryData;
  graphData: GraphifyData | null;
}

export default function GraphWorkspace({ data, graphData }: Props) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const allNodes = graphData?.nodes ?? [];
  const allEdges = graphData?.edges ?? [];

  // filter by search, cap for performance
  const nodes = useMemo<GraphifyNode[]>(() => {
    const q = search.toLowerCase();
    const filtered = q
      ? allNodes.filter((n) => n.label.toLowerCase().includes(q))
      : allNodes;
    return filtered.slice(0, MAX_NODES);
  }, [allNodes, search]);

  const nodeSet = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  const edges = useMemo<GraphifyEdge[]>(
    () =>
      allEdges
        .filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target))
        .slice(0, MAX_EDGES),
    [allEdges, nodeSet]
  );

  const positions = useMemo(() => layoutNodes(nodes), [nodes]);

  const selectedNode = nodes.find((n) => n.id === selected) ?? null;

  const connectedEdges = useMemo<GraphifyEdge[]>(
    () =>
      selected
        ? allEdges.filter((e) => e.source === selected || e.target === selected)
        : [],
    [selected, allEdges]
  );

  const stats = data.overview ?? {};
  const nodeCount = graphData?.node_count ?? allNodes.length ?? stats.graph_nodes ?? 0;
  const edgeCount = graphData?.edge_count ?? allEdges.length ?? stats.relationships_count ?? 0;

  // unique types for the legend
  const seenTypes = useMemo(
    () => [...new Set(nodes.map((n) => n.type?.toUpperCase()).filter(Boolean))].slice(0, 7),
    [nodes]
  );

  return (
    <div className="flex h-full flex-col gap-3">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <KpiCard label="Graph Nodes" value={`${nodeCount}`} />
        <KpiCard label="Edges" value={`${edgeCount}`} tone="success" />
        <KpiCard label="Entities" value={`${stats.entities_count ?? 0}`} />
        <KpiCard label="Trust" value={fmtPct(stats.trust_score ?? null)} tone="warning" />
      </div>

      {/* main split */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[2fr_1fr]">
        {/* SVG canvas */}
        <div className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSelected(null); }}
              placeholder="Search node…"
              className="h-8 w-44 rounded-md border border-slate-300 px-2 text-[12px]"
            />
            <span className="text-[10px] text-slate-400">
              {nodes.length} nodes · {edges.length} edges
              {allNodes.length > MAX_NODES && (
                <span className="ml-1 text-amber-500">(capped at {MAX_NODES})</span>
              )}
            </span>
            <button
              onClick={() => { setSearch(""); setSelected(null); }}
              className="ml-auto rounded-md border border-slate-300 px-2 py-1 text-[11px]"
            >
              Reset
            </button>
          </div>

          {nodes.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-[12px] text-slate-400">
              {allNodes.length === 0
                ? "No graph data available — run ingestion to build the knowledge graph."
                : "No nodes match your search."}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-slate-900">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${VW} ${VH}`}
                className="h-full w-full"
                preserveAspectRatio="xMidYMid meet"
              >
                {/* edges */}
                <g>
                  {edges.map((e, i) => {
                    const s = positions.get(e.source);
                    const t = positions.get(e.target);
                    if (!s || !t) return null;
                    const active = selected === e.source || selected === e.target;
                    return (
                      <line
                        key={i}
                        x1={s.x} y1={s.y}
                        x2={t.x} y2={t.y}
                        stroke={active ? "#60a5fa" : "#475569"}
                        strokeWidth={active ? 1.5 : 0.5}
                        strokeOpacity={active ? 0.9 : 0.3}
                      />
                    );
                  })}
                </g>

                {/* nodes */}
                <g>
                  {nodes.map((n) => {
                    const pos = positions.get(n.id);
                    if (!pos) return null;
                    const r = Math.max(5, Math.min(16, 5 + Math.log1p(n.count ?? 1) * 2.5));
                    const color = typeColor(n.type);
                    const isSelected = selected === n.id;
                    const isHovered = hovered === n.id;
                    const maxLen = 13;
                    const labelText =
                      n.label.length > maxLen ? n.label.slice(0, maxLen - 1) + "…" : n.label;
                    return (
                      <g
                        key={n.id}
                        transform={`translate(${pos.x},${pos.y})`}
                        style={{ cursor: "pointer" }}
                        onClick={() => setSelected(isSelected ? null : n.id)}
                        onMouseEnter={() => setHovered(n.id)}
                        onMouseLeave={() => setHovered(null)}
                      >
                        {/* glow ring on select/hover */}
                        {(isSelected || isHovered) && (
                          <circle r={r + 5} fill={color} opacity={0.2} />
                        )}
                        {/* event trigger dashed ring */}
                        {n.is_event_trigger && (
                          <circle
                            r={r + 4}
                            fill="none"
                            stroke="#ef4444"
                            strokeWidth={1}
                            strokeDasharray="3 2"
                          />
                        )}
                        <circle
                          r={r}
                          fill={color}
                          stroke={isSelected ? "#f8fafc" : "none"}
                          strokeWidth={isSelected ? 2 : 0}
                        />
                        <text
                          y={r + 10}
                          textAnchor="middle"
                          fontSize={8}
                          fill="#cbd5e1"
                          pointerEvents="none"
                        >
                          {labelText}
                        </text>
                      </g>
                    );
                  })}
                </g>

                {/* type legend */}
                {seenTypes.length > 0 && (
                  <g transform="translate(10,10)">
                    {seenTypes.map((type, i) => (
                      <g key={type} transform={`translate(0,${i * 14})`}>
                        <circle cx={5} cy={5} r={4} fill={typeColor(type)} />
                        <text x={13} y={9} fontSize={9} fill="#94a3b8">
                          {type}
                        </text>
                      </g>
                    ))}
                  </g>
                )}
              </svg>
            </div>
          )}
        </div>

        {/* Inspector panel */}
        <InspectorPanel title="Node Inspector" emptyMessage="Click a node to inspect it.">
          {selectedNode ? (
            <div className="space-y-2">
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-[10px] text-slate-500">Label</div>
                <div className="text-[12px] font-semibold text-slate-900">{selectedNode.label}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-[10px] text-slate-500">Type</div>
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: typeColor(selectedNode.type) }}
                  />
                  <span className="text-[12px] text-slate-700">{selectedNode.type}</span>
                </div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-[10px] text-slate-500">Community</div>
                <div className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: commColor(selectedNode.community ?? 0) }}
                  />
                  <span className="text-[12px] text-slate-700">{selectedNode.community ?? 0}</span>
                </div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-[10px] text-slate-500">Occurrence count</div>
                <div className="text-[12px] text-slate-700">{selectedNode.count ?? 1}</div>
              </div>
              {selectedNode.is_event_trigger && (
                <div className="rounded-lg bg-red-50 p-2 text-[11px] text-red-700">
                  ⚡ Disruption / event trigger entity
                </div>
              )}
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="mb-1 text-[10px] text-slate-500">
                  Connected edges ({connectedEdges.length})
                </div>
                <div className="max-h-40 space-y-1 overflow-auto">
                  {connectedEdges.slice(0, 20).map((e, i) => {
                    const otherId = e.source === selectedNode.id ? e.target : e.source;
                    const otherNode = allNodes.find((n) => n.id === otherId);
                    const otherLabel = otherNode?.label ?? otherId;
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded bg-white px-2 py-1 text-[10px]"
                        style={{ border: "1px solid #e2e8f0" }}
                      >
                        <span
                          className="max-w-[110px] cursor-pointer truncate text-slate-600 hover:text-blue-600"
                          onClick={() => setSelected(otherId)}
                        >
                          {otherLabel}
                        </span>
                        <span className="ml-1 shrink-0 rounded bg-blue-50 px-1 text-blue-700">
                          {e.relation}
                        </span>
                      </div>
                    );
                  })}
                  {connectedEdges.length > 20 && (
                    <div className="text-[10px] text-slate-400">
                      …and {connectedEdges.length - 20} more
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </InspectorPanel>
      </div>
    </div>
  );
}
