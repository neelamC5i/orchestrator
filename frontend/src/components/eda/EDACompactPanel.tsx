"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { ObservatoryData } from "./types";
import KpiCard from "./KpiCard";
import { EmptyState, fmtNum } from "./common";

export default function EDACompactPanel({ data }: { data: ObservatoryData }) {
  const eda = data.eda;
  const stats = eda?.column_statistics ?? [];
  const hist = eda?.histograms ?? [];
  const outliers = eda?.outliers ?? [];

  if (!stats.length && !hist.length && !outliers.length) {
    return <EmptyState message="Pending data: EDA visuals are not available for this corpus yet." />;
  }

  const relDist = hist.map((h) => ({ name: h.column, count: h.bins.reduce((a, b) => a + (b.count ?? 0), 0) }));

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
        <KpiCard label="Numeric Columns" value={`${stats.length}`} tone="success" />
        <KpiCard label="Histograms" value={`${hist.length}`} />
        <KpiCard label="Outliers" value={`${outliers.length}`} tone={outliers.length ? "warning" : "default"} />
        <KpiCard label="Null / Missing" value="Not available" sub="Awaiting null-profile payload" />
        <KpiCard label="Covariance" value="Not available" sub="Analytical association only" />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Entity / Relationship Distribution</div>
          {relDist.length ? (
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={relDist}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#2563eb" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-[12px] text-slate-500">Not available</div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Compact Column Stats</div>
          <div className="h-[220px] overflow-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-2">Column</th>
                  <th className="py-2 pr-2">Mean</th>
                  <th className="py-2 pr-2">P10</th>
                  <th className="py-2">P90</th>
                </tr>
              </thead>
              <tbody>
                {stats.slice(0, 50).map((s, i) => (
                  <tr key={`${s.file_id}-${s.column}-${i}`} className="border-b border-slate-100">
                    <td className="py-2 pr-2 text-slate-700">{s.column}</td>
                    <td className="py-2 pr-2 text-slate-700">{fmtNum(s.mean ?? null)}</td>
                    <td className="py-2 pr-2 text-slate-700">{fmtNum(s.p10 ?? null)}</td>
                    <td className="py-2 text-slate-700">{fmtNum(s.p90 ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
