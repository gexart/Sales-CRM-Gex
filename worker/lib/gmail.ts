// Gmail API for the cold-email mailbox: OAuth (offline access), send in-thread, read the inbox.
// Scopes: gmail.send + gmail.readonly. Nothing here can delete or modify mail.
import type { Env } from "../env";
import { ApiError } from "./http";
import { encryptSecret, decryptSecret } from "./settings";
import { now } from "./util";

export const GMAIL_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"];
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface Mailbox {
  id: string;
  email: string;
  from_name: string | null;
  refresh_token: string;
  daily_cap: number;
  warmup_started_on: string | null;
  status: string;
}

function client(env: Env) {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new ApiError(400, "not_configured", "Add the Google OAuth client ID and secret in Settings → Configuration → Cold email mailbox");
  }
  return { id: env.GOOGLE_OAUTH_CLIENT_ID, secret: env.GOOGLE_OAUTH_CLIENT_SECRET };
}

export function googleAuthUrl(env: Env, redirectUri: string, state: string, loginHint?: string) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", client(env).id);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  if (loginHint) u.searchParams.set("login_hint", loginHint);
  return u.toString();
}

/** Exchanges an authorisation code for tokens; returns the mailbox address and an encrypted refresh token. */
export async function exchangeGoogleCode(env: Env, code: string, redirectUri: string) {
  const c = client(env);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: c.id, client_secret: c.secret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const j = (await r.json().catch(() => ({}))) as { refresh_token?: string; access_token?: string; id_token?: string; scope?: string; error_description?: string; error?: string };
  if (!r.ok || !j.access_token) throw new ApiError(502, "provider_error", `Google sign-in failed: ${j.error_description ?? j.error ?? r.status}`);
  if (!j.refresh_token) throw new ApiError(400, "provider_error", "Google did not grant offline access. Remove the app's access in your Google account and connect again.");
  const granted = (j.scope ?? "").split(" ");
  for (const s of GMAIL_SCOPES.slice(2)) if (!granted.includes(s)) throw new ApiError(400, "provider_error", "Please allow both 'Send email' and 'Read email' on Google's consent screen.");
  const profile = await fetch(`${API}/profile`, { headers: { authorization: `Bearer ${j.access_token}` } }).then((x) => x.json() as Promise<{ emailAddress?: string }>);
  if (!profile.emailAddress) throw new ApiError(502, "provider_error", "Could not read the mailbox address from Gmail");
  return { email: profile.emailAddress.toLowerCase(), refreshToken: await encryptSecret(env, j.refresh_token) };
}

const tokenCache = new Map<string, { token: string; exp: number }>();

async function accessToken(env: Env, mb: Mailbox): Promise<string> {
  const hit = tokenCache.get(mb.id);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const c = client(env);
  const refresh = await decryptSecret(env, mb.refresh_token);
  if (!refresh) throw new ApiError(400, "not_configured", `Reconnect ${mb.email}: its stored token can no longer be read`);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: refresh, client_id: c.id, client_secret: c.secret, grant_type: "refresh_token" }),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!r.ok || !j.access_token) {
    const msg = j.error === "invalid_grant" ? `Google access for ${mb.email} was revoked or expired. Reconnect the mailbox.` : `Google token refresh failed (${j.error ?? r.status})`;
    await env.DB.prepare("UPDATE mailboxes SET status = 'error', last_error = ?, updated_at = ? WHERE id = ?").bind(msg, now(), mb.id).run();
    throw new ApiError(502, "provider_error", msg);
  }
  tokenCache.set(mb.id, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

async function gmail<T>(env: Env, mb: Mailbox, path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken(env, mb);
  const r = await fetch(`${API}${path}`, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!r.ok) throw new ApiError(502, "provider_error", `Gmail: ${j.error?.message ?? r.status}`);
  return j;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const utf8b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const header = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${utf8b64(s)}?=`);
const safe = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

/** Builds an RFC 5322 plain-text message. Exported for tests. */
export function buildMime(m: { from: string; fromName?: string | null; to: string; subject: string; text: string; inReplyTo?: string | null; unsubscribeTo: string }) {
  const from = m.fromName ? `${header(safe(m.fromName))} <${m.from}>` : m.from;
  const lines = [
    `From: ${from}`,
    `To: ${safe(m.to)}`,
    `Subject: ${header(safe(m.subject))}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    `List-Unsubscribe: <mailto:${m.unsubscribeTo}?subject=unsubscribe>`,
  ];
  if (m.inReplyTo) lines.push(`In-Reply-To: ${safe(m.inReplyTo)}`, `References: ${safe(m.inReplyTo)}`);
  const body = utf8b64(m.text.replace(/\r?\n/g, "\r\n")).replace(/.{76}/g, "$&\r\n");
  return `${lines.join("\r\n")}\r\n\r\n${body}`;
}

