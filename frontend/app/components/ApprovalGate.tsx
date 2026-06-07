"use client";

import { useState } from "react";
import { API_BASE, apiFetch } from "../lib/api";

export type GateStep = "import" | "dedup" | "quality" | "graph" | "model";

interface GateProps {
  step: GateStep;
  jobId: string;
  stats: {
    docCount?: number;
    fileNames?: string[];
    dupCount?: number;
    keptCount?: number;
    qualityDist?: { high: number; medium: number; low: number };
    entityCount?: number;
    topEntities?: string[];
    userQuery?: string;
    models?: {
      name: string;
      provider: string;
      score: number;
      bestFor: string;
      isLocal: boolean;
      role?: string;
      why?: string;
      isPrimary?: boolean;
      benchmarkScore?: number | null;
      availabilityScore?: number | null;
      learningScore?: number | null;
    }[];
  };
  onProceed: (config?: Record<string, unknown>) => void;
  onSkip?: () => void;
}

const GATE_META: Record<GateStep, { title: string; icon: string; color: string }> = {
  import:  { title: "Data Imported",           icon: "📥", color: "#6c5cf7" },
  dedup:   { title: "Cleaning Complete",        icon: "🧹", color: "#0d9e74" },
  quality: { title: "Readiness Check",          icon: "📊", color: "#d97706" },
  graph:   { title: "Knowledge Graph Built",    icon: "🕸️",  color: "#60a5fa" },
  model:   { title: "AI Models Selected",       icon: "🤖", color: "#6c5cf7" },
};

