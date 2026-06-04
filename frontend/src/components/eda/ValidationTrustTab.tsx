"use client";

import { ObservatoryData } from "./types";
import { EmptyState, fmtNum, fmtPct } from "./common";
import KpiCard from "./KpiCard";

export default function ValidationTrustTab({ data }: { data: ObservatoryData }) {
  const v = data.validation_trust;
  if (!v) return <EmptyState />;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
        <KpiCard label="Graph Trust Score" value={fmtPct(v.trust_breakdown?.graph_trust ?? null)} tooltip="Composite trust score for graph structure and consistency." />
        <KpiCard label="Hallucination Risk" value="Not available" tone="warning" tooltip="Not present in current observatory payload." />
        <KpiCard label="Calibration Error" value="Not available" tooltip="Expected calibration error is pending from model validation payload." />
        <KpiCard label="Metadata Coverage" value={fmtPct(v.trust_breakdown?.consistency ?? null)} />
        <KpiCard label="Retrieval Proxy" value={fmtPct(v.trust_breakdown?.f1_proxy ?? null)} />
      </div>

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <KpiCard label="Entity Precision" value="Not available" />
        <KpiCard label="Entity Recall" value="Not available" />
        <KpiCard label="Entity F1" value={fmtPct(v.trust_breakdown?.f1_proxy ?? null)} />
        <KpiCard label="Relationship F1" value={fmtPct(v.trust_breakdown?.confidence ?? null)} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Validation Counters</div>
        <div className="grid grid-cols-2 gap-2 text-[11px] md:grid-cols-5">
          <div className="rounded-lg bg-slate-50 p-2"><span className="text-slate-500">Schema:</span> {fmtNum(v.validation_errors?.schema ?? 0)}</div>
          <div className="rounded-lg bg-slate-50 p-2"><span className="text-slate-500">Nulls:</span> {fmtNum(v.validation_errors?.nulls ?? null)}</div>
          <div className="rounded-lg bg-slate-50 p-2"><span className="text-slate-500">Duplicates:</span> {fmtNum(v.validation_errors?.duplicates ?? 0)}</div>
          <div className="rounded-lg bg-slate-50 p-2"><span className="text-slate-500">Ontology Violations:</span> {fmtNum(v.ontology_violations ?? 0)}</div>
          <div className="rounded-lg bg-slate-50 p-2"><span className="text-slate-500">Orphan Nodes:</span> {fmtNum(v.orphan_nodes ?? 0)}</div>
        </div>
      </div>
    </div>
  );
}
