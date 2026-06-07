import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg2 p-6">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="text-6xl font-bold text-t3 font-sora">404</div>
        <h2 className="text-xl font-semibold text-t1 font-sora">Page not found</h2>
        <p className="text-sm text-t3">The page you're looking for doesn't exist or has been moved.</p>
        <Link
          href="/dashboard"
          className="inline-block btn btn-p px-6 py-2.5 text-sm"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
