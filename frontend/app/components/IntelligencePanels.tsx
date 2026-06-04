"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

/**
 * Expandable per-layer intelligence panels for the 14-layer pipeline.
 * Reads the artifacts produced by the new semantic-intelligence layers from
 * GET /api/v1/data/intelligence/{job_id} and renders them with recharts.
 * Read-only and additive — appears once the graph is built (ready=true).
 */

interface Props {
  jobId: string;
  ready: boolean;
}

interface IntelData {
  metadata_intelligence?: any;
  semantic_learning?: any;
  ml_validation?: any;
  ontology?: any;
  graph_validation?: any;
}

const PURPLE = "#7c6af8";
const GREEN = "#16a34a";
const AMBER = "#d97706";
const RED = "#e63755";

function pct(v: any): string {
  const n = Number(v);
  if (!isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

function StatTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center bg-white border border-dborder rounded-lg p-2.5">
      <div className="text-[16px] font-bold leading-none" style={{ color }}>{value}</div>
      <div className="text-[9px] text-t3 mt-1 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function Histogram({ data, color }: { data: { bin_start: number; count: number }[]; color: string }) {
  const rows = (data ?? []).map(d => ({ name: `${(d.bin_start * 100).toFixed(0)}`, count: d.count }));
  if (!rows.length) return <div className="text-[11px] text-t3">No data</div>;
  return (
    <div style={{ width: "100%", height: 120 }}>
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
          <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#9898b0" }} />
          <YAxis tick={{ fontSize: 9, fill: "#9898b0" }} allowDecimals={false} />
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
          <Bar dataKey="count" fill={color} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TaxonomyBars({ taxonomy }: { taxonomy: Record<string, number> }) {
  const rows = Object.entries(taxonomy ?? {})
    .map(([name, count]) => ({ name, count: Number(count) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  if (!rows.length) return <div className="text-[11px] text-t3">No taxonomy data</div>;
  return (
    <div style={{ width: "100%", height: Math.max(120, rows.length * 22) }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 9, fill: "#6b6b80" }} />
          <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
          <Bar dataKey="count" radius={[0, 3, 3, 0]}>
            {rows.map((_, i) => <Cell key={i} fill={PURPLE} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Panel({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-bg3 border border-dborder rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-white/50 transition-colors"
      >
        <span className="text-base">{icon}</span>
        <span className="text-[12px] font-semibold text-t1">{title}</span>
        <span className="ml-auto text-t3 text-[11px]">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-dborder">{children}</div>}
    </div>
  );
}

export default function IntelligencePanels({ jobId, ready }: Props) {
  const [data, setData] = useState<IntelData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ready || !jobId) return;
    const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    setLoading(true);
    fetch(`${API}/api/v1/data/intelligence/${jobId}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [ready, jobId]);

  if (!ready) return null;

  const md = data?.metadata_intelligence ?? {};
  const sl = data?.semantic_learning ?? {};
  const ml = data?.ml_validation ?? {};
  const onto = data?.ontology ?? {};
  const gv = data?.graph_validation ?? {};

  return (
    <div className="mb-8">
      <div className="sect">Semantic Intelligence Layers</div>
      {loading && <div className="text-[11px] text-t3 mb-2">Loading layer intelligence…</div>}
      <div className="space-y-2">

        {/* Layer 5 — Metadata Intelligence */}
        <Panel icon="🏷️" title="Metadata Intelligence">
          <div className="grid grid-cols-3 gap-2 mt-3">
            <StatTile label="Tabular files" value={`${md.summary?.tabular_file_count ?? 0}`} color={PURPLE} />
            <StatTile label="Classified" value={`${md.summary?.classified_table_count ?? 0}`} color={GREEN} />
            <StatTile label="FK candidates" value={`${md.summary?.fk_candidate_count ?? 0}`} color={AMBER} />
          </div>
          {!md.summary && <div className="text-[11px] text-t3 mt-2">No tabular metadata in this corpus.</div>}
        </Panel>

        {/* Layer 7 — Semantic Learning */}
        <Panel icon="🧬" title="Semantic Learning">
          <div className="grid grid-cols-3 gap-2 mt-3">
            <StatTile label="Clusters" value={`${sl.summary?.cluster_count ?? 0}`} color={PURPLE} />
            <StatTile label="Unique entities" value={`${sl.summary?.unique_entity_count ?? 0}`} color={GREEN} />
            <StatTile label="Co-occ pairs" value={`${sl.summary?.cooccurrence_pair_count ?? 0}`} color={AMBER} />
          </div>
          {Array.isArray(sl.clusters) && sl.clusters.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {sl.clusters.slice(0, 8).map((c: any) => (
                <span key={c.cluster_id} className="text-[10px] px-2 py-1 rounded-full bg-accent/10 text-accent border border-accent/20">
                  {(c.members ?? []).slice(0, 2).join(", ")}{c.size > 2 ? ` +${c.size - 2}` : ""}
                </span>
              ))}
            </div>
          )}
        </Panel>

        {/* Layer 9 — ML Validation & Accuracy */}
        <Panel icon="🎯" title="ML Validation & Accuracy">
          <div className="grid grid-cols-4 gap-2 mt-3">
            <StatTile label="Precision" value={pct(ml.precision_proxy)} color={GREEN} />
            <StatTile label="Recall" value={pct(ml.recall_proxy)} color={GREEN} />
            <StatTile label="F1" value={pct(ml.f1_proxy)} color={PURPLE} />
            <StatTile label="Halluc. risk" value={pct(ml.hallucination_risk)} color={RED} />
          </div>
          <div className="mt-3">
            <div className="text-[10px] text-t3 uppercase tracking-wider mb-1">Entity confidence distribution</div>
            <Histogram data={ml.entity_confidence_histogram} color={PURPLE} />
          </div>
        </Panel>

        {/* Layer 10 — Ontology & Governance */}
        <Panel icon="📐" title="Ontology & Governance">
          <div className="grid grid-cols-3 gap-2 mt-3 mb-3">
            <StatTile label="Entity types" value={`${onto.summary?.type_count ?? 0}`} color={PURPLE} />
            <StatTile label="Relations" value={`${onto.summary?.relation_count ?? 0}`} color={GREEN} />
            <StatTile label="Violations" value={`${onto.summary?.violation_count ?? 0}`} color={RED} />
          </div>
          <div className="text-[10px] text-t3 uppercase tracking-wider mb-1">Entity-type taxonomy</div>
          <TaxonomyBars taxonomy={onto.taxonomy} />
        </Panel>

        {/* Layer 13 — Graph Validation & Consistency */}
        <Panel icon="✅" title="Graph Validation & Consistency">
          <div className="grid grid-cols-4 gap-2 mt-3">
            <StatTile label="Trust score" value={pct(gv.trust_score)} color={GREEN} />
            <StatTile label="Orphans" value={`${gv.orphan_node_count ?? 0}`} color={AMBER} />
            <StatTile label="Cycles" value={`${gv.cycle_count ?? 0}`} color={AMBER} />
            <StatTile label="Onto. viol." value={`${gv.ontology_violation_count ?? 0}`} color={RED} />
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <StatTile label="Nodes" value={`${gv.node_count ?? 0}`} color={PURPLE} />
            <StatTile label="Edges" value={`${gv.edge_count ?? 0}`} color={PURPLE} />
            <StatTile label="Weak edges" value={`${gv.weak_edge_count ?? 0}`} color={AMBER} />
          </div>
        </Panel>

      </div>
    </div>
  );
}
