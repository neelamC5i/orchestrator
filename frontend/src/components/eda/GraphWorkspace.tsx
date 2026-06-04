"use client";

import { useMemo, useState } from "react";
import { ObservatoryData } from "./types";
import KpiCard from "./KpiCard";
import InspectorPanel from "./InspectorPanel";
import { fmtPct } from "./common";

function initials(label: string): string {
  return label
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase() ?? "")
    .join("");
}

export default function GraphWorkspace({ data }: { data: ObservatoryData }) {
  const [search, setSearch] = useState("");
  const [threshold, setThreshold] = useState(0.5);
  const [selected, setSelected] = useState<string | null>(null);

  const entries = useMemo(() => {
    const breakdown = data.confidence?.breakdown ?? {};
    const top = new Map((data.knowledge_graph?.top_connected_entities ?? []).map((x) => [x.entity, x.degree]));

    return Object.values(breakdown)
      .map((b) => {
        const stages = Object.values(b.stages ?? {}).filter((v) => typeof v === "number") as number[];
        const avg = stages.length ? stages.reduce((a, c) => a + c, 0) / stages.length : null;
        return {
          entity: b.entity,
          type: b.entity_type ?? "unknown",
          confidence: avg,
          degree: top.get(b.entity) ?? 0,
          canonical_id: b.canonical_id,
          source_files: b.source_files ?? [],
        };
      })
      .filter((x) => (x.confidence ?? 0) >= threshold)
      .filter((x) => x.entity.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (b.degree - a.degree) || ((b.confidence ?? 0) - (a.confidence ?? 0)));
  }, [data, search, threshold]);

  const selectedNode = entries.find((e) => e.entity === selected) ?? null;

  const stats = data.overview ?? {};

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <KpiCard label="Graph Nodes" value={`${stats.graph_nodes ?? 0}`} />
        <KpiCard label="Entities" value={`${stats.entities_count ?? 0}`} tone="success" />
        <KpiCard label="Relationships" value={`${stats.relationships_count ?? 0}`} />
        <KpiCard label="Trust" value={fmtPct(stats.trust_score ?? null)} tone="warning" />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[2fr_1fr]">
        <div className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search node"
              className="h-8 w-44 rounded-md border border-slate-300 px-2 text-[12px]"
            />
            <div className="flex items-center gap-2 text-[11px] text-slate-600">
              <span>Confidence</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
              <span>{Math.round(threshold * 100)}%</span>
            </div>
            <button
              onClick={() => {
                setSearch("");
                setThreshold(0.5);
              }}
              className="ml-auto rounded-md border border-slate-300 px-2 py-1 text-[11px]"
            >
              Fit to screen
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-auto rounded-lg bg-slate-50 p-2 sm:grid-cols-3 lg:grid-cols-4">
            {entries.map((n) => (
              <button
                key={n.entity}
                className={`flex h-20 flex-col items-center justify-center rounded-xl border px-2 text-center ${
                  selected === n.entity ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white"
                }`}
                onClick={() => setSelected(n.entity)}
                title={`${n.entity} • ${fmtPct(n.confidence ?? null)}`}
              >
                <div className="mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700">
                  {initials(n.entity)}
                </div>
                <div className="line-clamp-1 text-[10px] font-semibold text-slate-700">{n.entity}</div>
                <div className="text-[9px] text-slate-500">{fmtPct(n.confidence ?? null)}</div>
              </button>
            ))}
          </div>
        </div>

        <InspectorPanel title="Node / Edge Inspector" emptyMessage="Pick a node on the canvas.">
          {selectedNode ? (
            <div className="space-y-2">
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-[10px] text-slate-500">Label</div>
                <div className="text-[12px] font-semibold text-slate-900">{selectedNode.entity}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-[10px] text-slate-500">Type</div>
                <div className="text-[12px] text-slate-700">{selectedNode.type}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-[10px] text-slate-500">Confidence</div>
                <div className="text-[12px] text-slate-700">{fmtPct(selectedNode.confidence ?? null)}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-[10px] text-slate-500">Canonical ID</div>
                <div className="break-all font-mono text-[11px] text-slate-700">{selectedNode.canonical_id ?? "Not available"}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-[10px] text-slate-500">Source / Provenance</div>
                <div className="text-[11px] text-slate-700">
                  {selectedNode.source_files.length ? selectedNode.source_files.join(", ") : "Not available"}
                </div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-[10px] text-slate-500">Connected Nodes (proxy degree)</div>
                <div className="text-[12px] text-slate-700">{selectedNode.degree}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
                Edge-level aliases / incoming / outgoing relationships are pending from current payload.
              </div>
            </div>
          ) : null}
        </InspectorPanel>
      </div>
    </div>
  );
}
