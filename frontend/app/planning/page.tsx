"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE } from "../lib/api";

// ─── Types ───────────────────────────────────────────────────────────────────
type PathType = "BUILDER" | "RESEARCHER" | "ANALYST" | "AUDITOR" | "SUMMARIZER";

interface Suggestion {
  id:     string;
  icon:   string;
  label:  string;
  desc:   string;
  prompt: string;
  path:   PathType;
  badge:  string;
}

// ─── Domain-aware suggestion sets ─────────────────────────────────────────────
const CPG_SUGGESTIONS: Suggestion[] = [
  {
    id: "mkt_predictor", icon: "🔮", badge: "AI Build", path: "BUILDER",
    label: "Market Demand Predictor",
    desc: "Forecast SKU demand using adjusted forecast & historical sales columns",
    prompt: "Build a market demand predictor using ADJSTD_DMND_QTY_WK4_FCST and HIST_AVG_QTY_4WK to forecast top-SKU demand for the next 8 weeks across all plants",
  },
  {
    id: "new_products", icon: "🧪", badge: "Research", path: "RESEARCHER",
    label: "New Product Research",
    desc: "Research launch opportunities for new carbonated drinks, energy drinks, or snacks",
    prompt: "Research what new product opportunities exist for carbonated drinks and energy drinks based on current market trends, category growth rates, and consumer preference data in my corpus",
  },
  {
    id: "product_suggest", icon: "💡", badge: "Ideas", path: "RESEARCHER",
    label: "Product Portfolio Suggestions",
    desc: "Get AI suggestions for new flavors, pack sizes, and channel expansions",
    prompt: "Suggest new product ideas, flavor line extensions, and pack size opportunities for the carbonated drinks and snacks portfolio based on market research and consumer trends",
  },
  {
    id: "promo_roi", icon: "📊", badge: "Analysis", path: "ANALYST",
    label: "Trade Promotion ROI",
    desc: "Analyze which promotions delivered the best ROI and what drove lift",
    prompt: "Analyze which trade promotions had the highest ROI_VAL and LIFT_FCTR, and identify what channels, SKUs, and promotion types drove the best performing campaigns",
  },
  {
    id: "vendor_risk", icon: "🚨", badge: "Risk", path: "ANALYST",
    label: "Vendor Supply Risk",
    desc: "Flag vendors with OTIF < 90% before your next promotion goes live",
    prompt: "Identify vendors with OTIF_PCT below 90% and OTD_PCT below 85%, and flag which SKUs and upcoming promotions are at supply risk",
  },
  {
    id: "inventory_scan", icon: "📦", badge: "Operations", path: "ANALYST",
    label: "Inventory Risk Scanner",
    desc: "Find SKUs at critically low stock or excess inventory by plant",
    prompt: "Scan current inventory levels and identify SKUs with INV_STS_CD of CRIT or LOW, compare against SS_QTY and ROP_VAL, and prioritize by demand forecast impact",
  },
];

const RETAIL_SUGGESTIONS: Suggestion[] = [
  {
    id: "sales_dash", icon: "🏆", badge: "AI Build", path: "BUILDER",
    label: "Sales Performance Dashboard",
    desc: "Build an AI dashboard tracking revenue and growth by region",
    prompt: "Build a sales performance dashboard showing revenue, unit trends, and growth rates by region and channel",
  },
  {
    id: "trend_analysis", icon: "📈", badge: "Analysis", path: "ANALYST",
    label: "Product Trend Analysis",
    desc: "Identify which products are growing vs declining in velocity",
    prompt: "Analyze which products are trending up vs declining in sales velocity and market share over the past 26 weeks",
  },
  {
    id: "pricing", icon: "🎯", badge: "Strategy", path: "RESEARCHER",
    label: "Pricing Strategy Research",
    desc: "Research optimal pricing based on competitive and market data",
    prompt: "Research and suggest pricing strategies based on competitive landscape, price elasticity, and channel performance data",
  },
  {
    id: "customer_patt", icon: "💬", badge: "Insights", path: "ANALYST",
    label: "Customer Feedback Patterns",
    desc: "Discover recurring themes in customer reviews and feedback",
    prompt: "Analyze customer feedback patterns to identify the most common product complaints and areas of delight",
  },
  {
    id: "assortment", icon: "🛒", badge: "Planning", path: "RESEARCHER",
    label: "Assortment Optimization",
    desc: "Research ideal SKU assortment by channel and store format",
    prompt: "Research and recommend the ideal product assortment for each retail channel based on velocity, margin, and consumer demand data",
  },
  {
    id: "promo_planner", icon: "📅", badge: "AI Build", path: "BUILDER",
    label: "Promotion Planner",
    desc: "Build a trade promotion planning tool with ROI simulation",
    prompt: "Build a trade promotion planner that simulates ROI, lift factor, and incremental volume for planned promotions",
  },
];

