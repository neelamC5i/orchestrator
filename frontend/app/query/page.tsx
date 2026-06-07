"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import PromptBuilder from "../components/PromptBuilder";
import { API_BASE } from "../lib/api";

interface StoredCorpus {
  job_id: string;
  domain_label: string;
  file_count: number;
  entity_count: number;
  created_at: string;
}

const DOMAIN_ICONS: Record<string, string> = {
  manufacturing: "\u{1F3ED}",
  "it industry": "\u{1F4BB}",
  software: "\u{1F4BB}",
  healthcare: "\u{1F3E5}",
  medical: "\u{1F3E5}",
  finance: "\u{1F4C9}",
  banking: "\u{1F4C9}",
  legal: "\u{2696}\uFE0F",
  law: "\u{2696}\uFE0F",
  retail: "\u{1F6CD}\uFE0F",
  education: "\u{1F393}",
  logistics: "\u{1F69A}",
  supply: "\u{1F69A}",
  energy: "\u26A1",
  pharma: "\u{1F48A}",
  pharmaceutical: "\u{1F48A}",
  research: "\u{1F52C}",
  science: "\u{1F52C}",
  construction: "\u{1F3D7}\uFE0F",
};

function domainIcon(label: string): string {
  const key = label.toLowerCase();
  for (const [k, v] of Object.entries(DOMAIN_ICONS)) {
    if (key.includes(k.trim())) return v;
  }
  return "\u{1F5C2}\uFE0F";
}

