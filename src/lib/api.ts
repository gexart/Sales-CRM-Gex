export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  /** Field-level messages from a validation_error response, keyed by field name. */
  get fieldErrors(): Record<string, string> {
    if (this.code !== "validation_error" || !Array.isArray(this.details)) return {};
    return Object.fromEntries((this.details as { path: string; message: string }[]).map((d) => [d.path, d.message]));
  }
}

export interface Page<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-requested-with": "gexart-crm" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error ?? {};
    if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("gexart:unauthenticated"));
    throw new ApiError(res.status, e.code ?? "error", e.message ?? `Request failed (${res.status})`, e.details);
  }
  return json as T;
}

async function upload<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { method: "POST", credentials: "same-origin", headers: { "x-requested-with": "gexart-crm" }, body: form });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error ?? {};
    throw new ApiError(res.status, e.code ?? "error", e.message ?? `Upload failed (${res.status})`, e.details);
  }
  return json as T;
}

export const api = {
  upload: <T = { data: Row }>(path: string, form: FormData) => upload<T>(path, form),
  del: <T = { data: Row }>(path: string) => request<T>("DELETE", path),
  get: <T = { data: Row }>(path: string) => request<T>("GET", path),
  post: <T = { data: Row }>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T = { data: Row }>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T = { data: Row }>(path: string, body: unknown) => request<T>("PUT", path, body),
};

export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
