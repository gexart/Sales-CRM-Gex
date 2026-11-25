import type { Env } from "../env";
import { brevoSend } from "../lib/providers";
import { gmailSend, type Mailbox } from "../lib/gmail";
import { recordAudit } from "./access";

/**
 * Emails to clients and the push to the agency CRM (crm.gexart.com).
 * Provider is chosen in Settings -> Configuration -> "Billing emails and CRM": gmail (a connected mailbox such as
 * tech.gexart@gmail.com), brevo or resend. Nothing here ever throws: a failed email or push must not undo an invoice.
 */
export type MailResult = { sent: boolean; provider?: string; error?: string };
type L = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const emailProvider = (env: Env) => String(env.BILLING_EMAIL_PROVIDER || "").toLowerCase().trim();

export async function sendClientEmail(env: Env, m: { to: string; toName?: string; subject: string; text: string; html: string }): Promise<MailResult> {
  const wanted = emailProvider(env);
  const order = wanted === "off" ? [] : wanted ? [wanted] : ["gmail", "brevo", "resend"];
  let lastError = "No email provider is set up. Open Settings, then Configuration, then Billing emails.";
  for (const p of order) {
    try {
      if (p === "gmail") {
        const boxes = await env.DB.prepare("SELECT * FROM mailboxes WHERE status = 'active' ORDER BY CASE WHEN email = 'tech.gexart@gmail.com' THEN 0 ELSE 1 END, created_at LIMIT 1").all<Mailbox>();
        const mb = boxes.results?.[0];
        if (!mb) throw new Error("No Gmail mailbox is connected");
        await gmailSend(env, mb, { to: m.to, subject: m.subject, text: m.text });
        return { sent: true, provider: `gmail (${mb.email})` };
      }
      if (p === "brevo") {
        await brevoSend(env, { to: { email: m.to, name: m.toName }, subject: m.subject, html: m.html, text: m.text, tags: ["billing"] });
        return { sent: true, provider: "brevo" };
      }
      if (p === "resend") {
        if (!env.RESEND_API_KEY || !env.RESEND_SENDER_EMAIL) throw new Error("Resend needs RESEND_API_KEY and RESEND_SENDER_EMAIL");
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({ from: `${env.RESEND_SENDER_NAME || "Gexart"} <${env.RESEND_SENDER_EMAIL}>`, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
        });
        if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 160)}`);
        return { sent: true, provider: "resend" };
      }
    } catch (e) {
      lastError = `${p}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return { sent: false, error: lastError };
}

const rs = (paise: number) => `Rs. ${((paise ?? 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function invoiceEmail(o: { company: string; party: string; invoiceNo: string; totalPaise: number; balancePaise: number; dueDate?: string; link: string; kind: "invoice" | "payment" | "reminder"; paidPaise?: number }) {
  const subject = o.kind === "payment" ? `Payment received for ${o.invoiceNo}` : o.kind === "reminder" ? `Reminder: invoice ${o.invoiceNo} is due` : `Invoice ${o.invoiceNo} from ${o.company}`;
  const lines =
    o.kind === "payment"
      ? [`Thank you. We received ${rs(o.paidPaise ?? 0)} against invoice ${o.invoiceNo}.`, o.balancePaise > 0 ? `Balance due: ${rs(o.balancePaise)}.` : "This invoice is now paid in full."]
      : [`Your invoice ${o.invoiceNo} for ${rs(o.totalPaise)} is ready.`, o.balancePaise > 0 ? `Amount due: ${rs(o.balancePaise)}${o.dueDate ? ` by ${day(o.dueDate)}` : ""}.` : "It is already paid in full."];
  const text = `Hello ${o.party},\n\n${lines.join("\n")}\n\nView${o.balancePaise > 0 ? " and pay" : ""} your invoice: ${o.link}\n\nThank you,\n${o.company}`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111827;max-width:520px"><p>Hello ${esc(o.party)},</p>${lines.map((l) => `<p>${esc(l)}</p>`).join("")}<p><a href="${o.link}" style="display:inline-block;background:#F47A20;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">View${o.balancePaise > 0 ? " and pay" : ""} invoice</a></p><p style="color:#6B7280">Thank you,<br>${esc(o.company)}</p></div>`;
  return { subject, text, html };
}

