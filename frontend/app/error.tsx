"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg2 p-6">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="text-5xl">⚠️</div>
        <h2 className="text-xl font-semibold text-t1 font-sora">Something went wrong</h2>
        <p className="text-sm text-t3">{error.message || "An unexpected error occurred."}</p>
        <button
          onClick={reset}
          className="btn btn-p px-6 py-2.5 text-sm"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
