"use client";

export default function MetricTooltip({ text }: { text: string }) {
  return (
    <span
      className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] text-slate-500"
      title={text}
      aria-label={text}
    >
      i
    </span>
  );
}
