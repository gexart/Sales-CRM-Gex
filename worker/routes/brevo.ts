// Brevo transactional sending (only for approved messages, only after the key is
// validated) and the delivery webhook (token-authenticated, idempotent).
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { hasUnresolved, textToHtml } from "../../shared/templating";
import { ApiError, parseJson } from "../lib/http";
import { activityStmt, auditStmt } from "../lib/audit-log";
import { clientIp } from "../lib/auth";
import { fetchOne, loadRaw } from "../lib/entity";
import { brevoSend, recordProviderResult } from "../lib/providers";
import { now, sha256Hex } from "../lib/util";
import { ENTITIES } from "../entities";
import { notifyStmt } from "../audits/run";

type Row = Record<string, unknown>;
export const brevoRoutes = new Hono<AppEnv>();

async function brevoReady(env: AppEnv["Bindings"]) {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) return false;
  const s = await env.DB.prepare("SELECT last_success_at, last_error_at FROM integrations WHERE provider = 'brevo'").first<Row>();
  return !!s?.last_success_at && (!s.last_error_at || String(s.last_success_at) > String(s.last_error_at));
}

brevoRoutes.post("/outreach/:id/send-brevo", async (c) => {
  const id = c.req.param("id");
  const m = await loadRaw(c, ENTITIES.outreach, id);
  await parseJson(c, z.object({ confirm: z.literal(true, { message: "Confirm the send" }) }));
  if (!(await brevoReady(c.env))) throw new ApiError(400, "not_configured", "Brevo is not connected. An admin must add the API key and sender, then validate it in Settings → Integrations.");
  if (!["approved", "failed"].includes(String(m.status))) throw new ApiError(409, "not_approved", "Only approved messages can be sent through Brevo");
  if (!["manual_email", "brevo"].includes(String(m.channel))) throw new ApiError(400, "wrong_channel", "Only email messages can be sent through Brevo");
  if (!m.subject || !m.body) throw new ApiError(400, "validation_error", "Subject and body are required");
  if (hasUnresolved(m.subject as string, m.body as string)) throw new ApiError(400, "unresolved_placeholders", "Resolve every {{placeholder}} before sending");
  if (!m.contact_id) throw new ApiError(400, "no_recipient", "Choose a contact recipient");
  const contact = await fetchOne(c, ENTITIES.contacts, String(m.contact_id));
  if (!contact.email) throw new ApiError(400, "no_email", "The contact has no email address");
  if (contact.status === "do_not_contact") throw new ApiError(400, "do_not_contact", "This contact is marked Do not contact");
  const db = c.env.DB;
  const user = c.get("user");
  // Idempotency: a second click (or a retried request) cannot send twice.
  try {
    await db.prepare("INSERT INTO webhook_events (provider, event_id, received_at) VALUES ('brevo_send', ?, ?)").bind(`${id}:${m.updated_at}`, now()).run();
  } catch {
    throw new ApiError(409, "already_sending", "This message is already being sent");
  }
  let messageId: string;
  try {
    const res = await brevoSend(c.env, {
      to: { email: String(contact.email), name: String(contact.full_name ?? "") || undefined },
      subject: String(m.subject),
      text: String(m.body),
      html: textToHtml(String(m.body)),
      tags: ["gexart-crm"],
    });
    messageId = res.messageId;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Send failed";
    await db.batch([
      db.prepare("UPDATE outreach_messages SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?").bind(msg.slice(0, 500), now(), id),
      auditStmt(db, { actorId: user.id, action: "outreach_send_failed", entityType: "outreach", entityId: id, summary: msg.slice(0, 300), ip: clientIp(c) }),
    ]);
    await recordProviderResult(c.env, "brevo", msg);
    throw e;
  }
  const t = now();
  await db.batch([
    db.prepare("UPDATE outreach_messages SET status = 'sent', channel = 'brevo', sent_via_integration = 1, provider_message_id = ?, sent_at = ?, last_error = NULL, updated_at = ? WHERE id = ?").bind(messageId, t, t, id),
    activityStmt(db, { type: "email", subject: `Email sent via Brevo: ${m.subject}`.slice(0, 200), body: String(m.body), actorId: user.id, accountId: m.account_id as string, contactId: m.contact_id as string, prospectId: m.prospect_id as string, campaignId: m.campaign_id as string, meta: { outreach_id: id, provider: "brevo", provider_message_id: messageId } }),
    db.prepare("UPDATE contacts SET last_contacted_at = ?, status = CASE WHEN status IN ('new','not_contacted') THEN 'contacted' ELSE status END, updated_at = ? WHERE id = ?").bind(t, t, m.contact_id),
    auditStmt(db, { actorId: user.id, action: "outreach_sent", entityType: "outreach", entityId: id, summary: `Sent via Brevo (${messageId})`, ip: clientIp(c) }),
  ]);
  await recordProviderResult(c.env, "brevo", null);
  return c.json({ data: await fetchOne(c, ENTITIES.outreach, id) });
});

