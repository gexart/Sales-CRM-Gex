import { waHref } from "./contact-links";
import { inr } from "./billing";

/** "Open WhatsApp automatically after I save or approve an invoice" is remembered per phone. */
const AUTO_KEY = "gexart-auto-whatsapp";
export const getAutoWhatsApp = () => {
  try {
    return localStorage.getItem(AUTO_KEY) !== "0";
  } catch {
    return true;
  }
};
export const setAutoWhatsApp = (on: boolean) => {
  try {
    localStorage.setItem(AUTO_KEY, on ? "1" : "0");
  } catch {
    /* storage blocked: the default (on) stays */
  }
};

export const invoiceLink = (token: string) => `${window.location.origin}/i/${token}`;

export function invoiceMessage(o: { party: string; invoiceNo: string; totalPaise: number; balancePaise: number; dueDate?: string | null; token?: string | null }) {
  const due = o.balancePaise > 0 ? ` Amount due: ${inr(o.balancePaise)}${o.dueDate ? ` by ${new Date(o.dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}.` : " Paid in full. Thank you!";
  return `Hello ${o.party}, your invoice ${o.invoiceNo} for ${inr(o.totalPaise)} is ready.${due}${o.token ? `\nView and pay: ${invoiceLink(o.token)}` : ""}\n\nThank you, Gexart`;
}

export function reminderMessage(o: { party: string; outstandingPaise: number }) {
  return `Hello ${o.party}, a gentle reminder: ${inr(o.outstandingPaise)} is pending with us. Please share the payment status at your earliest. Thank you, Gexart`;
}

/** Opens WhatsApp with the message ready for that number. In the Android app this hands over to the WhatsApp app. */
export function openWhatsApp(phone: string, text: string) {
  const url = waHref(phone, text);
  const w = window.open(url, "_blank", "noopener");
  if (!w) window.location.href = url;
}