/** Email the client about an invoice event, record the outcome in the audit log, and never throw. */
export async function emailInvoiceEvent(env: Env, stub: any, invoiceId: string, kind: "invoice" | "payment" | "reminder", origin: string, opts: { to?: string; actor?: { id: string; name: string }; paidPaise?: number } = {}): Promise<MailResult> {
  try {
    const inv: L = await stub.getSalesInvoice(invoiceId);
    if (!inv) return { sent: false, error: "Invoice not found" };
    const party: L | null = inv.party_id ? await stub.getParty(inv.party_id) : null;
    const to = (opts.to || inv.party_email || party?.email || "").trim();
    if (!to) return { sent: false, error: "This customer has no email address" };
    const settings = (await stub.getAllSettings())?.billing_settings;
    const company = settings?.company?.legalName || inv.branch?.name || "Gexart";
    const mail = invoiceEmail({ company, party: inv.party_name, invoiceNo: inv.invoice_no, totalPaise: inv.total_paise, balancePaise: inv.balance_amount_paise, dueDate: inv.due_date, link: `${origin}/i/${inv.shareToken}`, kind, paidPaise: opts.paidPaise });
    const r = await sendClientEmail(env, { to, toName: inv.party_name, ...mail });
    await recordAudit(env.DB, { actorId: opts.actor?.id ?? null, actorName: opts.actor?.name ?? "system", action: `email.${kind}`, entityType: "invoice", entityId: invoiceId, status: r.sent ? 200 : 502, detail: { to, provider: r.provider, error: r.error } });
    return r;
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const CRM_ALT_HOSTS: Record<string, string> = { "crm.gexart.com": "gexart-crm-front.pages.dev" };

/** Send an invoice (or its payment or cancellation) to the agency CRM's invoice webhook. */
export async function pushInvoiceToCrm(env: Env, stub: any, invoiceId: string, origin: string, event: "invoice.created" | "payment.received" | "invoice.cancelled" | "manual", actor?: { id: string; name: string }, payment?: { amountPaise: number; mode?: string; date?: string; ref?: string }): Promise<{ ok: boolean; status?: number; message: string }> {
  const url = String(env.AGENCY_CRM_HOOK_URL || "").trim();
  const allowed = url.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url); // plain http only for a local test receiver
  if (!allowed) return { ok: false, message: "Add the CRM webhook address in Settings, Configuration, Billing emails and CRM link" };
  try {
    const inv: L = await stub.getSalesInvoice(invoiceId);
    if (!inv) return { ok: false, message: "Invoice not found" };
    const party: L | null = inv.party_id ? await stub.getParty(inv.party_id) : null;
    const body = {
      event,
      invoice_no: inv.invoice_no,
      issue_date: inv.date,
      due_date: inv.due_date,
      amount: inv.total_paise / 100,
      paid_amount: inv.paid_amount_paise / 100,
      status: inv.status === "CANCELLED" ? "cancelled" : inv.status === "PAID" ? "paid" : inv.status === "PARTIALLY_PAID" ? "partial" : "unpaid",
      link: `${origin}/i/${inv.shareToken}`,
      title: (inv.lines ?? []).map((l: L) => l.name).join(", ").slice(0, 120),
      customer: { name: inv.party_name, company: party?.company ?? null, email: inv.party_email ?? party?.email ?? null, phone: inv.party_phone ?? party?.phone ?? null, gstin: inv.party_gstin ?? null, address: inv.party_address ?? null },
      items: (inv.lines ?? []).map((l: L) => ({ name: l.name, hsn: l.hsn_sac, qty: l.quantity_thousandths / 1000, rate: l.unit_price_paise / 100, gst_percent: l.tax_rate_basis_points / 100, amount: l.line_total_paise / 100 })),
      ...(payment ? { payment: { amount: payment.amountPaise / 100, mode: payment.mode, date: payment.date, reference: payment.ref } } : {}),
    };
    const send = (target: string) => fetch(target, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Gexart-Sales/1.0" }, body: JSON.stringify(body) });
    let res = await send(url);
    let host = new URL(url).host;
    // crm.gexart.com is an alias for a Cloudflare Pages site; from another Cloudflare app that alias can answer 522. The Pages address serves the same API.
    if (res.status >= 520 && res.status <= 527) {
      const u = new URL(url);
      const alt = String(env.AGENCY_CRM_ALT_HOST || CRM_ALT_HOSTS[u.host] || "").trim();
      if (alt) {
        u.host = alt;
        const second = await send(u.toString());
        if (second.status < 520) (res = second, (host = alt));
      }
    }
    const text = (await res.text()).slice(0, 300);
    let message = res.ok ? "Sent to the CRM" : `CRM answered ${res.status} (${host})`;
    try {
      const j = JSON.parse(text);
      const first = Array.isArray(j.results) ? j.results[0] : null;
      if (first?.action === "error") message = first.error;
      else if (first) message = `CRM: invoice ${first.action} for ${first.client}`;
    } catch {
      /* not JSON: keep the generic message */
    }
    await recordAudit(env.DB, { actorId: actor?.id ?? null, actorName: actor?.name ?? "system", action: "crm.push", entityType: "invoice", entityId: invoiceId, status: res.status, detail: { event, message } });
    return { ok: res.ok, status: res.status, message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
