"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { API_BASE, apiFetch, parseApiError } from "../lib/api";
import { deriveBuildPlan, type BuildStep, type OrchestratorOutput, type ModelRec, type SubTaskResult } from "../lib/buildPlan";
import {
  ConfidenceBadge, SubConfidenceBadge, ModelChoiceCard, WarningsBanner,
  ProviderBadge, PriorityBadge, Pyramid,
  type ModelContextArm, type ModelContext, type OrchestratorWarning,
} from "../components/BlueprintHelpers";

interface ChatMessage { role: "user" | "assistant"; content: string; }

export default function RecommendationsPage() {
  const router = useRouter();
  const [output, setOutput] = useState<OrchestratorOutput | null>(null);
  const [buildPlan, setBuildPlan] = useState<BuildStep[]>([]);
  const [planPath, setPlanPath] = useState<"BUILDER"|"RESEARCHER"|"ANALYST"|"AUDITOR"|"SUMMARIZER">("BUILDER");
  const [planAnswers, setPlanAnswers] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<string>("answer");
  const [expandedStep, setExpandedStep] = useState<number | null>(1);
  const [traceExpanded, setTraceExpanded] = useState<number | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [selectedKpis, setSelectedKpis] = useState<Set<string>>(new Set());
  const [kpiApplied, setKpiApplied] = useState(false);
  const [existingSysPrompt, setExistingSysPrompt] = useState("");
  const [tweakQuery, setTweakQuery] = useState("");
  const [tweakOpen, setTweakOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  // Probabilistic transparency state
  const [modelContext, setModelContext] = useState<ModelContext | null>(null);
  const [orcWarnings, setOrcWarnings] = useState<OrchestratorWarning[]>([]);
  const [activeWeights, setActiveWeights] = useState<Record<string, number> | null>(null);
  const [feedbackSent, setFeedbackSent] = useState<Record<string, "correct" | "incorrect">>({});
  // Per-step inline tweak
  const [stepTweakInput, setStepTweakInput] = useState<Record<number, string>>({});
  const [stepTweakLoading, setStepTweakLoading] = useState<Record<number, boolean>>({});
  const [stepTweakReplies, setStepTweakReplies] = useState<Record<number, string>>({});
  const [stepTweakError, setStepTweakError] = useState<Record<number, string>>({});

  useEffect(() => {
    const jid = sessionStorage.getItem("job_id");
    setJobId(jid);
    setExistingSysPrompt(sessionStorage.getItem("system_prompt") ?? "");
    // Load intent path from planning wizard
    try {
      const choices = JSON.parse(sessionStorage.getItem("orch_plan_choices") ?? "{}");
      if (choices.path) setPlanPath(choices.path);
      if (choices.answers) setPlanAnswers(choices.answers);
      // BUILDER defaults to blueprint tab; others default to answer
      if (choices.path === "BUILDER") setActiveTab("plan");
      else setActiveTab("answer");
    } catch { /**/ }

    const raw = sessionStorage.getItem("orchestrator_output");
    setTweakQuery(sessionStorage.getItem("query") ?? "");
    // Load probabilistic context emitted before the main output
    try {
      const mc = sessionStorage.getItem("orch_model_context");
      if (mc) setModelContext(JSON.parse(mc));
    } catch { /**/ }
    try {
      const w = sessionStorage.getItem("orch_warnings");
      if (w) setOrcWarnings(JSON.parse(w));
    } catch { /**/ }
    try {
      const sw = sessionStorage.getItem("scoring_weights");
      if (sw) setActiveWeights(JSON.parse(sw));
    } catch { /**/ }
    if (raw) {
      try {
        const parsed: OrchestratorOutput = JSON.parse(raw);
        setOutput(parsed);
        const plan = deriveBuildPlan(parsed);
        setBuildPlan(plan);
        // Persist KPIs to localStorage so query page can display them
        const allKpis = plan.flatMap(s => s.kpis.map(k => ({ kpi: k, phase: s.phase })));
        try { localStorage.setItem("orch_last_kpis", JSON.stringify(allKpis)); } catch { /**/ }
        if (parsed.final_answer) {
          setChatMessages([{ role: "assistant", content: parsed.final_answer }]);
        }
      } catch { router.push("/query"); }
    } else { router.push("/query"); }
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  // Detect whether the user input is a question or a modification request
  const isModificationRequest = (text: string): boolean => {
    const t = text.toLowerCase().trim();
    const modWords = [
      "add ", "remove ", "delete ", "include ", "exclude ", "change ", "update ", "replace ",
      "modify ", "use ", "switch ", "rename ", "drop ", "insert ", "append ", "move ",
      "i need ", "i want ", "please add", "please change", "please update", "make it ",
      "instead of ", "rather than ", "also add", "don't use", "avoid ",
    ];
    return modWords.some(w => t.startsWith(w) || t.includes(" " + w.trim() + " "));
  };

  const askAboutStep = async (step: BuildStep) => {
    const question = (stepTweakInput[step.id] ?? "").trim();
    if (!question) return;
    setStepTweakLoading(p => ({ ...p, [step.id]: true }));
    setStepTweakError(p => ({ ...p, [step.id]: "" }));
    setStepTweakReplies(p => ({ ...p, [step.id]: "" }));
    const API = API_BASE;
    const domainLabel = sessionStorage.getItem("domain_label") ?? "general";
    const originalQuery = sessionStorage.getItem("original_query") ?? sessionStorage.getItem("query") ?? "";

    // Full step context for the LLM — keep under 2800 chars to stay within max_length=4096
    const trunc = (s: string, n: number) => s.length > n ? s.slice(0, n) + "…" : s;
    const stepContextLines = [
      `Step ${step.id}: ${step.title} (${step.phase})`,
      `HLD: ${trunc(step.hld, 400)}`,
      `Bullets: ${step.hldBullets.slice(0, 3).join(" | ")}`,
      step.lld[0] ? `LLD: ${step.lld[0].component} — ${step.lld[0].logic.slice(0, 2).join("; ")}` : "",
      `KPIs: ${step.kpis.slice(0, 3).join(", ")}`,
      `Models: ${step.models.slice(0, 3).map(m => `${m.name} score=${m.score.toFixed(3)} role=${m.role} reason="${trunc(m.why, 80)}"`).join(" | ")}`,
    ].filter(Boolean);
    const stepContext = stepContextLines.join("\n");

    const isModification = isModificationRequest(question);

    try {
      if (!isModification) {
        // ── Q&A mode: just answer the question with full step context ──
        const systemPrompt = `You are an expert software architect reviewing a solution blueprint. Answer questions concisely and specifically about the given step. When asked about model recommendations, explain the scores, capabilities, and why that model fits the role. Never regenerate the blueprint — just answer the question.`;
        const raw = `${stepContext}\n\n---\nUser question: ${question}`;
        const queryWithContext = raw.length > 4000 ? raw.slice(0, 4000) : raw;
        const res = await apiFetch(`${API}/api/v1/orchestrator/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: queryWithContext, domain_label: domainLabel, job_id: jobId, system_prompt: systemPrompt }),
        });
        if (!res.ok) throw new Error(await parseApiError(res));
        if (!res.body) throw new Error("No response body");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "", answer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n"); buf = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.type === "output" && ev.data?.final_answer) answer = ev.data.final_answer;
              } catch { /* skip */ }
            }
          }
        }
        setStepTweakReplies(p => ({ ...p, [step.id]: answer || "No answer returned." }));
        setStepTweakInput(p => ({ ...p, [step.id]: "" }));

      } else {
        // ── Regeneration mode: regenerate ONLY this step ──
        setStepTweakReplies(p => ({ ...p, [step.id]: "⏳ Regenerating this step…" }));
        const systemPrompt = `You are an expert software architect. The user wants to modify a specific step in a solution blueprint. Regenerate ONLY this step incorporating the user's change. Keep the same JSON structure. The original project query was: "${originalQuery}"`;
        const rawRegen = `${stepContext}\n\n---\nModification request: "${question}"\nRegenerate this step only, incorporating the change into HLD, LLD, implementation steps, KPIs and model recommendations.`;
        const regenQuery = rawRegen.length > 4000 ? rawRegen.slice(0, 4000) : rawRegen;
        const res = await apiFetch(`${API}/api/v1/orchestrator/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: regenQuery, domain_label: domainLabel, job_id: jobId, system_prompt: systemPrompt }),
        });
        if (!res.ok) throw new Error(await parseApiError(res));
        if (!res.body) throw new Error("No response body");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "", newBuildPlan: BuildStep[] | null = null, finalAnswer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n"); buf = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.type === "output" && ev.data) {
                  if (ev.data.build_plan?.length) newBuildPlan = ev.data.build_plan;
                  if (ev.data.final_answer) finalAnswer = ev.data.final_answer;
                }
              } catch { /* skip */ }
            }
          }
        }
        // Patch only the matching step in buildPlan; fall back to showing answer if no plan returned
        if (newBuildPlan) {
          const updatedStep = newBuildPlan.find(s => s.id === step.id) ?? newBuildPlan[0];
          if (updatedStep) {
            setBuildPlan(prev => prev.map(s => s.id === step.id ? { ...updatedStep, id: step.id } : s));
            setStepTweakReplies(p => ({ ...p, [step.id]: `✅ Step "${step.title}" has been updated with your change.` }));
          }
        } else {
          setStepTweakReplies(p => ({ ...p, [step.id]: finalAnswer || "Step regenerated — please scroll up to review." }));
        }
        setStepTweakInput(p => ({ ...p, [step.id]: "" }));
      }
    } catch (e: any) {
      setStepTweakError(p => ({ ...p, [step.id]: e.message ?? "Request failed" }));
      setStepTweakReplies(p => ({ ...p, [step.id]: "" }));
    } finally {
      setStepTweakLoading(p => ({ ...p, [step.id]: false }));
    }
  };

  const regenerateSolution = async () => {
    const newQuery = tweakQuery.trim();
    if (!newQuery || !jobId || regenerating) return;
    setRegenerating(true);
    setRegenError(null);
    const API = API_BASE;
    const domainLabel = sessionStorage.getItem("domain_label") ?? "general";
    const systemPrompt = sessionStorage.getItem("system_prompt") ?? "";
    try {
      const res = await apiFetch(`${API}/api/v1/orchestrator/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: newQuery, domain_label: domainLabel, job_id: jobId, system_prompt: systemPrompt }),
      });
      if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
      if (!res.body) throw new Error("No response body from orchestrator");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === "output" && ev.data) {
                const newOutput: OrchestratorOutput = ev.data;
                sessionStorage.setItem("query", newQuery);
                sessionStorage.setItem("orchestrator_output", JSON.stringify(newOutput));
                setOutput(newOutput);
                setBuildPlan(deriveBuildPlan(newOutput));
                if (newOutput.final_answer) setChatMessages([{ role: "assistant", content: newOutput.final_answer }]);
                setTweakOpen(false);
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch (e: any) {
      setRegenError(e.message ?? "Regeneration failed");
    } finally {
      setRegenerating(false);
    }
  };

  const sendFeedback = async (modelId: string, taskType: string, idx: number, isCorrect: boolean) => {
    const key = `${idx}`;
    setFeedbackSent(p => ({ ...p, [key]: isCorrect ? "correct" : "incorrect" }));
    const API = API_BASE;
    try {
      await apiFetch(`${API}/api/v1/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: output?.session_id ?? "",
          model_id: modelId,
          task_type: taskType,
          is_correct: isCorrect,
          domain_label: sessionStorage.getItem("domain_label") ?? "general",
        }),
      });
    } catch { /**/ }  // non-fatal — UI state already updated
  };

  const startNewSession = () => {
    sessionStorage.removeItem("query");
    sessionStorage.removeItem("orchestrator_output");
    sessionStorage.removeItem("system_prompt");
    sessionStorage.removeItem("reuse_corpus");
    // Keep job_id and domain_label so the query page auto-selects the same corpus
    router.push("/query");
  };

  const downloadPDF = () => {
    window.print();
  };

  const sendChat = async () => {
    if (!chatInput.trim() || !output) return;
    const msg = chatInput.trim();
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", content: msg }]);
    setIsChatting(true);
    try {
      const API = API_BASE;
      const res = await apiFetch(`${API}/api/v1/orchestrator/ask`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: msg, session_id: output.session_id, job_id: jobId,
          domain_label: output.slm_model_id ?? sessionStorage.getItem("domain_label") ?? "general",
        }),
      });
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "", answer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try { const ev = JSON.parse(line.slice(6)); if (ev.type === "output") answer = ev.data?.final_answer ?? ""; } catch { /**/ }
          }
        }
      }
      setChatMessages(prev => [...prev, { role: "assistant", content: answer || "I couldn't generate a response." }]);
    } catch {
      setChatMessages(prev => [...prev, { role: "assistant", content: "Error communicating with the model." }]);
    } finally { setIsChatting(false); }
  };

  if (!output) return <div className="flex items-center justify-center h-screen text-t3 text-sm">Loading…</div>;

  return (
    <div>
      {/* ── Regenerating overlay ── */}
      {regenerating && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center backdrop-blur-sm">
          <div className="bg-card rounded-2xl border border-dborder shadow-xl px-10 py-8 flex flex-col items-center gap-4 max-w-sm w-full mx-4">
            <div className="w-10 h-10 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            <div className="text-[14px] font-semibold text-t1">Regenerating solution…</div>
            <div className="text-[12px] text-t3 text-center">Re-running the AI with your updated prompt.<br/>The knowledge graph stays intact.</div>
          </div>
        </div>
      )}

      {/* ── Tweak prompt panel ── */}
      <div className="bg-card border-b border-dborder px-8 py-3 no-print">
        <button
          onClick={() => { setTweakOpen(o => !o); setRegenError(null); }}
          className="flex items-center gap-2 text-[12px] text-t3 hover:text-t1 transition-colors"
        >
          <span className="text-[14px]">✏️</span>
          <span className="font-medium">Refine prompt</span>
          <span className="ml-1 text-[10px]">{tweakOpen ? "▲" : "▼"}</span>
        </button>
        {tweakOpen && (
          <div className="mt-3 flex flex-col gap-3">
            <div className="text-[11px] text-t3">Edit your original prompt below and click <strong>Regenerate</strong> — the corpus and knowledge graph stay intact, only the AI answer and blueprint are updated.</div>
            <textarea
              value={tweakQuery}
              onChange={e => setTweakQuery(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-dborder bg-bg2 text-t1 text-[13px] px-4 py-3 resize-y focus:outline-none focus:border-accent"
              placeholder="Describe what you want to build or ask…"
            />
            {regenError && <div className="text-[11px] text-coral">⚠ {regenError}</div>}
            <div className="flex gap-2 items-center">
              <button
                onClick={regenerateSolution}
                disabled={!tweakQuery.trim() || regenerating}
                className="btn btn-p btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ↺ Regenerate solution
              </button>
              <button onClick={() => { setTweakOpen(false); setTweakQuery(output?.query ?? ""); setRegenError(null); }} className="btn btn-sm">
                Cancel
              </button>
              <span className="text-[11px] text-t3 ml-auto">Current: "{output.query.slice(0, 60)}{output.query.length > 60 ? '…' : ''}"</span>
            </div>
          </div>
        )}
      </div>

      {/* Page header */}
      <div className="bg-card border-b border-dborder px-0 py-7 mb-7 no-print">
        <div className="w-full px-8 flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-t3 mb-1.5 flex items-center gap-2">
              <span className="inline-block w-4 h-px bg-accent" />
              Step 3 of 3 · Complete
            </div>
            <div className="font-sora text-2xl font-semibold text-t1">
              {planPath === "BUILDER" ? "Solution Blueprint" : planPath === "ANALYST" ? "Analysis Report" : planPath === "AUDITOR" ? "Compliance Report" : planPath === "SUMMARIZER" ? "Executive Summary" : "Your Answer"}
            </div>
            <div className="text-[12px] text-t2 mt-1 italic">"{output.query}"</div>
          </div>
          <div className="flex gap-2 pt-1 flex-shrink-0">
            <button onClick={downloadPDF} className="btn btn-sm" title="Download as PDF">
              ⬇ PDF
            </button>
            <button onClick={() => router.push("/dashboard")} className="btn btn-sm">
              Dashboard
            </button>
            <button onClick={startNewSession} className="btn btn-sm btn-p">
              + New Session
            </button>
          </div>
        </div>
      </div>

      <div className="w-full px-8">
        <Pyramid />

        {/* Meta row */}
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="apill">Intent: <span className="text-accent">{output.intent}</span></span>
          <span className="apill">Coverage: <span className="text-amber">{output.coverage_action}</span></span>
          {output.slm_model_id && <span className="apill-done apill">Custom AI: {output.slm_model_id}</span>}
          {output.build_in_progress && <span className="apill bg-amber/10 text-amber border-amber/30">⏳ AI build queued</span>}
          <span className={`apill ${output.hallucination_rate < 0.05 ? "apill-done" : "bg-coral/10 text-coral border-coral/30"}`}>
            Accuracy: {((1 - output.hallucination_rate) * 100).toFixed(1)}%
          </span>
          <ConfidenceBadge hallucination_rate={output.hallucination_rate} />
        </div>

        {/* Model choice + uncertainty transparency */}
        {modelContext && (
          <ModelChoiceCard
            context={modelContext}
            primaryModel={output.slm_model_id ?? (output.model_recommendations?.find(r => r.is_primary)?.model_name ?? null)}
          />
        )}

        {/* Tabs — adaptive by intent path */}
        <div className="flex gap-1 mb-6 border-b border-dborder">
          {(planPath === "BUILDER" ? [
            { key: "plan",   label: "Solution Blueprint" },
            { key: "answer", label: "Answer" },
            { key: "chat",   label: "Chat" },
            { key: "trace",  label: "Reasoning Trail" },
          ] : planPath === "ANALYST" ? [
            { key: "answer", label: "Analysis Report" },
            { key: "plan",   label: "Key Findings" },
            { key: "chat",   label: "Chat" },
            { key: "trace",  label: "Reasoning Trail" },
          ] : planPath === "AUDITOR" ? [
            { key: "answer", label: "Compliance Report" },
            { key: "plan",   label: "Gap Analysis" },
            { key: "chat",   label: "Chat" },
            { key: "trace",  label: "Reasoning Trail" },
          ] : planPath === "SUMMARIZER" ? [
            { key: "answer", label: "Executive Summary" },
            { key: "plan",   label: "Full Detail" },
            { key: "chat",   label: "Chat" },
            { key: "trace",  label: "Reasoning Trail" },
          ] : [
            { key: "answer", label: "Answer" },
            { key: "plan",   label: "Sources & Blueprint" },
            { key: "chat",   label: "Chat" },
            { key: "trace",  label: "Reasoning Trail" },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-[12px] font-semibold rounded-t transition-colors ${
                activeTab === tab.key
                  ? "bg-bg3 text-accent border-b-2 border-accent"
                  : "text-t3 hover:text-t2"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* BUILD PLAN TAB */}
        {activeTab === "plan" && (
          <div className="space-y-3">
            {/* Architecture overview bar */}
            <div className="bg-bg3 border border-dborder rounded-card px-5 py-4 mb-2">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-t3 mb-3">System Architecture — End to End</div>
              <div className="flex items-center gap-1 flex-wrap">
                {[
                  { label: "Files / DB", color: "bg-bg4 border-dborder text-t2" },
                  { label: "→", color: "text-t3 border-0 bg-transparent" },
                  { label: "Chunker + Embedder", color: "bg-blue/10 border-blue/30 text-blue" },
                  { label: "→", color: "text-t3 border-0 bg-transparent" },
                  { label: "Knowledge Graph", color: "bg-purple/10 border-purple/30 text-purple" },
                  { label: "→", color: "text-t3 border-0 bg-transparent" },
                  { label: "SLM Factory", color: "bg-amber/10 border-amber/30 text-amber" },
                  { label: "→", color: "text-t3 border-0 bg-transparent" },
                  { label: "Orchestrator (9-step)", color: "bg-accent/10 border-accent/30 text-accent" },
                  { label: "→", color: "text-t3 border-0 bg-transparent" },
                  { label: "GraphRAG Retriever", color: "bg-teal/10 border-teal/30 text-teal" },
                  { label: "→", color: "text-t3 border-0 bg-transparent" },
                  { label: "Next.js UI", color: "bg-gg/10 border-gg/30 text-gg" },
                ].map((n, i) => (
                  n.label === "→"
                    ? <span key={i} className="text-t3 text-[11px]">→</span>
                    : <span key={i} className={`text-[10px] font-semibold px-2.5 py-1 rounded-md border ${n.color}`}>{n.label}</span>
                ))}
              </div>
            </div>

            {buildPlan.map(step => (
              <div
                key={step.id}
                className={`bg-card2 border rounded-card overflow-hidden transition-colors ${expandedStep === step.id ? "border-accent" : "border-dborder hover:border-dborder2"}`}
              >
                {/* Step header */}
                <button className="w-full flex items-start gap-4 px-5 py-4 text-left" onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}>
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent/10 border border-accent/30 flex items-center justify-center text-[13px] font-bold text-accent">{step.id}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-[10px] text-t3 font-mono uppercase">{step.phase}</span>
                      <PriorityBadge priority={step.priority} />
                      <span className="text-[10px] text-t3">~{step.effort}</span>
                    </div>
                    <p className="text-[13px] font-semibold text-t1">{step.title}</p>
                    {expandedStep !== step.id && <p className="text-[11px] text-t3 mt-1 line-clamp-1">{step.hld.slice(0, 120)}…</p>}
                  </div>
                  <span className="text-t3 flex-shrink-0 mt-1 text-[11px]">{expandedStep === step.id ? "▲" : "▼"}</span>
                </button>

                {expandedStep === step.id && (
                  <div className="border-t border-dborder">

                    {/* HLD */}
                    <div className="px-5 pt-4 pb-3 border-b border-dborder/50">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-blue mb-2 flex items-center gap-2">
                        <span className="w-3 h-px bg-blue/60" />HLD — High Level Design
                      </div>
                      <p className="text-[12px] text-t2 leading-relaxed mb-3">{step.hld}</p>
                      <ul className="space-y-1.5">
                        {step.hldBullets.map((b, i) => (
                          <li key={i} className="flex items-start gap-2 text-[11px] text-t2">
                            <span className="text-accent mt-0.5 flex-shrink-0">◆</span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* LLD */}
                    <div className="px-5 pt-4 pb-3 border-b border-dborder/50">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-purple mb-3 flex items-center gap-2">
                        <span className="w-3 h-px bg-purple/60" />LLD — Low Level Design
                      </div>
                      <div className="space-y-4">
                        {step.lld.map((spec, si) => (
                          <div key={si} className="bg-bg border border-dborder rounded-sm p-3">
                            <div className="text-[11px] font-bold text-purple mb-2 font-mono">{spec.component}</div>
                            <div className="grid grid-cols-2 gap-2 text-[10px] mb-2">
                              <div><span className="text-t3 font-semibold">IN: </span><span className="text-t2 font-mono">{spec.inputs}</span></div>
                              <div><span className="text-t3 font-semibold">OUT: </span><span className="text-t2 font-mono">{spec.outputs}</span></div>
                            </div>
                            <ul className="space-y-1 mb-2">
                              {spec.logic.map((l, li) => (
                                <li key={li} className="flex items-start gap-2 text-[11px] text-t2">
                                  <span className="text-purple/60 flex-shrink-0 font-mono">{li + 1}.</span>
                                  <span>{l}</span>
                                </li>
                              ))}
                            </ul>
                            {spec.schema && (
                              <pre className="bg-bg3 border border-dborder rounded-sm p-2 text-[10px] text-gg font-mono overflow-auto mt-2">{spec.schema}</pre>
                            )}
                            {spec.apiContract && (
                              <pre className="bg-bg3 border border-accent/20 rounded-sm p-2 text-[10px] text-accent font-mono overflow-auto mt-2">{spec.apiContract}</pre>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Implementation steps */}
                    <div className="px-5 pt-4 pb-3 border-b border-dborder/50">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-gg mb-2 flex items-center gap-2">
                        <span className="w-3 h-px bg-gg/60" />Implementation Steps
                      </div>
                      <ol className="space-y-1.5">
                        {step.implSteps.map((s, i) => (
                          <li key={i} className="flex items-start gap-2 text-[11px] text-t2">
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gg/10 border border-gg/30 flex items-center justify-center text-[9px] font-bold text-gg">{i + 1}</span>
                            <span className="mt-0.5">{s.replace(/^\d+\.\s*/, "")}</span>
                          </li>
                        ))}
                      </ol>
                    </div>

                    {/* KPIs */}
                    <div className="px-5 pt-3 pb-4 border-b border-dborder/50">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-amber mb-2 flex items-center gap-2">
                        <span className="w-3 h-px bg-amber/60" />Success KPIs
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {step.kpis.map((k, i) => (
                          <span key={i} className="text-[10px] px-2.5 py-1 bg-amber/5 border border-amber/20 rounded-md text-amber">{k}</span>
                        ))}
                      </div>
                    </div>

                    {/* Models */}
                    <div className="px-5 pt-3 pb-4 border-b border-dborder/50">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-t3 mb-2 flex items-center gap-2">
                        <span className="w-3 h-px bg-t3/40" />Recommended Models
                      </div>
                      <div className="space-y-1.5">
                        {step.models.map((m, i) => (
                          <div key={i} className={`model-row ${i === 0 ? "border-teal chosen" : ""}`}>
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: i === 0 ? "#2dd4a0" : "#5c5a78" }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-[12px] font-medium font-mono ${i === 0 ? "text-teal" : "text-t1"}`}>{m.name}</span>
                                <ProviderBadge provider={m.provider} local={m.local} />
                                <span className="text-[9px] px-1.5 py-0.5 rounded border text-t3 border-dborder">{m.role}</span>
                                {i === 0 && <span className="ft-badge bg-teal/10 text-teal border border-teal/30">PRIMARY</span>}
                              </div>
                              <p className="text-[10px] text-t3 mt-0.5">{m.why}</p>
                            </div>
                            <span className={`text-[14px] font-bold font-mono ${m.score >= 0.8 ? "text-gg" : m.score >= 0.6 ? "text-t2" : "text-coral"}`}>{m.score.toFixed(3)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* ── Per-step tweak / Q&A box ── */}
                    <div className="px-5 pt-4 pb-5">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-accent mb-2 flex items-center gap-2">
                        <span className="w-3 h-px bg-accent/60" />Ask or tweak this step
                      </div>
                      {/* Previous reply */}
                      {stepTweakReplies[step.id] && (
                        <div className="mb-3 bg-accent/5 border border-accent/20 rounded-xl px-4 py-3">
                          <div className="text-[9px] font-bold text-accent uppercase tracking-widest mb-1">AI response</div>
                          <div className="text-[12px] text-t2 leading-relaxed prose prose-sm max-w-none prose-headings:text-t2 prose-headings:font-semibold prose-headings:mt-2 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-strong:text-t1 prose-code:text-accent prose-code:bg-bg3 prose-code:px-1 prose-code:rounded">
                            <ReactMarkdown>{stepTweakReplies[step.id]}</ReactMarkdown>
                          </div>
                          <button
                            onClick={() => setStepTweakReplies(p => ({ ...p, [step.id]: "" }))}
                            className="text-[10px] text-t3 hover:text-t1 mt-2"
                          >✕ Clear</button>
                        </div>
                      )}
                      <div className="flex gap-2 items-end">
                        <textarea
                          value={stepTweakInput[step.id] ?? ""}
                          onChange={e => setStepTweakInput(p => ({ ...p, [step.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askAboutStep(step); } }}
                          rows={2}
                          placeholder={`Ask a question (e.g. "Why was general_v10 chosen?") or request a change (e.g. "Add a user_name column to recommendations table")…`}
                          className="flex-1 rounded-xl border border-dborder bg-bg2 text-t1 text-[12px] px-3 py-2.5 resize-none focus:outline-none focus:border-accent"
                        />
                        <button
                          onClick={() => askAboutStep(step)}
                          disabled={!stepTweakInput[step.id]?.trim() || stepTweakLoading[step.id]}
                          className="flex-shrink-0 h-[58px] px-4 rounded-xl bg-accent text-white text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                        >
                          {stepTweakLoading[step.id] ? (
                            <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          ) : isModificationRequest(stepTweakInput[step.id] ?? "") ? "Update" : "Ask"}
                        </button>
                      </div>
                      {stepTweakError[step.id] && (
                        <p className="text-[11px] text-coral mt-1">⚠ {stepTweakError[step.id]}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ANSWER TAB */}
        {activeTab === "answer" && (
          <div>
            <WarningsBanner warnings={orcWarnings} />
            {output.final_answer ? (
              <div className="card">
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-2 h-2 rounded-full bg-gg" />
                  <p className="text-[10px] font-semibold text-t3 uppercase tracking-widest">Direct answer</p>
                  {output.slm_model_id && <span className="ml-auto apill font-mono">{output.slm_model_id}</span>}
                </div>
                <div className="text-[13px] text-t1 leading-relaxed prose prose-sm max-w-none prose-headings:text-t1 prose-headings:font-bold prose-headings:mt-4 prose-headings:mb-2 prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5 prose-strong:text-t1 prose-code:text-accent prose-code:bg-bg3 prose-code:px-1 prose-code:rounded prose-pre:bg-bg3 prose-pre:rounded-xl prose-pre:p-3">
                  <ReactMarkdown>{output.final_answer}</ReactMarkdown>
                </div>
                {output.sub_task_results?.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-dborder">
                    <div className="sect">Sub-task breakdown</div>
                    <div className="space-y-3">
                      {output.sub_task_results.map((r, i) => (
                        <div key={i} className="bg-bg3 rounded-sm p-3 border border-dborder">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="apill font-mono">{r.task_type}</span>
                            <span className="text-[10px] text-t3 font-mono">{r.assigned_model}</span>
                            <SubConfidenceBadge confidence={r.confidence} />
                            <span className="ml-auto text-[9px] text-t3 italic">
                              {r.confidence >= 0.8 ? "From your documents" : r.confidence >= 0.5 ? "Partial match" : "Model estimate"}
                            </span>
                          </div>
                          <p className="text-[10px] text-t3 italic mb-1.5">{r.query_fragment}</p>
                          <div className="text-[12px] text-t2 leading-relaxed prose prose-sm max-w-none prose-headings:text-t2 prose-headings:font-semibold prose-headings:mt-2 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-strong:text-t1 prose-code:text-accent prose-code:bg-bg3 prose-code:px-1 prose-code:rounded">
                            <ReactMarkdown>{(r.response?.length ?? 0) > 500 ? r.response!.slice(0, 500) + "…" : (r.response ?? "")}</ReactMarkdown>
                          </div>
                          {/* Human feedback loop — updates LinUCB bandit reward */}
                          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-dborder/50">
                            <span className="text-[10px] text-t3 flex-shrink-0">Accurate?</span>
                            <button
                              onClick={() => sendFeedback(r.assigned_model, r.task_type, i, true)}
                              disabled={!!feedbackSent[String(i)]}
                              title="Mark as correct — bandit will route more queries to this model"
                              className={`text-[12px] px-2 py-0.5 rounded transition-colors ${feedbackSent[String(i)] === "correct" ? "bg-gg/20 text-gg" : "text-t3 hover:text-gg disabled:opacity-40"}`}
                            >👍</button>
                            <button
                              onClick={() => sendFeedback(r.assigned_model, r.task_type, i, false)}
                              disabled={!!feedbackSent[String(i)]}
                              title="Mark as incorrect — bandit will reduce routing to this model"
                              className={`text-[12px] px-2 py-0.5 rounded transition-colors ${feedbackSent[String(i)] === "incorrect" ? "bg-coral/20 text-coral" : "text-t3 hover:text-coral disabled:opacity-40"}`}
                            >👎</button>
                            {feedbackSent[String(i)] && (
                              <span className="text-[10px] text-t3 italic">
                                {feedbackSent[String(i)] === "correct" ? "✓ Noted — AI will favour this model" : "✓ Noted — AI will explore alternatives"}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="card border-amber/30">
                <p className="text-amber font-semibold text-[15px] mb-2">⏳ Corpus Processing In Progress</p>
                <p className="text-[12px] text-t2 leading-relaxed mb-4">
                  The system is ingesting your data and building the knowledge graph.<br />
                  Use the <span className="text-accent font-medium">Q&A Chat</span> tab to ask questions right now.
                </p>
                {output.error && <p className="text-[11px] text-coral mt-2 font-mono">{output.error}</p>}
              </div>
            )}
          </div>
        )}

        {/* Q&A CHAT TAB */}
        {activeTab === "chat" && (
          <div className="flex flex-col" style={{ height: "540px" }}>
            <p className="text-[11px] text-t3 mb-3">
              Ask questions about your data using available models.
              {jobId && <span className="text-gg ml-2">● corpus context loaded</span>}
            </p>
            <div className="flex-1 overflow-auto bg-bg rounded-sm border border-dborder p-4 space-y-3 mb-3">
              {chatMessages.length === 0 && (
                <div className="text-center mt-4">
                  <p className="text-t3 text-[11px] mb-3">Try these questions:</p>
                  <div className="space-y-2 max-w-lg mx-auto">
                    {[
                      "What's the demand impact if US tariffs on personal care products increase 25%?",
                      "Which suppliers face highest risk from a Red Sea route closure?",
                      "What safety stock should I hold given current risks?",
                      "How should I adjust demand forecasts if a disruption hits East Asia?",
                      "Give me a step-by-step plan to build this intelligence system.",
                    ].map(q => (
                      <button key={q} onClick={() => setChatInput(q)}
                        className="block w-full text-left text-[11px] bg-bg3 hover:bg-bg4 border border-dborder rounded-sm px-3 py-2.5 text-t3 hover:text-t2 transition-colors">
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-2xl rounded-card px-4 py-3 text-[12px] ${msg.role === "user" ? "bg-accent text-white" : "bg-card2 border border-dborder text-t1"}`}>
                    {msg.role === "assistant" && <p className="text-[10px] text-accent mb-1.5 font-semibold">AI Orchestrator</p>}
                    <div className="leading-relaxed prose prose-sm max-w-none prose-headings:font-bold prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-strong:font-semibold prose-code:bg-black/10 prose-code:px-1 prose-code:rounded">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ))}
              {isChatting && (
                <div className="thinking-bar">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple animate-blink" />
                  Thinking…
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="flex gap-2">
              <input
                className="flex-1 prompt-box resize-none"
                style={{ minHeight: "unset" }}
                placeholder="Ask about your data…"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              />
              <button onClick={sendChat} disabled={isChatting || !chatInput.trim()} className="btn btn-p px-6 disabled:opacity-40">
                Send
              </button>
            </div>
          </div>
        )}

        {/* DECISION TRACE TAB */}
        {activeTab === "trace" && (
          <div className="space-y-2">
            {(output.steps ?? []).length === 0 && (
              <div className="text-[12px] text-t3 text-center py-10">No reasoning trace available for this session.</div>
            )}
            {(output.steps ?? []).map((step, i) => {
              const expl = step.explanation ?? {} as typeof step.explanation;
              const confidence = expl.confidence ?? 0;
              return (
              <div key={i} className="bg-card2 border border-dborder rounded-card overflow-hidden">
                <button className="w-full flex items-center justify-between px-4 py-3 text-left"
                  onClick={() => setTraceExpanded(traceExpanded === i ? null : i)}>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-purple/10 border border-purple/30 text-[11px] font-bold text-purple">
                      {step.step_number}
                    </div>
                    <div>
                      <p className="text-[12px] font-semibold text-t1">{step.step_name}</p>
                      <p className="text-[10px] text-t3">{step.duration_ms ?? 0}ms</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="prog-bar w-16"><div className="prog-fill" style={{ width: `${confidence * 100}%` }} /></div>
                    <span className={`text-[11px] font-mono font-semibold ${confidence >= 0.8 ? "text-gg" : confidence >= 0.6 ? "text-amber" : "text-coral"}`}>
                      {(confidence * 100).toFixed(0)}%
                    </span>
                    <span className="text-t3 text-[11px]">{traceExpanded === i ? "▲" : "▼"}</span>
                  </div>
                </button>
                {traceExpanded === i && (
                  <div className="px-4 pb-4 pt-3 border-t border-dborder space-y-2 text-[11px]">
                    {([["WHAT", expl.what], ["WHY", expl.why],
                      ["FOUND", expl.what_we_found], ["DECISION", expl.decision_made]] as [string, string][])
                      .filter(([, value]) => value)
                      .map(([label, value]) => (
                        <div key={label} className="flex gap-3">
                          <span className="text-t3 font-bold w-16 flex-shrink-0">{label}</span>
                          <span className="text-t2">{value}</span>
                        </div>
                      ))}
                    {(expl.caveats ?? []).length > 0 && (
                      <div className="flex gap-3">
                        <span className="text-t3 font-bold w-16 flex-shrink-0">CAVEATS</span>
                        <span className="text-amber italic">{expl.caveats.join(" · ")}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
            })}

            {/* Shapley Source Attribution */}
            {output.sub_task_results && output.sub_task_results.length > 0 && (
              <div className="mt-6">
                <div className="sect mb-3">Source Attribution (Shapley)</div>
                <div className="text-[11px] text-t3 mb-3">Estimated contribution of each sub-task to the final answer</div>
                <div className="space-y-2">
                  {output.sub_task_results.map((r, i) => {
                    // Approximate Shapley value: weight by response length relative to total
                    const totalLen = output.sub_task_results.reduce((acc, x) => acc + (x.response?.length ?? 0), 0);
                    const contribution = totalLen > 0 ? (r.response?.length ?? 0) / totalLen : 1 / output.sub_task_results.length;
                    const pct = Math.round(contribution * 100);
                    const colors = ["#6c5cf7","#0d9e74","#d97706","#e63755","#60a5fa","#2dd4a0"];
                    const color = colors[i % colors.length];
                    return (
                      <div key={i} className="flex items-center gap-3">
                        <div className="w-32 flex-shrink-0 text-[11px] font-semibold text-t2 truncate">{r.task_type ?? `Task ${i+1}`}</div>
                        <div className="flex-1 h-2 bg-bg3 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
                        </div>
                        <div className="text-[11px] font-bold w-8 text-right" style={{ color }}>{pct}%</div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 text-[10px] text-t3 italic">Attribution estimated from sub-task response weight. Exact Shapley values require marginal contribution sampling.</div>
              </div>
            )}

            {/* Model auction results (bandit scores) */}
            {output.model_recommendations.length > 0 && (
              <div className="mt-6">
                <div className="sect mb-1">Model Auction Results</div>
                <div className="text-[11px] text-t3 mb-3">Models competed for each task using LinUCB bandit scoring. Highest UCB score wins.</div>
                <div className="sect">All model recommendations</div>
                {/* Active scoring weights banner */}
                {activeWeights && (() => {
                  const total = Object.values(activeWeights).reduce((s: number, v) => s + (v as number), 0) || 1;
                  const labels: Record<string, string> = {
                    benchmark: "Quality", availability: "Avail.", bandit: "Reliability",
                    speed: "Speed", ctx_fit: "Ctx fit", task_fit: "Task fit",
                  };
                  const nonZero = Object.entries(activeWeights).filter(([, v]) => (v as number) > 0);
                  const isDefault =
                    Math.abs((activeWeights.benchmark ?? 0) - 0.30) < 0.01 &&
                    Math.abs((activeWeights.speed ?? 0) - 0.15) < 0.01;
                  return (
                    <div className={`flex flex-wrap items-center gap-2 mb-2 px-3 py-2 rounded-card text-[10px] ${isDefault ? "bg-bg3 border border-dborder2 text-t3" : "bg-accent/10 border border-accent/30 text-accent"}`}>
                      <span className="font-semibold">{isDefault ? "Default weights:" : "Your scoring weights:"}</span>
                      {nonZero.map(([key, val]) => (
                        <span key={key} className="font-mono">
                          {labels[key] ?? key} {Math.round((val as number) / total * 100)}%
                        </span>
                      ))}
                      <a href="/query" className="ml-auto underline opacity-60 hover:opacity-100">adjust →</a>
                    </div>
                  );
                })()}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {output.model_recommendations.map((rec, i) => (
                    <div key={i} className={`model-row ${rec.is_primary ? "chosen" : ""}`}>
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: rec.is_primary ? "#2dd4a0" : "#5c5a78" }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[12px] font-medium font-mono ${rec.is_primary ? "text-teal" : "text-t1"}`}>{rec.model_name}</span>
                          <ProviderBadge provider={rec.provider} local={rec.is_available_locally} />
                        </div>
                        <p className="text-[10px] text-t3">{rec.provider} · {rec.task_type}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[13px] font-mono text-accent font-bold">{rec.composite_score.toFixed(3)}</p>
                        {rec.is_available_locally && <p className="text-[9px] text-gg">● local</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-10 pt-6 border-t border-dborder flex justify-between items-center mb-8">
          <button onClick={() => router.push("/query")} className="btn btn-sm text-t3 hover:text-t1">← New query</button>
          <div className="text-[10px] text-t3 text-right">
            Session: <span className="font-mono">{output.session_id?.slice(0, 8)}…</span>
            {output.total_tokens_used > 0 && <span className="ml-3">{output.total_tokens_used.toLocaleString()} tokens</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
