import { ApiError } from "./api";
import { bill } from "./billing";

/**
 * Invoice requests made with no signal wait here, on the phone, and are sent when it is back online.
 * Each carries a reference so a retry can never create the same request twice (the server de-duplicates on it).
 */
const KEY = "gexart-offline-invoice-requests";
export interface QueuedRequest { ref: string; body: unknown; at: string; party: string }

function read(): QueuedRequest[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}
function write(list: QueuedRequest[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new Event("gexart:queue"));
  } catch {
    /* storage full or blocked: nothing more we can do */
  }
}

export const queuedCount = () => read().length;
export const newRef = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function queueInvoiceRequest(body: unknown, party: string, ref = newRef()) {
  write([...read(), { ref, body, at: new Date().toISOString(), party }]);
  return ref;
}

let flushing = false;
/** Send what is waiting. Stops at the first network failure; drops requests the server rejects as invalid. */
export async function flushQueue(): Promise<{ sent: number; dropped: number; left: number }> {
  if (flushing) return { sent: 0, dropped: 0, left: queuedCount() };
  flushing = true;
  let sent = 0,
    dropped = 0;
  try {
    for (const item of read()) {
      try {
        await bill.post("/sales/invoices", item.body, { "x-client-ref": item.ref });
        write(read().filter((q) => q.ref !== item.ref));
        sent++;
      } catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429 && e.status !== 401) {
          write(read().filter((q) => q.ref !== item.ref));
          dropped++;
        } else break;
      }
    }
  } finally {
    flushing = false;
  }
  return { sent, dropped, left: queuedCount() };
}
