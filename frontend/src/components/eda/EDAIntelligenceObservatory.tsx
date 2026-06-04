"use client";

import { useEffect, useMemo, useState } from "react";
import type { ObservatoryData, ObservatoryTab } from "./types";
import { EmptyState } from "./common";
import OverviewTab from "./OverviewTab";
import PipelineTab from "./PipelineTab";
import ExtractionTab from "./ExtractionTab";
import MetadataTab from "./MetadataTab";
import EDATab from "./EDATab";
import KnowledgeGraphTab from "./KnowledgeGraphTab";
import ConfidenceTab from "./ConfidenceTab";
import ValidationTrustTab from "./ValidationTrustTab";
import GovernanceOntologyTab from "./GovernanceOntologyTab";
import WikiTab from "./WikiTab";

const TABS: ObservatoryTab[] = [
  "Pipeline",
  "Overview",
  "Extraction",
  "Metadata",
  "EDA",
  "Knowledge Graph",
  "Confidence",
  "Validation & Trust",
  "Governance & Ontology",
  "Wiki",
];

export default function EDAIntelligenceObservatory({ jobId }: { jobId: string }) {
  const [activeTab, setActiveTab] = useState<ObservatoryTab>("Pipeline");
  const [data, setData] = useState<ObservatoryData | null>(null);
  const [wikiPages, setWikiPages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [emptyMessage, setEmptyMessage] = useState(
    "No data ingested yet — upload files or connect a database to populate this view."
  );

  useEffect(() => {
    const envApi = (process.env.NEXT_PUBLIC_API_URL ?? "").trim();
    const API = envApi.endsWith("/") ? envApi.slice(0, -1) : envApi;

    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const latestCompletedJobId = async (): Promise<string | null> => {
      try {
        const res = await fetch(`${API}/api/v1/data/corpora`);
        if (!res.ok) return null;
        const corpora = await res.json();
        if (!Array.isArray(corpora) || corpora.length === 0) return null;
        const latest = corpora
          .filter((row) => typeof row?.job_id === "string")
          .sort((a, b) => String(b?.created_at ?? "").localeCompare(String(a?.created_at ?? "")))[0];
        return typeof latest?.job_id === "string" ? latest.job_id : null;
      } catch {
        return null;
      }
    };

    const fetchObservatory = async (targetJobId: string): Promise<ObservatoryData | null> => {
      const r = await fetch(`${API}/api/v1/eda/observatory/${targetJobId}`);
      if (!r.ok) return null;
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("application/json")) return null;
      return await r.json();
    };

    const fetchWiki = async (targetJobId: string): Promise<any[]> => {
      try {
        const r = await fetch(`${API}/api/v1/wiki/${targetJobId}/pages?limit=200`);
        if (!r.ok) return [];
        const payload = await r.json();
        return Array.isArray(payload?.pages) ? payload.pages : [];
      } catch {
        return [];
      }
    };

    const load = async (showLoader: boolean) => {
      try {
        if (showLoader) setLoading(true);
        let d: ObservatoryData | null = null;
        let targetJobId = jobId;

        if (!targetJobId) {
          targetJobId = (await latestCompletedJobId()) ?? "";
        }

        if (targetJobId) {
          d = await fetchObservatory(targetJobId);
        }

        if (
          d &&
          !d.has_data &&
          ["graph_done", "failed", "error"].includes(String(d.status ?? "").toLowerCase())
        ) {
          const fallbackJobId = await latestCompletedJobId();
          if (fallbackJobId && fallbackJobId !== targetJobId) {
            const fallbackData = await fetchObservatory(fallbackJobId);
            if (fallbackData?.has_data) {
              d = fallbackData;
              targetJobId = fallbackJobId;
            }
          }
        }

        if (!cancelled) {
          setData(d);
          setWikiPages(targetJobId ? await fetchWiki(targetJobId) : []);
          if (!targetJobId) {
            setEmptyMessage("No completed ingestion found yet. Upload files or connect a database to start the pipeline.");
          } else if (!d) {
            setEmptyMessage("Unable to load observability data right now. Please retry in a moment.");
          } else if (!d.has_data && String(d.status ?? "").toLowerCase() === "ingesting") {
            setEmptyMessage("Ingestion is in progress. Observability visuals will appear as stages complete.");
          } else {
            setEmptyMessage("No data ingested yet — upload files or connect a database to populate this view.");
          }
        }

        // Keep polling until pipeline settles to graph_done/failed so visuals appear
        // without requiring a manual page refresh.
        const status = (d?.status ?? "").toLowerCase();
        const settled = status === "graph_done" || status === "failed" || status === "error";
        if (!settled && !timer) {
          timer = setInterval(() => {
            void load(false);
          }, 5000);
        }
        if (settled && timer) {
          clearInterval(timer);
          timer = null;
        }
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled && showLoader) setLoading(false);
      }
    };

    void load(true);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [jobId]);

  const body = useMemo(() => {
    if (!data) return <EmptyState message={emptyMessage} />;
    if (!data.has_data) return <EmptyState message={emptyMessage} />;

    if (activeTab === "Pipeline") return <PipelineTab data={data} />;
    if (activeTab === "Overview") return <OverviewTab data={data} />;
    if (activeTab === "Extraction") return <ExtractionTab data={data} />;
    if (activeTab === "Metadata") return <MetadataTab data={data} />;
    if (activeTab === "EDA") return <EDATab data={data} />;
    if (activeTab === "Knowledge Graph") return <KnowledgeGraphTab data={data} />;
    if (activeTab === "Confidence") return <ConfidenceTab data={data} />;
    if (activeTab === "Validation & Trust") return <ValidationTrustTab data={data} />;
    if (activeTab === "Governance & Ontology") return <GovernanceOntologyTab data={data} />;
    return <WikiTab pages={wikiPages} />;
  }, [data, activeTab, emptyMessage, wikiPages]);

  return (
    <div className="mb-8">
      <div className="sect">EDA Intelligence Observatory</div>
      <div className="h-[78vh] min-h-[620px] rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 via-blue-50/50 to-indigo-50/70 shadow-sm">
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-3 py-2 backdrop-blur">
          <div className="flex flex-wrap gap-1">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
                  activeTab === tab
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-slate-300 bg-white text-slate-600 hover:border-blue-300"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="h-[calc(78vh-64px)] min-h-0 p-3">
          {loading ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-[11px] text-slate-500">Loading observability data…</div>
          ) : (
            <div className="h-full min-h-0 overflow-auto pr-1">{body}</div>
          )}
        </div>
      </div>
    </div>
  );
}
