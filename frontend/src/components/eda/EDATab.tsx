"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { ObservatoryData } from "./types";
import { EmptyState, fmtNum } from "./common";

export default function EDATab({ data }: { data: ObservatoryData }) {
  const stats = data.eda?.column_statistics ?? [];
  const hist = data.eda?.histograms ?? [];
  const outliers = data.eda?.outliers ?? [];
  const boxPlots = data.eda?.box_plots ?? [];

  const hasAnyEDAVisual = stats.length > 0 || hist.length > 0 || outliers.length > 0 || boxPlots.length > 0;
  if (!hasAnyEDAVisual) return <EmptyState message="No numeric columns found in ingested data." />;

  return (
    <div className="space-y-3">
      {!!stats.length && (
        <div className="card overflow-auto">
          <div className="sect">Column Statistics</div>
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="border-b border-dborder text-left text-t3">
                <th className="py-2 pr-2">file</th>
                <th className="py-2 pr-2">column</th>
                <th className="py-2 pr-2">mean</th>
                <th className="py-2 pr-2">median</th>
                <th className="py-2 pr-2">std</th>
                <th className="py-2 pr-2">p10</th>
                <th className="py-2">p90</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => (
                <tr key={`${s.file_id}-${s.column}-${i}`} className="border-b border-dborder/60">
                  <td className="py-2 pr-2">{s.file_id}</td>
                  <td className="py-2 pr-2">{s.column}</td>
                  <td className="py-2 pr-2">{fmtNum(s.mean ?? null)}</td>
                  <td className="py-2 pr-2">{fmtNum(s.median ?? null)}</td>
                  <td className="py-2 pr-2">{fmtNum(s.std ?? null)}</td>
                  <td className="py-2 pr-2">{fmtNum(s.p10 ?? null)}</td>
                  <td className="py-2">{fmtNum(s.p90 ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!!hist.length && (
        <div className="card">
          <div className="sect">Histograms</div>
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <BarChart
                data={hist[0].bins.map((b, i) => ({ x: `${b.bin_start}-${b.bin_end}`, y: b.count, i }))}
              >
                <XAxis dataKey="x" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="y" fill="#7c6af8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="card">
          <div className="sect">Outlier Detection</div>
          <div className="text-[12px] text-t2">{outliers.length ? `${outliers.length} outlier records` : "No outlier data"}</div>
        </div>
        <div className="card">
          <div className="sect">Box Plots</div>
          <div className="text-[12px] text-t2">{boxPlots.length ? `${boxPlots.length} box plot records` : "No box plot data"}</div>
        </div>
      </div>
    </div>
  );
}
