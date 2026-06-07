"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { API_BASE } from "./lib/api";

const DOMAIN_PRESETS = [
  { id: "manufacturing",  label: "Manufacturing",   icon: "🏭", desc: "Production, supply chain, quality control" },
  { id: "it-industry",    label: "IT Industry",     icon: "💻", desc: "Software, infrastructure, DevOps" },
  { id: "healthcare",     label: "Healthcare",      icon: "🏥", desc: "Clinical, patient care, medical devices" },
  { id: "finance",        label: "Finance",         icon: "💹", desc: "Banking, investment, risk management" },
  { id: "legal",          label: "Legal",           icon: "⚖️",  desc: "Contracts, compliance, case research" },
  { id: "retail",         label: "Retail",          icon: "🛍️",  desc: "E-commerce, inventory, customer data" },
  { id: "logistics",      label: "Logistics",       icon: "🚚", desc: "Supply chain, fleet, warehouse ops" },
  { id: "energy",         label: "Energy",          icon: "⚡", desc: "Oil & gas, renewables, grid management" },
  { id: "pharma",         label: "Pharma",          icon: "💊", desc: "Drug development, regulatory, trials" },
  { id: "research",       label: "Research",        icon: "🔬", desc: "Scientific analysis, literature review" },
  { id: "custom",         label: "Other / Custom",  icon: "🗂️",  desc: "Enter your own domain below" },
];

interface DBCredentials {
  db_type: string; host: string; port: number;
  database: string; username: string; password: string;
}