export default function ApprovalGate({ step, jobId, stats, onProceed, onSkip }: GateProps) {
  const meta = GATE_META[step];
  const [dedupSensitivity, setDedupSensitivity] = useState(3);
  const [qualityThreshold, setQualityThreshold] = useState(70);
  const aiPrimary = stats.models?.find(m => m.isPrimary) ?? stats.models?.[0] ?? null;
  const [selectedModel, setSelectedModel] = useState<string | null>(aiPrimary?.name ?? null);

  const handleProceed = async () => {
    const cfg: Record<string, unknown> = {};
    if (step === "dedup")   cfg.dedup_sensitivity = dedupSensitivity;
    if (step === "quality") cfg.quality_threshold = qualityThreshold / 100;
    if (step === "model" && selectedModel) cfg.selected_model = selectedModel;

    const backendStep = step === "dedup" ? "clean" : step;
    try {
      if (Object.keys(cfg).length > 0) {
        await apiFetch(`${API_BASE}/api/v1/pipeline/${jobId}/config`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cfg),
        });
      }
      await apiFetch(`${API_BASE}/api/v1/pipeline/${jobId}/approve/${backendStep}`, {
        method: "POST",
      });
    } catch { /* proceed anyway if backend call fails */ }

    onProceed(cfg);
  };

  return (
    <div className="fixed inset-0 z-[150] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full overflow-hidden ${step === "model" ? "max-w-lg" : "max-w-md"}`}>
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-dborder">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
              style={{ background: `${meta.color}15`, border: `1.5px solid ${meta.color}40` }}>
              {meta.icon}
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-t3">Step Complete</div>
              <div className="text-[15px] font-bold text-t1">{meta.title}</div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">

          {step === "import" && (
            <div>
              <p className="text-[13px] text-t2 mb-3">
                <span className="font-bold text-t1">{stats.docCount ?? 0} documents</span> loaded and ready to process.
              </p>
              {stats.fileNames && stats.fileNames.length > 0 && (
                <div className="bg-bg2 rounded-xl p-3 space-y-1 max-h-32 overflow-y-auto">
                  {stats.fileNames.slice(0, 8).map(f => (
                    <div key={f} className="text-[11px] text-t2 flex items-center gap-2">
                      <span className="text-gg">✓</span> {f}
                    </div>
                  ))}
                  {stats.fileNames.length > 8 && (
                    <div className="text-[11px] text-t3">+{stats.fileNames.length - 8} more files</div>
                  )}
                </div>
              )}
            </div>
          )}

          {step === "dedup" && (
            <div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-bg2 rounded-xl p-3 text-center">
                  <div className="text-[18px] font-bold text-gg">{stats.keptCount ?? 0}</div>
                  <div className="text-[10px] text-t3 font-semibold uppercase tracking-wider">Kept</div>
                </div>
                <div className="bg-bg2 rounded-xl p-3 text-center">
                  <div className="text-[18px] font-bold text-coral">{stats.dupCount ?? 0}</div>
                  <div className="text-[10px] text-t3 font-semibold uppercase tracking-wider">Removed</div>
                </div>
              </div>
              <div className="mb-2">
                <div className="flex justify-between text-[11px] font-semibold text-t2 mb-1">
                  <span>Sensitivity</span>
                  <span className="text-accent">{["Very Low", "Low", "Medium", "High", "Very High"][dedupSensitivity - 1]}</span>
                </div>
                <input type="range" min={1} max={5} value={dedupSensitivity}
                  onChange={e => setDedupSensitivity(Number(e.target.value))}
                  className="w-full accent-accent cursor-pointer" />
                <div className="flex justify-between text-[10px] text-t3 mt-0.5">
                  <span>Keep more</span><span>Remove more</span>
                </div>
              </div>
            </div>
          )}

          {step === "quality" && (
            <div>
              {stats.qualityDist && (
                <div className="mb-4">
                  <div className="text-[11px] font-semibold text-t2 mb-2">Document readiness distribution</div>
                  <div className="space-y-1.5">
                    {[
                      { label: "High quality", count: stats.qualityDist.high,   color: "#16a34a" },
                      { label: "Medium",       count: stats.qualityDist.medium, color: "#d97706" },
                      { label: "Low quality",  count: stats.qualityDist.low,    color: "#e63755" },
                    ].map(({ label, count, color }) => {
                      const total = (stats.qualityDist?.high ?? 0) + (stats.qualityDist?.medium ?? 0) + (stats.qualityDist?.low ?? 0);
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      return (
                        <div key={label} className="flex items-center gap-2">
                          <div className="text-[10px] text-t3 w-24 flex-shrink-0">{label}</div>
                          <div className="flex-1 h-2 bg-bg3 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${pct}%`, background: color }} />
                          </div>
                          <div className="text-[10px] font-semibold text-t2 w-8 text-right">{pct}%</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <div>
                <div className="flex justify-between text-[11px] font-semibold text-t2 mb-1">
                  <span>Minimum readiness</span>
                  <span className="text-accent">{qualityThreshold}%</span>
                </div>
                <input type="range" min={30} max={95} step={5} value={qualityThreshold}
                  onChange={e => setQualityThreshold(Number(e.target.value))}
                  className="w-full accent-accent cursor-pointer" />
                <div className="flex justify-between text-[10px] text-t3 mt-0.5">
                  <span>Include more</span><span>Be strict</span>
                </div>
              </div>
            </div>
          )}

          {step === "graph" && (
            <div>
              <p className="text-[13px] text-t2 mb-3">
                Knowledge graph built with <span className="font-bold text-t1">{stats.entityCount ?? 0} entities</span> discovered.
              </p>
              {stats.topEntities && stats.topEntities.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-t3 mb-2">Top entities found</div>
                  <div className="flex flex-wrap gap-1.5">
                    {stats.topEntities.slice(0, 8).map(e => (
                      <span key={e} className="text-[11px] px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/20 font-semibold">
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === "model" && stats.models && (
            <div className="space-y-4">
              {/* System recommendation — full card */}
              {aiPrimary ? (
                <div className="rounded-2xl border-2 border-accent/40 bg-accent/5 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[18px]">🤖</span>
                    <div>
                      <div className="text-[10px] font-bold text-accent uppercase tracking-widest">System Recommendation</div>
                      <div className="text-[15px] font-bold text-t1">{aiPrimary.name}</div>
                    </div>
                    <div className="ml-auto flex flex-col items-end gap-1">
                      <span className="text-[9px] px-2 py-0.5 bg-gg/15 text-gg border border-gg/30 rounded-full font-bold">
                        {Math.round(aiPrimary.score * 100)}% match
                      </span>
                      {aiPrimary.isLocal && (
                        <span className="text-[9px] px-2 py-0.5 bg-accent/10 text-accent border border-accent/20 rounded-full font-bold">LOCAL</span>
                      )}
                    </div>
                  </div>

                  {/* Why this model */}
                  {aiPrimary.why && (
                    <p className="text-[12px] text-t2 leading-relaxed mb-3">{aiPrimary.why}</p>
                  )}

                  {/* Score breakdown */}
                  <div className="space-y-1.5">
                    {[
                      { label: "Overall fit",   val: aiPrimary.score,             color: "#6c5cf7" },
                      ...(aiPrimary.benchmarkScore    != null ? [{ label: "Benchmark",   val: aiPrimary.benchmarkScore,    color: "#0d9e74" }] : []),
                      ...(aiPrimary.availabilityScore != null ? [{ label: "Availability",val: aiPrimary.availabilityScore, color: "#60a5fa" }] : []),
                      ...(aiPrimary.learningScore     != null ? [{ label: "Learning",     val: aiPrimary.learningScore,     color: "#d97706" }] : []),
                    ].map(({ label, val, color }) => (
                      <div key={label} className="flex items-center gap-2">
                        <div className="text-[10px] text-t3 w-20 flex-shrink-0">{label}</div>
                        <div className="flex-1 h-1.5 bg-bg3 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${Math.round(val * 100)}%`, background: color }} />
                        </div>
                        <div className="text-[10px] font-bold w-8 text-right" style={{ color }}>
                          {Math.round(val * 100)}%
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Role badge */}
                  {aiPrimary.role && (
                    <div className="mt-2.5 text-[10px] text-t3">
                      Role: <span className="font-semibold text-t2">{aiPrimary.role}</span>
                      {aiPrimary.bestFor && <span> · Best for <span className="font-semibold text-t2">{aiPrimary.bestFor.replace(/_/g, " ")}</span></span>}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-dborder bg-bg2 p-4 text-[13px] text-t2">
                  Selecting best available local model…
                </div>
              )}

              {/* Other candidates — info only, not selectable */}
              {stats.models.length > 1 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-t3 mb-2">
                    Also evaluated ({stats.models.length - 1} others)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {stats.models.slice(1).map((m, i) => (
                      <span key={i} className="text-[10px] px-2.5 py-1 rounded-full bg-bg2 border border-dborder text-t3 font-medium">
                        {m.name.split(":")[0]} <span className="text-t3 font-normal">{Math.round(m.score * 100)}%</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Weight basis note */}
              <div className="rounded-xl border border-dborder bg-bg2 px-3 py-2 flex items-start gap-2">
                <span className="text-[13px] mt-0.5">⚖️</span>
                <p className="text-[11px] text-t2 leading-relaxed">
                  Selected automatically based on your <span className="font-semibold text-t1">scoring weights</span> set in the Query step.
                  Adjust weights to change this recommendation.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={handleProceed}
            className="flex-1 py-2.5 rounded-xl font-bold text-[13px] text-white transition-all hover:opacity-90"
            style={{ background: meta.color }}
          >
          Proceed →
          {step === "model" && aiPrimary && <span className="text-[11px] opacity-80 ml-1">with {aiPrimary.name.split(":")[0]}</span>}
          </button>
          {onSkip && (
            <button
              onClick={onSkip}
              className="px-5 py-2.5 rounded-xl font-semibold text-[12px] text-t3 border border-dborder hover:border-t2 transition-colors"
            >
              Skip
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
