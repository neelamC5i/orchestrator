"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { API_BASE, parseApiError } from "../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem("orch_logged_in") === "true") {
      router.replace("/dashboard");
    }
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!res.ok) {
        setError(await parseApiError(res));
        setLoading(false);
        return;
      }
      const data = await res.json();
      localStorage.setItem("orch_access_token", data.access_token);
      localStorage.setItem("orch_refresh_token", data.refresh_token);
      localStorage.setItem("orch_logged_in", "true");
      localStorage.setItem("orch_user", username.trim());
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `orch_logged_in=true; path=/; SameSite=Lax${secure}`;
      router.replace("/dashboard");
    } catch {
      setError("Unable to reach the server. Is the backend running?");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg2 flex items-center justify-center p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-accent/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-purple/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo / brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-3">
            <img src="/c5i-logo.png" alt="C5i" width={72} height={40} className="object-contain" />
          </div>
          <h1 className="text-[22px] font-bold font-sora">
            <span className="text-t1">Domain Harnessing System</span>
          </h1>
          <p className="text-[13px] text-t3 mt-1">Sign in to your workspace</p>
        </div>

        {/* Card */}
        <div className="bg-card border border-dborder rounded-2xl shadow-sm p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Username */}
            <div>
              <label className="block text-[11px] font-semibold text-t3 uppercase tracking-widest mb-1.5">
                Username
              </label>
              <input
                type="text"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="admin"
                className="w-full bg-bg3 border border-dborder rounded-xl px-4 py-2.5 text-[13px] text-t1 placeholder:text-t3 outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-[11px] font-semibold text-t3 uppercase tracking-widest mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-bg3 border border-dborder rounded-xl px-4 py-2.5 pr-10 text-[13px] text-t1 placeholder:text-t3 outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-t3 hover:text-t1 text-[11px] select-none"
                  tabIndex={-1}
                >
                  {showPass ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-[12px] text-red-600">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full py-2.5 rounded-xl text-[13px] font-bold text-white bg-accent hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Signing in…" : "Sign In →"}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-t3 mt-6">
          Local instance · all data stays on your machine
        </p>
      </div>
    </div>
  );
}
