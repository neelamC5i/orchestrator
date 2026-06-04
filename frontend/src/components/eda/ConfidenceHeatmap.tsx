"use client";

import { ObservatoryData } from "./types";
import { fmtPct } from "./common";

function scoreColor(v?: number | null): string {
  if (v === null || v === undefined) return "#cbd5e1";
  const n = Math.max(0, Math.min(1, Number(v)));
  if (n >= 0.85) return "#10b981";
  if (n >= 0.7) return "#2563eb";
  if (n >= 0.5) return "#f59e0b";
  return "#ef4444";
}

export default function ConfidenceHeatmap({
  data,
  onSelect,
}: {
  data: ObservatoryData;
  onSelect: (entity: string, stage: string) => void;
}) {
  const stages = data.confidence?.stages ?? [];
  const matrix = data.confidence?.matrix ?? [];

  return (
    <div className="h-full overflow-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="py-2 pr-2">Entity</th>
            {stages.map((s) => (
              <th key={s} className="py-2 pr-2">{s}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row) => (
            <tr key={row.entity} className="border-b border-slate-100">
              <td className="py-2 pr-2 text-slate-700">{row.entity}</td>
              {stages.map((stage) => {
                const score = row.stages?.[stage];
                const tooltip = `${row.entity} • ${stage} • ${fmtPct(score ?? null)}`;
                return (
                  <td key={`${row.entity}-${stage}`} className="py-1 pr-2">
                    <button
                      className="w-full rounded px-2 py-1 text-left text-[10px] text-white"
                      title={tooltip}
                      style={{ background: scoreColor(score ?? null) }}
                      onClick={() => onSelect(row.entity, stage)}
                    >
                      {fmtPct(score ?? null)}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