// ─── Webhook (no session; authenticated by a shared secret in the URL) ───
export const webhookRoutes = new Hono<AppEnv>();

async function safeEqual(a: string, b2: string) {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b2)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

const BOUNCE = ["hard_bounce", "invalid_email", "blocked", "error"];

webhookRoutes.post("/brevo", async (c) => {
  const secret = c.env.BREVO_WEBHOOK_SECRET;
  if (!secret || !(await safeEqual(c.req.query("token") ?? "", secret))) throw new ApiError(401, "unauthenticated", "Invalid webhook token");
  const body = await c.req.json().catch(() => null);
  const events = (Array.isArray(body) ? body : [body]).filter((e) => e && typeof e === "object") as Row[];
  const db = c.env.DB;
  let processed = 0;
  for (const ev of events.slice(0, 100)) {
    const msgId = String(ev["message-id"] ?? ev.messageId ?? "");
    const event = String(ev.event ?? "");
    if (!msgId || !event) continue;
    const key = `${msgId}|${event}|${ev.ts_event ?? ev.ts ?? ev.date ?? ""}`;
    const fresh = await db.prepare("INSERT OR IGNORE INTO webhook_events (provider, event_id, received_at) VALUES ('brevo', ?, ?)").bind(key.slice(0, 300), now()).run();
    if (!fresh.meta.changes) continue; // duplicate delivery
    const m = await db.prepare("SELECT * FROM outreach_messages WHERE provider_message_id = ?").bind(msgId).first<Row>();
    if (!m) continue;
    const t = now();
    if (event === "delivered") {
      await db.prepare("UPDATE outreach_messages SET status = CASE WHEN status = 'sent' THEN 'delivered' ELSE status END, delivered_at = ?, updated_at = ? WHERE id = ?").bind(t, t, m.id).run();
    } else if (BOUNCE.includes(event)) {
      await db.batch([
        db.prepare("UPDATE outreach_messages SET status = CASE WHEN status IN ('sent','delivered') THEN 'bounced' ELSE status END, last_error = ?, updated_at = ? WHERE id = ?").bind(`${event}: ${ev.reason ?? ""}`.slice(0, 500), t, m.id),
        activityStmt(db, { type: "system", subject: `Email bounced (${event.replace("_", " ")})`, body: (ev.reason as string) ?? null, actorId: null, accountId: m.account_id as string, contactId: m.contact_id as string, meta: { outreach_id: m.id, provider: "brevo" } }),
        ...(m.owner_id ? [notifyStmt(db, String(m.owner_id), `bounce:${m.id}`, `Email bounced: ${m.title}`, String(ev.reason ?? event), "outreach", String(m.id))] : []),
      ]);
    } else if (event === "soft_bounce" || event === "deferred") {
      await db.prepare("UPDATE outreach_messages SET last_error = ?, updated_at = ? WHERE id = ?").bind(`${event}: ${ev.reason ?? ""}`.slice(0, 500), t, m.id).run();
    } else if (event === "unsubscribed" || event === "spam") {
      await db.batch([
        ...(m.contact_id ? [db.prepare("UPDATE contacts SET status = 'do_not_contact', updated_at = ? WHERE id = ?").bind(t, m.contact_id)] : []),
        activityStmt(db, { type: "system", subject: event === "spam" ? "Recipient marked the email as spam: set to Do not contact" : "Recipient unsubscribed: set to Do not contact", actorId: null, accountId: m.account_id as string, contactId: m.contact_id as string, meta: { outreach_id: m.id } }),
      ]);
    }
    processed++;
  }
  return c.json({ data: { processed } });
});

