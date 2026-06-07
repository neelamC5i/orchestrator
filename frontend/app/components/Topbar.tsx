"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";

const STEPS = [
  { label: "Dashboard",     path: "/dashboard" },
  { label: "① Workspace",  path: "/" },
  { label: "② Processing", path: "/processing" },
  { label: "③ Query",      path: "/query" },
  { label: "④ Plan",       path: "/planning" },
  { label: "⑤ Results",    path: "/recommendations" },
  { label: "Wiki",          path: "/wiki" },
  { label: "Quality",       path: "/quality" },
  { label: "Templates",     path: "/templates" },
];

export default function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [user, setUser] = useState("");

  useEffect(() => {
    const name = sessionStorage.getItem("domain_label") ?? "";
    setWorkspaceName(name);
    setIsProcessing(pathname === "/processing");
    setUser(localStorage.getItem("orch_user") ?? "admin");
  }, [pathname]);

  function handleLogout() {
    document.cookie = "orch_logged_in=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    localStorage.removeItem("orch_logged_in");
    localStorage.removeItem("orch_user");
    localStorage.removeItem("orch_access_token");
    localStorage.removeItem("orch_refresh_token");
    router.replace("/login");
  }

  // Don't render the topbar on the login page
  if (pathname === "/login") return null;

  const activeIndex = STEPS.findIndex((s) => s.path === pathname);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-8 bg-white border-b border-dborder shadow-sm">
      {/* Brand */}
      <a
        className="flex items-center gap-3 font-sora font-bold text-lg text-t1 no-underline cursor-pointer flex-shrink-0"
        onClick={() => router.push("/")}
      >
        <div className="flex items-center justify-center flex-shrink-0">
          <Image
            src="/c5i-logo.png"
            alt="C5i"
            width={48}
            height={27}
            className="object-contain"
            priority
          />
        </div>
        Domain Harnessing System
      </a>

      {/* Workspace name (center-left) */}
      {workspaceName && (
        <div className="flex items-center gap-2 px-3 py-1 bg-bg2 border border-dborder rounded-lg ml-4 flex-shrink-0">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: isProcessing ? "#d97706" : "#16a34a" }} />
          <span className="text-[12px] font-semibold text-t2 max-w-[140px] truncate">{workspaceName}</span>
        </div>
      )}

      {/* Step nav */}
      <div className="flex gap-0.5 mx-auto">
        {STEPS.map((step, i) => {
          const isActive = activeIndex === i;
          const isDone = activeIndex > i;
          return (
            <button
              key={i}
              onClick={() => router.push(step.path)}
              className={`
                px-3 py-1.5 rounded-full text-[12px] font-semibold tracking-wide border transition-all duration-150
                ${isActive
                  ? "bg-accent text-white border-accent shadow-[0_0_0_2px_rgba(124,106,248,0.25)]"
                  : isDone
                  ? "bg-accent/10 text-accent border-dborder2"
                  : "bg-transparent text-t3 border-transparent hover:text-t2 hover:bg-bg3"
                }
              `}
            >
              {step.label}
            </button>
          );
        })}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3 flex-shrink-0">
        {isProcessing ? (
          <span className="text-[11px] text-amber bg-amber/10 border border-amber/30 px-3 py-1 rounded-xl font-semibold animate-pulse">
            ⚙ Processing
          </span>
        ) : (
          <span className="text-[11px] text-teal bg-teal/10 border border-teal/30 px-3 py-1 rounded-xl font-semibold">
            ● Live
          </span>
        )}
        {/* User badge */}
        <div className="flex items-center gap-2 pl-1">
          <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-[10px] font-bold text-white uppercase select-none">
            {user.slice(0, 1)}
          </div>
          <span className="text-[12px] font-semibold text-t2 hidden sm:block">{user}</span>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="text-[11px] text-t3 hover:text-coral border border-dborder hover:border-coral/40 px-2.5 py-1 rounded-lg transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