const FINANCE_SUGGESTIONS: Suggestion[] = [
  {
    id: "rev_forecast", icon: "📊", badge: "AI Build", path: "BUILDER",
    label: "Revenue Forecasting Model",
    desc: "Build a forward-looking revenue model from historical data",
    prompt: "Build a revenue forecasting model using historical revenue data, growth trends, and seasonal patterns",
  },
  {
    id: "expense_audit", icon: "✅", badge: "Audit", path: "AUDITOR",
    label: "Expense Policy Audit",
    desc: "Check expense categories against company policy for compliance",
    prompt: "Audit expense categories and transactions against expense policy to flag non-compliant items and amounts",
  },
  {
    id: "variance", icon: "📉", badge: "Finance", path: "ANALYST",
    label: "Budget Variance Analysis",
    desc: "Analyze budget vs actual spend variance by department",
    prompt: "Analyze budget vs actual variance by department and cost center, highlighting the largest deviations and root causes",
  },
  {
    id: "risk_dash", icon: "🔴", badge: "Risk", path: "BUILDER",
    label: "Financial Risk Dashboard",
    desc: "Build a dashboard surfacing key financial risk indicators",
    prompt: "Build a financial risk dashboard that surfaces AR aging, cash flow risk, and budget overrun alerts",
  },
  {
    id: "margin_analysis", icon: "💰", badge: "Analysis", path: "ANALYST",
    label: "Margin Analysis",
    desc: "Identify which products or segments have the highest/lowest margin",
    prompt: "Analyze gross margin by product, channel, and region to identify the highest and lowest performing segments",
  },
  {
    id: "exec_report", icon: "📝", badge: "Summary", path: "SUMMARIZER",
    label: "Executive Financial Summary",
    desc: "Summarize financial performance for board-level reporting",
    prompt: "Summarize the key financial performance metrics and strategic insights for an executive board audience",
  },
];

const GENERAL_SUGGESTIONS: Suggestion[] = [
  {
    id: "analytics_app", icon: "🏗️", badge: "AI Build", path: "BUILDER",
    label: "AI Analytics Dashboard",
    desc: "Build an AI-powered dashboard for your domain data",
    prompt: "Build an AI-powered analytics dashboard that surfaces key insights and KPIs from my data",
  },
  {
    id: "predictor", icon: "🔮", badge: "AI Build", path: "BUILDER",
    label: "Predictive Model",
    desc: "Build a predictive model from patterns in your corpus",
    prompt: "Build a predictive model that uses historical patterns in my data to forecast future outcomes",
  },
  {
    id: "pattern_analysis", icon: "📊", badge: "Analysis", path: "ANALYST",
    label: "Pattern & Trend Analysis",
    desc: "Discover the key patterns and trends in your data",
    prompt: "Analyze patterns and trends in my data and highlight the most important findings with supporting evidence",
  },
  {
    id: "knowledge_res", icon: "🔬", badge: "Research", path: "RESEARCHER",
    label: "Knowledge Base Research",
    desc: "Surface deep insights from your ingested knowledge base",
    prompt: "Research and surface the key insights from my knowledge base that are most relevant to my business goals",
  },
  {
    id: "compliance", icon: "✅", badge: "Audit", path: "AUDITOR",
    label: "Compliance Gap Audit",
    desc: "Check your data against policies and flag coverage gaps",
    prompt: "Audit my data against applicable policies and regulations to identify compliance gaps and risk areas",
  },
  {
    id: "exec_summary", icon: "📝", badge: "Summary", path: "SUMMARIZER",
    label: "Executive Summary",
    desc: "Condense everything into a board-level strategic overview",
    prompt: "Summarize the key findings and strategic insights from my data for an executive audience",
  },
];

