"use client";

import { PipelineStageRow } from "./types";

function statusBadge(status: string): string {
  if (status === "done") return "bg-emerald-100 text-emerald-700";
  if (status === "running") return "bg-blue-100 text-blue-700";
  if (status === "failed") return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-600";
}

export default function PipelineTimeline({
  stages,
  selectedId,
  onSelect,
}: {
  stages: PipelineStageRow[];
  selectedId?: string;
  onSelect: (stage: PipelineStageRow) => void;
}) {
  return (
    <div className="h-full overflow-auto pr-1">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {stages.map((s, i) => {
          const active = s.id === selectedId;
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s)}
              className={`rounded-xl border p-3 text-left shadow-sm transition ${
                active ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:border-blue-300"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Layer {i + 1}</span>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${statusBadge(s.status)}`}>
                  {s.status}
                </span>
              </div>
              <div className="mt-1 text-[12px] font-semibold text-slate-900">{s.label}</div>
              <div className="mt-1 line-clamp-2 text-[11px] text-slate-500">{s.detail || "No details yet"}</div>
              <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${Math.max(0, Math.min(100, s.pct ?? 0))}%` }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
