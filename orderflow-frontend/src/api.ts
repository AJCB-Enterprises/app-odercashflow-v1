/** Thin API client. All paths are relative to /api (see vite.config.ts proxy). */

const BASE = import.meta.env.VITE_API_URL || "/api";

export interface AuthUser {
  id: string;
  role: "admin" | "agent";
  full_name: string;
}

export const getToken = () => localStorage.getItem("of_token");
export const getUser = (): AuthUser | null => {
  const raw = localStorage.getItem("of_user");
  return raw ? (JSON.parse(raw) as AuthUser) : null;
};
export const setSession = (token: string, user: AuthUser) => {
  localStorage.setItem("of_token", token);
  localStorage.setItem("of_user", JSON.stringify(user));
};
export const clearSession = () => {
  localStorage.removeItem("of_token");
  localStorage.removeItem("of_user");
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const request = async <T>(path: string, opts: RequestInit = {}, auth = true): Promise<T> => {
  const headers: Record<string, string> = { ...(opts.headers as Record<string, string>) };
  if (auth && getToken()) headers.Authorization = `Bearer ${getToken()}`;
  const res = await fetch(BASE + path, { ...opts, headers });

  if (res.status === 401 && auth) {
    clearSession();
    if (!location.pathname.startsWith("/login")) location.assign("/login");
    throw new ApiError(401, "Sign in required");
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error || `Request failed (${res.status})`);
  return body as T;
};

export const api = {
  get: <T = any>(path: string, auth = true) => request<T>(path, {}, auth),
  post: <T = any>(path: string, data?: object, auth = true) =>
    request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined }, auth),
  put: <T = any>(path: string, data: object) =>
    request<T>(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  patch: <T = any>(path: string, data: object) =>
    request<T>(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
  delete: <T = any>(path: string) => request<T>(path, { method: "DELETE" }),
  /** Multipart upload for the public receipt endpoint (no auth header). */
  upload: <T = any>(path: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<T>(path, { method: "POST", body: form }, false);
  },
  /** Fetch a protected binary (receipt file) and open it in a new tab. */
  openBlob: async (path: string) => {
    const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new ApiError(res.status, "Could not load file");
    const url = URL.createObjectURL(await res.blob());
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};

/* ---- formatting helpers ---- */
export const peso = (n: string | number) =>
  "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2 });
export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
export const fmtTime = (d: string | Date) =>
  new Date(d).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const daysUntil = (d: string | Date) =>
  Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
