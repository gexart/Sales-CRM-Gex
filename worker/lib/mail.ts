// System emails (welcome / password reset) sent through Brevo, plus the one-time link tokens behind them.
// These are transactional account emails, separate from the approval-gated outreach workflow.
import type { Env } from "../env";
import { escapeHtml } from "../../shared/templating";
import { labelOf, ROLES } from "../../shared/enums";
import { brevoSend } from "./providers";
import { newId, now, sha256Hex } from "./util";

export const WELCOME_TTL_HOURS = 72;
export const RESET_TTL_MINUTES = 60;

const emailjsConfigured = (env: Env) => Boolean(env.EMAILJS_SERVICE_ID && env.EMAILJS_TEMPLATE_ID && env.EMAILJS_PUBLIC_KEY && env.EMAILJS_PRIVATE_KEY);
const brevoConfigured = (env: Env) => Boolean(env.BREVO_API_KEY && env.BREVO_SENDER_EMAIL);

/** Account emails can be sent when EmailJS is fully set up, or a Brevo key and verified sender are. */
export const emailConfigured = (env: Env) => emailjsConfigured(env) || brevoConfigured(env);

/** EmailJS REST API (server side). Needs "Allow EmailJS API for non-browser applications" enabled in the account. */
async function emailjsSend(env: Env, to: { email: string; name?: string }, subject: string, html: string, text: string) {
  const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      service_id: env.EMAILJS_SERVICE_ID,
      template_id: env.EMAILJS_TEMPLATE_ID,
      user_id: env.EMAILJS_PUBLIC_KEY,
      accessToken: env.EMAILJS_PRIVATE_KEY,
      template_params: { to_email: to.email, to_name: to.name ?? "", subject, message_html: html, message: text, from_name: env.BREVO_SENDER_NAME || "Gexart" },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`EmailJS ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160) || "request rejected"}`);
}

