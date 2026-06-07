"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AchievementToast from "../components/AchievementToast";
import { API_BASE, apiFetch } from "../lib/api";

interface DashboardStats {
  tokens_saved?: number;
  active_slms?: number;
  files_ingested?: number;
  cost_saved?: number;
}

interface LearningModel {
  model_id: string;
  query_count: number;
  accuracy_pct: number;
  val_loss: number | null;
  reward: number;
  converged: boolean;
}

interface LearningProgress {
  models: LearningModel[];
  summary: { total_queries: number; avg_accuracy_pct: number; any_converged: boolean; active_models: number };
}

interface BanditArm {
  model_id: string;
  theta_norm: number;
  estimated_reward: number;
  observations: number;
  explore_width: number;
  converged: boolean;
}

interface NashCandidate {
  model: string;
  provider: string;
  benchmark: number;
  availability: number;
  bandit_score: number;
  composite_score: number;
  is_available: boolean;
  observations: number;
  nash_probability: number;
  is_dominant: boolean;
  benchmark_source: string;
}

interface NashInsights {
  task_type: string;
  valid_task_types: string[];
  candidates: NashCandidate[];
  dominant_model: string | null;
  nash_explanation: string;
  formula: string;
  game_theory_note: string;
}

interface StoredSession {
  job_id: string;
  query: string;
  domain_label: string;
  timestamp: string;
  slm_model_id: string | null;
  intent: string;
  coverage_action: string;
  hallucination_rate: number;
  output: {
    process_steps?: { step: number; label: string; icon: string; output: string }[];
    [key: string]: any;
  } | null;
}

function MetricCard({
  label, value, sub, pill, pillClass, barColor,
}: {
  label: string; value: string; sub?: string;
  pill?: string; pillClass?: string; barColor: string;
}) {
  return (
    <div className="mcard">
      <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t" style={{ background: barColor }} />
      <div className="text-[10px] text-t3 font-semibold uppercase tracking-widest mb-2">{label}</div>
      <div className="font-sora text-[26px] font-bold text-t1 leading-none">{value}</div>
      {sub && <div className="text-[11px] text-t2 mt-1">{sub}</div>}
      {pill && <div className={`mt-2 ${pillClass}`}>{pill}</div>}
    </div>
  );
}