function getSuggestions(domainLabel: string): Suggestion[] {
  const d = domainLabel.toLowerCase();
  if (/cpg|beverage|drink|snack|food|fmcg|refreshco|cola|juice|chip|candy/.test(d)) return CPG_SUGGESTIONS;
  if (/retail|sales|ecommerce|store|merch|shop|commerce/.test(d))                    return RETAIL_SUGGESTIONS;
  if (/finance|financial|account|budget|revenue|expense|banking/.test(d))            return FINANCE_SUGGESTIONS;
  return GENERAL_SUGGESTIONS;
}

const BADGE_COLORS: Record<string, string> = {
  "AI Build":   "#6c5cf7",
  "Research":   "#0d9e74",
  "Analysis":   "#d97706",
  "Risk":       "#e63755",
  "Ideas":      "#7c3aed",
  "Operations": "#0369a1",
  "Audit":      "#e63755",
  "Finance":    "#0d9e74",
  "Summary":    "#60a5fa",
  "Strategy":   "#d97706",
  "Insights":   "#0d9e74",
  "Planning":   "#6c5cf7",
};

const PATH_ARROW: Record<PathType, string> = {
  BUILDER:    "→ AI will build this",
  RESEARCHER: "→ Research answer",
  ANALYST:    "→ Analyze & compare",
  AUDITOR:    "→ Compliance check",
  SUMMARIZER: "→ Summarize",
};

const PATH_ARROW_COLOR: Record<PathType, string> = {
  BUILDER:    "#6c5cf7",
  RESEARCHER: "#0d9e74",
  ANALYST:    "#d97706",
  AUDITOR:    "#e63755",
  SUMMARIZER: "#60a5fa",
};

// ─── Path detection ───────────────────────────────────────────────────────────

function detectPath(query: string): PathType {
  const q = query.toLowerCase();
  if (/\b(build|create|develop|design|architect|make|implement|set up|application|app|platform|system|tool)\b/.test(q)) return "BUILDER";
  if (/\b(analyz|compar|pattern|trend|audit review|investigat|discover)\b/.test(q)) return "ANALYST";
  if (/\b(compliance|policy|check|gap|regulation|verify|conform|adhere)\b/.test(q)) return "AUDITOR";
  if (/\b(summar|overview|brief|report|digest|condense|abstract)\b/.test(q)) return "SUMMARIZER";
  return "RESEARCHER";
}

// ─── Wizard questions per path ───────────────────────────────────────────────
interface WizardQuestion {
  id: string;
  question: string;
  options: { id: string; label: string; desc: string; icon: string }[];
}