function domainLabel(label: string): string {
  return label.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

export default function QueryPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selectedCorpus, setSelectedCorpus] = useState<StoredCorpus | null>(null);
  const [savedCorpora, setSavedCorpora] = useState<StoredCorpus[]>([]);
  const [error, setError] = useState("");
  const [lastKpis, setLastKpis] = useState<{ kpi: string; phase: string }[]>([]);
  const [selectedKpis, setSelectedKpis] = useState<Set<string>>(new Set());
  const [kpiApplied, setKpiApplied] = useState(false);
  const [slmStatus, setSlmStatus] = useState<"none" | "building" | "done">("none");
  const [slmModelId, setSlmModelId] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [weights, setWeights] = useState({
    benchmark: 0.30, availability: 0.20, bandit: 0.20,
    speed: 0.15, ctx_fit: 0.10, task_fit: 0.05,
  });

  const WEIGHT_PRESETS = {
    balanced: { benchmark: 0.30, availability: 0.20, bandit: 0.20, speed: 0.15, ctx_fit: 0.10, task_fit: 0.05 },
    quality:  { benchmark: 0.55, availability: 0.10, bandit: 0.10, speed: 0.05, ctx_fit: 0.10, task_fit: 0.10 },
    speed:    { benchmark: 0.15, availability: 0.15, bandit: 0.15, speed: 0.50, ctx_fit: 0.05, task_fit: 0.00 },
    reliable: { benchmark: 0.15, availability: 0.35, bandit: 0.35, speed: 0.05, ctx_fit: 0.05, task_fit: 0.05 },
  } as const;
  type PresetKey = keyof typeof WEIGHT_PRESETS;

  const WEIGHT_LABELS: Record<string, { label: string; desc: string }> = {
    benchmark:    { label: "Quality",      desc: "Benchmark accuracy / reasoning score" },
    availability: { label: "Availability", desc: "How often the model is reachable" },
    bandit:       { label: "Reliability",  desc: "Historical success rate (bandit)" },
    speed:        { label: "Speed",        desc: "Tokens-per-second throughput" },
    ctx_fit:      { label: "Context fit",  desc: "Handles your document length" },
    task_fit:     { label: "Task fit",     desc: "Specialised for this task type" },
  };

  const weightTotal = Object.values(weights).reduce((s, v) => s + v, 0);

  const applyPreset = (key: PresetKey) => {
    setWeights({ ...WEIGHT_PRESETS[key] });
    sessionStorage.setItem("scoring_weights", JSON.stringify(WEIGHT_PRESETS[key]));
  };

  const updateWeight = (key: string, val: number) => {
    const next = { ...weights, [key]: val };
    setWeights(next);
    sessionStorage.setItem("scoring_weights", JSON.stringify(next));
  };

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("scoring_weights") ?? "null");
      if (saved && typeof saved === "object") setWeights(w => ({ ...w, ...saved }));
    } catch { /**/ }

    const savedSysPrompt = sessionStorage.getItem("system_prompt") ?? "";
    if (savedSysPrompt) setSystemPrompt(savedSysPrompt);

    try {
      const kpis = JSON.parse(localStorage.getItem("orch_last_kpis") ?? "[]");
      if (Array.isArray(kpis) && kpis.length > 0) setLastKpis(kpis);
    } catch { /**/ }

    const local: StoredCorpus[] = (() => {
      try { return JSON.parse(localStorage.getItem("orch_corpora") ?? "[]"); }
      catch { return []; }
    })();
    setSavedCorpora(local);

    const domainLbl = sessionStorage.getItem("domain_label") ?? "general";

    fetch(`${API_BASE}/api/v1/slm/status?domain_label=${encodeURIComponent(domainLbl)}`)
      .then(r => r.json())
      .then(d => {
        if (d.status === "done") { setSlmStatus("done"); setSlmModelId(d.model_id ?? null); }
        else if (d.status === "running" || d.status === "queued") setSlmStatus("building");
      })
      .catch(() => {});

    const jobId = sessionStorage.getItem("job_id");
    if (jobId) {
      const match = local.find(c => c.job_id === jobId);
      if (match) {
        setSelectedCorpus(match);
      } else {
        setSelectedCorpus({ job_id: jobId, domain_label: domainLbl, file_count: 0, entity_count: 0, created_at: "" });
      }
    } else if (local.length > 0) {
      setSelectedCorpus(local[0]);
      sessionStorage.setItem("job_id", local[0].job_id);
      sessionStorage.setItem("domain_label", local[0].domain_label);
    }
  }, []);

  const handleRun = (overrideQuery?: string, overrideSysPrompt?: string) => {
    const q = (overrideQuery ?? query).trim();
    const sp = (overrideSysPrompt ?? systemPrompt).trim();
    if (!q) { setError("Please enter a question or goal"); return; }
    if (!selectedCorpus) { setError("Select a workspace first"); return; }
    setError("");
    sessionStorage.setItem("job_id", selectedCorpus.job_id);
    sessionStorage.setItem("domain_label", selectedCorpus.domain_label);
    sessionStorage.setItem("query", q);
    sessionStorage.setItem("system_prompt", sp);
    sessionStorage.setItem("reuse_corpus", "true");
    router.push("/processing");
  };

  const selectCorpus = (c: StoredCorpus) => {
    setSelectedCorpus(c);
    sessionStorage.setItem("job_id", c.job_id);
    sessionStorage.setItem("domain_label", c.domain_label);
    setManualMode(false);
  };

  return (
    <div>
      {/* Header */}
      <div className="bg-card border-b border-dborder px-0 py-7 mb-7">
        <div className="w-full px-8 flex items-start justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-t3 mb-1.5 flex items-center gap-2">
              <span className="inline-block w-4 h-px bg-accent" />
              Step 3 \u00B7 Workspace
            </div>
            <div className="font-sora text-2xl font-semibold text-t1">Select your workspace</div>
            <div className="text-[12px] text-t2 mt-1">Choose your domain, then pick what you want to do</div>
          </div>
          <button onClick={() => router.push("/")} className="btn btn-sm text-t3 hover:text-t1 mt-2">
            \u2190 Back
          </button>
        </div>
      </div>

      <div className="w-full px-8">

        {/* Workspace / Domain selector */}
        {savedCorpora.length === 0 && !selectedCorpus ? (
          <div className="px-4 py-4 bg-amber/5 border border-amber/30 rounded-sm text-[12px] text-amber mb-6">
            No workspace available.{" "}
            <button onClick={() => router.push("/")} className="underline">Upload files first \u2192</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 mb-6">
            {savedCorpora.map(c => (
              <div
                key={c.job_id}
                onClick={() => selectCorpus(c)}
                className={`flex items-center gap-4 px-4 py-3.5 rounded-card border cursor-pointer transition-all ${
                  selectedCorpus?.job_id === c.job_id
                    ? "bg-accent/10 border-accent/50 shadow-sm"
                    : "bg-card2 border-dborder hover:border-accent/30 hover:bg-accent/5"
                }`}
              >
                <div className="text-2xl flex-shrink-0 w-8 text-center">{domainIcon(c.domain_label)}</div>
                <div className="flex-1 min-w-0">
                  <div className={`text-[13px] font-semibold ${selectedCorpus?.job_id === c.job_id ? "text-accent" : "text-t1"}`}>
                    {domainLabel(c.domain_label)}
                  </div>
                  <div className="text-[10px] text-t3 mt-0.5">
                    {c.file_count > 0 ? `${c.file_count} file${c.file_count !== 1 ? "s" : ""}` : "Just ingested"}
                    {c.entity_count > 0 && ` \u00B7 ${c.entity_count} entities`}
                    {c.created_at ? " \u00B7 " + new Date(c.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                  </div>
                </div>
                {selectedCorpus?.job_id === c.job_id ? (
                  <span className="text-[11px] text-accent font-bold flex-shrink-0">\u2713</span>
                ) : (
                  <span className="text-[11px] text-t3 flex-shrink-0">\u203A</span>
                )}
              </div>
            ))}

            {/* Just-ingested corpus not yet in localStorage */}
            {selectedCorpus && !savedCorpora.find(c => c.job_id === selectedCorpus.job_id) && (
              <div className="flex items-center gap-4 px-4 py-3.5 rounded-card border bg-accent/10 border-accent/50 shadow-sm">
                <div className="text-2xl w-8 text-center">{domainIcon(selectedCorpus.domain_label)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-accent">{domainLabel(selectedCorpus.domain_label)}</div>
                  <div className="text-[10px] text-t3 mt-0.5">Just ingested \u00B7 knowledge graph ready</div>
                </div>
                <span className="text-[11px] text-accent font-bold flex-shrink-0">\u2713</span>
              </div>
            )}
          </div>
        )}

        {/* SLM badge */}
        {slmStatus !== "none" && (
          <div className="mb-5">
            {slmStatus === "done" ? (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                \u2728 Custom AI ready{slmModelId && <span className="font-normal text-emerald-500/70 ml-1">({slmModelId})</span>}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-2.5 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                \u2699\uFE0F Building your custom AI\u2026
              </span>
            )}
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-dborder mb-6" />

        {/* Prompt Builder or manual input */}
        {manualMode ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-t3">Your question or goal</div>
              <button
                onClick={() => setManualMode(false)}
                className="text-[10px] text-accent hover:text-accent/70 transition-colors"
              >
                \u2190 Back to suggestions
              </button>
            </div>
            <textarea
              className="w-full bg-bg3 border border-dborder2 rounded-card px-4 py-3 text-[12px] text-t1 outline-none transition-colors focus:border-accent font-dm resize-none mb-2"
              rows={4}
              placeholder="e.g. Analyze supplier risk across the manufacturing chain\u2026"
              value={query}
              onChange={e => { setQuery(e.target.value); setError(""); }}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleRun(); }}
            />
            <div className="text-[10px] text-t3 mb-4">Ctrl+Enter to run</div>
            {error && (
              <div className="flex items-center gap-2 px-4 py-3 bg-coral/10 border border-coral/30 rounded-sm text-[12px] text-coral mb-4">
                \u26A0 {error}
              </div>
            )}
            <button
              onClick={() => handleRun()}
              disabled={!query.trim() || !selectedCorpus}
              className="btn btn-p btn-full py-3 text-sm disabled:opacity-40 mb-8"
            >
              Run \u2192
            </button>
          </>
        ) : (
          <PromptBuilder
            corpus={selectedCorpus}
            onUsePrompt={(q, sp, proc) => {
              // Store process info if present
              if (proc) {
                sessionStorage.setItem("process_plan", "true");
                sessionStorage.setItem("process_intent", proc.intent);
                sessionStorage.setItem("process_topic", proc.topic);
                sessionStorage.setItem("process_topics", JSON.stringify(proc.selectedTopics ?? []));
                if (proc.customTemplateId) {
                  sessionStorage.setItem("process_custom_template", proc.customTemplateId);
                } else {
                  sessionStorage.removeItem("process_custom_template");
                }
              } else {
                sessionStorage.removeItem("process_plan");
                sessionStorage.removeItem("process_intent");
                sessionStorage.removeItem("process_topic");
                sessionStorage.removeItem("process_topics");
                sessionStorage.removeItem("process_custom_template");
              }
              // Fill the textarea so the user can review before clicking Run
              const mergedSp = [systemPrompt, sp].filter(Boolean).join("\n\n").trim();
              setQuery(q);
              if (mergedSp) setSystemPrompt(mergedSp);
              setManualMode(true);
            }}
            onManual={() => {
              sessionStorage.removeItem("process_plan");
              sessionStorage.removeItem("process_intent");
              sessionStorage.removeItem("process_topic");
              sessionStorage.removeItem("process_topics");
              sessionStorage.removeItem("process_custom_template");
              setManualMode(true);
            }}
          />
        )}

        {/* Advanced settings */}
        <div className="border border-dborder2 rounded-card mb-8 mt-4">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-left"
            onClick={() => setAdvancedOpen(o => !o)}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-t3">Advanced settings</span>
            <span className="text-[10px] text-t3">{advancedOpen ? "\u25B2 hide" : "\u25BC show"}</span>
          </button>

          {advancedOpen && (
            <div className="px-4 pb-4 border-t border-dborder2 pt-4 space-y-5">

              {/* System prompt */}
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-t3 mb-1.5">
                  System prompt <span className="font-normal normal-case">(optional)</span>
                </div>
                <textarea
                  className="w-full bg-bg3 border border-dborder2 rounded-card px-4 py-3 text-[12px] text-t1 outline-none transition-colors focus:border-accent font-dm resize-none"
                  rows={3}
                  placeholder="e.g. You are an expert in pharmaceutical regulatory affairs. Always cite sources."
                  value={systemPrompt}
                  onChange={e => setSystemPrompt(e.target.value)}
                />
                <div className="text-[10px] text-t3 mt-1">Prepended to every LLM call. Set a persona, constraints, or output format.</div>
              </div>

              {/* KPI panel */}
              {lastKpis.length > 0 && (
                <div className="bg-bg3 border border-amber/20 rounded-card px-4 py-3">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-amber flex items-center gap-2">
                        <span className="w-3 h-px bg-amber/60" />Quality KPIs from last session
                      </div>
                      <p className="text-[10px] text-t3 mt-0.5">Select KPIs to inject as constraints</p>
                    </div>
                    {selectedKpis.size > 0 && !kpiApplied && (
                      <button
                        onClick={() => {
                          const lines = [...selectedKpis];
                          const prefix = systemPrompt.trim() ? systemPrompt.trim() + "\n\n" : "";
                          const kpiBlock = "Enforce the following quality targets in every response:\n" + lines.map(k => `- ${k}`).join("\n");
                          const newPrompt = prefix + kpiBlock;
                          setSystemPrompt(newPrompt);
                          sessionStorage.setItem("system_prompt", newPrompt);
                          setKpiApplied(true);
                        }}
                        className="text-[11px] font-semibold px-3 py-1.5 bg-amber/10 border border-amber/40 rounded-md text-amber hover:bg-amber/20 transition-colors flex-shrink-0 ml-4"
                      >
                        Apply {selectedKpis.size} KPI{selectedKpis.size > 1 ? "s" : ""}
                      </button>
                    )}
                    {kpiApplied && <span className="text-[11px] text-gg font-semibold flex-shrink-0 ml-4">\u2713 Added</span>}
                  </div>
                  <div className="space-y-2">
                    {[...new Set(lastKpis.map(k => k.phase))].map(phase => (
                      <div key={phase}>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-t3 mb-1">{phase}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {lastKpis.filter(k => k.phase === phase).map(({ kpi }) => (
                            <button
                              key={kpi}
                              onClick={() => {
                                setSelectedKpis(prev => { const n = new Set(prev); n.has(kpi) ? n.delete(kpi) : n.add(kpi); return n; });
                                setKpiApplied(false);
                              }}
                              className={`text-[10px] px-2.5 py-1 rounded-md border transition-colors ${
                                selectedKpis.has(kpi) ? "bg-amber/15 border-amber/50 text-amber" : "bg-bg border-dborder text-t3 hover:border-amber/30 hover:text-t2"
                              }`}
                            >
                              {selectedKpis.has(kpi) && <span className="mr-1">\u2713</span>}{kpi}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Scoring weights */}
              <div className="border border-dborder2 rounded-card">
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                  onClick={() => setWeightsOpen(o => !o)}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-t3">AI scoring preferences</span>
                  <span className="text-[10px] text-t3">{weightsOpen ? "\u25B2 hide" : "\u25BC customise"}</span>
                </button>
                {weightsOpen && (
                  <div className="px-4 pb-4 border-t border-dborder2">
                    <div className="flex gap-2 mt-3 mb-4 flex-wrap">
                      {(Object.keys(WEIGHT_PRESETS) as PresetKey[]).map(k => (
                        <button key={k} onClick={() => applyPreset(k)}
                          className="text-[10px] px-3 py-1 rounded-full border border-dborder2 text-t2 hover:border-accent hover:text-accent transition-colors capitalize">
                          {k === "balanced" ? "Balanced (default)" : k.charAt(0).toUpperCase() + k.slice(1) + " first"}
                        </button>
                      ))}
                    </div>
                    <div className="space-y-3">
                      {Object.entries(weights).map(([key, val]) => (
                        <div key={key}>
                          <div className="flex justify-between mb-1">
                            <span className="text-[11px] text-t1 font-medium">{WEIGHT_LABELS[key].label}</span>
                            <span className="text-[11px] text-accent font-mono">{Math.round(val * 100)}%</span>
                          </div>
                          <input type="range" min={0} max={1} step={0.05} value={val}
                            onChange={e => updateWeight(key, parseFloat(e.target.value))}
                            className="w-full accent-accent h-1" />
                          <div className="text-[10px] text-t3 mt-0.5">{WEIGHT_LABELS[key].desc}</div>
                        </div>
                      ))}
                    </div>
                    <div className={`mt-4 text-[10px] font-mono ${Math.abs(weightTotal - 1.0) > 0.01 ? "text-amber" : "text-t3"}`}>
                      Weight total: {(weightTotal * 100).toFixed(0)}%
                      {Math.abs(weightTotal - 1.0) > 0.01 && " \u2014 will be normalised automatically"}
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

      </div>
    </div>
  );
}
