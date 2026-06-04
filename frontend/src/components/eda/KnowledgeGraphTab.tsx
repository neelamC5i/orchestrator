"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";
import { ObservatoryData } from "./types";
import { EmptyState, fmtNum } from "./common";

export default function KnowledgeGraphTab({ data }: { data: ObservatoryData }) {
  const kg = data.knowledge_graph;
  if (!kg?.entity_growth?.length && !kg?.top_connected_entities?.length) return <EmptyState />;

  return (
    <div className="space-y-3">
      {!!kg.entity_growth.length && (
        <div className="card">
          <div className="sect">Entity Growth</div>
          <div style={{ width: "100%", height: 170 }}>
            <ResponsiveContainer>
              <LineChart data={kg.entity_growth.map((x) => ({ x: x.created_at.slice(0, 10), y: x.count }))}>
                <XAxis dataKey="x" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line dataKey="y" stroke="#7c6af8" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {!!kg.relationship_growth.length && (
        <div className="card">
          <div className="sect">Relationship Growth</div>
          <div style={{ width: "100%", height: 170 }}>
            <ResponsiveContainer>
              <LineChart data={kg.relationship_growth.map((x) => ({ x: x.created_at.slice(0, 10), y: x.count }))}>
                <XAxis dataKey="x" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line dataKey="y" stroke="#16a34a" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card overflow-auto">
        <div className="sect">Top 10 Connected Entities</div>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-t3 border-b border-dborder">
              <th className="py-2 pr-2">Entity</th>
              <th className="py-2">Degree</th>
            </tr>
          </thead>
          <tbody>
            {(kg.top_connected_entities ?? []).map((r) => (
              <tr key={r.entity} className="border-b border-dborder/60">
                <td className="py-2 pr-2 text-t2">{r.entity}</td>
                <td className="py-2 text-t2">{fmtNum(r.degree)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mcard inline-block">
        <div className="text-[10px] text-t3 uppercase tracking-wider">Orphan Nodes</div>
        <div className="text-[20px] font-bold text-t1">{fmtNum(kg.orphan_nodes_count ?? 0)}</div>
      </div>
    </div>
  );
}
