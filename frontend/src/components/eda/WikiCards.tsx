"use client";

import { useMemo, useState } from "react";

type WikiPage = {
  canonical_id?: string;
  title?: string;
  entity_type?: string;
  source_file?: string;
  summary?: string;
  citations?: string[];
  provenance?: string[];
};

export default function WikiCards({ pages }: { pages: WikiPage[] }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");

  const types = useMemo(() => {
    const t = new Set<string>();
    pages.forEach((p) => {
      if (p.entity_type) t.add(p.entity_type);
    });
    return ["all", ...Array.from(t).sort()];
  }, [pages]);

  const filtered = useMemo(() => {
    return pages
      .filter((p) => (type === "all" ? true : (p.entity_type ?? "") === type))
      .filter((p) => {
        const hay = `${p.title ?? ""} ${p.summary ?? ""} ${p.canonical_id ?? ""}`.toLowerCase();
        return hay.includes(query.toLowerCase());
      });
  }, [pages, query, type]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search wiki"
          className="h-8 w-48 rounded-md border border-slate-300 px-2 text-[12px]"
        />
        <select value={type} onChange={(e) => setType(e.target.value)} className="h-8 rounded-md border border-slate-300 px-2 text-[12px]">
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <span className="ml-auto text-[11px] text-slate-500">{filtered.length} cards</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
        {filtered.length ? (
          filtered.map((p, i) => (
            <article key={`${p.canonical_id ?? p.title ?? "wiki"}-${i}`} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-1 line-clamp-1 text-[12px] font-semibold text-slate-900">{p.title ?? p.canonical_id ?? "Untitled"}</div>
              <div className="mb-2 flex items-center gap-2 text-[10px] text-slate-500">
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">{p.entity_type ?? "unknown"}</span>
                {p.source_file ? <span className="line-clamp-1">{p.source_file}</span> : null}
              </div>
              <p className="line-clamp-4 text-[11px] text-slate-600">{p.summary ?? "No explanation available."}</p>
              <div className="mt-2 border-t border-slate-100 pt-2 text-[10px] text-slate-500">
                Citations: {(p.citations ?? p.provenance ?? []).length || "Not available"}
              </div>
            </article>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-3 text-[12px] text-slate-500">No wiki cards available.</div>
        )}
      </div>
    </div>
  );
}
