"use client";

import { ObservatoryData } from "./types";
import { EmptyState, fmtNum, fmtPct } from "./common";

export default function ValidationTrustTab({ data }: { data: ObservatoryData }) {
  const v = data.validation_trust;
  if (!v) return <EmptyState />;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="mcard"><div className="text-[10px] text-t3">Schema Errors</div><div className="text-[18px] font-bold text-t1">{fmtNum(v.validation_errors?.schema ?? 0)}</div></div>
        <div className="mcard"><div className="text-[10px] text-t3">Null Errors</div><div className="text-[18px] font-bold text-t1">{fmtNum(v.validation_errors?.nulls ?? null)}</div></div>
        <div className="mcard"><div className="text-[10px] text-t3">Duplicate Errors</div><div className="text-[18px] font-bold text-t1">{fmtNum(v.validation_errors?.duplicates ?? 0)}</div></div>
        <div className="mcard"><div className="text-[10px] text-t3">Ontology Violations</div><div className="text-[18px] font-bold text-t1">{fmtNum(v.ontology_violations ?? 0)}</div></div>
      </div>

      <div className="mcard inline-block">
        <div className="text-[10px] text-t3">Orphan Nodes</div>
        <div className="text-[18px] font-bold text-t1">{fmtNum(v.orphan_nodes ?? 0)}</div>
      </div>

      <div className="card">
        <div className="sect">Trust Score Breakdown</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[11px]">
          <div className="mcard"><div className="text-t3">Trust</div><div className="text-t1 font-semibold">{fmtPct(v.trust_breakdown?.trust_score ?? null)}</div></div>
          <div className="mcard"><div className="text-t3">Consistency</div><div className="text-t1 font-semibold">{fmtPct(v.trust_breakdown?.consistency ?? null)}</div></div>
          <div className="mcard"><div className="text-t3">Confidence</div><div className="text-t1 font-semibold">{fmtPct(v.trust_breakdown?.confidence ?? null)}</div></div>
          <div className="mcard"><div className="text-t3">Graph Trust</div><div className="text-t1 font-semibold">{fmtPct(v.trust_breakdown?.graph_trust ?? null)}</div></div>
          <div className="mcard"><div className="text-t3">F1 Proxy</div><div className="text-t1 font-semibold">{fmtPct(v.trust_breakdown?.f1_proxy ?? null)}</div></div>
        </div>
      </div>
    </div>
  );
}
