"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { ObservatoryData } from "./types";
import KpiCard from "./KpiCard";
import MetricTooltip from "./MetricTooltip";
import { fmtNum, fmtPct } from "./common";

export default function GovernancePanel({ data }: { data: ObservatoryData }) {
  const gov = data.governance_ontology;
  const val = data.validation_trust;

  const verdicts = [
    { name: "auto_accept", value: Math.max(0, (gov?.relationship_type_violations ?? 0) * 0.2) },
    { name: "review_required", value: Math.max(0, gov?.relationship_type_violations ?? 0) },
    { name: "reject", value: Math.max(0, val?.ontology_violations ?? 0) },
  ];

  const alerts = gov?.governance_alerts ?? [];

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
        <KpiCard label="Ontology Consistency" value={fmtPct(gov?.ontology_consistency_score ?? null)} tone="success" />
        <KpiCard label="Graph Trust" value={fmtPct(val?.trust_breakdown?.graph_trust ?? null)} />
        <KpiCard label="Metadata Coverage" value={fmtPct(val?.trust_breakdown?.consistency ?? null)} tooltip="Proxy for metadata completeness." />
        <KpiCard label="Hallucination Risk" value="Not available" tone="warning" tooltip="No hallucination-rate field in observatory payload." />
        <KpiCard label="Retrieval Proxy" value={fmtPct(val?.trust_breakdown?.f1_proxy ?? null)} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Verdict Distribution
            <MetricTooltip text="Derived from available ontology violation counters." />
          </div>
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={verdicts}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#7c3aed" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Rejected / Violating Relationships</div>
          <div className="h-[220px] overflow-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-2 pr-2">Type</th>
                  <th className="py-2 pr-2">Count</th>
                  <th className="py-2">Payload</th>
                </tr>
              </thead>
              <tbody>
                {alerts.length ? (
                  alerts.map((a, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-2 pr-2 text-slate-700">{String((a as any).type ?? "alert")}</td>
                      <td className="py-2 pr-2 text-slate-700">{fmtNum((a as any).count ?? 1)}</td>
                      <td className="py-2 text-slate-700">{JSON.stringify(a).slice(0, 120)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="py-3 text-slate-500">No violating relationship records.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
