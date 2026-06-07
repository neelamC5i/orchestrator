"use client";

import { useEffect, useState, useCallback, type ReactNode, type FC, type Key } from "react";
import { X, Clock, CheckCircle2, AlertTriangle, Loader2, FileText, Database, Brain, BarChart3, Shield, Network, BookOpen } from "lucide-react";
import type { PipelineLayer } from "./PipelineLayerList";
import { API_BASE } from "../lib/api";

interface LayerDetailPanelProps {
  layer: PipelineLayer;
  jobId: string;
  initialArtifacts?: ArtifactData;
  onClose: () => void;
}

interface ArtifactData {
  [key: string]: unknown;
}

const LAYER_ICONS: Record<string, typeof FileText> = {
  upload: FileText, extract: Database, clean: FileText, chunk: FileText,
  metadata: Brain, entities: Network, semantic: Brain, eda: BarChart3,
  validation: Shield, ontology: Shield, canonical: Network,
  graph_build: Network, graph_consist: Shield, wiki: BookOpen,
};

function formatTimestamp(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(startMs: number | null, endMs: number | null): string {
  if (!startMs) return "—";
  const end = endMs ?? Date.now() / 1000;
  const diff = Math.max(0, Math.round(end - startMs));
  if (diff < 60) return `${diff}s`;
  return `${Math.floor(diff / 60)}m ${diff % 60}s`;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="text-[10px] font-semibold text-t3 uppercase tracking-wider mb-2">{children}</div>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="bg-bg3 border border-dborder rounded-sm px-3 py-3">
      <div className="text-[11px] font-semibold text-t2">{title}</div>
      <div className="text-[10px] text-t3 mt-0.5 leading-relaxed">{detail}</div>
    </div>
  );
}

function MetricBar({ label, value, max, color = "bg-accent", showPct = false }: { key?: Key; label: string; value: number; max: number; color?: string; showPct?: boolean }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="text-[10px] text-t3 w-32 flex-shrink-0 truncate capitalize">{label.replace(/_/g, " ")}</div>
      <div className="flex-1 h-1.5 bg-bg4 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-t2 font-medium tabular-nums w-14 text-right">
        {showPct ? `${(value * 100).toFixed(0)}%` : (typeof value === "number" && value < 1 && value > 0) ? value.toFixed(4) : value}
      </div>
    </div>
  );
}

