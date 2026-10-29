let userTimeZone = "Asia/Kolkata";
export const setTimeZone = (tz: string) => (userTimeZone = tz);
export const getTimeZone = () => userTimeZone;

export function money(minor: number | null | undefined, currency = "INR", compact = false): string {
  if (minor === null || minor === undefined) return "—";
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en", {
      style: "currency",
      currency,
      maximumFractionDigits: compact ? 1 : 0,
      notation: compact ? "compact" : "standard",
    }).format(minor / 100);
  } catch {
    return `${currency} ${(minor / 100).toLocaleString()}`;
  }
}

/** Sums per currency, e.g. [{currency:'INR', amount_minor: 1}] → "₹12L · $3K". */
export function moneyList(rows: { currency: string; amount_minor: number }[] | undefined, compact = true) {
  if (!rows?.length) return money(0, "INR", compact);
  return rows.map((r) => money(Number(r.amount_minor), r.currency, compact)).join(" · ");
}

export function date(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00Z`) : new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: iso.length === 10 ? "UTC" : userTimeZone }).format(d);
}

export const dateTime = (iso: string | null | undefined) =>
  date(iso, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

export function relative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return date(iso);
}

export const isOverdue = (iso: string | null | undefined) => !!iso && new Date(iso).getTime() < Date.now();

/** Local datetime-input value ("YYYY-MM-DDTHH:mm") ⇄ UTC ISO, in the browser's zone. */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export function initials(name: string | null | undefined) {
  return (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
}

export const pct = (v: number | null | undefined) => (v === null || v === undefined || !isFinite(v) ? "N/A" : `${Math.round(v * 100)}%`);

export function hostOf(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
