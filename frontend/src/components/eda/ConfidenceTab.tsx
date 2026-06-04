"use client";

import { useMemo, useState } from "react";
import { ObservatoryData } from "./types";
import { EmptyState, fmtPct } from "./common";

function cellColor(v?: number | null): string {
  if (v === null || v === undefined) return "#c9ccd6";
  const n = Math.max(0, Math.min(1, Number(v)));
  if (n >= 0.8) return "#16a34a";
  if (n >= 0.6) return "#7c6af8";
  if (n >= 0.4) return "#d97706";
  return "#e63755";
}

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
    <div className="space-y-3">
      <div className="card overflow-auto">
        <div className="sect">Semantic Confidence Heatmap</div>
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr className="border-b border-dborder text-left text-t3">
              <th className="py-2 pr-2">Entity</th>
              {stages.map((s) => <th key={s} className="py-2 pr-2">{s}</th>)}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.entity} className="border-b border-dborder/60">
                <td className="py-2 pr-2 text-t2">{row.entity}</td>
                {stages.map((stage) => {
                  const v = row.stages?.[stage];
                  return (
                    <td key={`${row.entity}-${stage}`} className="py-1 pr-2">
                      <button
                        className="w-full text-left px-2 py-1 rounded text-white"
                        style={{ background: cellColor(v ?? null) }}
                        onClick={() => setSelected({ entity: row.entity, stage })}
                      >
                        {fmtPct(v ?? null)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && selectedData && (
        <div className="card">
          <div className="sect">Confidence Breakdown</div>
          <div className="text-[12px] text-t2">Entity: {selectedData.entity}</div>
          <div className="text-[11px] text-t3">Canonical ID: {selectedData.canonical_id ?? "-"}</div>
          <div className="text-[11px] text-t3">Type: {selectedData.entity_type ?? "-"}</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-2">
            {stages.map((s) => (
              <div className="mcard" key={s}>
                <div className="text-[10px] text-t3">{s}</div>
                <div className="text-[14px] font-semibold text-t1">{fmtPct(selectedData.stages?.[s] ?? null)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
