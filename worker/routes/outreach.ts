// Outreach Centre: template rendering, manual send confirmation, responses and sequences.
// Nothing in this module sends a message. Sending is always done by the user in their own
// mail app (manual workflow) and confirmed here, or later by an authenticated provider.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { enrollSchema, markSentSchema, recordReplySchema, renderSchema } from "../../shared/schemas";
import { CHANNEL_ACTIVITY, OUTREACH_CHANNELS, UNSENT_OUTREACH_STATUSES, labelOf } from "../../shared/enums";
import { PLACEHOLDERS, hasUnresolved, render, type TemplateContext } from "../../shared/templating";
import { ApiError, notFound, parseJson } from "../lib/http";
import { activityStmt, auditStmt } from "../lib/audit-log";
import { clientIp } from "../lib/auth";
import { fetchOne, loadRaw } from "../lib/entity";
import { b, newId, now } from "../lib/util";
import { ENTITIES } from "../entities";

type Row = Record<string, unknown>;
type Ctx = Context<AppEnv>;
export const outreachRoutes = new Hono<AppEnv>();

outreachRoutes.get("/outreach-placeholders", (c) => c.json({ data: Object.entries(PLACEHOLDERS).map(([key, label]) => ({ key, label })) }));

/** Builds the personalisation context from records the user is allowed to see. */
async function contextFor(c: Ctx, ids: { contact_id?: string | null; account_id?: string | null; prospect_id?: string | null; product_id?: string | null }) {
  const user = c.get("user");
  const ctx: TemplateContext = { sender_name: user.name, sender_email: user.email };
  let recipient: { name: string | null; email: string | null } = { name: null, email: null };
  let accountId = ids.account_id ?? null;
  if (ids.contact_id) {
    const ct = await fetchOne(c, ENTITIES.contacts, ids.contact_id);
    Object.assign(ctx, {
      contact_first_name: ct.first_name as string,
      contact_last_name: ct.last_name as string,
      contact_full_name: ct.full_name as string,
      contact_title: ct.job_title as string,
    });
    recipient = { name: ct.full_name as string, email: (ct.email as string) ?? null };
    accountId ??= (ct.account_id as string) ?? null;
  }
  if (accountId) {
    const a = await fetchOne(c, ENTITIES.accounts, accountId);
    Object.assign(ctx, { company_name: a.name as string, company_website: a.website as string, company_city: a.city as string, company_industry: a.industry as string });
  } else if (ids.prospect_id) {
    const p = await fetchOne(c, ENTITIES.prospects, ids.prospect_id);
    const [first, ...rest] = String(p.contact_name ?? "").split(" ").filter(Boolean);
    Object.assign(ctx, {
      company_name: p.company_name as string,
      company_website: p.website as string,
      company_city: p.geography as string,
      company_industry: p.industry as string,
      contact_first_name: ctx.contact_first_name ?? first,
      contact_last_name: ctx.contact_last_name ?? (rest.join(" ") || undefined),
      contact_full_name: ctx.contact_full_name ?? ((p.contact_name as string) || undefined),
      contact_title: ctx.contact_title ?? (p.contact_title as string),
    });
    if (!recipient.email) recipient = { name: (p.contact_name as string) ?? null, email: (p.email as string) ?? null };
  }
  if (ids.product_id) {
    const pr = await c.env.DB.prepare("SELECT name FROM products WHERE id = ?").bind(ids.product_id).first<{ name: string }>();
    if (pr) ctx.service_name = pr.name;
  }
  return { ctx, recipient };
}

outreachRoutes.post("/outreach/render", async (c) => {
  const input = await parseJson(c, renderSchema);
  let { subject, body } = input;
  let template: Row | null = null;
  if (input.template_id) {
    template = await c.env.DB.prepare("SELECT id, name, subject, body, product_id FROM email_templates WHERE id = ? AND archived_at IS NULL").bind(input.template_id).first<Row>();
    if (!template) throw notFound("Template");
    if (!subject) subject = String(template.subject);
    if (!body) body = String(template.body);
  }
  const { ctx, recipient } = await contextFor(c, { ...input, product_id: input.product_id ?? (template?.product_id as string) ?? null });
  return c.json({ data: { subject: render(subject, ctx), body: render(body, ctx), recipient, template } });
});