const WIZARD_QUESTIONS: Record<PathType, WizardQuestion[]> = {
  BUILDER: [], // Skip wizard for BUILDER — go straight to results
  RESEARCHER: [
    {
      id: "intent",
      question: "What do you want to do with this answer?",
      options: [
        { id: "read",   label: "Read it here",          desc: "Show me the answer on screen",          icon: "👁️" },
        { id: "share",  label: "Share with my team",     desc: "I'll copy or forward this",             icon: "👥" },
        { id: "export", label: "Export as a document",   desc: "I need a downloadable report",          icon: "📄" },
        { id: "paste",  label: "Paste into another tool",desc: "I'll use this in another system",       icon: "📋" },
      ],
    },
    {
      id: "detail",
      question: "How much detail do you need?",
      options: [
        { id: "quick",  label: "Quick summary",          desc: "Key points only — 2–3 sentences",      icon: "⚡" },
        { id: "full",   label: "Full explanation",        desc: "Complete answer with context",          icon: "📖" },
        { id: "steps",  label: "Step-by-step breakdown",  desc: "Walk me through it stage by stage",    icon: "🪜" },
      ],
    },
  ],
  ANALYST: [
    {
      id: "discover",
      question: "What are you looking to discover?",
      options: [
        { id: "themes",   label: "Common themes",          desc: "What topics keep appearing?",          icon: "🧩" },
        { id: "problems", label: "Problem patterns",       desc: "Where do issues occur most?",          icon: "⚠️" },
        { id: "trends",   label: "Data trends",            desc: "How do things change over time?",      icon: "📈" },
        { id: "compare",  label: "Side-by-side comparison",desc: "How do these things differ?",          icon: "⚖️" },
      ],
    },
    {
      id: "audience",
      question: "Who will see this output?",
      options: [
        { id: "me",       label: "Just me",                desc: "Personal reference only",               icon: "👤" },
        { id: "manager",  label: "My manager",             desc: "Internal reporting",                    icon: "🏢" },
        { id: "customer", label: "A customer",             desc: "External-facing output",                icon: "🤝" },
        { id: "team",     label: "A larger team",          desc: "Shared with multiple stakeholders",     icon: "👥" },
      ],
    },
    {
      id: "format",
      question: "Preferred output format?",
      options: [
        { id: "report",   label: "Structured report",      desc: "Sections with headers and detail",      icon: "📋" },
        { id: "bullets",  label: "Bullet points",          desc: "Clean list of key findings",            icon: "•" },
        { id: "timeline", label: "Timeline view",          desc: "Events and findings in sequence",       icon: "📅" },
      ],
    },
  ],
  AUDITOR: [
    {
      id: "reference",
      question: "What are you checking against?",
      options: [
        { id: "policy",     label: "Our own policy",       desc: "Internal company rules and standards",  icon: "📜" },
        { id: "regulation", label: "Industry regulation",  desc: "External legal or industry requirement",icon: "⚖️" },
        { id: "contract",   label: "A contract",           desc: "Terms and clauses in an agreement",     icon: "🤝" },
        { id: "checklist",  label: "A custom checklist",   desc: "A list I'll describe",                  icon: "✅" },
      ],
    },
    {
      id: "gaps",
      question: "Do you want to flag gaps and missing coverage?",
      options: [
        { id: "yes",  label: "Yes — show gaps",            desc: "Highlight what's missing or at risk",   icon: "🔍" },
        { id: "no",   label: "Just confirm coverage",      desc: "Only show what passes",                 icon: "✅" },
      ],
    },
  ],
  SUMMARIZER: [
    {
      id: "audience",
      question: "Who is this summary for?",
      options: [
        { id: "technical",    label: "Technical team",      desc: "Developers, engineers, analysts",       icon: "💻" },
        { id: "manager",      label: "Non-technical manager",desc: "Plain English, no jargon",             icon: "🏢" },
        { id: "customer",     label: "Customer / client",   desc: "Professional, concise, external",       icon: "🤝" },
        { id: "board",        label: "Board / Executive",   desc: "High-level strategic overview",         icon: "👔" },
      ],
    },
    {
      id: "length",
      question: "How long should the summary be?",
      options: [
        { id: "paragraph",    label: "One paragraph",       desc: "50–100 words max",                     icon: "📝" },
        { id: "page",         label: "One page",            desc: "250–400 words with sections",          icon: "📄" },
        { id: "full",         label: "Full summary",        desc: "Detailed with all key sections",       icon: "📚" },
      ],
    },
  ],
};