function ConfidenceHistogram({ bins, title }: { bins: { bin_start: number; bin_end: number; count: number }[]; title: string }) {
  if (!bins || bins.length === 0) return null;
  const maxCount = Math.max(...bins.map(b => b.count), 1);
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <div className="flex items-end gap-0.5 h-16">
        {bins.map((b, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
            <div
              className="w-full bg-accent/70 rounded-t-sm transition-all duration-300"
              style={{ height: `${Math.max(2, (b.count / maxCount) * 56)}px` }}
            />
            <div className="text-[7px] text-t3 tabular-nums">{b.bin_start.toFixed(1)}</div>
          </div>
        ))}
      </div>
      <div className="text-[8px] text-t3 text-center mt-0.5">Confidence Range →</div>
    </div>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  if (rows.length === 0) return <div className="text-[11px] text-t3 italic">No data available</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-dborder">
            {headers.map(h => (
              <th key={h} className="text-left py-1.5 px-2 text-t3 font-semibold uppercase tracking-wider text-[9px]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-dborder/50 hover:bg-bg3 transition-colors">
              {row.map((cell, j) => (
                <td key={j} className="py-1.5 px-2 text-t2 font-dm">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiniStat({ label, value, color }: { key?: Key; label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-bg3 border border-dborder rounded-sm px-3 py-2">
      <div className={`text-[14px] font-bold tabular-nums ${color ?? "text-t1"}`}>{value}</div>
      <div className="text-[9px] text-t3 uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    PERSON: "bg-blue/10 text-blue border-blue/20",
    ORG: "bg-purple/10 text-purple border-purple/20",
    GPE: "bg-teal/10 text-teal border-teal/20",
    DATE: "bg-amber/10 text-amber border-amber/20",
    ENTITY: "bg-accent/10 text-accent border-accent/20",
  };
  const cls = colors[type?.toUpperCase()] ?? "bg-bg4 text-t3 border-dborder";
  return <span className={`text-[8px] font-semibold px-1.5 py-0.5 rounded border ${cls}`}>{type}</span>;
}

function IssueList({ items, color = "text-t2" }: { items: unknown[]; color?: string }) {
  if (!items || items.length === 0) return <div className="text-[10px] text-t3 italic">None detected</div>;
  return (
    <div className="space-y-1 max-h-36 overflow-y-auto">
      {items.slice(0, 15).map((item, i) => (
        <div key={i} className={`text-[10px] ${color} font-dm bg-bg3 border border-dborder rounded-sm px-2 py-1`}>
          {typeof item === "string" ? item : JSON.stringify(item)}
        </div>
      ))}
      {items.length > 15 && <div className="text-[9px] text-t3">+ {items.length - 15} more</div>}
    </div>
  );
}

// ── Per-layer renderers ──────────────────────────────────────────────────────

function UploadDetail({ data }: { data: ArtifactData }) {
  const files = (data.files as { file_id: string; name: string; ext: string; size_bytes: number }[]) ?? [];
  return (
    <div className="space-y-3">
      <div className="text-[10px] text-t3 font-medium">{data.file_count as number ?? 0} files uploaded</div>
      <DataTable
        headers={["File", "Type", "Size"]}
        rows={files.map(f => [f.name, f.ext.toUpperCase(), `${(f.size_bytes / 1024).toFixed(1)} KB`])}
      />
    </div>
  );
}

function ExtractDetail({ data }: { data: ArtifactData }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Files Extracted" value={data.files_extracted as number ?? 0} />
        <MiniStat label="Errors" value={data.extract_errors as number ?? 0} color={data.extract_errors ? "text-coral" : undefined} />
        <MiniStat label="Total Chars" value={(data.total_chars as number ?? 0).toLocaleString()} />
      </div>
      {(data.corpus_files as string[])?.length > 0 && (
        <div className="text-[10px] text-t3">{(data.corpus_files as string[]).length} corpus files generated</div>
      )}
    </div>
  );
}

function ChunkDetail({ data }: { data: ArtifactData }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <MiniStat label="Total Chunks" value={data.total_chunks as number ?? 0} />
      <MiniStat label="Avg Coverage" value={`${data.avg_coverage_pct ?? 0}%`} />
      <MiniStat label="Chunk Size" value={data.chunk_size as number ?? 400} />
      <MiniStat label="Overlap" value={data.overlap as number ?? 60} />
    </div>
  );
}

function EntityDetail({ data }: { data: ArtifactData }) {
  const entities = (data.entity_sample as { canonical_id?: string; label?: string; text?: string; entity_type?: string; type?: string; confidence?: number; source_files?: string[] }[]) ?? [];
  const rels = (data.relationship_sample as { source_canonical_id?: string; target_canonical_id?: string; source?: string; target?: string; relation?: string; confidence?: number }[]) ?? [];
  const confHist = data.confidence_histograms as { entities?: { bin_start: number; bin_end: number; count: number }[]; relationships?: { bin_start: number; bin_end: number; count: number }[] } | undefined;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Entities" value={data.entity_count as number ?? entities.length} />
        <MiniStat label="Relationships" value={data.relationship_count as number ?? rels.length} />
        <MiniStat label="File Graphs" value={data.per_file_graph_count as number ?? 0} />
      </div>

      {confHist?.entities && <ConfidenceHistogram bins={confHist.entities} title="Entity Confidence Distribution" />}
      {confHist?.relationships && <ConfidenceHistogram bins={confHist.relationships} title="Relationship Confidence Distribution" />}

      {entities.length > 0 && (
        <div>
          <SectionTitle>Top Entities (by confidence)</SectionTitle>
          <DataTable
            headers={["Entity", "Type", "Confidence", "Sources"]}
            rows={entities.slice(0, 20).map(e => [
              e.label ?? e.text ?? e.canonical_id ?? "—",
              e.entity_type ?? e.type ?? "—",
              e.confidence != null ? e.confidence.toFixed(3) : "—",
              e.source_files ? String(e.source_files.length) : "—",
            ])}
          />
        </div>
      )}
      {rels.length > 0 && (
        <div>
          <SectionTitle>Relationships (by confidence)</SectionTitle>
          <DataTable
            headers={["Source", "Relation", "Target", "Conf."]}
            rows={rels.slice(0, 15).map(r => [
              r.source_canonical_id ?? r.source ?? "—",
              r.relation ?? "—",
              r.target_canonical_id ?? r.target ?? "—",
              r.confidence != null ? r.confidence.toFixed(3) : "—",
            ])}
          />
        </div>
      )}
    </div>
  );
}

function SemanticDetail({ data }: { data: ArtifactData }) {
  const confHist = data.confidence_histograms as { entities?: { bin_start: number; bin_end: number; count: number }[]; relationships?: { bin_start: number; bin_end: number; count: number }[] } | undefined;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Entities Scored" value={data.entities_scored as number ?? 0} />
        <MiniStat label="Relationships Scored" value={data.relationships_scored as number ?? 0} />
        <MiniStat label="Avg Entity Conf." value={(data.avg_entity_confidence as number ?? 0).toFixed(4)} />
        <MiniStat label="Avg Rel. Conf." value={(data.avg_relationship_confidence as number ?? 0).toFixed(4)} />
      </div>
      {confHist?.entities && <ConfidenceHistogram bins={confHist.entities} title="Entity Confidence Distribution" />}
      {confHist?.relationships && <ConfidenceHistogram bins={confHist.relationships} title="Relationship Confidence Distribution" />}
    </div>
  );
}

function EDADetail({ data }: { data: ArtifactData }) {
  const scorecards = (data.scorecards as Record<string, number>[]) ?? [];
  const visuals = (data.visuals as Record<string, unknown>[]) ?? [];
  const firstCard = scorecards[0] ?? (data.scorecard as Record<string, number> | undefined) ?? {};
  const firstVisual = visuals[0] ?? data;

  const SCORE_KEYS = [
    "completeness_score", "consistency_score", "confidence_score",
    "graph_trust_score", "retrieval_readiness_score", "semantic_coherence_score",
    "canonical_resolution_score", "extraction_reliability_score",
  ];
  const overallScore = firstCard.overall_kg_quality_score as number ?? 0;

  const entityDist = (firstVisual.entity_distribution as { type: string; count: number }[]) ?? [];
  const relationDist = (firstVisual.relation_distributions as { relation: string; count: number }[]) ?? [];
  const confHist = firstVisual.confidence_histograms as { entities?: { bin_start: number; bin_end: number; count: number }[]; relationships?: { bin_start: number; bin_end: number; count: number }[] } | undefined;

  const graphMetrics = (data.eda_summaries as Record<string, unknown>[])
    ?.[0]?.graph_metrics as Record<string, unknown> | undefined;
  const directGraphMetrics = (data.graph_metrics as Record<string, unknown> | undefined) ?? graphMetrics;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Files Analyzed" value={data.files_analyzed as number ?? 0} />
        <MiniStat label="EDA Errors" value={data.eda_errors as number ?? 0} color={data.eda_errors ? "text-coral" : undefined} />
        <MiniStat label="Overall Quality" value={overallScore > 0 ? `${(overallScore * 100).toFixed(0)}%` : "—"} color={overallScore >= 0.7 ? "text-gg" : overallScore >= 0.4 ? "text-amber" : "text-coral"} />
      </div>

      {SCORE_KEYS.some(k => firstCard[k] != null) && (
        <div>
          <SectionTitle>Quality Scorecard</SectionTitle>
          <div className="space-y-1.5">
            {SCORE_KEYS.map(k => {
              const v = firstCard[k] as number ?? 0;
              return <MetricBar key={k} label={k.replace(/_score$/, "")} value={v} max={1} showPct color={v >= 0.7 ? "bg-gg" : v >= 0.4 ? "bg-amber" : "bg-coral"} />;
            })}
          </div>
        </div>
      )}

      {confHist?.entities && <ConfidenceHistogram bins={confHist.entities} title="Entity Confidence Histogram" />}
      {confHist?.relationships && <ConfidenceHistogram bins={confHist.relationships} title="Relationship Confidence Histogram" />}

      {entityDist.length > 0 && (
        <div>
          <SectionTitle>Entity Type Distribution</SectionTitle>
          <div className="space-y-1">
            {entityDist.slice(0, 10).map(d => (
              <div key={d.type} className="flex items-center gap-2">
                <TypeBadge type={d.type} />
                <div className="flex-1 h-1 bg-bg4 rounded-full overflow-hidden">
                  <div className="h-full bg-accent/60 rounded-full" style={{ width: `${Math.min(100, (d.count / Math.max(...entityDist.map(e => e.count), 1)) * 100)}%` }} />
                </div>
                <span className="text-[9px] text-t2 tabular-nums w-8 text-right">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {relationDist.length > 0 && (
        <div>
          <SectionTitle>Relation Distribution</SectionTitle>
          <div className="flex flex-wrap gap-1">
            {relationDist.slice(0, 15).map(r => (
              <span key={r.relation} className="apill">{r.relation} ({r.count})</span>
            ))}
          </div>
        </div>
      )}

      {!scorecards.length && !visuals.length && (
        <EmptyState title="EDA visuals unavailable" detail="The pipeline did not produce EDA artifact files for this job yet. If the source has no extracted entities or relationships, this can be a valid empty result." />
      )}

      {directGraphMetrics && (
        <div>
          <SectionTitle>Graph Metrics</SectionTitle>
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Nodes" value={directGraphMetrics.node_count as number ?? 0} />
            <MiniStat label="Edges" value={directGraphMetrics.edge_count as number ?? 0} />
            <MiniStat label="Density" value={(directGraphMetrics.graph_density as number ?? 0).toFixed(4)} />
          </div>
        </div>
      )}
    </div>
  );
}

function ValidationDetail({ data }: { data: ArtifactData }) {
  const breakdown = data.score_breakdown as Record<string, number> | undefined;
  const SCORE_LABELS: Record<string, string> = {
    overall_kg_quality_score: "Overall KG Quality",
    completeness_score: "Completeness",
    consistency_score: "Consistency",
    confidence_score: "Confidence",
    graph_trust_score: "Graph Trust",
    retrieval_readiness_score: "Retrieval Readiness",
    semantic_coherence_score: "Semantic Coherence",
    canonical_resolution_score: "Canonical Resolution",
    extraction_reliability_score: "Extraction Reliability",
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Files Validated" value={data.files_validated as number ?? 0} />
        <MiniStat label="Avg Trust" value={(data.avg_trust_score as number ?? 0).toFixed(4)} color={
          (data.avg_trust_score as number ?? 0) >= 0.7 ? "text-gg" : (data.avg_trust_score as number ?? 0) >= 0.4 ? "text-amber" : "text-coral"
        } />
        <MiniStat label="Avg Quality" value={(data.avg_quality_score as number ?? 0).toFixed(4)} color={
          (data.avg_quality_score as number ?? 0) >= 0.7 ? "text-gg" : (data.avg_quality_score as number ?? 0) >= 0.4 ? "text-amber" : "text-coral"
        } />
      </div>

      {breakdown && Object.keys(breakdown).length > 0 && (
        <div>
          <SectionTitle>Score Breakdown</SectionTitle>
          <div className="space-y-1.5">
            {Object.entries(breakdown).map(([k, v]) => (
              <MetricBar key={k} label={SCORE_LABELS[k] ?? k} value={v} max={1} showPct color={v >= 0.7 ? "bg-gg" : v >= 0.4 ? "bg-amber" : "bg-coral"} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OntologyDetail({ data }: { data: ArtifactData }) {
  const violations = (data.violation_samples as unknown[]) ?? [];
  const contradictions = (data.contradiction_samples as unknown[]) ?? [];
  const temporal = (data.temporal_issues as unknown[]) ?? [];
  const semMetrics = data.semantic_metrics as Record<string, unknown> | undefined;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Violations" value={data.ontology_violations as number ?? violations.length} color={violations.length > 0 ? "text-coral" : "text-gg"} />
        <MiniStat label="Contradictions" value={data.semantic_contradictions as number ?? contradictions.length} color={contradictions.length > 0 ? "text-amber" : "text-gg"} />
      </div>

      {semMetrics?.consistency_score != null && (
        <MetricBar label="Consistency Score" value={semMetrics.consistency_score as number} max={1} showPct
          color={(semMetrics.consistency_score as number) >= 0.7 ? "bg-gg" : "bg-amber"} />
      )}

      {violations.length > 0 && (
        <div>
          <SectionTitle>Ontology Violations</SectionTitle>
          <IssueList items={violations} color="text-coral" />
        </div>
      )}
      {contradictions.length > 0 && (
        <div>
          <SectionTitle>Semantic Contradictions</SectionTitle>
          <IssueList items={contradictions} color="text-amber" />
        </div>
      )}
      {temporal.length > 0 && (
        <div>
          <SectionTitle>Temporal Inconsistencies</SectionTitle>
          <IssueList items={temporal} />
        </div>
      )}

      {violations.length === 0 && contradictions.length === 0 && temporal.length === 0 && (
        <div className="text-[11px] text-gg flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" /> No governance issues detected
        </div>
      )}
    </div>
  );
}

function CanonicalDetail({ data }: { data: ArtifactData }) {
  const reg = data.registry_summary as Record<string, number> | undefined;
  const mergeHistory = (data.merge_history_sample as { file_id?: string; source_id?: string; target_id?: string; score?: number }[]) ?? [];
  const pendingReviews = (data.pending_review_sample as unknown[]) ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Canonical Nodes" value={data.canonical_nodes as number ?? reg?.total_nodes ?? 0} />
        <MiniStat label="Resolved Nodes" value={data.resolved_nodes as number ?? 0} />
        <MiniStat label="Total Aliases" value={reg?.total_aliases ?? 0} />
        <MiniStat label="Merged" value={data.merged as number ?? reg?.merge_count ?? 0} />
      </div>

      {(reg?.pending_review_count ?? 0) > 0 && (
        <div className="bg-amber/5 border border-amber/20 rounded-sm px-3 py-2">
          <div className="text-[11px] font-semibold text-amber">{reg?.pending_review_count} entities pending human review</div>
        </div>
      )}

      {mergeHistory.length > 0 && (
        <div>
          <SectionTitle>Merge History</SectionTitle>
          <DataTable
            headers={["Source", "Target", "Score"]}
            rows={mergeHistory.slice(0, 10).map(m => [
              m.source_id ?? "—",
              m.target_id ?? "—",
              m.score != null ? m.score.toFixed(3) : "—",
            ])}
          />
        </div>
      )}

      {pendingReviews.length > 0 && (
        <div>
          <SectionTitle>Pending Reviews</SectionTitle>
          <IssueList items={pendingReviews} color="text-amber" />
        </div>
      )}
    </div>
  );
}

function GraphBuildDetail({ data }: { data: ArtifactData }) {
  const centralEntities = (data.central_entities as { label: string; type: string; confidence: number; source_count: number }[]) ?? [];
  const confDist = data.edge_confidence_distribution as { low: number; medium: number; high: number } | undefined;
  const nodeCount = (data.graph_nodes as number) ?? (data.node_count as number) ?? 0;
  const edgeCount = (data.graph_edges as number) ?? (data.edge_count as number) ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Graph Nodes" value={nodeCount} />
        <MiniStat label="Graph Edges" value={edgeCount} />
        <MiniStat label="File Graphs" value={(data.per_file_graph_count as number) ?? 0} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Density" value={((data.density as number) ?? 0).toFixed(4)} />
        <MiniStat label="Avg Degree" value={((data.avg_degree as number) ?? 0).toFixed(2)} />
        <MiniStat label="Cross Links" value={(data.cross_links as number) ?? 0} />
      </div>

      {confDist && (
        <div>
          <SectionTitle>Edge Confidence Distribution</SectionTitle>
          <div className="flex gap-2">
            {([["Low (<0.4)", confDist.low, "bg-coral/60"], ["Medium", confDist.medium, "bg-amber/60"], ["High (>0.7)", confDist.high, "bg-gg/60"]] as [string, number, string][]).map(([label, count, color]) => (
              <div key={label} className="flex-1 bg-bg3 border border-dborder rounded-sm p-2 text-center">
                <div className={`w-full h-2 rounded-full ${color} mb-1.5`} />
                <div className="text-[14px] font-bold text-t1 tabular-nums">{count}</div>
                <div className="text-[8px] text-t3 uppercase">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {centralEntities.length > 0 && (
        <div>
          <SectionTitle>Central Entities</SectionTitle>
          <DataTable
            headers={["Entity", "Type", "Confidence", "Sources"]}
            rows={centralEntities.slice(0, 15).map(e => [
              e.label, e.type, e.confidence.toFixed(3), String(e.source_count),
            ])}
          />
        </div>
      )}

      {nodeCount === 0 && edgeCount === 0 && (
        <EmptyState title="Knowledge graph not generated yet" detail="No canonical graph nodes or edges are available for this job. The snapshot will populate this panel as soon as graph artifacts are written." />
      )}
    </div>
  );
}

function GraphConsistDetail({ data }: { data: ArtifactData }) {
  const weakEdges = (data.weak_edges as unknown[]) ?? [];
  const dupeEntities = (data.duplicate_entities as unknown[]) ?? [];
  const disconnected = (data.disconnected_nodes as unknown[]) ?? [];
  const ontoViolations = (data.ontology_violations as unknown[]) ?? [];
  const gStats = data.graph_stats as Record<string, unknown> | undefined;

  const totalIssues = weakEdges.length + dupeEntities.length + disconnected.length + ontoViolations.length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Density" value={(data.density as number ?? gStats?.density as number ?? 0).toFixed(6)} />
        <MiniStat label="Total Issues" value={totalIssues} color={totalIssues > 0 ? "text-amber" : "text-gg"} />
        <MiniStat label="Active Edges" value={data.active_edges as number ?? gStats?.active_count as number ?? 0} />
        <MiniStat label="Suppressed" value={data.suppressed_edges as number ?? gStats?.suppressed_count as number ?? 0} />
      </div>

      {weakEdges.length > 0 && (
        <div>
          <SectionTitle>Weak Edges ({weakEdges.length})</SectionTitle>
          <IssueList items={weakEdges} color="text-amber" />
        </div>
      )}
      {dupeEntities.length > 0 && (
        <div>
          <SectionTitle>Duplicate Entities ({dupeEntities.length})</SectionTitle>
          <IssueList items={dupeEntities} color="text-coral" />
        </div>
      )}
      {disconnected.length > 0 && (
        <div>
          <SectionTitle>Disconnected Nodes ({disconnected.length})</SectionTitle>
          <IssueList items={disconnected} />
        </div>
      )}
      {ontoViolations.length > 0 && (
        <div>
          <SectionTitle>Ontology Violations ({ontoViolations.length})</SectionTitle>
          <IssueList items={ontoViolations} color="text-coral" />
        </div>
      )}

      {totalIssues === 0 && (
        <div className="text-[11px] text-gg flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5" /> Graph is consistent — no issues detected
        </div>
      )}
    </div>
  );
}

function WikiDetail({ data }: { data: ArtifactData }) {
  const pages = (data.wiki_pages_sample as string[]) ?? [];
  const samplePages = (data.sample_pages as {
    canonical_id: string; title: string; entity_type: string; summary: string;
    key_fact_count: number; related_entity_count: number; source_file_count: number;
    citation_coverage: { facts_with_citations?: number; total_facts?: number };
  }[]) ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Wiki Pages" value={(data.wiki_pages as number) ?? (data.wiki_page_count as number) ?? 0} />
        <MiniStat label="FAISS Indexed" value={(data.faiss_chunks_indexed as number) ?? 0} />
      </div>

      {samplePages.length > 0 && (
        <div>
          <SectionTitle>Generated Wiki Pages Preview</SectionTitle>
          <div className="space-y-2">
            {samplePages.map(p => (
              <div key={p.canonical_id} className="bg-bg3 border border-dborder rounded-sm p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="text-[12px] font-semibold text-t1">{p.title}</div>
                  {p.entity_type && <TypeBadge type={p.entity_type} />}
                </div>
                {p.summary && (
                  <div className="text-[10px] text-t2 leading-relaxed mb-2">{p.summary}</div>
                )}
                <div className="flex gap-3 text-[9px] text-t3">
                  <span>{p.key_fact_count} facts</span>
                  <span>{p.related_entity_count} related</span>
                  <span>{p.source_file_count} sources</span>
                  {p.citation_coverage?.total_facts != null && (
                    <span>{p.citation_coverage.facts_with_citations ?? 0}/{p.citation_coverage.total_facts} cited</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {samplePages.length === 0 && pages.length > 0 && (
        <div>
          <SectionTitle>Pages</SectionTitle>
          <div className="flex flex-wrap gap-1">
            {pages.slice(0, 20).map(p => (
              <span key={p} className="apill">{p}</span>
            ))}
          </div>
        </div>
      )}

      {samplePages.length === 0 && pages.length === 0 && (
        <EmptyState title="Wiki not generated yet" detail="No wiki pages are available for this corpus. This panel will populate after the Wiki + Explainability layer writes its page index." />
      )}
    </div>
  );
}

function GenericDetail({ data }: { data: ArtifactData }) {
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && typeof v !== "object");
  if (entries.length === 0) return <div className="text-[11px] text-t3 italic">No detail data available yet.</div>;
  return (
    <div className="grid grid-cols-2 gap-2">
      {entries.map(([k, v]) => (
        <MiniStat key={k} label={k.replace(/_/g, " ")} value={String(v)} />
      ))}
    </div>
  );
}

const DETAIL_RENDERERS: Record<string, FC<{ data: ArtifactData }>> = {
  upload: UploadDetail, extract: ExtractDetail, clean: GenericDetail,
  chunk: ChunkDetail, metadata: GenericDetail, entities: EntityDetail,
  semantic: SemanticDetail, eda: EDADetail, validation: ValidationDetail,
  ontology: OntologyDetail, canonical: CanonicalDetail,
  graph_build: GraphBuildDetail, graph_consist: GraphConsistDetail, wiki: WikiDetail,
};

export default function LayerDetailPanel({ layer, jobId, initialArtifacts, onClose }: LayerDetailPanelProps) {
  const [artifacts, setArtifacts] = useState<ArtifactData | null>(initialArtifacts ?? null);
  const [loading, setLoading] = useState(!initialArtifacts);
  const [error, setError] = useState<string | null>(null);

  const fetchArtifacts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    const API = API_BASE;
    try {
      const res = await fetch(`${API}/api/v1/pipeline/${jobId}/layer/${layer.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setArtifacts(data.artifacts ?? {});
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch layer detail");
    } finally {
      setLoading(false);
    }
  }, [jobId, layer.id]);

  useEffect(() => {
    setArtifacts(initialArtifacts ?? null);
    setLoading(!initialArtifacts);
    fetchArtifacts(Boolean(initialArtifacts));
    if (layer.status !== "running") return;
    const intervalId = window.setInterval(() => fetchArtifacts(true), 2500);
    return () => window.clearInterval(intervalId);
  }, [fetchArtifacts, initialArtifacts, layer.status, layer.detail]);

  const Icon = LAYER_ICONS[layer.id] ?? FileText;
  const Renderer = DETAIL_RENDERERS[layer.id] ?? GenericDetail;

  let parsedDetail: ArtifactData = {};
  try {
    parsedDetail = layer.detail ? JSON.parse(layer.detail) : {};
  } catch {
    parsedDetail = layer.detail ? { raw: layer.detail } : {};
  }

  const displayData = artifacts ? { ...parsedDetail, ...artifacts } : parsedDetail;

  return (
    <div className="detail-slide bg-card2 border border-dborder rounded-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-dborder bg-bg3/50">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
              layer.status === "done" ? "bg-gg/10 text-gg"
              : layer.status === "running" ? "bg-amber/10 text-amber"
              : layer.status === "error" ? "bg-coral/10 text-coral"
              : "bg-bg4 text-t3"
            }`}>
              <Icon className="w-4 h-4" />
            </div>
            <div>
              <div className="font-sora text-[14px] font-semibold text-t1">{layer.label}</div>
              <div className="text-[10px] text-t3 font-mono">{layer.id}</div>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-bg4 flex items-center justify-center text-t3 hover:text-t1 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Runtime metadata */}
        <div className="flex items-center gap-4 text-[10px]">
          <div className="flex items-center gap-1 text-t3">
            <Clock className="w-3 h-3" />
            <span>Started {formatTimestamp(layer.started_at)}</span>
          </div>
          {layer.completed_at && (
            <div className="text-t3">
              Duration: <span className="text-t2 font-medium">{formatDuration(layer.started_at, layer.completed_at)}</span>
            </div>
          )}
        </div>

        {/* Error banner */}
        {layer.error_code && (
          <div className="mt-3 flex items-start gap-2 bg-coral/5 border border-coral/20 rounded-sm px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5 text-coral flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-[11px] font-semibold text-coral">{layer.error_code}</div>
              {parsedDetail.raw && <div className="text-[10px] text-t2 mt-0.5">{String(parsedDetail.raw)}</div>}
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-t3">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[11px]">Loading layer artifacts…</span>
          </div>
        ) : error ? (
          <div className="text-[11px] text-coral py-4">{error}</div>
        ) : (
          <Renderer data={displayData} />
        )}
      </div>
    </div>
  );
}