export default function WorkspacePage() {
  const router = useRouter();
  const [selectedDomain, setSelectedDomain] = useState("");
  const [customDomain, setCustomDomain]     = useState("");
  const [files, setFiles]                   = useState<File[]>([]);
  const [dbOpen, setDbOpen]                 = useState(false);
  const [dbCreds, setDbCreds]               = useState<DBCredentials>({
    db_type: "", host: "localhost", port: 5432,
    database: "", username: "", password: "",
  });
  const [schemaPreview, setSchemaPreview]   = useState<string | null>(null);
  const [isConnecting, setIsConnecting]     = useState(false);
  const [isSubmitting, setIsSubmitting]     = useState(false);
  const [error, setError]                   = useState("");

  const ALLOWED_EXT = new Set([".csv",".json",".jsonl",".txt",".pdf",".xlsx",".xls",".parquet",".md",".docx",".doc"]);
  const MAX_FILE_MB = 100;

  const validateFiles = (incoming: File[]): File[] => {
    const rejected: string[] = [];
    const accepted: File[] = [];
    for (const f of incoming) {
      const ext = f.name.includes(".") ? `.${f.name.split(".").pop()!.toLowerCase()}` : "";
      if (!ALLOWED_EXT.has(ext)) { rejected.push(`${f.name}: unsupported type`); continue; }
      if (f.size > MAX_FILE_MB * 1024 * 1024) { rejected.push(`${f.name}: exceeds ${MAX_FILE_MB}MB`); continue; }
      accepted.push(f);
    }
    if (rejected.length) setError(rejected.join("; "));
    return accepted;
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const validated = validateFiles(Array.from(e.dataTransfer.files));
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      return [...prev, ...validated.filter(f => !existing.has(f.name))];
    });
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const validated = validateFiles(Array.from(e.target.files ?? []));
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      return [...prev, ...validated.filter(f => !existing.has(f.name))];
    });
  };

  const testConnection = async () => {
    if (!dbCreds.db_type) return;
    setIsConnecting(true);
    setSchemaPreview(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/data/test-connection`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dbCreds),
      });
      const data = await res.json();
      setSchemaPreview(JSON.stringify(data.schema ?? data, null, 2));
    } catch {
      setSchemaPreview("Connection failed");
    } finally {
      setIsConnecting(false);
    }
  };

  const effectiveDomain = selectedDomain === "custom"
    ? customDomain.trim()
    : selectedDomain;

  const handleSubmit = async () => {
    if (!effectiveDomain)                       { setError("Please select a domain"); return; }
    if (files.length === 0 && !dbCreds.db_type) { setError("Please upload files or connect a database"); return; }
    setIsSubmitting(true);
    setError("");
    try {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      form.append("domain_label", effectiveDomain);
      if (dbCreds.db_type) {
        form.append("db_type",  dbCreds.db_type);
        form.append("host",     dbCreds.host);
        form.append("port",     String(dbCreds.port));
        form.append("database", dbCreds.database);
        form.append("username", dbCreds.username);
        form.append("password", dbCreds.password);
      }
      const res  = await fetch(`${API_BASE}/api/v1/data/ingest`, { method: "POST", body: form });
      const data = await res.json();
      sessionStorage.setItem("job_id",       data.job_id);
      sessionStorage.setItem("domain_label", effectiveDomain);
      sessionStorage.setItem("pipeline_reused", data.reused ? "true" : "false");
      sessionStorage.removeItem("query");
      sessionStorage.removeItem("reuse_corpus");
      router.push("/processing");
    } catch (e: any) {
      setError(e.message ?? "Failed to start ingestion");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="bg-card border-b border-dborder px-0 py-7 mb-7">
        <div className="w-full px-8">
          <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-t3 mb-1.5 flex items-center gap-2">
            <span className="inline-block w-4 h-px bg-accent" />
            Step 1 · Workspace
          </div>
          <div className="font-sora text-2xl font-semibold text-t1">Set up your workspace</div>
          <div className="text-[12px] text-t2 mt-1">Choose your domain and upload your knowledge corpus</div>
        </div>
      </div>

      <div className="w-full px-8">

        {/* ── Domain selector ─────────────────────────────────── */}
        <div className="text-[10px] font-semibold uppercase tracking-wider text-t3 mb-3">Select domain</div>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {DOMAIN_PRESETS.map(d => (
            <button
              key={d.id}
              onClick={() => setSelectedDomain(d.id)}
              className={`flex items-center gap-3 px-4 py-3 rounded-card border text-left transition-all ${
                selectedDomain === d.id
                  ? "bg-accent/10 border-accent/50 shadow-sm"
                  : "bg-card2 border-dborder hover:border-accent/30 hover:bg-accent/5"
              }`}
            >
              <span className="text-xl flex-shrink-0">{d.icon}</span>
              <div className="min-w-0">
                <div className={`text-[12px] font-semibold leading-tight ${
                  selectedDomain === d.id ? "text-accent" : "text-t1"
                }`}>{d.label}</div>
                <div className="text-[10px] text-t3 mt-0.5 leading-snug line-clamp-1">{d.desc}</div>
              </div>
              {selectedDomain === d.id && (
                <span className="ml-auto text-accent font-bold flex-shrink-0">✓</span>
              )}
            </button>
          ))}
        </div>

        {/* Custom domain text field */}
        {selectedDomain === "custom" && (
          <div className="mb-4">
            <input
              autoFocus
              className="w-full bg-bg3 border border-dborder2 rounded-card px-4 py-2.5 text-[12px] text-t1 outline-none transition-colors focus:border-accent font-dm"
              placeholder="e.g. aerospace, telecom, government-procurement…"
              value={customDomain}
              onChange={e => setCustomDomain(e.target.value)}
            />
          </div>
        )}

        <div className="border-t border-dborder my-5" />

        {/* ── File upload ─────────────────────────────────────── */}
        <div className="text-[10px] font-semibold uppercase tracking-wider text-t3 mb-3">
          Upload corpus{" "}
          <span className="font-normal normal-case">— PDF, DOCX, CSV, JSON, Parquet, TXT</span>
        </div>

        <div
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => document.getElementById("ws-file-input")?.click()}
          className="border-2 border-dashed border-dborder rounded-card p-6 text-center cursor-pointer hover:border-accent/50 transition-all mb-4"
        >
          <input
            id="ws-file-input" type="file" multiple className="hidden"
            accept=".pdf,.docx,.doc,.csv,.json,.parquet,.txt,.md"
            onChange={onFileChange}
          />
          {files.length === 0 ? (
            <div>
              <div className="text-3xl mb-2">📂</div>
              <div className="text-[13px] text-t2 font-medium">Drop files here or click to browse</div>
              <div className="text-[10px] text-t3 mt-1">Multiple files supported</div>
            </div>
          ) : (
            <div className="text-left space-y-1.5" onClick={e => e.stopPropagation()}>
              {files.map(f => (
                <div key={f.name} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[14px]">📄</span>
                    <span className="text-[11px] text-t2 truncate">{f.name}</span>
                  </div>
                  <span className="text-[10px] text-t3 flex-shrink-0">
                    {(f.size / 1024).toFixed(0)} KB
                  </span>
                </div>
              ))}
              <div className="pt-2 border-t border-dborder mt-2 flex items-center justify-between">
                <span className="text-[10px] text-t3">{files.length} file{files.length !== 1 ? "s" : ""} selected</span>
                <button
                  onClick={() => setFiles([])}
                  className="text-[10px] text-t3 hover:text-coral transition-colors"
                >
                  Clear all
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── DB connection (collapsible) ──────────────────────── */}
        <div className="border border-dborder2 rounded-card mb-6">
          <button
            className="w-full flex items-center justify-between px-4 py-3 text-left"
            onClick={() => setDbOpen(o => !o)}
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-t3">
              Database connection{" "}
              <span className="font-normal normal-case">(optional)</span>
            </span>
            <span className="text-[10px] text-t3">{dbOpen ? "▲ hide" : "▼ connect"}</span>
          </button>

          {dbOpen && (
            <div className="px-4 pb-4 border-t border-dborder2 pt-3 space-y-3">
              <select
                className="w-full bg-bg3 border border-dborder2 rounded-card px-3 py-2 text-[12px] text-t1 outline-none focus:border-accent"
                value={dbCreds.db_type}
                onChange={e => setDbCreds(p => ({ ...p, db_type: e.target.value }))}
              >
                <option value="">-- Select database type --</option>
                <option value="postgresql">PostgreSQL</option>
                <option value="mysql">MySQL</option>
                <option value="sqlite">SQLite</option>
                <option value="mongodb">MongoDB</option>
              </select>

              {dbCreds.db_type && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {(["host", "port", "database", "username"] as const).map(k => (
                      <input
                        key={k}
                        placeholder={k.charAt(0).toUpperCase() + k.slice(1)}
                        className="bg-bg3 border border-dborder2 rounded-card px-3 py-2 text-[12px] text-t1 outline-none focus:border-accent"
                        value={(dbCreds as any)[k]}
                        onChange={e => setDbCreds(p => ({ ...p, [k]: e.target.value }))}
                      />
                    ))}
                    <input
                      type="password" placeholder="Password"
                      className="col-span-2 bg-bg3 border border-dborder2 rounded-card px-3 py-2 text-[12px] text-t1 outline-none focus:border-accent"
                      value={dbCreds.password}
                      onChange={e => setDbCreds(p => ({ ...p, password: e.target.value }))}
                    />
                    <button
                      onClick={testConnection} disabled={isConnecting}
                      className="col-span-2 btn py-2 text-[12px] disabled:opacity-50"
                    >
                      {isConnecting ? "Connecting…" : "Test Connection & Preview Schema"}
                    </button>
                  </div>
                  {schemaPreview && (
                    <pre className="bg-bg3 rounded-card p-3 text-[10px] text-gg overflow-auto max-h-40 font-mono">
                      {schemaPreview}
                    </pre>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 bg-coral/10 border border-coral/30 rounded-sm text-[12px] text-coral mb-4">
            ⚠ {error}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || !effectiveDomain || (files.length === 0 && !dbCreds.db_type)}
          className="btn btn-p btn-full py-3 text-sm disabled:opacity-40 mb-8"
        >
          {isSubmitting ? "Starting ingestion…" : "Start Ingestion →"}
        </button>

      </div>
    </div>
  );
}
