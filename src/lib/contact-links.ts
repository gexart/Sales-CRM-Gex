// Pure helpers for click-to-call and WhatsApp links (no UI), so they can be unit-tested.
const digits = (p: string) => String(p).replace(/\D/g, "");

/** WhatsApp wants country code + number, digits only. Bare 10-digit (Indian) numbers get 91. */
export function waNumber(p: string): string {
  let d = digits(p);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10) d = `91${d}`;
  else if (d.length === 11 && d.startsWith("0")) d = `91${d.slice(1)}`;
  return d;
}
export const hasDigits = (p: string) => digits(p).length > 0;
export const telHref = (p: string) => `tel:+${waNumber(p)}`;
export const waHref = (p: string, text?: string) => `https://wa.me/${waNumber(p)}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
