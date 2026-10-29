export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

/** D1 rejects `undefined` bindings. */
export const b = (v: unknown) => (v === undefined ? null : v);

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(pvt|private|ltd|limited|llp|inc|llc|co|company)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function domainOf(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    return u.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export const normalizeEmail = (e: string | null | undefined) => (e ? e.trim().toLowerCase() : null);

/** Digits only, last 10 digits, so "+91 98300 12345" and "098300-12345" match. */
export function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : null;
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
