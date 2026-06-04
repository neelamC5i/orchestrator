"use client";

import { ObservatoryData } from "./types";
import { EmptyState, StatCard, fmtPct, fmtNum } from "./common";

export default function OverviewTab({ data }: { data: ObservatoryData }) {
  const d = data.overview;
  const hasData = [d.entities_count, d.relationships_count, d.graph_nodes].some(v => Number(v || 0) > 0);
  if (!hasData) return <EmptyState />;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <StatCard label="Entities" value={fmtNum(d.entities_count)} />
      <StatCard label="Relationships" value={fmtNum(d.relationships_count)} />
      <StatCard label="Graph Nodes" value={fmtNum(d.graph_nodes)} />
      <StatCard label="Trust Score" value={fmtPct(d.trust_score)} />
      <StatCard label="Ontology Consistency" value={fmtPct(d.ontology_consistency)} />
    </div>
  );
}