/** The user confirms they sent the message themselves. Never triggered automatically. */
outreachRoutes.post("/outreach/:id/mark-sent", async (c) => {
  const id = c.req.param("id");
  const m = await loadRaw(c, ENTITIES.outreach, id);
  const input = await parseJson(c, markSentSchema);
  if (!UNSENT_OUTREACH_STATUSES.includes(String(m.status))) throw new ApiError(409, "already_sent", "This message is not awaiting sending");
  if (m.channel === "brevo") throw new ApiError(400, "provider_channel", "Brevo messages are marked sent only by the provider");
  if (!m.body) throw new ApiError(400, "validation_error", "The message has no content");
  if (hasUnresolved(m.subject as string, m.body as string)) throw new ApiError(400, "unresolved_placeholders", "Resolve every {{placeholder}} before marking it sent");
  const user = c.get("user");
  const db = c.env.DB;
  const sentAt = input.sent_at ?? now();
  if (sentAt > new Date(Date.now() + 5 * 60_000).toISOString()) throw new ApiError(400, "validation_error", "The sent time cannot be in the future");
  const t = now();
  const channelLabel = labelOf(OUTREACH_CHANNELS, m.channel as string);
  // Each follow-on statement only applies if this request's UPDATE took effect (guard on updated_at = t),
  // so a concurrent second confirmation cannot log the send twice.
  const applied = `EXISTS (SELECT 1 FROM outreach_messages WHERE id = ? AND status = 'sent' AND updated_at = ?)`;
  const stmts = [
    // Idempotency key: a second confirmation of the same message violates the primary key,
    // which rolls back this entire batch (activity, contact update, follow-up task, audit row).
    db.prepare("INSERT INTO webhook_events (provider, event_id, received_at) VALUES ('manual_send', ?, ?)").bind(id, t),
    db.prepare(
      `UPDATE outreach_messages SET status = 'sent', sent_at = ?, sent_via_integration = 0, next_follow_up_at = COALESCE(?, next_follow_up_at), updated_at = ?
       WHERE id = ? AND status IN ('draft','ready_for_review','approved')`,
    ).bind(sentAt, b(input.next_follow_up_at), t, id),
    db.prepare(
      `INSERT INTO activities (id, type, subject, body, account_id, contact_id, prospect_id, campaign_id, actor_id, occurred_at, meta, created_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${applied}`,
    ).bind(
      newId(), CHANNEL_ACTIVITY[m.channel as string] ?? "note",
      m.subject ? `${channelLabel} sent: ${m.subject}`.slice(0, 200) : `${channelLabel}: ${m.title}`.slice(0, 200),
      b(m.body), b(m.account_id), b(m.contact_id), b(m.prospect_id), b(m.campaign_id), user.id, sentAt,
      JSON.stringify({ outreach_id: id, confirmed_by_user: true, via_integration: false }), t, id, t,
    ),
  ];
  if (m.contact_id) {
    stmts.push(
      db.prepare(
        `UPDATE contacts SET last_contacted_at = MAX(COALESCE(last_contacted_at, ''), ?),
           status = CASE WHEN status IN ('new','not_contacted') THEN 'contacted' ELSE status END, updated_at = ?
         WHERE id = ? AND ${applied}`,
      ).bind(sentAt, t, m.contact_id, id, t),
    );
  }
  const follow = input.next_follow_up_at;
  if (follow) {
    stmts.push(
      db.prepare(
        `INSERT INTO tasks (id, title, type, account_id, contact_id, prospect_id, due_at, priority, owner_id, status, description, created_by, created_at, updated_at)
         SELECT ?,?,?,?,?,?,?,'medium',?,'open',?,?,?,? WHERE ${applied}`,
      ).bind(
        newId(), `Follow up: ${m.title}`.slice(0, 200), m.channel === "phone" ? "follow_up_call" : "send_email", b(m.account_id), b(m.contact_id), b(m.prospect_id),
        follow, b(m.owner_id ?? user.id), `Follow-up to outreach sent ${sentAt.slice(0, 10)}.`, user.id, t, t, id, t,
      ),
    );
  }
  stmts.push(
    db.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, summary, ip, created_at) SELECT ?,?,'outreach_sent','outreach',?,?,?,? WHERE ${applied}`,
    ).bind(newId(), user.id, id, `Confirmed manual send: ${m.title}`.slice(0, 300), clientIp(c), t, id, t),
  );
  let res: D1Result[];
  try {
    res = await db.batch(stmts);
  } catch (e) {
    if (/UNIQUE constraint failed/i.test(String(e))) throw new ApiError(409, "already_sent", "This message was already marked as sent");
    throw e;
  }
  if (!res[1].meta.changes) throw new ApiError(409, "already_sent", "This message was already marked as sent");
  return c.json({ data: await fetchOne(c, ENTITIES.outreach, id) });
});

outreachRoutes.post("/outreach/:id/record-response", async (c) => {
  const id = c.req.param("id");
  const m = await loadRaw(c, ENTITIES.outreach, id);
  const input = await parseJson(c, recordReplySchema);
  if (!["sent", "delivered"].includes(String(m.status))) throw new ApiError(409, "not_sent", "Responses can only be recorded for sent messages");
  const user = c.get("user");
  const at = input.at ?? now();
  const t = now();
  const db = c.env.DB;
  const replied = input.outcome === "replied";
  const stmts = [
    db.prepare(`UPDATE outreach_messages SET status = ?, replied_at = ?, outcome = COALESCE(?, outcome), updated_at = ? WHERE id = ?`).bind(input.outcome, replied ? at : null, b(input.note), t, id),
    activityStmt(db, {
      type: replied ? (CHANNEL_ACTIVITY[m.channel as string] ?? "note") : "system",
      subject: replied ? `Reply received: ${m.subject ?? m.title}`.slice(0, 200) : `Bounced: ${m.subject ?? m.title}`.slice(0, 200),
      body: input.note ?? null,
      actorId: user.id,
      accountId: m.account_id as string,
      contactId: m.contact_id as string,
      prospectId: m.prospect_id as string,
      occurredAt: at,
      meta: { outreach_id: id, recorded_by_user: true },
    }),
    auditStmt(db, { actorId: user.id, action: `outreach_${input.outcome}`, entityType: "outreach", entityId: id, summary: `Recorded ${input.outcome}: ${m.title}`, ip: clientIp(c) }),
  ];
  if (replied && m.contact_id) {
    stmts.push(db.prepare(`UPDATE contacts SET status = 'responded', updated_at = ? WHERE id = ? AND status IN ('new','not_contacted','contacted','unresponsive')`).bind(t, m.contact_id));
  }
  await db.batch(stmts);
  return c.json({ data: await fetchOne(c, ENTITIES.outreach, id) });
});

// ─── Sequences ───
outreachRoutes.get("/sequences/:id/detail", async (c) => {
  const id = c.req.param("id");
  await fetchOne(c, ENTITIES.sequences, id);
  const db = c.env.DB;
  const [steps, enrollments] = await db.batch<Row>([
    db.prepare("SELECT s.*, t.name AS template_name FROM sequence_steps s LEFT JOIN email_templates t ON t.id = s.template_id WHERE s.sequence_id = ? ORDER BY s.position").bind(id),
    db.prepare(
      `SELECT e.*, (c.first_name || COALESCE(' ' || c.last_name,'')) AS contact_name, a.name AS account_name, u.name AS created_by_name,
         (SELECT COUNT(*) FROM tasks t WHERE t.sequence_enrollment_id = e.id) AS task_total,
         (SELECT COUNT(*) FROM tasks t WHERE t.sequence_enrollment_id = e.id AND t.status = 'completed') AS task_done
       FROM sequence_enrollments e JOIN contacts c ON c.id = e.contact_id LEFT JOIN accounts a ON a.id = e.account_id LEFT JOIN users u ON u.id = e.created_by
       WHERE e.sequence_id = ? ORDER BY e.created_at DESC LIMIT 200`,
    ).bind(id),
  ]);
  return c.json({ data: { steps: steps.results, enrollments: enrollments.results } });
});

/** 09:00 on a calendar date in the user's timezone, as UTC ISO. */
export function nineAmIn(date: string, tz: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 9, 0);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  );
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (asLocal - guess)).toISOString();
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

outreachRoutes.post("/sequences/:id/enroll", async (c) => {
  const id = c.req.param("id");
  const seq = await fetchOne(c, ENTITIES.sequences, id);
  if (seq.status !== "active" || seq.archived_at) throw new ApiError(400, "inactive", "This sequence is not active");
  const input = await parseJson(c, enrollSchema);
  const contact = await fetchOne(c, ENTITIES.contacts, input.contact_id);
  if (contact.status === "do_not_contact") throw new ApiError(400, "do_not_contact", "This contact is marked Do not contact");
  const db = c.env.DB;
  const active = await db.prepare("SELECT id FROM sequence_enrollments WHERE sequence_id = ? AND contact_id = ? AND status = 'active'").bind(id, input.contact_id).first();
  if (active) throw new ApiError(409, "already_enrolled", "This contact is already active in this sequence");
  const steps = (await db.prepare("SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY position").bind(id).all<Row>()).results;
  if (!steps.length) throw new ApiError(400, "no_steps", "This sequence has no steps");

  const user = c.get("user");
  const t = now();
  const enrollmentId = newId();
  const { ctx } = await contextFor(c, { contact_id: input.contact_id, product_id: input.product_id ?? null });
  const accountId = (contact.account_id as string) ?? null;
  const stmts: D1PreparedStatement[] = [
    db.prepare("INSERT INTO sequence_enrollments (id, sequence_id, contact_id, account_id, status, started_at, created_by, created_at) VALUES (?,?,?,?, 'active', ?,?,?)").bind(
      enrollmentId, id, input.contact_id, accountId, input.start_date, user.id, t,
    ),
  ];
  let drafts = 0;
  for (const s of steps) {
    const due = nineAmIn(addDays(input.start_date, Number(s.day_offset)), user.timezone);
    const label = labelOf(OUTREACH_CHANNELS, s.channel as string);
    stmts.push(
      db.prepare(
        `INSERT INTO tasks (id, title, description, type, account_id, contact_id, due_at, priority, owner_id, status, sequence_enrollment_id, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,'medium',?,'open',?,?,?,?)`,
      ).bind(
        newId(), `${seq.name} · step ${s.position}/${steps.length}: ${label} — ${contact.full_name}`.slice(0, 200),
        [s.note, s.template_id ? "A draft message is ready in Outreach. Review it, send it from your mail app, then mark it as sent." : null].filter(Boolean).join("\n") || null,
        s.task_type ?? "send_email", accountId, input.contact_id, due, user.id, enrollmentId, user.id, t, t,
      ),
    );
    if (s.template_id) {
      const tpl = await db.prepare("SELECT name, subject, body FROM email_templates WHERE id = ?").bind(s.template_id).first<Row>();
      if (tpl) {
        drafts++;
        stmts.push(
          db.prepare(
            `INSERT INTO outreach_messages (id, title, account_id, contact_id, channel, template_id, product_id, subject, body, owner_id, status, planned_send_at, sequence_enrollment_id, created_by, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?, 'draft', ?,?,?,?,?)`,
          ).bind(
            newId(), `${seq.name} · step ${s.position}: ${tpl.name}`.slice(0, 200), accountId, input.contact_id, s.channel, s.template_id, b(input.product_id),
            render(tpl.subject as string, ctx).text, render(tpl.body as string, ctx).text, user.id, due, enrollmentId, user.id, t, t,
          ),
        );
      }
    }
  }
  stmts.push(
    activityStmt(db, { type: "system", subject: `Enrolled in sequence "${seq.name}"`, body: `${steps.length} scheduled steps from ${input.start_date}; ${drafts} draft message(s) prepared. Nothing is sent automatically.`, actorId: user.id, contactId: input.contact_id, accountId }),
    auditStmt(db, { actorId: user.id, action: "sequence_enroll", entityType: "contact", entityId: input.contact_id, summary: `Enrolled in ${seq.name}`, ip: clientIp(c) }),
  );
  await db.batch(stmts);
  return c.json({ data: { enrollment_id: enrollmentId, tasks: steps.length, drafts } }, 201);
});

outreachRoutes.post("/sequence-enrollments/:id/stop", async (c) => {
  const id = c.req.param("id");
  const e = await c.env.DB.prepare("SELECT * FROM sequence_enrollments WHERE id = ?").bind(id).first<Row>();
  if (!e) throw notFound("Enrollment");
  await fetchOne(c, ENTITIES.contacts, String(e.contact_id));
  if (e.status !== "active") throw new ApiError(409, "not_active", "This enrollment is not active");
  const user = c.get("user");
  const t = now();
  const db = c.env.DB;
  await db.batch([
    db.prepare("UPDATE sequence_enrollments SET status = 'stopped', stopped_at = ? WHERE id = ?").bind(t, id),
    db.prepare("UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE sequence_enrollment_id = ? AND status IN ('open','in_progress')").bind(t, id),
    db.prepare("UPDATE outreach_messages SET status = 'cancelled', updated_at = ? WHERE sequence_enrollment_id = ? AND status IN ('draft','ready_for_review','approved')").bind(t, id),
    activityStmt(db, { type: "system", subject: "Removed from sequence", body: "Remaining tasks and unsent drafts were cancelled.", actorId: user.id, contactId: e.contact_id as string, accountId: e.account_id as string }),
    auditStmt(db, { actorId: user.id, action: "sequence_stop", entityType: "contact", entityId: e.contact_id as string, summary: "Stopped sequence enrollment", ip: clientIp(c) }),
  ]);
  return c.json({ data: { ok: true } });
});

outreachRoutes.get("/contacts/:id/enrollments", async (c) => {
  const id = c.req.param("id");
  await fetchOne(c, ENTITIES.contacts, id);
  const r = await c.env.DB.prepare(
    `SELECT e.*, s.name AS sequence_name,
       (SELECT COUNT(*) FROM tasks t WHERE t.sequence_enrollment_id = e.id) AS task_total,
       (SELECT COUNT(*) FROM tasks t WHERE t.sequence_enrollment_id = e.id AND t.status = 'completed') AS task_done
     FROM sequence_enrollments e JOIN outreach_sequences s ON s.id = e.sequence_id WHERE e.contact_id = ? ORDER BY e.created_at DESC`,
  )
    .bind(id)
    .all();
  return c.json({ data: r.results });
});