export async function gmailSend(env: Env, mb: Mailbox, m: { to: string; subject: string; text: string; threadId?: string | null; inReplyTo?: string | null }) {
  const raw = b64url(new TextEncoder().encode(buildMime({ from: mb.email, fromName: mb.from_name, to: m.to, subject: m.subject, text: m.text, inReplyTo: m.inReplyTo, unsubscribeTo: mb.email })));
  const sent = await gmail<{ id: string; threadId: string }>(env, mb, "/messages/send", { method: "POST", body: JSON.stringify({ raw, ...(m.threadId ? { threadId: m.threadId } : {}) }) });
  const meta = await gmail<{ payload?: { headers?: { name: string; value: string }[] } }>(env, mb, `/messages/${sent.id}?format=metadata&metadataHeaders=Message-Id`).catch(() => null);
  const rfc = meta?.payload?.headers?.find((h) => h.name.toLowerCase() === "message-id")?.value ?? null;
  return { id: sent.id, threadId: sent.threadId, rfcMessageId: rfc };
}

export interface InboundMail {
  id: string;
  threadId: string;
  from: string;
  fromName: string | null;
  subject: string;
  date: string;
  text: string;
  autoSubmitted: boolean;
}

interface Part { mimeType?: string; body?: { data?: string }; parts?: Part[] }
const decode = (d: string) => new TextDecoder().decode(Uint8Array.from(atob(d.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0)));
function plainText(p: Part): string | null {
  if (p.mimeType === "text/plain" && p.body?.data) return decode(p.body.data);
  for (const c of p.parts ?? []) {
    const t = plainText(c);
    if (t) return t;
  }
  if (p.mimeType === "text/html" && p.body?.data) return decode(p.body.data).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  return null;
}

/** Strips quoted history so only the new reply text remains. Exported for tests. */
export function newReplyText(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (/^On .+wrote:\s*$/i.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l.trim()) || /^From: .+/i.test(l.trim())) break;
    if (l.trim().startsWith(">")) continue;
    out.push(l);
  }
  return out.join("\n").trim().slice(0, 8000);
}

/** New inbox messages since `afterEpoch` (seconds), excluding mail we sent. */
export async function gmailInbox(env: Env, mb: Mailbox, afterEpoch: number): Promise<InboundMail[]> {
  const q = encodeURIComponent(`in:inbox after:${afterEpoch} -from:me`);
  const list = await gmail<{ messages?: { id: string; threadId: string }[] }>(env, mb, `/messages?q=${q}&maxResults=50`);
  const out: InboundMail[] = [];
  for (const m of list.messages ?? []) {
    const full = await gmail<{ id: string; threadId: string; internalDate: string; payload: Part & { headers?: { name: string; value: string }[] } }>(env, mb, `/messages/${m.id}?format=full`);
    const h = (n: string) => full.payload.headers?.find((x) => x.name.toLowerCase() === n)?.value ?? "";
    const fromRaw = h("from");
    const email = (fromRaw.match(/<([^>]+)>/)?.[1] ?? fromRaw).trim().toLowerCase();
    out.push({
      id: full.id,
      threadId: full.threadId,
      from: email,
      fromName: fromRaw.includes("<") ? fromRaw.split("<")[0].replace(/"/g, "").trim() || null : null,
      subject: h("subject"),
      date: new Date(Number(full.internalDate)).toISOString(),
      text: plainText(full.payload) ?? "",
      autoSubmitted: /auto-(replied|generated)/i.test(h("auto-submitted")) || !!h("x-autoreply") || /^(out of office|automatic reply|auto:)/i.test(h("subject")),
    });
  }
  return out;
}

export async function gmailProfile(env: Env, mb: Mailbox) {
  return gmail<{ emailAddress: string; messagesTotal: number }>(env, mb, "/profile");
}
