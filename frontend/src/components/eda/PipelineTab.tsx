"use client";

import { useState } from "react";
import { ObservatoryData } from "./types";
import { EmptyState, fmtBytes, fmtNum } from "./common";

function statusDot(status: string): string {
  if (status === "done") return "bg-gg";
  if (status === "running") return "bg-amber";
  if (status === "failed") return "bg-coral";
  return "bg-t3";
}

export default function PipelineTab({ data }: { data: ObservatoryData }) {
  const stages = data.pipeline?.stages ?? [];
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (!stages.length) return <EmptyState />;

  return (
    <div className="card overflow-hidden p-0">
      <div className="divide-y divide-dborder">
        {stages.map((s) => {
          const isOpen = !!expanded[s.id];
          return (
            <div key={s.id}>
              <button
                className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-bg3"
                onClick={() => setExpanded((p) => ({ ...p, [s.id]: !p[s.id] }))}
              >
                <span className={`w-2 h-2 rounded-full ${statusDot(s.status)}`} />
                <span className="text-[12px] font-semibold text-t1">{s.label}</span>
                <span className="text-[11px] text-t3">{s.detail ?? ""}</span>
                <span className="ml-auto text-[11px] text-t3">{isOpen ? "▾" : "▸"}</span>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 pt-1 border-t border-dborder bg-bg3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                    <div className="mcard"><div className="text-t3">Input Size</div><div className="text-t1 font-semibold">{fmtBytes(s.input_size_bytes)}</div></div>
                    <div className="mcard"><div className="text-t3">Output Size</div><div className="text-t1 font-semibold">{fmtBytes(s.output_size_bytes)}</div></div>
                    <div className="mcard"><div className="text-t3">Processing Time</div><div className="text-t1 font-semibold">{s.processing_time_ms ? `${fmtNum(s.processing_time_ms)} ms` : "-"}</div></div>
                    <div className="mcard"><div className="text-t3">Progress</div><div className="text-t1 font-semibold">{s.pct ?? 0}%</div></div>
                  </div>
                  <div className="mt-2 text-[11px] text-t3">
                    <div>Warnings: {(s.warnings ?? []).length ? (s.warnings ?? []).join(", ") : "None"}</div>
                    <div>Errors: {(s.errors ?? []).length ? (s.errors ?? []).join(", ") : "None"}</div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
