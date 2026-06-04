"use client";

import { ObservatoryData } from "./types";
import { EmptyState, fmtNum, fmtPct } from "./common";

export default function GovernanceOntologyTab({ data }: { data: ObservatoryData }) {
  const g = data.governance_ontology;
  if (!g) return <EmptyState />;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="mcard"><div className="text-[10px] text-t3">Ontology Consistency</div><div className="text-[18px] font-bold text-t1">{fmtPct(g.ontology_consistency_score ?? null)}</div></div>
        <div className="mcard"><div className="text-[10px] text-t3">Type Violations</div><div className="text-[18px] font-bold text-t1">{fmtNum(g.relationship_type_violations ?? 0)}</div></div>
        <div className="mcard"><div className="text-[10px] text-t3">Entity Types</div><div className="text-[18px] font-bold text-t1">{fmtNum(g.schema_adherence?.type_count ?? 0)}</div></div>
        <div className="mcard"><div className="text-[10px] text-t3">Relation Types</div><div className="text-[18px] font-bold text-t1">{fmtNum(g.schema_adherence?.relation_count ?? 0)}</div></div>
      </div>

      <div className="card">
        <div className="sect">Governance Alerts</div>
        <div className="text-[11px] text-t2 max-h-44 overflow-auto">
          {g.governance_alerts?.length
            ? g.governance_alerts.map((a, i) => <div key={i}>{JSON.stringify(a)}</div>)
            : "No governance alerts."}
        </div>
      </div>
    </div>
  );
}
