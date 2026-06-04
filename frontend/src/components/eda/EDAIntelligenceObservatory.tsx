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
];

export default function EDAIntelligenceObservatory({ jobId }: { jobId: string }) {
  const [activeTab, setActiveTab] = useState<ObservatoryTab>("Pipeline");
  const [data, setData] = useState<ObservatoryData | null>(null);
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
    return <GovernanceOntologyTab data={data} />;
  }, [data, activeTab, emptyMessage]);

  return (
    <div className="mb-8">
      <div className="sect">EDA Intelligence Observatory</div>
      <div className="bg-white border border-dborder rounded-2xl overflow-hidden shadow-sm">
        <div className="px-4 py-3 border-b border-dborder bg-bg3">
          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-full text-[11px] border transition ${
                  activeTab === tab
                    ? "bg-accent text-white border-accent"
                    : "bg-white text-t2 border-dborder hover:border-accent/40"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
        <div className="p-4">
          {loading ? <div className="text-[11px] text-t3">Loading observability data…</div> : body}
        </div>
      </div>
    </div>
  );
}
