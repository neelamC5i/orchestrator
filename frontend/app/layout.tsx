import type { Metadata } from "next";
import "./globals.css";
import Topbar from "./components/Topbar";
import LayoutShell from "./components/LayoutShell";
import ErrorBoundary from "./components/ErrorBoundary";

export const metadata: Metadata = {
  title: "AI Fine-Tuning Orchestrator",
  description: "Domain SLM builder and intelligent model recommender",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body className="bg-bg text-t1 min-h-screen font-sora">
        <Topbar />
        <LayoutShell>
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </LayoutShell>
      </body>
    </html>
  );
}