/** Public base URL used in emailed links: APP_URL when set, otherwise the origin the request came in on. */
export function appBaseUrl(env: Env, requestUrl: string): string {
  const configured = env.APP_URL?.trim();
  if (configured && /^https?:\/\//i.test(configured)) return configured.replace(/\/+$/, "");
  return new URL(requestUrl).origin;
}

const b64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Creates a single-use link token for the user, invalidating any earlier unused ones.
 * Only the hash is stored; the raw token exists only in the emailed link.
 */
export async function issueLinkToken(db: D1Database, userId: string, purpose: "welcome" | "reset", ip: string | null): Promise<string> {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const ttl = purpose === "welcome" ? WELCOME_TTL_HOURS * 3600_000 : RESET_TTL_MINUTES * 60_000;
  await db.batch([
    db.prepare("DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL").bind(userId),
    db
      .prepare("INSERT INTO password_resets (id, user_id, purpose, created_at, expires_at, ip) VALUES (?,?,?,?,?,?)")
      .bind(await sha256Hex(token), userId, purpose, now(), new Date(Date.now() + ttl).toISOString(), ip),
    // Housekeeping: drop links that expired more than a week ago.
    db.prepare("DELETE FROM password_resets WHERE expires_at < ?").bind(new Date(Date.now() - 7 * 86400_000).toISOString()),
  ]);
  return token;
}

// ─── Branded template ───
const NAVY = "#141E2E";
const ORANGE = "#F47A20";

function shell(o: { preheader: string; heading: string; bodyHtml: string; cta?: { label: string; url: string }; footnote?: string; appName: string }) {
  const cta = o.cta
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 8px"><tr><td style="border-radius:8px;background:${ORANGE}">
         <a href="${escapeHtml(o.cta.url)}" style="display:inline-block;padding:13px 28px;font:600 15px/1 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(o.cta.label)}</a>
       </td></tr></table>
       <p style="margin:14px 0 0;font:12px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#6b7686">Button not working? Paste this link into your browser:<br><a href="${escapeHtml(o.cta.url)}" style="color:#6b7686;word-break:break-all">${escapeHtml(o.cta.url)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f7">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(o.preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f3f4f7"><tr><td align="center" style="padding:32px 16px">
  <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(20,30,46,.08)">
    <tr><td style="background:${NAVY};padding:26px 32px">
      <span style="font:700 22px/1 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#ffffff;letter-spacing:.2px">${escapeHtml(o.appName)}</span>
      <div style="height:3px;width:34px;background:${ORANGE};margin-top:12px"></div>
    </td></tr>
    <tr><td style="padding:34px 32px 30px;font:15px/1.65 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#243044">
      <h1 style="margin:0 0 14px;font:700 22px/1.3 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:${NAVY}">${escapeHtml(o.heading)}</h1>
      ${o.bodyHtml}
      ${cta}
    </td></tr>
    <tr><td style="padding:18px 32px 26px;border-top:1px solid #e8eaf0;font:12px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#8a93a3">
      ${o.footnote ? `${escapeHtml(o.footnote)}<br>` : ""}This is an automated message from ${escapeHtml(o.appName)}. Please do not reply.
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

const p = (s: string) => `<p style="margin:0 0 14px">${s}</p>`;
const hours = (h: number) => (h % 24 === 0 ? `${h / 24} days` : `${h} hours`);

export interface MailResult {
  sent: boolean;
  /** Safe-to-show reason when not sent. */
  reason?: string;
}

async function deliver(env: Env, to: { email: string; name?: string }, subject: string, html: string, text: string, tag: string): Promise<MailResult> {
  if (!emailConfigured(env)) return { sent: false, reason: "Email is not set up. Add the EmailJS (or Brevo) details in Settings → Configuration." };
  try {
    if (emailjsConfigured(env)) await emailjsSend(env, to, subject, html, text);
    else await brevoSend(env, { to, subject, html, text, tags: ["gexart-crm", tag] });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message.slice(0, 200) : "The email provider rejected the message" };
  }
}

export async function sendWelcomeEmail(env: Env, o: { to: { email: string; name: string }; role: string; invitedBy: string; setupUrl: string; loginUrl: string }): Promise<MailResult> {
  const app = env.APP_NAME || "Gexart Sales";
  const first = o.to.name.split(/\s+/)[0] || o.to.name;
  const role = labelOf(ROLES, o.role);
  const html = shell({
    appName: app,
    preheader: `${o.invitedBy} added you to ${app}. Set your password to get started.`,
    heading: `Welcome aboard, ${first}`,
    bodyHtml:
      p(`${escapeHtml(o.invitedBy)} has created an account for you on <b>${escapeHtml(app)}</b> with the role <b>${escapeHtml(role)}</b>.`) +
      p(`Your sign-in email is <b>${escapeHtml(o.to.email)}</b>. Choose your own password using the button below, then sign in.`),
    cta: { label: "Set my password", url: o.setupUrl },
    footnote: `This link works once and expires in ${hours(WELCOME_TTL_HOURS)}. If it has expired, use "Forgot password" on the sign-in page.`,
  });
  const text = `Welcome to ${app}, ${first}\n\n${o.invitedBy} created an account for you (role: ${role}).\nSign-in email: ${o.to.email}\n\nSet your password (one-time link, expires in ${hours(WELCOME_TTL_HOURS)}):\n${o.setupUrl}\n\nThen sign in at ${o.loginUrl}`;
  return deliver(env, o.to, `Welcome to ${app}: set your password`, html, text, "welcome");
}

export async function sendResetEmail(env: Env, o: { to: { email: string; name: string }; resetUrl: string }): Promise<MailResult> {
  const app = env.APP_NAME || "Sales CRM";
  const first = o.to.name.split(/\s+/)[0] || o.to.name;
  const html = shell({
    appName: app,
    preheader: "Use this link to choose a new password.",
    heading: "Reset your password",
    bodyHtml:
      p(`Hi ${escapeHtml(first)}, we received a request to reset the password for your ${escapeHtml(app)} account.`) +
      p(`Choose a new password with the button below. For your security the link works once and expires in ${RESET_TTL_MINUTES} minutes.`),
    cta: { label: "Choose a new password", url: o.resetUrl },
    footnote: "If you did not ask for this, you can ignore this email. Your password will not change and nobody has access to your account.",
  });
  const text = `Hi ${first},\n\nWe received a request to reset your ${app} password.\nChoose a new one (one-time link, expires in ${RESET_TTL_MINUTES} minutes):\n${o.resetUrl}\n\nIf you did not ask for this, ignore this email; your password will not change.`;
  return deliver(env, o.to, `Reset your ${app} password`, html, text, "password-reset");
}

export { newId };
