export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("orch_access_token");
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem("orch_refresh_token");
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    localStorage.setItem("orch_access_token", data.access_token);
    localStorage.setItem("orch_refresh_token", data.refresh_token);
    return data.access_token;
  } catch {
    return null;
  }
}

function clearAuth() {
  localStorage.removeItem("orch_access_token");
  localStorage.removeItem("orch_refresh_token");
  localStorage.removeItem("orch_logged_in");
  localStorage.removeItem("orch_user");
  document.cookie = "orch_logged_in=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  window.location.href = "/login";
}

/**
 * Wrapper around fetch that automatically attaches the JWT Authorization
 * header and handles 401 with a silent token refresh + retry.
 */
export async function parseApiError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message ?? body?.detail ?? `HTTP ${res.status}`;
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = getAccessToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let res = await fetch(input, { ...init, headers });

  if (res.status === 401) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      headers.set("Authorization", `Bearer ${newToken}`);
      res = await fetch(input, { ...init, headers });
    }
    if (res.status === 401) {
      clearAuth();
    }
  }

  return res;
}
