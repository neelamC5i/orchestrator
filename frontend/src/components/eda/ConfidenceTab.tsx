"use client";

import { useMemo, useState } from "react";
import { ObservatoryData } from "./types";
import { EmptyState, fmtPct } from "./common";
import ConfidenceHeatmap from "./ConfidenceHeatmap";
import InspectorPanel from "./InspectorPanel";

export default function ConfidenceTab({ data }: { data: ObservatoryData }) {
  const [selected, setSelected] = useState<{ entity: string; stage: string } | null>(null);
  const matrix = data.confidence?.matrix ?? [];
  const stages = data.confidence?.stages ?? [];
  const breakdown = data.confidence?.breakdown ?? {};

  if (!matrix.length || !stages.length) return <EmptyState />;

  const selectedData = useMemo(() => {
    if (!selected) return null;
    return breakdown[selected.entity] ?? null;
  }, [selected, breakdown]);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 xl:grid-cols-[2fr_1fr]">
      <ConfidenceHeatmap data={data} onSelect={(entity, stage) => setSelected({ entity, stage })} />

      <InspectorPanel title="Confidence Detail" emptyMessage="Click a heatmap cell to inspect score details.">
        {selected && selectedData ? (
          <div className="space-y-2">
            <div className="rounded-lg bg-slate-50 p-2 text-[12px] text-slate-700">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Entity</div>
              <div className="font-semibold text-slate-900">{selectedData.entity}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-2 text-[12px] text-slate-700">
              <span className="text-slate-500">Layer:</span> {selected.stage}
            </div>
            <div className="rounded-lg bg-slate-50 p-2 text-[12px] text-slate-700">
              <span className="text-slate-500">Canonical ID:</span> {selectedData.canonical_id ?? "-"}
            </div>
            <div className="rounded-lg bg-slate-50 p-2 text-[12px] text-slate-700">
              <span className="text-slate-500">Type:</span> {selectedData.entity_type ?? "-"}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {stages.map((s) => (
                <div className="rounded-lg border border-slate-200 bg-white p-2" key={s}>
                  <div className="text-[10px] text-slate-500">{s}</div>
                  <div className="text-[12px] font-semibold text-slate-800">{fmtPct(selectedData.stages?.[s] ?? null)}</div>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
              Formula / reason: score reflects stage confidence provided by backend payload.
            </div>
          </div>
        ) : null}
      </InspectorPanel>
    </div>
  );
}
