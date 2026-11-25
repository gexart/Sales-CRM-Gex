import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "./api";

export interface BillingAccess {
  isAdmin: boolean;
  roleId: string | null;
  roleName: string | null;
  permissions: string[];
  limits: { maxDiscountPct?: number; approvalAboveRupees?: number };
}

/** What the signed-in user may do in billing. Drives the menu and every button, but the server is the real gate. */
export function useBillingAccess() {
  const q = useQuery({
    queryKey: ["billing-access", "me"],
    queryFn: async () => (await api.get<{ data: BillingAccess }>("/billing-access/me")).data,
    staleTime: 60_000,
  });
  const a = q.data;
  const set = new Set(a?.permissions ?? []);
  const can = (k: string) => !!a && (a.isAdmin || set.has(k));
  return { access: a, loading: q.isLoading, can, any: (...k: string[]) => k.some(can), hasBilling: can("billing.access") };
}

/** Billing API calls (the engine answers with plain objects, not {data}). Errors become ApiError with the server's message. */
export const bill = {
  get: <T = any>(path: string) => api.get<T>(`/billing${path}`), // eslint-disable-line @typescript-eslint/no-explicit-any
  post: <T = any>(path: string, body?: unknown, headers?: Record<string, string>) => api.post<T>(`/billing${path}`, body, headers), // eslint-disable-line @typescript-eslint/no-explicit-any
  put: <T = any>(path: string, body: unknown) => api.put<T>(`/billing${path}`, body), // eslint-disable-line @typescript-eslint/no-explicit-any
  del: <T = any>(path: string, body?: unknown) => api.del<T>(`/billing${path}`, body), // eslint-disable-line @typescript-eslint/no-explicit-any
};
export const access = {
  get: <T = any>(path: string) => api.get<T>(`/billing-access${path}`), // eslint-disable-line @typescript-eslint/no-explicit-any
  post: <T = any>(path: string, body?: unknown) => api.post<T>(`/billing-access${path}`, body), // eslint-disable-line @typescript-eslint/no-explicit-any
  put: <T = any>(path: string, body: unknown) => api.put<T>(`/billing-access${path}`, body), // eslint-disable-line @typescript-eslint/no-explicit-any
  del: <T = any>(path: string) => api.del<T>(`/billing-access${path}`), // eslint-disable-line @typescript-eslint/no-explicit-any
};

export const inr = (paise: number | null | undefined) => `₹${((paise ?? 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong");
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => new Date(new Date(iso).getTime() + n * 86400000).toISOString().slice(0, 10);

export const INVOICE_STATUS_TONE: Record<string, "green" | "amber" | "red" | "gray" | "blue"> = { PAID: "green", UNPAID: "amber", PARTIALLY_PAID: "amber", PENDING: "amber", OVERDUE: "red", CANCELLED: "gray", DRAFT: "gray", OPEN: "blue" };
export const fileUrl = (path: string, fmt: "pdf" | "docx", inline = false, name?: string) => {
  const q = [inline ? "inline=1" : "", name ? `name=${encodeURIComponent(name)}` : ""].filter(Boolean).join("&");
  return `/api/v1/billing${path}/${fmt}${q ? `?${q}` : ""}`;
};