const PATH_META: Record<PathType, { label: string; icon: string; color: string; desc: string }> = {
  BUILDER:    { label: "Project Builder",   icon: "🏗️",  color: "#6c5cf7", desc: "Build a complete architecture blueprint" },
  RESEARCHER: { label: "Research Q&A",      icon: "🔬",  color: "#0d9e74", desc: "Get a detailed answer from your documents" },
  ANALYST:    { label: "Data Analysis",     icon: "📊",  color: "#d97706", desc: "Find patterns and insights" },
  AUDITOR:    { label: "Compliance Audit",  icon: "✅",  color: "#e63755", desc: "Check coverage against policies" },
  SUMMARIZER: { label: "Smart Summary",     icon: "📝",  color: "#60a5fa", desc: "Condense documents for any audience" },
};

// ─── Convert a raw API suggestion to Suggestion object ──────────────────────
const PATH_ICONS: Record<PathType, string> = {
  BUILDER:    "🏗️",
  RESEARCHER: "🔬",
  ANALYST:    "📊",
  AUDITOR:    "✅",
  SUMMARIZER: "📝",
};
const PATH_BADGE: Record<PathType, string> = {
  BUILDER:    "AI Build",
  RESEARCHER: "Research",
  ANALYST:    "Analysis",
  AUDITOR:    "Audit",
  SUMMARIZER: "Summary",
};
function apiSuggestionToCard(
  item: { label: string; desc: string; prompt: string },
  idx: number,
): Suggestion {
  const path = detectPath(item.prompt || item.label);
  return {
    id:     `ai_${idx}`,
    icon:   PATH_ICONS[path],
    label:  item.label,
    desc:   item.desc,
    prompt: item.prompt,
    path,
    badge:  PATH_BADGE[path],
  };
}

