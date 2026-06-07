"use client";

interface ModelContextArm {
  model_id: string;
  observations: number;
  estimated_reward: number;
  explore_width: number;
  state: "Exploring" | "Learning" | "Confident";
}

interface ModelContext {
  embedding_available: boolean;
  arms: ModelContextArm[];
  available_model_count: number;
}

interface OrchestratorWarning {
  code: string;
  message: string;
}

export type { ModelContextArm, ModelContext, OrchestratorWarning };

export function ConfidenceBadge({ hallucination_rate }: { hallucination_rate: number }) {
  const h = hallucination_rate;
  const label = h < 0.05 ? "High" : h < 0.15 ? "Medium" : "Low";
  const dot   = h < 0.05 ? "●" : h < 0.15 ? "◐" : "○";
  const cls   = h < 0.05
    ? "bg-gg/10 text-gg border-gg/30"
    : h < 0.15
    ? "bg-amber/10 text-amber border-amber/30"
    : "bg-coral/10 text-coral border-coral/30";
  const tip   = h < 0.05
    ? "Hallucination rate < 5% — high factual reliability"
    : h < 0.15
    ? `Hallucination rate ${(h * 100).toFixed(1)}% — verify key figures`
    : `Hallucination rate ${(h * 100).toFixed(1)}% — treat as estimate, confirm with domain experts`;
  return (
    <span title={tip} className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-md border cursor-help ${cls}`}>
      <span>{dot}</span>{label} confidence
    </span>
  );
}

export function SubConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const cls = pct >= 80 ? "text-gg" : pct >= 60 ? "text-amber" : "text-coral";
  const tip = pct >= 80 ? "High sub-task confidence — matched your document corpus"
    : pct >= 60 ? "Medium — partial knowledge match"
    : "Low — model inferred from general knowledge, not your documents";
  return (
    <span title={tip} className={`text-[10px] font-mono font-bold cursor-help ${cls}`}>{pct}%</span>
  );
}

export function ModelChoiceCard({ context, primaryModel }: { context: ModelContext; primaryModel: string | null }) {
  const primaryArm = context.arms.find(a => a.model_id === primaryModel) ?? context.arms[0];
  if (!primaryArm) return null;
  const stateColor = primaryArm.state === "Confident"
    ? "text-gg border-gg/30 bg-gg/5"
    : primaryArm.state === "Learning"
    ? "text-amber border-amber/30 bg-amber/5"
    : "text-blue border-blue/30 bg-blue/5";
  const stateIcon = primaryArm.state === "Confident" ? "✓" : primaryArm.state === "Learning" ? "⟳" : "🔍";
  const stateDesc = primaryArm.state === "Confident"
    ? `${primaryArm.observations} queries seen — routing optimised`
    : primaryArm.state === "Learning"
    ? `${primaryArm.observations} queries seen — confidence improving`
    : `${primaryArm.observations < 5 ? "First few queries" : `${primaryArm.observations} queries seen`} — still learning your domain`;
  return (
    <div className="bg-bg3 border border-dborder rounded-xl px-4 py-3 mb-4 flex flex-wrap gap-3 items-center text-[11px]">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-t3 flex-shrink-0 font-semibold">AI used:</span>
        <span className="font-mono font-semibold text-t1 truncate">{primaryArm.model_id}</span>
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded border flex-shrink-0 ${stateColor}`}>
          {stateIcon} {primaryArm.state}
        </span>
        {!context.embedding_available && (
          <span title="nomic-embed-text not available — results ranked by keyword match only" className="text-[9px] px-2 py-0.5 rounded border bg-coral/5 text-coral border-coral/30 flex-shrink-0 cursor-help">
            ⚠ No semantic embedding
          </span>
        )}
      </div>
      <div className="flex items-center gap-4 text-[10px] text-t3 flex-shrink-0">
        <span title="Estimated reward the bandit has learned for this model (0–1 scale)">
          Reward: <span className="font-mono text-t2">{(primaryArm.estimated_reward * 100).toFixed(0)}%</span>
        </span>
        <span title="UCB exploration width — lower = more confident in this model's routing">
          Certainty: <span className={`font-mono font-semibold ${primaryArm.explore_width < 0.01 ? "text-gg" : primaryArm.explore_width < 0.05 ? "text-amber" : "text-coral"}`}>
            {primaryArm.explore_width < 0.01 ? "High" : primaryArm.explore_width < 0.05 ? "Medium" : "Low"}
          </span>
        </span>
        <span className="text-t3 italic hidden sm:inline">{stateDesc}</span>
      </div>
    </div>
  );
}

export function WarningsBanner({ warnings }: { warnings: OrchestratorWarning[] }) {
  if (!warnings.length) return null;
  return (
    <div className="mb-4 space-y-1.5">
      {warnings.map((w, i) => (
        <div key={i} className="flex items-start gap-2.5 bg-amber/5 border border-amber/25 rounded-xl px-3.5 py-2.5 text-[11px]">
          <span className="text-amber flex-shrink-0 mt-0.5">⚠</span>
          <span className="text-t2">{w.message}</span>
        </div>
      ))}
    </div>
  );
}

export function ProviderBadge({ provider, local }: { provider: string; local: boolean }) {
  const map: Record<string, string> = {
    ollama:     "bg-gg/10 text-gg border-gg/30",
    openai:     "bg-blue/10 text-blue border-blue/30",
    anthropic:  "bg-purple/10 text-purple border-purple/30",
    groq:       "bg-amber/10 text-amber border-amber/30",
  };
  return (
    <span className={`inline-flex items-center text-[9px] font-bold px-2 py-0.5 rounded-md border ${map[provider] ?? "bg-bg4 text-t3 border-dborder"}`}>
      {local && <span className="mr-1">●</span>}{provider}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  return <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-lg border ${priority === "critical" ? "bg-coral/10 text-coral border-coral/30" : priority === "high" ? "bg-amber/10 text-amber border-amber/30" : "bg-bg4 text-t3 border-dborder"}`}>{priority}</span>;
}

export function Pyramid() {
  return (
    <div className="flex flex-col items-center gap-1 pb-7 pt-1">
      {[
        { label: "✓ Result",             w: 80  },
        { label: "✓ Model selection",    w: 190 },
        { label: "✓ SLM engine",         w: 280 },
        { label: "✓ Data + GraphRAG",    w: 390 },
      ].map((t, i) => (
        <div
          key={i}
          className="flex items-center justify-center h-9 rounded-[10px] text-[12px] font-semibold px-5 bg-gg/10 border border-gg/30 text-gg"
          style={{ width: t.w }}
        >
          {t.label}
        </div>
      ))}
    </div>
  );
}
