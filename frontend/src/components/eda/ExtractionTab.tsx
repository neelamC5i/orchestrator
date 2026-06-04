"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LineChart, Line } from "recharts";
import { ObservatoryData } from "./types";
import { EmptyState, fmtPct, fmtNum } from "./common";

export default function ExtractionTab({ data }: { data: ObservatoryData }) {
  const parser = data.extraction?.parser_confidence ?? [];
  const ocr = data.extraction?.ocr_confidence_timeline ?? [];
  const lineage = data.extraction?.lineage ?? [];

  if (!parser.length && !lineage.length) return <EmptyState message="No extraction data available." />;

  return (
    <div className="space-y-3">
      {!!parser.length && (
        <div className="card">
          <div className="sect">Parser Confidence</div>
          <div style={{ width: "100%", height: 190 }}>
            <ResponsiveContainer>
              <BarChart data={parser.map((p) => ({
                name: p.source_file,
                confidence: (p.confidence ?? 0) * 100,
              }))}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="confidence" fill="#7c6af8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {!!ocr.length && (
        <div className="card">
          <div className="sect">OCR Confidence Timeline</div>
          <div style={{ width: "100%", height: 190 }}>
            <ResponsiveContainer>
              <LineChart data={ocr.map((x) => ({ x: `${x.source_file}:${x.point}`, y: (x.confidence ?? 0) * 100 }))}>
                <XAxis dataKey="x" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                <Tooltip />
                <Line dataKey="y" stroke="#16a34a" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {!!lineage.length && (
        <div className="card overflow-auto">
          <div className="sect">Extraction Lineage</div>
          <table className="w-full text-[11px] border-collapse">
            <thead>
              <tr className="text-left text-t3 border-b border-dborder">
                <th className="py-2 pr-2">chunk_id</th>
                <th className="py-2 pr-2">source_file</th>
                <th className="py-2 pr-2">adapter</th>
                <th className="py-2 pr-2">confidence</th>
                <th className="py-2 pr-2">page/row</th>
                <th className="py-2 pr-2">entity_count</th>
                <th className="py-2">warnings</th>
              </tr>
            </thead>
            <tbody>
              {lineage.map((r) => (
                <tr key={r.chunk_id} className="border-b border-dborder/60">
                  <td className="py-2 pr-2 text-t2 font-mono">{r.chunk_id}</td>
                  <td className="py-2 pr-2 text-t2">{r.source_file}</td>
                  <td className="py-2 pr-2 text-t2">{r.adapter ?? "-"}</td>
                  <td className="py-2 pr-2 text-t2">{fmtPct(r.confidence)}</td>
                  <td className="py-2 pr-2 text-t2">{r.page_row ?? "-"}</td>
                  <td className="py-2 pr-2 text-t2">{fmtNum(r.entity_count ?? 0)}</td>
                  <td className="py-2 text-t2">{(r.warnings ?? []).join(", ") || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
