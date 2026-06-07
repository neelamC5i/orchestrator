export default function GlobalLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg2">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-t3">Loading…</p>
      </div>
    </div>
  );
}