export default function PlanningPage() {
  const router = useRouter();
  const [path, setPath]           = useState<PathType>("RESEARCHER");
  const [step, setStep]           = useState(0);
  const [answers, setAnswers]     = useState<Record<string, string>>({});
  const [query, setQuery]         = useState("");
  const [domain, setDomain]       = useState("");
  const [showWizard, setShowWizard] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [dynamicSuggestions, setDynamicSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestionSource, setSuggestionSource]     = useState<"slm" | "fallback" | "static">("static");

  useEffect(() => {
    const q   = sessionStorage.getItem("query") ?? "";
    const dl  = sessionStorage.getItem("domain_label") ?? "";
    const jid = sessionStorage.getItem("job_id") ?? "";
    const output = sessionStorage.getItem("orchestrator_output");
    if (!q || !output) { router.push("/"); return; }
    setQuery(q);
    setDomain(dl);
    setPath(detectPath(q));

    // Fetch AI-generated suggestions from the SLM
    if (dl) {
      const params = new URLSearchParams({ domain_label: dl });
      if (jid) params.set("job_id", jid);
      fetch(`${API_BASE}/api/v1/slm/suggestions?${params}`)
        .then(r => r.json())
        .then(data => {
          const raw: { label?: string; desc?: string; prompt?: string }[] = data.suggestions ?? [];
          if (raw.length >= 3) {
            const cards: Suggestion[] = raw.map((item, i) => {
              // Handle both rich {label,desc,prompt} objects and legacy plain strings
              if (typeof item === "string") {
                const words = (item as string).split(" ");
                return apiSuggestionToCard({
                  label:  words.slice(0, 6).join(" "),
                  desc:   (item as string).slice(0, 180),
                  prompt: item as string,
                }, i);
              }
              return apiSuggestionToCard({
                label:  item.label  ?? "Analyze this data",
                desc:   item.desc   ?? "",
                prompt: item.prompt ?? item.label ?? "",
              }, i);
            });
            setDynamicSuggestions(cards);
            setSuggestionSource(data.source === "slm" ? "slm" : "fallback");
          }
        })
        .catch(() => {})
        .finally(() => setLoadingSuggestions(false));
    } else {
      setLoadingSuggestions(false);
    }
  }, []);

  const suggestions = dynamicSuggestions ?? getSuggestions(domain);
  const questions   = WIZARD_QUESTIONS[path];
  const meta        = PATH_META[path];
  const currentQ    = questions[step];

  // Suggestion clicked — replace query and jump to results
  function handleSuggestion(s: Suggestion) {
    sessionStorage.setItem("query", s.prompt);
    sessionStorage.setItem("orch_plan_choices", JSON.stringify({
      path: s.path, answers: {}, fromSuggestion: true, suggestionId: s.id,
    }));
    router.push("/recommendations");
  }

  // Use original query (skip / BUILDER / wizard done)
  function useOriginalQuery() {
    sessionStorage.setItem("orch_plan_choices", JSON.stringify({ path, answers }));
    router.push("/recommendations");
  }

  // Wizard answer
  function handleAnswer(questionId: string, answerId: string) {
    const next = { ...answers, [questionId]: answerId };
    setAnswers(next);
    if (step < questions.length - 1) {
      setStep(s => s + 1);
    } else {
      sessionStorage.setItem("orch_plan_choices", JSON.stringify({ path, answers: next }));
      router.push("/recommendations");
    }
  }

  const domainDisplay = domain
    ? domain.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    : "your corpus";

  return (
    <div className="min-h-screen bg-bg2 flex items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-4">

        {/* ── Suggestions panel ───────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-dborder shadow-sm overflow-hidden">

          {/* Header */}
          <div className="px-6 pt-5 pb-4 border-b border-dborder flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-t3 mb-0.5 flex items-center gap-1.5">
                {suggestionSource === "slm" ? (
                  <><span className="text-accent">✦</span> AI-generated for {domainDisplay}</>
                ) : (
                  <><span>✨</span> Suggested for {domainDisplay}</>
                )}
              </div>
              <div className="text-[14px] font-bold text-t1">What would you like to do?</div>
            </div>
            <button
              onClick={useOriginalQuery}
              className="text-[11px] text-t3 hover:text-t1 border border-dborder rounded-lg px-3 py-1.5 flex-shrink-0 transition-colors"
            >
              Use my query →
            </button>
          </div>

          {/* 2-column suggestion grid */}
          <div className="p-4 grid grid-cols-2 gap-2.5">
            {/* Loading skeleton */}
            {loadingSuggestions && Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-dborder bg-bg2 p-4 space-y-2 animate-pulse">
                <div className="flex justify-between">
                  <div className="w-7 h-7 rounded bg-dborder2" />
                  <div className="w-12 h-4 rounded bg-dborder2" />
                </div>
                <div className="h-3.5 rounded bg-dborder2 w-4/5" />
                <div className="h-2.5 rounded bg-dborder2 w-full" />
                <div className="h-2.5 rounded bg-dborder2 w-3/4" />
              </div>
            ))}
            {!loadingSuggestions && suggestions.map(s => {
              const badgeColor = BADGE_COLORS[s.badge] ?? "#6c5cf7";
              return (
                <button
                  key={s.id}
                  onClick={() => handleSuggestion(s)}
                  className="group text-left flex flex-col gap-2 p-4 rounded-xl border border-dborder bg-bg2 hover:border-accent hover:bg-accent/5 transition-all"
                >
                  {/* Icon + badge row */}
                  <div className="flex items-center justify-between">
                    <span className="text-2xl leading-none">{s.icon}</span>
                    <span
                      className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ background: `${badgeColor}18`, color: badgeColor }}
                    >
                      {s.badge}
                    </span>
                  </div>
                  {/* Label */}
                  <div className="text-[12px] font-bold text-t1 group-hover:text-accent leading-tight">
                    {s.label}
                  </div>
                  {/* Desc */}
                  <div className="text-[10px] text-t3 leading-snug flex-1">
                    {s.desc}
                  </div>
                  {/* Path arrow */}
                  <div className="text-[9px] font-semibold uppercase tracking-wider mt-1"
                    style={{ color: PATH_ARROW_COLOR[s.path] }}>
                    {PATH_ARROW[s.path]}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Footer — expand wizard */}
          <div className="px-4 pb-4">
            <button
              onClick={() => setShowWizard(w => !w)}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-dborder2 text-[11px] text-t3 hover:text-t1 hover:border-accent transition-colors"
            >
              {showWizard ? "▲ Hide" : "▼ Customise with my own query"}
              {" — \""}{query.slice(0, 55)}{query.length > 55 ? "…" : ""}{"\""}
            </button>
          </div>
        </div>

        {/* ── Collapsible wizard ──────────────────────────────────────────── */}
        {showWizard && (
          <>
            {/* Path detected banner */}
            <div className="bg-white rounded-2xl border border-dborder shadow-sm px-6 py-4 flex items-center gap-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ background: `${meta.color}15`, border: `1.5px solid ${meta.color}40` }}
              >
                {meta.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-widest text-t3">Detected intent</div>
                <div className="text-[14px] font-bold text-t1">{meta.label}</div>
                <div className="text-[11px] text-t3 truncate">
                  "{query.slice(0, 80)}{query.length > 80 ? "…" : ""}"
                </div>
              </div>
              <button
                onClick={useOriginalQuery}
                className="text-[11px] text-t3 hover:text-t1 border border-dborder rounded-lg px-3 py-1.5 flex-shrink-0"
              >
                Skip →
              </button>
            </div>

            {/* BUILDER has no wizard questions */}
            {path === "BUILDER" ? (
              <div className="bg-white rounded-2xl border border-dborder shadow-sm px-6 py-6 text-center">
                <div className="text-[13px] text-t2 mb-4">
                  Your query is a{" "}
                  <span className="font-bold" style={{ color: "#6c5cf7" }}>Project Builder</span>
                  {" "}request — no additional questions needed.
                </div>
                <button
                  onClick={useOriginalQuery}
                  className="px-6 py-2.5 rounded-xl text-[13px] font-bold text-white"
                  style={{ background: "#6c5cf7" }}
                >
                  Build with my query →
                </button>
              </div>
            ) : (
              <>
                {/* Step dots */}
                {questions.length > 1 && (
                  <div className="flex items-center justify-center gap-2">
                    {questions.map((_, i) => (
                      <div key={i} className={`transition-all rounded-full ${
                        i < step ? "w-5 h-2 bg-gg" : i === step ? "w-5 h-2 bg-accent" : "w-2 h-2 bg-dborder2"
                      }`} />
                    ))}
                  </div>
                )}

                {/* Question card */}
                {currentQ && (
                  <div className="bg-white rounded-2xl border border-dborder shadow-sm overflow-hidden">
                    <div className="px-7 pt-7 pb-2">
                      {step > 0 && (
                        <button
                          onClick={() => setStep(s => s - 1)}
                          className="text-[11px] text-t3 hover:text-t1 mb-4 flex items-center gap-1"
                        >
                          ← Back
                        </button>
                      )}
                      <div className="text-[16px] font-bold text-t1 mb-1">{currentQ.question}</div>
                      <div className="text-[11px] text-t3 mb-5">
                        Step {step + 1} of {questions.length} · {meta.label}
                      </div>
                    </div>
                    <div className="px-7 pb-7 space-y-2">
                      {currentQ.options.map(opt => (
                        <button
                          key={opt.id}
                          onClick={() => handleAnswer(currentQ.id, opt.id)}
                          className="w-full flex items-center gap-4 px-4 py-4 rounded-xl border border-dborder bg-bg2 hover:border-accent hover:bg-accent/5 transition-all text-left group"
                        >
                          <span className="text-2xl w-8 flex-shrink-0">{opt.icon}</span>
                          <div>
                            <div className="text-[13px] font-bold text-t1 group-hover:text-accent">{opt.label}</div>
                            <div className="text-[11px] text-t3">{opt.desc}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
