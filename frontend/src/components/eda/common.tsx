"use client";

import React from "react";

export function EmptyState({ message = "No data ingested yet — upload files or connect a database to populate this view." }: { message?: string }) {
  return (
    <div className="card text-[12px] text-t3">{message}</div>
  );
}

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="mcard">
      <div className="text-[20px] font-bold text-t1 leading-none">{value}</div>
      <div className="text-[10px] text-t3 mt-1 uppercase tracking-wider">{label}</div>
    </div>
  );
}

export function fmtPct(v?: number | null): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "-";
  return `${(Number(v) * 100).toFixed(1)}%`;
}

export function fmtNum(v?: number | null): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "-";
  return Number(v).toLocaleString();
}

export function fmtBytes(v?: number | null): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "-";
  const n = Number(v);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
