"use client";

import { useMemo, useState } from "react";
import { ObservatoryData } from "./types";
import { EmptyState, fmtBytes, fmtNum } from "./common";
import PipelineTimeline from "./PipelineTimeline";
import InspectorPanel from "./InspectorPanel";
import KpiCard from "./KpiCard";

export default function PipelineTab({ data }: { data: ObservatoryData }) {
  const stages = data.pipeline?.stages ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(stages[0]?.id);

  if (!stages.length) return <EmptyState />;

  const selected = useMemo(() => stages.find((s) => s.id === selectedId) ?? stages[0], [selectedId, stages]);
  const okCount = stages.filter((s) => s.status === "done").length;
  const warnCount = stages.filter((s) => s.status === "running").length;
  const failCount = stages.filter((s) => s.status === "failed").length;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <KpiCard label="Total Layers" value={`${stages.length}`} />
        <KpiCard label="OK" value={`${okCount}`} tone="success" />
        <KpiCard label="Warning" value={`${warnCount}`} tone="warning" />
        <KpiCard label="Failed" value={`${failCount}`} tone="risk" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[2fr_1fr]">
        <PipelineTimeline stages={stages} selectedId={selectedId} onSelect={(s) => setSelectedId(s.id)} />
        <InspectorPanel title="Layer Inspector">
          {selected ? (
            <div className="space-y-2 text-[12px]">
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Layer</div>
                <div className="font-semibold text-slate-900">{selected.label}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2"><span className="text-slate-500">Status:</span> {selected.status}</div>
              <div className="rounded-lg bg-slate-50 p-2"><span className="text-slate-500">Progress:</span> {selected.pct ?? 0}%</div>
              <div className="rounded-lg bg-slate-50 p-2"><span className="text-slate-500">Input size:</span> {fmtBytes(selected.input_size_bytes)}</div>
              <div className="rounded-lg bg-slate-50 p-2"><span className="text-slate-500">Output size:</span> {fmtBytes(selected.output_size_bytes)}</div>
              <div className="rounded-lg bg-slate-50 p-2"><span className="text-slate-500">Processing:</span> {selected.processing_time_ms ? `${fmtNum(selected.processing_time_ms)} ms` : "Not available"}</div>
              <div className="rounded-lg bg-slate-50 p-2"><span className="text-slate-500">Description:</span> {selected.detail || "Pending data"}</div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-slate-500">Warnings</div>
                <div>{(selected.warnings ?? []).length ? (selected.warnings ?? []).join(", ") : "None"}</div>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="text-slate-500">Errors</div>
                <div>{(selected.errors ?? []).length ? (selected.errors ?? []).join(", ") : "None"}</div>
              </div>
            </div>
          ) : null}
        </InspectorPanel>
      </div>
    </div>
  );
}