function Pyramid() {
  return (
    <div className="flex flex-col items-center gap-1 pb-7 pt-1">
      <div className="flex items-center justify-center h-9 px-5 rounded-[10px] text-[12px] font-semibold bg-purple/10 border border-purple/30 text-purple" style={{ width: 80 }}>Result layer</div>
      <div className="flex items-center justify-center h-9 px-5 rounded-[10px] text-[12px] font-semibold bg-teal/10 border border-teal/25 text-teal" style={{ width: 190 }}>Model selection</div>
      <div className="flex items-center justify-center h-9 px-5 rounded-[10px] text-[12px] font-semibold bg-coral/10 border border-coral/25 text-coral" style={{ width: 280 }}>SLM engine</div>
      <div className="flex items-center justify-center h-9 px-5 rounded-[10px] text-[12px] font-semibold bg-amber/10 border border-amber/25 text-amber" style={{ width: 390 }}>Data + GraphRAG foundation</div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats>({});
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [learning, setLearning] = useState<LearningProgress | null>(null);
  const [banditArms, setBanditArms] = useState<BanditArm[]>([]);
  const [nashInsights, setNashInsights] = useState<NashInsights | null>(null);
  const [nashTask, setNashTask] = useState("general_reasoning");

  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [fetchErrors, setFetchErrors] = useState<string[]>([]);

  const API = API_BASE;

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("orch_sessions") ?? "[]");
      setSessions(stored);
    } catch { /* ignore */ }

    setLoading(true);
    setFetchErrors([]);
    apiFetch(`${API}/api/v1/slm/stats`)
      .then(r => r.json()).then(setStats)
      .catch(() => setFetchErrors(prev => [...prev, "Stats unavailable"]))
      .finally(() => setLoading(false));
    apiFetch(`${API}/api/v1/slm/learning-progress`)
      .then(r => r.json()).then(setLearning)
      .catch(() => setFetchErrors(prev => [...prev, "Learning progress unavailable"]));
    apiFetch(`${API}/api/v1/models/bandit-status`)
      .then(r => r.json()).then(d => setBanditArms(d.arms ?? []))
      .catch(() => setFetchErrors(prev => [...prev, "Bandit status unavailable"]));
    apiFetch(`${API}/api/v1/models/insights/general_reasoning`)
      .then(r => r.json()).then(setNashInsights)
      .catch(() => setFetchErrors(prev => [...prev, "Nash insights unavailable"]));
  }, []);

  const loadNashTask = (task: string) => {
    setNashTask(task);
    setNashInsights(null);
    apiFetch(`${API}/api/v1/models/insights/${task}`)
      .then(r => r.json()).then(setNashInsights).catch(() => {});
  };

  const resumeSession = (s: StoredSession) => {
    sessionStorage.setItem("job_id", s.job_id);
    sessionStorage.setItem("domain_label", s.domain_label);
    sessionStorage.setItem("query", s.query);
    if (s.output) {
      // Session has stored output — restore it and go directly to results
      sessionStorage.setItem("orchestrator_output", JSON.stringify(s.output));
      sessionStorage.removeItem("reuse_corpus");
      router.push("/recommendations");
    } else {
      // No output yet — start fresh from query page
      sessionStorage.removeItem("orchestrator_output");
      sessionStorage.removeItem("reuse_corpus");
      router.push("/query");
    }
  };

  const replayProcessSession = (s: StoredSession) => {
    sessionStorage.setItem("job_id", s.job_id);
    sessionStorage.setItem("domain_label", s.domain_label);
    sessionStorage.setItem("query", s.query);
    sessionStorage.setItem("reuse_corpus", "true");
    sessionStorage.setItem("process_plan", "true");
    sessionStorage.setItem("process_intent", s.intent);
    sessionStorage.setItem("process_topic", s.query);
    sessionStorage.removeItem("process_topics");
    router.push("/processing");
  };

  const deleteSession = (job_id: string) => {
    const updated = sessions.filter(s => s.job_id !== job_id);
    setSessions(updated);
    localStorage.setItem("orch_sessions", JSON.stringify(updated));
  };

  const tokensSaved = stats.tokens_saved ?? 0;
  const slmsActive  = sessions.length;
  const filesIngested = stats.files_ingested ?? 0;
  const costSaved   = stats.cost_saved ?? 0;

  return (
    <div>
      <AchievementToast />
      {fetchErrors.length > 0 && (
        <div className="mx-6 mt-4 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
          <span className="font-semibold">Some data may be unavailable:</span>{" "}
          {fetchErrors.join(", ")}
        </div>
      )}
      {/* Page header */}
      <div className="bg-card border-b border-dborder px-0 py-7 mb-7">
        <div className="w-full px-12">
          <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-t3 mb-1.5 flex items-center gap-2">
            <span className="inline-block w-4 h-px bg-accent" />
            Workspace overview
          </div>
          <div className="font-sora text-2xl font-semibold text-t1">Intelligence Dashboard</div>
          <div className="text-[12px] text-t2 mt-1">Workspace health, AI learning progress &amp; session history</div>
        </div>
      </div>

      <div className="w-full px-12">
        <Pyramid />

        <div className="sect">Key metrics</div>
        <div className="grid grid-cols-4 gap-3.5 mb-6">
          <MetricCard
            label="Tokens saved"
            value={tokensSaved > 0 ? `${(tokensSaved / 1000).toFixed(1)}K` : "—"}
            sub="this month"
            pill="↓ 68% vs GPT-4"
            pillClass="pill-g"
            barColor="#4ade80"
          />
          <MetricCard
            label="Custom AIs"
            value={String(slmsActive || 0)}
            sub="trained models"
            pill={slmsActive > 0 ? `+${slmsActive} active` : "None yet"}
            pillClass="pill-b"
            barColor="#7c6af8"
          />
          <MetricCard
            label="Files ingested"
            value={String(filesIngested || 0)}
            sub="PDF · DOCX · XLSX"
            pill={filesIngested > 0 ? `${filesIngested} complete` : "Upload files"}
            pillClass="pill-b"
            barColor="#60a5fa"
          />
          <MetricCard
            label="Cost saved"
            value={costSaved > 0 ? `$${costSaved.toFixed(2)}` : "$0"}
            sub="this month"
            pill="83% efficiency"
            pillClass="pill-a"
            barColor="#fbbf24"
          />
        </div>

        <div className="grid grid-cols-2 gap-3.5 mb-6">
          {/* Token reduction bars */}
          <div className="card">
            <div className="flex items-center justify-between mb-3.5">
              <span className="text-[13px] font-semibold text-t1">Token usage reduction</span>
              <span className="apill">Last 7 sessions</span>
            </div>
            {[
              { label: "Without SLM", pct: 100, color: "#2a2a3d" },
              { label: "With SLM",    pct: 32,  color: "#7c6af8" },
              { label: "GraphRAG",    pct: 18,  color: "#2dd4a0" },
            ].map(row => (
              <div key={row.label} className="flex items-center gap-2.5 mb-2.5">
                <span className="text-[11px] text-t2 w-24 flex-shrink-0">{row.label}</span>
                <div className="flex-1 prog-bar">
                  <div className="prog-fill" style={{ width: `${row.pct}%`, background: row.color }} />
                </div>
                <span className="text-[11px] font-semibold text-t1 w-9 text-right">{row.pct}%</span>
              </div>
            ))}
            <div className="mt-3 pt-2.5 border-t border-dborder text-[11px] text-t2">
              <span className="text-gg font-semibold">68% avg reduction</span> using your SLM library
            </div>
          </div>

          {/* SLM hit rate donut */}
          <div className="card">
            <div className="flex items-center justify-between mb-3.5">
              <span className="text-[13px] font-semibold text-t1">SLM hit rate</span>
              <span className="apill">Reuse vs create</span>
            </div>
            <div className="flex items-center gap-5">
              <svg width="80" height="80" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="29" fill="none" stroke="#1a1a28" strokeWidth="12" />
                <circle cx="40" cy="40" r="29" fill="none" stroke="#7c6af8" strokeWidth="12"
                  strokeDasharray="118 64" strokeDashoffset="0" transform="rotate(-90 40 40)" />
                <circle cx="40" cy="40" r="29" fill="none" stroke="#2dd4a0" strokeWidth="12"
                  strokeDasharray="40 142" strokeDashoffset="-118" transform="rotate(-90 40 40)" />
                <text x="40" y="44" textAnchor="middle" fontSize="12" fontWeight="700" fill="#e8e6f0" fontFamily="Sora,sans-serif">
                  {slmsActive > 0 ? "65%" : "—"}
                </text>
              </svg>
              <div>
                {[
                  { color: "bg-accent",  label: "SLM reused — 65%" },
                  { color: "bg-teal",    label: "New SLM created — 22%" },
                  { color: "bg-dborder", label: "Full LLM fallback — 13%" },
                ].map(r => (
                  <div key={r.label} className="flex items-center gap-2 mb-2 text-[11px] text-t2">
                    <span className={`w-2 h-2 rounded-full ${r.color} flex-shrink-0`} />{r.label}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* AI Learning Progress Panel */}
        {learning && learning.models.length > 0 && (
          <div className="card mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-[13px] font-semibold text-t1">🧠 AI Learning Progress</div>
                <div className="text-[11px] text-t3 mt-0.5">
                  Your AI has answered <span className="font-bold text-t1">{learning.summary.total_queries}</span> queries · avg accuracy <span className="font-bold text-gg">{learning.summary.avg_accuracy_pct}%</span>
                </div>
              </div>
              {learning.summary.any_converged && (
                <span className="text-[11px] px-3 py-1 bg-gg/10 border border-gg/30 rounded-xl text-gg font-bold">🏆 Optimal config reached</span>
              )}
            </div>
            <div className="space-y-4">
              {learning.models.slice(0, 6).map(m => (
                <div key={m.model_id}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold text-t1 font-mono">{m.model_id}</span>
                      {m.converged && <span className="text-[9px] px-1.5 py-0.5 bg-gg/10 text-gg border border-gg/20 rounded">Converged</span>}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-t3">
                      <span>{m.query_count} queries</span>
                      {m.val_loss !== null && <span>Loss: {m.val_loss.toFixed(3)}</span>}
                      <span className="font-bold text-gg">{m.accuracy_pct}% accuracy</span>
                    </div>
                  </div>
                  <div className="h-2 bg-bg3 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${m.accuracy_pct}%`, background: m.converged ? "#16a34a" : "#6c5cf7" }} />
                  </div>
                  <div className="flex justify-between text-[9px] text-t3 mt-0.5">
                    <span>Reward: {m.reward.toFixed(3)}</span>
                    <span>{m.accuracy_pct < 80 ? "Still learning…" : m.converged ? "Optimal" : "Getting better"}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bandit Status Panel */}
        {banditArms.length > 0 && (
          <div className="card mb-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-[13px] font-semibold text-t1">🎰 Bandit Learning (LinUCB)</div>
                <div className="text-[11px] text-t3 mt-0.5">Real query observations per model — higher reward = more queries routed here</div>
              </div>
              <span className="apill">{banditArms.length} arms</span>
            </div>
            <div className="space-y-2">
              {banditArms.slice(0, 8).map((arm, i) => {
                const state = arm.converged ? "Confident"
                  : arm.observations >= 20 ? "Learning"
                  : "Exploring";
                const stateColor = state === "Confident" ? "text-gg border-gg/20 bg-gg/8"
                  : state === "Learning" ? "text-amber border-amber/20 bg-amber/8"
                  : "text-blue border-blue/20 bg-blue/8";
                const stateDesc = state === "Confident" ? "Optimal routing"
                  : state === "Learning" ? "Improving"
                  : arm.observations === 0 ? "No real data yet" : "Still exploring";
                return (
                <div key={arm.model_id} className="flex items-center gap-3">
                  <span className="text-[10px] text-t3 w-4 text-right flex-shrink-0">{i+1}</span>
                  <span className="text-[11px] font-mono text-t1 w-36 flex-shrink-0 truncate">{arm.model_id}</span>
                  <div className="flex-1 h-1.5 bg-bg3 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, arm.estimated_reward * 100)}%`, background: arm.converged ? "#16a34a" : "#7c6af8" }} />
                  </div>
                  <span className="text-[10px] text-t2 w-12 text-right">{(arm.estimated_reward * 100).toFixed(1)}%</span>
                  <span className="text-[9px] text-t3 w-14 text-right">{arm.observations > 0 ? `${arm.observations} obs` : "prior only"}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border font-semibold w-20 text-center flex-shrink-0 ${stateColor}`}>
                    {state === "Confident" ? "✓ " : state === "Learning" ? "⟳ " : "🔍 "}{stateDesc}
                  </span>
                </div>
                );
              })}
            </div>
            {/* Learning state legend */}
            <div className="mt-3 pt-3 border-t border-dborder grid grid-cols-3 gap-3 text-[10px]">
              <div className="flex items-start gap-2">
                <span className="text-blue font-bold mt-0.5 flex-shrink-0">🔍</span>
                <div>
                  <div className="font-semibold text-t2">Exploring</div>
                  <div className="text-t3">&lt; 20 real queries. Scores come from published benchmarks, not your usage. Results may vary significantly.</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-amber font-bold mt-0.5 flex-shrink-0">⟳</span>
                <div>
                  <div className="font-semibold text-t2">Learning</div>
                  <div className="text-t3">20–50 queries. Adapting to your domain. Each query + your 👍/👎 feedback improves routing.</div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-gg font-bold mt-0.5 flex-shrink-0">✓</span>
                <div>
                  <div className="font-semibold text-t2">Confident</div>
                  <div className="text-t3">&gt; 50 queries, low UCB uncertainty. Routing is optimised for your workload. Click 👎 on wrong answers to keep it calibrated.</div>
                </div>
              </div>
            </div>
            <div className="mt-2 text-[10px] text-t3">
              <span className="font-semibold text-t2">Note: </span>
              This is a probabilistic system. Even a &quot;Confident&quot; model is not 100% accurate.
              Reward = 0.5×task_completion + 0.35×(1−hallucination) + 0.15×user_acceptance.
              Use the 👍/👎 buttons on results to provide the user_acceptance signal.
            </div>
          </div>
        )}

        {/* Nash Equilibrium Panel */}
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[13px] font-semibold text-t1">⚖️ Nash Equilibrium — Model Allocation</div>
              <div className="text-[11px] text-t3 mt-0.5">The optimal strategy: what % of queries should each model handle?</div>
            </div>
            <div className="flex gap-1 flex-wrap justify-end">
              {(nashInsights?.valid_task_types ?? ["general_reasoning","domain_qa","code_generation","data_analysis"]).slice(0,5).map(t => (
                <button key={t} onClick={() => loadNashTask(t)}
                  className={`text-[9px] px-2 py-0.5 rounded border font-semibold transition-colors ${nashTask === t ? "bg-accent text-white border-accent" : "border-dborder text-t3 hover:border-accent/40"}`}>
                  {t.replace(/_/g," ")}
                </button>
              ))}
            </div>
          </div>

          {!nashInsights ? (
            <div className="flex items-center gap-2 py-4 text-t3 text-[11px]">
              <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />Loading…
            </div>
          ) : (
            <>
              {/* Allocation bars */}
              <div className="space-y-2 mb-4">
                {nashInsights.candidates.filter(c => c.nash_probability > 0.001).slice(0, 7).map(c => (
                  <div key={c.model} className={`rounded-xl p-3 border transition-all ${c.is_dominant ? "border-accent/40 bg-accent/5" : "border-dborder bg-bg2"}`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`text-[11px] font-semibold ${c.is_dominant ? "text-accent" : "text-t1"} font-mono`}>{c.model}</span>
                      {c.is_dominant && <span className="text-[9px] px-1.5 py-0.5 bg-accent/15 text-accent border border-accent/30 rounded font-bold">Dominant Strategy</span>}
                      {!c.is_available && <span className="text-[9px] px-1.5 py-0.5 bg-amber/10 text-amber border border-amber/30 rounded">Not installed</span>}
                      <span className="ml-auto text-[10px] text-t3">{c.benchmark_source}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-bg3 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${c.nash_probability * 100}%`, background: c.is_dominant ? "#6c5cf7" : "#4a4a6a" }} />
                      </div>
                      <span className="text-[11px] font-bold w-10 text-right" style={{ color: c.is_dominant ? "#6c5cf7" : undefined }}>
                        {(c.nash_probability * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex gap-3 mt-1.5 text-[9px] text-t3">
                      <span>Benchmark: <b className="text-t2">{(c.benchmark * 100).toFixed(0)}%</b></span>
                      <span>Bandit: <b className="text-t2">{(c.bandit_score * 100).toFixed(1)}%</b></span>
                      <span>Composite: <b className="text-t2">{c.composite_score.toFixed(3)}</b></span>
                      {c.observations > 0 && <span>Obs: <b className="text-gg">{c.observations}</b></span>}
                    </div>
                  </div>
                ))}
              </div>

              {/* Explanation */}
              {nashInsights.nash_explanation && (
                <div className="bg-bg3 rounded-xl p-3.5 text-[11px] text-t2 leading-relaxed mb-3">
                  <span className="font-semibold text-t1">Why this model? </span>
                  {nashInsights.nash_explanation}
                </div>
              )}

              {/* Formula */}
              <div className="flex items-start gap-2 text-[10px] text-t3">
                <span className="font-semibold text-accent flex-shrink-0">Formula:</span>
                <span className="font-mono">{nashInsights.formula}</span>
              </div>
              <div className="mt-2 text-[10px] text-t3 leading-relaxed">
                <span className="font-semibold text-t2">Game theory: </span>
                {nashInsights.game_theory_note}
              </div>
            </>
          )}
        </div>

        <div className="sect">Session history</div>

        {/* Process analytics */}
        {(() => {
          const processSessions = sessions.filter(s => (s.output?.process_steps?.length ?? 0) > 0);
          if (processSessions.length === 0) return null;
          // Aggregate step health across all process sessions
          const stepHealth: Record<string, { label: string; icon: string; thumbsUp: number; thumbsDown: number; count: number }> = {};
          for (const s of processSessions) {
            for (const ps of (s.output?.process_steps ?? [])) {
              const key = ps.label;
              if (!stepHealth[key]) stepHealth[key] = { label: ps.label, icon: ps.icon, thumbsUp: 0, thumbsDown: 0, count: 0 };
              stepHealth[key].count++;
              if ((ps as any).rating === 1)  stepHealth[key].thumbsUp++;
              if ((ps as any).rating === -1) stepHealth[key].thumbsDown++;
            }
          }
          const entries = Object.values(stepHealth).sort((a, b) => b.count - a.count).slice(0, 8);
          const totalRuns = processSessions.length;
          const ratedRuns = processSessions.filter(s => s.output?.process_steps?.some((ps: any) => ps.rating != null)).length;
          return (
            <div className="card mb-4 bg-bg3">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-[12px] font-semibold text-t1">Process analytics</div>
                  <div className="text-[10px] text-t3 mt-0.5">{totalRuns} process {totalRuns === 1 ? "run" : "runs"} · {ratedRuns} rated</div>
                </div>
                <span className="text-[9px] px-2 py-0.5 bg-purple-600/10 text-purple-400 border border-purple-600/25 rounded-full font-bold">✦ Process</span>
              </div>
              {entries.length > 0 ? (
                <div className="space-y-2">
                  {entries.map(e => {
                    const rated = e.thumbsUp + e.thumbsDown;
                    const score = rated > 0 ? Math.round((e.thumbsUp / rated) * 100) : null;
                    return (
                      <div key={e.label} className="flex items-center gap-3">
                        <span className="text-base w-5 flex-shrink-0 text-center">{e.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[11px] text-t2 truncate">{e.label}</span>
                            <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                              {score !== null && (
                                <span className={`text-[10px] font-semibold ${score >= 60 ? "text-gg" : "text-coral"}`}>
                                  {score}% 👍
                                </span>
                              )}
                              <span className="text-[9px] text-t3">{e.count}×</span>
                            </div>
                          </div>
                          {rated > 0 && (
                            <div className="h-1 bg-bg4 rounded-full overflow-hidden">
                              <div
                                className={`h-1 rounded-full ${score !== null && score >= 60 ? "bg-gg" : "bg-coral"}`}
                                style={{ width: `${score ?? 0}%` }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[11px] text-t3">Rate steps after runs to see health scores here.</div>
              )}
              {/* Improvement notes */}
              {(() => {
                const notes: { step: string; note: string; query: string }[] = [];
                for (const s of processSessions) {
                  for (const ps of (s.output?.process_steps ?? [])) {
                    if ((ps as any).note) notes.push({ step: ps.label, note: (ps as any).note, query: s.query });
                  }
                }
                if (notes.length === 0) return null;
                return (
                  <div className="mt-3 pt-3 border-t border-dborder space-y-1.5">
                    <div className="text-[10px] font-semibold text-t3 uppercase tracking-wider">Improvement notes from past runs</div>
                    {notes.slice(0, 4).map((n, i) => (
                      <div key={i} className="flex gap-2 items-start">
                        <span className="text-coral text-[10px] flex-shrink-0 mt-0.5">↓</span>
                        <div>
                          <span className="text-[10px] font-semibold text-t2">{n.step}: </span>
                          <span className="text-[10px] text-t3">{n.note}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          );
        })()}

        {sessions.length === 0 ? (
          <div className="text-center py-10 text-t3 text-[12px]">
            No sessions yet — upload files and run your first query
          </div>
        ) : (
          sessions.map((s) => {
            const isProcess = (s.output?.process_steps?.length ?? 0) > 0;
            const isExpanded = expandedSessions.has(s.job_id);
            return (
              <div key={s.job_id} className="mb-2">
                <div className="flex items-center gap-3 p-3 bg-card2 border border-dborder rounded-sm transition-colors hover:border-dborder2 cursor-pointer group" onClick={() => resumeSession(s)}>
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0 ${isProcess ? "bg-purple-600" : "bg-accent"}`}>
                    {isProcess ? "PRO" : "SLM"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-t1 truncate">{s.query}</div>
                    <div className="text-[10px] text-t3 mt-0.5 flex items-center gap-2 flex-wrap">
                      <span className="bg-bg4 border border-dborder px-1.5 py-0.5 rounded text-[9px]">{s.domain_label}</span>
                      {s.slm_model_id && <span className="text-gg">SLM: {s.slm_model_id}</span>}
                      {isProcess && (
                        <button
                          onClick={e => { e.stopPropagation(); setExpandedSessions(prev => { const n = new Set(prev); n.has(s.job_id) ? n.delete(s.job_id) : n.add(s.job_id); return n; }); }}
                          className="px-1.5 py-0.5 rounded text-[9px] bg-purple-600/10 text-purple-400 border border-purple-600/30 hover:bg-purple-600/20 transition-colors"
                        >
                          ✦ Process {isExpanded ? "▲" : "▼"}
                        </button>
                      )}
                      <span>{new Date(s.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-lg border ${s.hallucination_rate < 0.05 ? "bg-gg/10 text-gg border-gg/30" : "bg-amber/10 text-amber border-amber/30"}`}>
                      {((1 - s.hallucination_rate) * 100).toFixed(0)}% accuracy
                    </span>
                    {isProcess && (
                      <button
                        onClick={e => { e.stopPropagation(); replayProcessSession(s); }}
                        className="btn btn-sm text-purple-400 border-purple-600/30 bg-purple-600/10 hover:bg-purple-600/20 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ↺ Replay
                      </button>
                    )}
                    <button
                      onClick={e => { e.stopPropagation(); resumeSession(s); }}
                      className="btn btn-sm text-accent border-accent/30 bg-accent/10 hover:bg-accent/20 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      {s.output ? "View Results →" : "Resume →"}
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); deleteSession(s.job_id); }}
                      className="btn btn-sm text-coral border-coral/30 bg-coral/10 hover:bg-coral/20 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {isProcess && isExpanded && (
                  <div className="border border-t-0 border-dborder bg-bg3 rounded-b-sm px-3 py-2 space-y-1.5">
                    {s.output!.process_steps!.map((st, i) => (
                      <div key={i} className="flex gap-2 items-start">
                        <span className="text-[13px] mt-0.5 flex-shrink-0">{st.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-semibold text-t1">{st.label}</div>
                          <div className="text-[10px] text-t3 mt-0.5 line-clamp-2">{st.output?.slice(0, 220)}{(st.output?.length ?? 0) > 220 ? "…" : ""}</div>
                        </div>
                        <span className="text-[9px] font-bold text-gg bg-gg/10 border border-gg/30 px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5">Step {i + 1}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        <div className="h-6" />
        <div className="flex gap-2">
          <button
            onClick={() => router.push("/query")}
            className="btn btn-p flex-1"
          >
            Start new session →
          </button>
          <button
            onClick={() => router.push("/templates")}
            className="btn flex-shrink-0 text-purple-400 border-purple-600/30 bg-purple-600/10 hover:bg-purple-600/20"
          >
            🗂️ Templates
          </button>
        </div>
        <div className="h-8" />
      </div>
    </div>
  );
}
