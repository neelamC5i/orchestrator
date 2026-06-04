"use client";

import React from "react";

export default function InspectorPanel({
  title,
  children,
  emptyMessage = "Select an item to inspect details.",
}: {
  title: string;
  children?: React.ReactNode;
  emptyMessage?: string;
}) {
  return (
    <aside className="h-full rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</div>
      <div className="h-[calc(100%-20px)] overflow-auto pr-1 text-[12px] text-slate-700">
        {children ?? <div className="text-slate-500">{emptyMessage}</div>}
      </div>
    </aside>
  );
}
