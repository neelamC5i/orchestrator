"use client";

import { useEffect, useState, useCallback } from "react";
import { API_BASE as API } from "../lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Corpus {
  job_id: string;
  domain_label?: string;
  entity_count?: number;
  file_count?: number;
}

interface WikiArticle {
  community_id: number;
  title: string;
  sections: Record<string, string[]>;
  passages: string[];
  entity_count?: number;
  status?: string;
}

interface Review {
  review_id: string;
  entity_a?: string;
  entity_b?: string;
  status?: string;
  merge_confidence?: number;
  reason?: string;
}

const TYPE_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  ORG:    { bg: "rgba(124,58,237,.12)", color: "#7c3aed", border: "rgba(124,58,237,.30)" },
  PERSON: { bg: "rgba(217,119,6,.12)",  color: "#d97706", border: "rgba(217,119,6,.30)"  },
  GPE:    { bg: "rgba(13,148,136,.12)", color: "#0d9488", border: "rgba(13,148,136,.30)" },
  LOC:    { bg: "rgba(13,148,136,.12)", color: "#0d9488", border: "rgba(13,148,136,.30)" },
  EVENT:  { bg: "rgba(239,68,68,.12)",  color: "#ef4444", border: "rgba(239,68,68,.30)"  },
};
function typeStyle(t: string) {
  return TYPE_COLORS[t.toUpperCase()] ?? { bg: "rgba(37,99,235,.12)", color: "#2563eb", border: "rgba(37,99,235,.30)" };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function WikiPage() {
  const [corpora, setCorpora] = useState<Corpus[]>([]);
  const [selectedJob, setSelectedJob] = useState<string>("");
  const [articles, setArticles] = useState<WikiArticle[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<WikiArticle | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [tab, setTab] = useState<"articles" | "reviews">("articles");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/v1/data/corpora`)
      .then((r) => r.json())
      .then((d) => {
        const list: Corpus[] = Array.isArray(d) ? d : d.corpora ?? [];
        setCorpora(list);
        if (list.length > 0) setSelectedJob(list[0].job_id);
        try { localStorage.setItem("orch_corpora", JSON.stringify(list)); } catch { /**/ }
      })
      .catch(() => {});
  }, []);

  const fetchArticles = useCallback(() => {
    if (!selectedJob) return;
    setLoading(true);
    setError(null);
    setSelectedArticle(null);
    fetch(`${API}/api/v1/data/wiki/${selectedJob}`)
      .then((r) => r.json())
      .then((d) => {
        const list: WikiArticle[] = d.articles ?? [];
        setArticles(list);
        if (list.length > 0) setSelectedArticle(list[0]);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [selectedJob]);

  useEffect(() => { fetchArticles(); }, [fetchArticles]);

  const fetchReviews = useCallback(() => {
    if (!selectedJob) return;
    fetch(`${API}/api/v1/wiki/${selectedJob}/reviews?status=pending&limit=100`)
      .then((r) => r.json())
      .then((d) => setReviews(d.reviews ?? []))
      .catch(() => {});
  }, [selectedJob]);

  useEffect(() => { if (tab === "reviews") fetchReviews(); }, [tab, fetchReviews]);

  const submitReview = (review_id: string, decision: "approve" | "reject") => {
    fetch(`${API}/api/v1/wiki/${selectedJob}/review/${review_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, decided_by: "user" }),
    }).then(() => fetchReviews()).catch(() => {});
  };

  const filteredArticles = query.trim()
    ? articles.filter((a) => a.title.toLowerCase().includes(query.toLowerCase()))
    : articles;

  const currentCorpus = corpora.find((c) => c.job_id === selectedJob);

  return (
    <div className="flex flex-col h-screen bg-bg2 overflow-hidden">

      {/* Page header */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-dborder bg-bg1 flex-shrink-0">
        <div>
          <div className="text-[15px] font-semibold font-sora text-t1">Wiki Articles</div>
          <div className="text-[11px] text-t3 mt-0.5">Knowledge graph entities &amp; community summaries</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            className="bg-bg3 border border-dborder rounded-lg px-3 py-1.5 text-[12px] text-t1 focus:outline-none"
            value={selectedJob}
            onChange={(e) => { setSelectedJob(e.target.value); setSelectedArticle(null); }}
          >
            {corpora.map((c) => (
              <option key={c.job_id} value={c.job_id}>
                {c.domain_label ?? c.job_id.slice(0, 12)}
              </option>
            ))}
          </select>
          <button onClick={fetchArticles} className="btn btn-sm">Refresh</button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar */}
        <aside className="w-64 flex-shrink-0 border-r border-dborder flex flex-col bg-bg1">
          <div className="flex border-b border-dborder flex-shrink-0">
            {(["articles", "reviews"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="flex-1 py-2.5 text-[11px] font-medium capitalize transition-colors border-b-2"
                style={{
                  borderBottomColor: tab === t ? "var(--color-accent, #4f46e5)" : "transparent",
                  color: tab === t ? "#4f46e5" : "var(--color-t2, #5a6077)",
                  background: "transparent",
                }}
              >
                {t}
                {t === "reviews" && reviews.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-[9px] bg-accent text-white rounded-full">{reviews.length}</span>
                )}
              </button>
            ))}
          </div>

          {tab === "articles" && (
            <>
              <div className="p-2 border-b border-dborder flex-shrink-0">
                <input
                  className="w-full bg-bg3 border border-dborder rounded-lg px-2.5 py-1.5 text-[12px] text-t1 placeholder-t3 focus:outline-none"
                  placeholder="Search articles…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {currentCorpus && (
                <div className="px-3 py-2 border-b border-dborder flex-shrink-0 flex items-center justify-between">
                  <span className="text-[10px] text-t3">{articles.length} article{articles.length !== 1 ? "s" : ""}</span>
                  {currentCorpus.entity_count ? (
                    <span className="text-[10px] font-mono text-t3">{currentCorpus.entity_count} entities</span>
                  ) : null}
                </div>
              )}
              <div className="flex-1 overflow-y-auto">
                {loading && <p className="p-3 text-[11px] text-t3">Loading…</p>}
                {error && <p className="p-3 text-[11px] text-coral">{error}</p>}
                {filteredArticles.map((a) => (
                  <button
                    key={a.community_id}
                    onClick={() => setSelectedArticle(a)}
                    className={`w-full text-left px-3 py-2.5 border-b border-dborder transition-colors hover:bg-bg3 ${
                      selectedArticle?.community_id === a.community_id ? "bg-bg3 border-l-2 border-l-accent" : ""
                    }`}
                  >
                    <div className="text-[12px] font-medium text-t1 truncate leading-snug">{a.title}</div>
                    <div className="flex items-center gap-1.5 mt-1">
                      {Object.keys(a.sections ?? {}).slice(0, 3).map((tp) => {
                        const s = typeStyle(tp);
                        return (
                          <span key={tp} className="text-[9px] font-semibold px-1.5 py-0.5 rounded" style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>{tp}</span>
                        );
                      })}
                      {a.passages?.length > 0 && (
                        <span className="text-[9px] text-t3 ml-auto">{a.passages.length}p</span>
                      )}
                    </div>
                  </button>
                ))}
                {!loading && filteredArticles.length === 0 && (
                  <p className="p-4 text-[11px] text-t3">
                    {selectedJob ? "No articles yet — run an ingest job first." : "Select a corpus."}
                  </p>
                )}
              </div>
            </>
          )}

          {tab === "reviews" && (
            <div className="flex-1 overflow-y-auto">
              {reviews.length === 0 && <p className="p-4 text-[11px] text-t3">No pending entity merge reviews.</p>}
              {reviews.map((r) => (
                <div key={r.review_id} className="p-3 border-b border-dborder">
                  <div className="text-[11px] font-medium text-t1 mb-1">
                    {r.entity_a} <span className="text-t3">↔</span> {r.entity_b}
                  </div>
                  <div className="text-[10px] text-t3 mb-2">
                    conf: {((r.merge_confidence ?? 0) * 100).toFixed(0)}% · {r.reason}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => submitReview(r.review_id, "approve")} className="flex-1 py-1 text-[11px] rounded-lg font-medium" style={{ background: "rgba(22,163,74,.15)", color: "#16a34a", border: "1px solid rgba(22,163,74,.3)" }}>Merge</button>
                    <button onClick={() => submitReview(r.review_id, "reject")} className="flex-1 py-1 text-[11px] rounded-lg font-medium" style={{ background: "rgba(100,116,139,.10)", color: "var(--color-t2)", border: "1px solid var(--color-dborder)" }}>Keep separate</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* Main panel */}
        <main className="flex-1 overflow-y-auto p-6">
          {!selectedArticle && !loading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-[40px] mb-3 opacity-30">📄</div>
                <p className="text-[13px] text-t3">Select an article from the left panel</p>
              </div>
            </div>
          )}

          {selectedArticle && (
            <article className="max-w-3xl">
              <div className="mb-6">
                <div className="flex items-start gap-3 mb-2">
                  <h1 className="text-[20px] font-bold font-sora text-t1 leading-snug">{selectedArticle.title}</h1>
                  <span className="pill-b mt-0.5 flex-shrink-0">Community {selectedArticle.community_id}</span>
                </div>
                {selectedArticle.entity_count != null && (
                  <p className="text-[12px] text-t3">{selectedArticle.entity_count} entities in this knowledge community</p>
                )}
              </div>

              {Object.keys(selectedArticle.sections ?? {}).length > 0 && (
                <div className="card mb-5">
                  <div className="sect mb-3">Entities by Type</div>
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(selectedArticle.sections).map(([type, entities]) => {
                      const s = typeStyle(type);
                      return (
                        <div key={type} className="mcard">
                          <div className="flex items-center gap-1.5 mb-2">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}>{type}</span>
                            <span className="text-[10px] text-t3">{entities.length}</span>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {entities.map((e) => (
                              <span key={e} className="text-[11px] px-2 py-0.5 rounded-md bg-bg4 border border-dborder text-t2">{e}</span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedArticle.passages?.length > 0 && (
                <div className="card">
                  <div className="sect mb-3">Source Passages ({selectedArticle.passages.length})</div>
                  <div className="space-y-2">
                    {selectedArticle.passages.map((p, i) => (
                      <div key={i} className="mcard">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: "rgba(79,70,229,.10)", color: "#4f46e5", border: "1px solid rgba(79,70,229,.25)" }}>passage {i + 1}</span>
                        </div>
                        <p className="text-[11px] text-t2 leading-relaxed font-mono break-all">{p}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </article>
          )}
        </main>
      </div>
    </div>
  );
}
