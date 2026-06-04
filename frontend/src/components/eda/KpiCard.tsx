"use client";

import MetricTooltip from "./MetricTooltip";

type Tone = "default" | "success" | "warning" | "risk";

function toneClass(tone: Tone): string {
  if (tone === "success") return "border-emerald-200 bg-emerald-50/70";
  if (tone === "warning") return "border-amber-200 bg-amber-50/70";
  if (tone === "risk") return "border-rose-200 bg-rose-50/70";
  return "border-slate-200 bg-white/80";
}

export default function KpiCard({
  label,
  value,
  sub,
  badge,
  tone = "default",
  tooltip,
}: {
  label: string;
  value: string;
  sub?: string;
  badge?: string;
  tone?: Tone;
  tooltip?: string;
}) {
  return (
    <div className={`rounded-xl border p-3 shadow-sm ${toneClass(tone)}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
          {tooltip ? <MetricTooltip text={tooltip} /> : null}
        </div>
        {badge ? <span className="rounded-full bg-slate-900/90 px-2 py-0.5 text-[9px] text-white">{badge}</span> : null}
      </div>
      <div className="mt-1 text-[20px] font-bold leading-none text-slate-900">{value}</div>
      {sub ? <div className="mt-1 text-[10px] text-slate-500">{sub}</div> : null}
    </div>
  );
}
