"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { ObservatoryData } from "./types";
import { EmptyState, fmtPct, fmtNum } from "./common";

export default function MetadataTab({ data }: { data: ObservatoryData }) {
  const completeness = data.metadata?.completeness ?? [];
  const missing = data.metadata?.missing_schema_fields ?? [];
  const coverage = data.metadata?.type_coverage ?? [];
  const richness = data.metadata?.richness_heatmap ?? [];

  if (!completeness.length && !richness.length) return <EmptyState message="No metadata extracted yet." />;

  return (
    <div className="space-y-3">
      {!!completeness.length && (
        <div className="card">
          <div className="sect">Completeness Score</div>
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer>
              <BarChart data={completeness.map((c) => ({ name: c.target, score: (c.score ?? 0) * 100 }))}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="score" fill="#16a34a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="card">
          <div className="sect">Missing Schema Fields</div>
          <div className="text-[11px] text-t2 max-h-36 overflow-auto">
            {missing.length ? missing.map((m, i) => <div key={`${m.target}-${m.field}-${i}`}>{m.target}: {m.field}</div>) : "None"}
          </div>
        </div>
        <div className="card">
          <div className="sect">Type Coverage</div>
          <div className="text-[11px] text-t2 max-h-36 overflow-auto">
            {coverage.length ? coverage.map((c, i) => <div key={`${c.target}-${i}`}>{c.target}: {fmtPct(c.coverage)}</div>) : "Not available"}
          </div>
        </div>
      </div>

      {!!richness.length && (
        <div className="card">
          <div className="sect">Metadata Richness Heatmap</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {richness.map((r) => (
              <div key={r.target} className="mcard">
                <div className="text-[11px] text-t3">{r.target}</div>
                <div className="text-[18px] font-bold text-accent">{fmtNum(r.richness ?? 0)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
