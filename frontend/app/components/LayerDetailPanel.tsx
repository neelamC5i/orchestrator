"use client";

import { useEffect, useState, useCallback } from "react";
import { X, Clock, CheckCircle2, AlertTriangle, Loader2, FileText, Database, Brain, BarChart3, Shield, Network, BookOpen } from "lucide-react";
import type { PipelineLayer } from "./PipelineLayerList";

interface LayerDetailPanelProps {
  layer: PipelineLayer;
  jobId: string;
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

function MetricBar({ label, value, max, color = "bg-accent" }: { label: string; value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="text-[10px] text-t3 w-28 flex-shrink-0 truncate">{label}</div>
      <div className="flex-1 h-1.5 bg-bg4 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-[10px] text-t2 font-medium tabular-nums w-12 text-right">{value}</div>
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
  const entities = (data.entity_sample as { id?: string; label?: string; text?: string; type?: string; confidence?: number }[]) ?? [];
  const rels = (data.relationship_sample as { source?: string; target?: string; relation?: string; confidence?: number }[]) ?? [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Entities" value={data.entity_count as number ?? entities.length} />
        <MiniStat label="Relationships" value={data.relationship_count as number ?? rels.length} />
        <MiniStat label="Errors" value={data.extraction_errors as number ?? 0} />
      </div>
      {entities.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-t3 uppercase tracking-wider mb-1.5">Top Entities</div>
          <DataTable
            headers={["Entity", "Type", "Confidence"]}
            rows={entities.slice(0, 15).map(e => [
              e.label ?? e.text ?? e.id ?? "—",
              e.type ?? "—",
              e.confidence != null ? e.confidence.toFixed(3) : "—",
            ])}
          />
        </div>
      )}
      {rels.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-t3 uppercase tracking-wider mb-1.5">Relationships</div>
          <DataTable
            headers={["Source", "Relation", "Target"]}
            rows={rels.slice(0, 10).map(r => [r.source ?? "—", r.relation ?? "—", r.target ?? "—"])}
          />
        </div>
      )}
    </div>
  );
}

function EDADetail({ data }: { data: ArtifactData }) {
  const scorecards = (data.scorecards as Record<string, number>[]) ?? [];
  const firstCard = scorecards[0] ?? {};
  const scoreKeys = Object.keys(firstCard).filter(k => typeof firstCard[k] === "number" && k !== "overall_kg_quality_score");
  const maxScore = scoreKeys.length > 0 ? Math.max(...scoreKeys.map(k => firstCard[k] as number), 1) : 1;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Files Analyzed" value={data.files_analyzed as number ?? 0} />
        <MiniStat label="EDA Errors" value={data.eda_errors as number ?? 0} />
        <MiniStat label="Total Files" value={data.total_files as number ?? 0} />
      </div>
      {scoreKeys.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-t3 uppercase tracking-wider mb-2">Quality Scorecard</div>
          <div className="space-y-1.5">
            {scoreKeys.slice(0, 8).map(k => (
              <MetricBar key={k} label={k.replace(/_/g, " ")} value={firstCard[k] as number} max={maxScore} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ValidationDetail({ data }: { data: ArtifactData }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <MiniStat label="Files Validated" value={data.files_validated as number ?? 0} />
      <MiniStat label="Avg Trust" value={(data.avg_trust_score as number ?? 0).toFixed(4)} />
      <MiniStat label="Avg Quality" value={(data.avg_quality_score as number ?? 0).toFixed(4)} />
    </div>
  );
}

function OntologyDetail({ data }: { data: ArtifactData }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <MiniStat label="Violations" value={data.ontology_violations as number ?? 0} color={data.ontology_violations ? "text-coral" : undefined} />
      <MiniStat label="Contradictions" value={data.semantic_contradictions as number ?? 0} color={data.semantic_contradictions ? "text-amber" : undefined} />
    </div>
  );
}

function CanonicalDetail({ data }: { data: ArtifactData }) {
  const reg = data.registry_summary as Record<string, number> | undefined;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Canonical Nodes" value={data.canonical_nodes as number ?? 0} />
        <MiniStat label="Resolved Nodes" value={data.resolved_nodes as number ?? 0} />
        <MiniStat label="Merged" value={data.merged as number ?? 0} />
        <MiniStat label="Pending Reviews" value={data.pending_reviews as number ?? 0} />
      </div>
      {reg && (
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Registry Nodes" value={reg.total_nodes ?? 0} />
          <MiniStat label="Total Aliases" value={reg.total_aliases ?? 0} />
        </div>
      )}
    </div>
  );
}

function GraphBuildDetail({ data }: { data: ArtifactData }) {
  const nodes = (data.node_sample as { id?: string; label?: string; type?: string }[]) ?? [];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Graph Nodes" value={data.graph_nodes ?? data.node_count as number ?? 0} />
        <MiniStat label="Graph Edges" value={data.graph_edges ?? data.edge_count as number ?? 0} />
        <MiniStat label="Cross Links" value={data.cross_links as number ?? 0} />
      </div>
      {nodes.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-t3 uppercase tracking-wider mb-1.5">Node Sample</div>
          <DataTable
            headers={["ID", "Label", "Type"]}
            rows={nodes.slice(0, 10).map(n => [n.id ?? "—", n.label ?? "—", n.type ?? "—"])}
          />
        </div>
      )}
    </div>
  );
}

