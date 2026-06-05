"use client";

import { CheckCircle2, Loader2, AlertTriangle, Clock, ChevronRight, ShieldCheck } from "lucide-react";

export type LayerStatus = "pending" | "running" | "done" | "error";

export interface PipelineLayer {
  id: string;
  label: string;
  status: LayerStatus;
  pct: number;
  detail: string;
  started_at: number | null;
  completed_at: number | null;
  error_code: string | null;
}

interface KPIs {
  entities: number;
  relationships: number;
  graph_nodes: number;
  trust_score: number;
  ontology_consistency: number;
}

interface PipelineLayerListProps {
  layers: PipelineLayer[];
  kpis: KPIs;
  activeLayerId: string | null;
  jobId: string;
  onLayerClick: (layer: PipelineLayer) => void;
  reviewPending?: boolean;
  onConfirmReview?: () => void;
}

const STATUS_CONFIG: Record<LayerStatus, { icon: typeof CheckCircle2; color: string; bg: string; border: string; label: string }> = {
  done:    { icon: CheckCircle2,   color: "text-gg",    bg: "bg-gg/10",     border: "border-gg/30",    label: "Complete" },
  running: { icon: Loader2,        color: "text-amber",  bg: "bg-amber/10",  border: "border-amber/30", label: "Running" },
  error:   { icon: AlertTriangle,  color: "text-coral",  bg: "bg-coral/10",  border: "border-coral/30", label: "Error" },
  pending: { icon: Clock,          color: "text-t3",     bg: "bg-bg4",       border: "border-dborder",  label: "Pending" },
};

function formatDuration(startMs: number | null, endMs: number | null): string {
  if (!startMs) return "";
  const end = endMs ?? Date.now() / 1000;
  const diff = Math.max(0, Math.round(end - startMs));
  if (diff < 60) return `${diff}s`;
  return `${Math.floor(diff / 60)}m ${diff % 60}s`;
}

function StatusBadge({ status, errorCode }: { status: LayerStatus; errorCode: string | null }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <div className="flex items-center gap-1.5">
      {errorCode && status === "error" && (
        <span className="text-[9px] font-mono text-coral/80 mr-1 hidden sm:inline">{errorCode}</span>
      )}
      <span className={`inline-flex items-center gap-1 text-[9px] font-semibold px-2 py-0.5 rounded-md border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
        <Icon className={`w-3 h-3 ${status === "running" ? "animate-spin" : ""}`} />
        {cfg.label}
      </span>
    </div>
  );
}

function KPICard({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-2.5 bg-card2 border border-dborder rounded-sm min-w-[100px]">
      <div className="font-sora text-[16px] font-bold text-t1 leading-none tabular-nums">
        {value}{unit && <span className="text-[10px] font-normal text-t3 ml-0.5">{unit}</span>}
      </div>
      <div className="text-[9px] text-t3 mt-0.5 uppercase tracking-wider font-medium">{label}</div>
    </div>
  );
}

export default function PipelineLayerList({ layers, kpis, activeLayerId, jobId, onLayerClick, reviewPending, onConfirmReview }: PipelineLayerListProps) {
  const completedCount = layers.filter(l => l.status === "done").length;
  const overallPct = Math.round((completedCount / Math.max(1, layers.length)) * 100);
  const allDone = completedCount === layers.length && layers.length > 0;

  return (
    <div className="w-full">
      {/* KPI header */}
      <div className="flex flex-wrap gap-2 mb-5">
        <KPICard label="Entities" value={kpis.entities.toLocaleString()} />
        <KPICard label="Relationships" value={kpis.relationships.toLocaleString()} />
        <KPICard label="Graph Nodes" value={kpis.graph_nodes.toLocaleString()} />
        <KPICard label="Trust Score" value={kpis.trust_score.toFixed(4)} />
        <KPICard label="Ontology" value={kpis.ontology_consistency.toLocaleString()} />
      </div>

      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div className="sect mb-0">
          Layer Execution — Source {jobId.slice(0, 8)}
        </div>
        <div className="text-[10px] text-t3 font-medium tabular-nums">
          {completedCount}/{layers.length} layers · {overallPct}%
        </div>
      </div>

      {/* Overall progress bar */}
      <div className="prog-bar h-1 mb-4">
        <div className="prog-fill h-1" style={{ width: `${overallPct}%` }} />
      </div>

      {/* Layer rows */}
      <div className="space-y-1">
        {layers.map((layer, idx) => {
          const isActive = activeLayerId === layer.id;
          const isClickable = layer.status !== "pending";
          const duration = formatDuration(layer.started_at, layer.completed_at);

          return (
            <button
              key={layer.id}
              onClick={() => isClickable && onLayerClick(layer)}
              disabled={!isClickable}
              className={`
                layer-row-enter w-full flex items-center gap-3 px-4 py-3 rounded-sm border transition-all duration-200 text-left group
                ${isActive
                  ? "bg-accent/5 border-accent/30 shadow-sm"
                  : isClickable
                    ? "bg-card2 border-dborder hover:border-dborder2 hover:bg-bg3 cursor-pointer"
                    : "bg-card2 border-dborder opacity-60 cursor-default"
                }
              `}
              style={{ animationDelay: `${idx * 40}ms` }}
            >
              {/* Number badge */}
              <div className={`
                w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0
                ${layer.status === "done" ? "bg-gg/15 text-gg"
                  : layer.status === "running" ? "bg-amber/15 text-amber"
                  : layer.status === "error" ? "bg-coral/15 text-coral"
                  : "bg-bg4 text-t3"
                }
              `}>
                {idx + 1}
              </div>

              {/* Label + duration */}
              <div className="flex-1 min-w-0">
                <div className={`text-[12px] font-medium leading-tight ${layer.status === "pending" ? "text-t3" : "text-t1"}`}>
                  {layer.label}
                </div>
                {duration && (
                  <div className="text-[9px] text-t3 mt-0.5 tabular-nums">{duration}</div>
                )}
              </div>

              {/* Status badge */}
              <StatusBadge status={layer.status} errorCode={layer.error_code} />

              {/* Chevron for clickable */}
              {isClickable && (
                <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200 ${isActive ? "text-accent rotate-90" : "text-t3 group-hover:text-t2"}`} />
              )}
            </button>
          );
        })}
      </div>

      {/* Pipeline review confirmation */}
      {reviewPending && allDone && onConfirmReview && (
        <div className="mt-5 animate-fade-in">
          <div className="bg-accent/5 border border-accent/20 rounded-card p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/25 flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-4.5 h-4.5 text-accent" />
              </div>
              <div>
                <div className="font-sora text-[14px] font-semibold text-t1">Pipeline Complete — Review Required</div>
                <div className="text-[11px] text-t2 mt-0.5 leading-relaxed">
                  All {layers.length} layers have finished processing. Click on any layer above to inspect its results in detail.
                  When you&apos;re satisfied, confirm to proceed to AI model selection.
                </div>
              </div>
            </div>
            <button
              onClick={onConfirmReview}
              className="w-full btn btn-p py-3 text-[13px] font-semibold"
            >
              Confirm Pipeline &amp; Continue →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