function GraphConsistDetail({ data }: { data: ArtifactData }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <MiniStat label="Density" value={(data.density as number ?? 0).toFixed(6)} />
      <MiniStat label="High Risk Ratio" value={(data.high_risk_edge_ratio as number ?? 0).toFixed(4)} />
      <MiniStat label="Active Edges" value={data.active_edges as number ?? 0} />
      <MiniStat label="Suppressed" value={data.suppressed_edges as number ?? 0} />
    </div>
  );
}

function WikiDetail({ data }: { data: ArtifactData }) {
  const pages = (data.wiki_pages_sample as string[]) ?? [];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Wiki Pages" value={data.wiki_pages ?? data.wiki_page_count as number ?? 0} />
        <MiniStat label="FAISS Indexed" value={data.faiss_chunks_indexed as number ?? 0} />
      </div>
      {pages.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-t3 uppercase tracking-wider mb-1.5">Pages</div>
          <div className="flex flex-wrap gap-1">
            {pages.slice(0, 20).map(p => (
              <span key={p} className="apill">{p}</span>
            ))}
          </div>
        </div>
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

function MiniStat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-bg3 border border-dborder rounded-sm px-3 py-2">
      <div className={`text-[14px] font-bold tabular-nums ${color ?? "text-t1"}`}>{value}</div>
      <div className="text-[9px] text-t3 uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  );
}

const DETAIL_RENDERERS: Record<string, React.FC<{ data: ArtifactData }>> = {
  upload: UploadDetail, extract: ExtractDetail, clean: GenericDetail,
  chunk: ChunkDetail, metadata: GenericDetail, entities: EntityDetail,
  semantic: GenericDetail, eda: EDADetail, validation: ValidationDetail,
  ontology: OntologyDetail, canonical: CanonicalDetail,
  graph_build: GraphBuildDetail, graph_consist: GraphConsistDetail, wiki: WikiDetail,
};

export default function LayerDetailPanel({ layer, jobId, onClose }: LayerDetailPanelProps) {
  const [artifacts, setArtifacts] = useState<ArtifactData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchArtifacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
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
    fetchArtifacts();
  }, [fetchArtifacts]);

  const Icon = LAYER_ICONS[layer.id] ?? FileText;
  const Renderer = DETAIL_RENDERERS[layer.id] ?? GenericDetail;

  let parsedDetail: ArtifactData = {};
  try {
    parsedDetail = layer.detail ? JSON.parse(layer.detail) : {};
  } catch {
    parsedDetail = layer.detail ? { raw: layer.detail } : {};
  }

  const displayData = artifacts ?? parsedDetail;

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

        {/* Status strip */}
        <div className="flex items-center gap-4 text-[10px]">
          <div className="flex items-center gap-1.5">
            {layer.status === "done" && <CheckCircle2 className="w-3 h-3 text-gg" />}
            {layer.status === "running" && <Loader2 className="w-3 h-3 text-amber animate-spin" />}
            {layer.status === "error" && <AlertTriangle className="w-3 h-3 text-coral" />}
            {layer.status === "pending" && <Clock className="w-3 h-3 text-t3" />}
            <span className={`font-semibold uppercase tracking-wider ${
              layer.status === "done" ? "text-gg"
              : layer.status === "running" ? "text-amber"
              : layer.status === "error" ? "text-coral"
              : "text-t3"
            }`}>{layer.status}</span>
          </div>
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
