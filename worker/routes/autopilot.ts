// Autopilot API: playbooks, the approval outbox, replies, mailboxes (Google OAuth), do-not-contact,
// and the revenue cockpit. Managers and admins run it; everyone sees the cockpit.
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { ApiError, notFound, parseJson } from "../lib/http";
import { activityStmt, auditStmt } from "../lib/audit-log";
import { clientIp, requireRole } from "../lib/auth";
import { decryptSecret, signToken, verifyToken } from "../lib/settings";
import { exchangeGoogleCode, googleAuthUrl, gmailProfile, type Mailbox } from "../lib/gmail";
import { b, newId, now } from "../lib/util";
import { enqueue } from "../jobs";
import { addDncStmt, sendMessage } from "../autopilot/engine";
import { dncMatch } from "../autopilot/rules";

type Row = Record<string, unknown>;
export const autopilotRoutes = new Hono<AppEnv>();
const manage = requireRole("admin", "manager");

const redirectUri = (url: string) => `${new URL(url).origin}/api/v1/mailboxes/google/callback`;

// ─── Overview & setup checklist ───
autopilotRoutes.get("/autopilot/overview", manage, async (c) => {
  const [pbs, boxes, stages] = await c.env.DB.batch<Row>([
    c.env.DB.prepare("SELECT p.*, m.email AS mailbox_email, u.name AS owner_name FROM autopilot_playbooks p LEFT JOIN mailboxes m ON m.id = p.mailbox_id LEFT JOIN users u ON u.id = p.owner_id ORDER BY p.created_at DESC"),
    c.env.DB.prepare("SELECT id, email, from_name, daily_cap, warmup_started_on, status, last_error, last_inbox_check_at, created_at FROM mailboxes ORDER BY created_at"),
    c.env.DB.prepare("SELECT playbook_id, stage, COUNT(*) AS n FROM autopilot_leads GROUP BY playbook_id, stage"),
  ]);
  const sentToday = await c.env.DB.prepare("SELECT from_email, COUNT(*) AS n FROM autopilot_messages WHERE direction = 'out' AND status = 'sent' AND sent_at >= ? GROUP BY from_email").bind(new Date(Date.now() - 86_400_000).toISOString()).all<Row>();
  const env = c.env;
  return c.json({
    data: {
      playbooks: pbs.results.map((p) => ({ ...p, stages: Object.fromEntries(stages.results.filter((s) => s.playbook_id === p.id).map((s) => [s.stage, s.n])) })),
      mailboxes: boxes.results.map((m) => ({ ...m, sent_today: sentToday.results.find((s) => s.from_email === m.email)?.n ?? 0 })),
      redirect_uri: redirectUri(c.req.url),
      checks: {
        google_client: !!(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET),
        mailbox: boxes.results.some((m) => m.status === "active"),
        postal_address: !!env.COMPANY_POSTAL_ADDRESS,
        claude: !!env.ANTHROPIC_API_KEY,
        places: !!env.GOOGLE_PLACES_API_KEY,
      },
    },
  });
});

// ─── Playbooks ───
const windowSchema = z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/), days: z.array(z.number().int().min(0).max(6)).min(1), tz: z.string().min(1).max(60) });
const playbookSchema = z.object({
  name: z.string().trim().min(1).max(120),
  searches: z.array(z.object({ query: z.string().trim().min(2).max(120), location: z.string().trim().max(120).optional().default("") })).max(20).default([]),
  use_existing: z.boolean().default(false),
  service_fit: z.string().trim().max(120).nullable().optional(),
  offer: z.string().trim().min(20, "Describe the offer in a sentence or two").max(1200),
  entry_offer: z.string().trim().max(200).nullable().optional(),
  booking_url: z.string().trim().url().max(500).nullable().optional().or(z.literal("").transform(() => null)),
  signature: z.string().trim().max(500).nullable().optional(),
  min_score: z.number().int().min(0).max(100).default(35),
  daily_new_leads: z.number().int().min(1).max(100).default(15),
  follow_up_days: z.array(z.number().int().min(1).max(30)).length(2).default([3, 5]),
  require_approval: z.boolean().default(true),
  send_window: windowSchema.default({ start: "10:00", end: "18:00", days: [1, 2, 3, 4, 5, 6], tz: "Asia/Kolkata" }),
  mailbox_id: z.string().nullable().optional(),
  owner_id: z.string().nullable().optional(),
  campaign_id: z.string().nullable().optional(),
});

function pbValues(i: z.infer<typeof playbookSchema>) {
  return [i.name, JSON.stringify(i.searches), i.use_existing ? 1 : 0, b(i.service_fit), i.offer, b(i.entry_offer), b(i.booking_url), b(i.signature), i.min_score, i.daily_new_leads, JSON.stringify(i.follow_up_days), i.require_approval ? 1 : 0, JSON.stringify(i.send_window), b(i.mailbox_id), b(i.owner_id), b(i.campaign_id)];
}

autopilotRoutes.post("/autopilot/playbooks", manage, async (c) => {
  const i = await parseJson(c, playbookSchema);
  const u = c.get("user");
  const id = newId();
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO autopilot_playbooks (name, searches, use_existing, service_fit, offer, entry_offer, booking_url, signature, min_score, daily_new_leads, follow_up_days, require_approval, send_window, mailbox_id, owner_id, campaign_id, id, status, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'paused',?,?,?)`,
    ).bind(...pbValues({ ...i, owner_id: i.owner_id ?? u.id }), id, u.id, t, t),
    auditStmt(c.env.DB, { actorId: u.id, action: "create", entityType: "autopilot_playbook", entityId: id, summary: `Created autopilot "${i.name}"`, ip: clientIp(c) }),
  ]);
  return c.json({ data: { id } }, 201);
});

autopilotRoutes.put("/autopilot/playbooks/:id", manage, async (c) => {
  const i = await parseJson(c, playbookSchema);
  const r = await c.env.DB.prepare(
    `UPDATE autopilot_playbooks SET name=?, searches=?, use_existing=?, service_fit=?, offer=?, entry_offer=?, booking_url=?, signature=?, min_score=?, daily_new_leads=?, follow_up_days=?, require_approval=?, send_window=?, mailbox_id=?, owner_id=?, campaign_id=?, updated_at=? WHERE id = ?`,
  ).bind(...pbValues(i), now(), c.req.param("id")).run();
  if (!r.meta.changes) throw notFound("Playbook");
  return c.json({ data: { ok: true } });
});

autopilotRoutes.post("/autopilot/playbooks/:id/status", manage, async (c) => {
  const { status } = await parseJson(c, z.object({ status: z.enum(["active", "paused"]) }));
  const pb = await c.env.DB.prepare("SELECT * FROM autopilot_playbooks WHERE id = ?").bind(c.req.param("id")).first<Row>();
  if (!pb) throw notFound("Playbook");
  if (status === "active") {
    if (!c.env.COMPANY_POSTAL_ADDRESS) throw new ApiError(400, "not_configured", "Add your business postal address in Settings → Configuration first. It goes under every cold email.");
    if (!pb.mailbox_id) throw new ApiError(400, "validation_error", "Choose a sending mailbox for this playbook first");
  }
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE autopilot_playbooks SET status = ?, paused_reason = NULL, updated_at = ? WHERE id = ?").bind(status, now(), pb.id),
    auditStmt(c.env.DB, { actorId: c.get("user").id, action: status === "active" ? "autopilot_start" : "autopilot_pause", entityType: "autopilot_playbook", entityId: String(pb.id), summary: `${status === "active" ? "Started" : "Paused"} autopilot "${pb.name}"`, ip: clientIp(c) }),
  ]);
  if (status === "active") await enqueue(c.env, c.executionCtx, { kind: "autopilot", playbookId: String(pb.id) });
  return c.json({ data: { ok: true } });
});

autopilotRoutes.post("/autopilot/playbooks/:id/run", manage, async (c) => {
  const pb = await c.env.DB.prepare("SELECT id FROM autopilot_playbooks WHERE id = ?").bind(c.req.param("id")).first<Row>();
  if (!pb) throw notFound("Playbook");
  await enqueue(c.env, c.executionCtx, { kind: "autopilot", playbookId: String(pb.id) });
  return c.json({ data: { started: true } });
});

autopilotRoutes.post("/autopilot/playbooks/:id/enrol", manage, async (c) => {
  const { prospect_ids } = await parseJson(c, z.object({ prospect_ids: z.array(z.string()).min(1).max(500) }));
  const pb = await c.env.DB.prepare("SELECT id FROM autopilot_playbooks WHERE id = ?").bind(c.req.param("id")).first<Row>();
  if (!pb) throw notFound("Playbook");
  const t = now();
  const res = await c.env.DB.batch(prospect_ids.map((p) => c.env.DB.prepare("INSERT OR IGNORE INTO autopilot_leads (id, playbook_id, prospect_id, stage, created_at, updated_at) SELECT ?,?,id,'found',?,? FROM prospects WHERE id = ? AND archived_at IS NULL").bind(newId(), pb.id, t, t, p)));
  return c.json({ data: { enrolled: res.reduce((n, r) => n + (r.meta.changes ?? 0), 0) } });
});

// ─── Leads & outbox ───
const LEAD_SELECT = `SELECT l.*, p.company_name, p.website, p.industry, p.geography, p.qualification_score, pb.name AS playbook_name
  FROM autopilot_leads l JOIN prospects p ON p.id = l.prospect_id JOIN autopilot_playbooks pb ON pb.id = l.playbook_id`;

autopilotRoutes.get("/autopilot/leads", manage, async (c) => {
  const q = c.req.query();
  const where: string[] = ["1=1"];
  const params: unknown[] = [];
  if (q.playbook_id) (where.push("l.playbook_id = ?"), params.push(q.playbook_id));
  if (q.stage) (where.push(`l.stage IN (${q.stage.split(",").map(() => "?").join(",")})`), params.push(...q.stage.split(",")));
  if (q.q) (where.push("(p.company_name LIKE ? OR l.email LIKE ?)"), params.push(`%${q.q}%`, `%${q.q}%`));
  const rows = await c.env.DB.prepare(`${LEAD_SELECT} WHERE ${where.join(" AND ")} ORDER BY l.updated_at DESC LIMIT 200`).bind(...params).all<Row>();
  return c.json({ data: rows.results });
});

autopilotRoutes.get("/autopilot/leads/:id", manage, async (c) => {
  const lead = await c.env.DB.prepare(`${LEAD_SELECT} WHERE l.id = ?`).bind(c.req.param("id")).first<Row>();
  if (!lead) throw notFound("Lead");
  const msgs = await c.env.DB.prepare("SELECT * FROM autopilot_messages WHERE lead_id = ? ORDER BY COALESCE(sent_at, received_at, created_at), step").bind(lead.id).all<Row>();
  return c.json({ data: { ...lead, research: lead.research ? JSON.parse(String(lead.research)) : null, messages: msgs.results, footer_address: c.env.COMPANY_POSTAL_ADDRESS ?? null } });
});

autopilotRoutes.get("/autopilot/outbox", manage, async (c) => {
  const leads = await c.env.DB.prepare(`${LEAD_SELECT} WHERE l.stage = 'drafted' ORDER BY p.qualification_score DESC, l.updated_at LIMIT 100`).all<Row>();
  const ids = leads.results.map((l) => l.id);
  const msgs = ids.length
    ? await c.env.DB.prepare(`SELECT * FROM autopilot_messages WHERE lead_id IN (${ids.map(() => "?").join(",")}) AND status = 'pending_approval' ORDER BY step`).bind(...ids).all<Row>()
    : { results: [] as Row[] };
  const replies = await c.env.DB.prepare(
    `SELECT m.*, p.company_name, l.prospect_id, (SELECT body FROM autopilot_messages i WHERE i.lead_id = m.lead_id AND i.direction = 'in' ORDER BY i.received_at DESC LIMIT 1) AS their_reply,
            (SELECT classification FROM autopilot_messages i WHERE i.lead_id = m.lead_id AND i.direction = 'in' ORDER BY i.received_at DESC LIMIT 1) AS their_class
     FROM autopilot_messages m JOIN autopilot_leads l ON l.id = m.lead_id JOIN prospects p ON p.id = l.prospect_id WHERE m.kind = 'reply' AND m.direction = 'out' AND m.status = 'pending_approval' ORDER BY m.created_at DESC`,
  ).all<Row>();
  return c.json({
    data: {
      sequences: leads.results.map((l) => ({ ...l, research: l.research ? JSON.parse(String(l.research)) : null, messages: msgs.results.filter((m) => m.lead_id === l.id) })),
      replies: replies.results,
      footer_address: c.env.COMPANY_POSTAL_ADDRESS ?? null,
    },
  });
});

const editSchema = z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(6000) });

autopilotRoutes.patch("/autopilot/messages/:id", manage, async (c) => {
  const i = await parseJson(c, editSchema);
  const r = await c.env.DB.prepare("UPDATE autopilot_messages SET subject = ?, body = ?, generator = CASE WHEN generator = 'human' THEN 'human' ELSE generator || '+edited' END, updated_at = ? WHERE id = ? AND status = 'pending_approval'")
    .bind(i.subject, i.body, now(), c.req.param("id"))
    .run();
  if (!r.meta.changes) throw new ApiError(409, "conflict", "Only drafts waiting for approval can be edited");
  return c.json({ data: { ok: true } });
});

autopilotRoutes.post("/autopilot/leads/approve", manage, async (c) => {
  const { ids } = await parseJson(c, z.object({ ids: z.array(z.string()).min(1).max(200) }));
  const u = c.get("user");
  const t = now();
  const dnc = (await c.env.DB.prepare("SELECT value FROM do_not_contact").all<{ value: string }>()).results.map((r) => r.value);
  const leads = await c.env.DB.prepare(`SELECT id, email FROM autopilot_leads WHERE stage = 'drafted' AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all<{ id: string; email: string }>();
  const stmts: D1PreparedStatement[] = [];
  let blocked = 0;
  for (const l of leads.results) {
    if (dncMatch(l.email, dnc)) {
      blocked++;
      stmts.push(c.env.DB.prepare("UPDATE autopilot_leads SET stage = 'opted_out', skip_reason = 'On do-not-contact list', updated_at = ? WHERE id = ?").bind(t, l.id));
      continue;
    }
    stmts.push(
      c.env.DB.prepare("UPDATE autopilot_messages SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE lead_id = ? AND status = 'pending_approval' AND kind != 'reply'").bind(u.id, t, t, l.id),
      c.env.DB.prepare("UPDATE autopilot_leads SET stage = 'approved', updated_at = ? WHERE id = ?").bind(t, l.id),
    );
  }
  if (stmts.length) {
    stmts.push(auditStmt(c.env.DB, { actorId: u.id, action: "autopilot_approve", entityType: "autopilot_lead", entityId: null, summary: `Approved ${leads.results.length - blocked} sequence(s) for sending`, ip: clientIp(c) }));
    await c.env.DB.batch(stmts);
  }
  return c.json({ data: { approved: leads.results.length - blocked, blocked } });
});

autopilotRoutes.post("/autopilot/leads/:id/reject", manage, async (c) => {
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE autopilot_messages SET status = 'rejected', updated_at = ? WHERE lead_id = ? AND status IN ('pending_approval','approved')").bind(t, c.req.param("id")),
    c.env.DB.prepare("UPDATE autopilot_leads SET stage = 'skipped', skip_reason = 'Rejected in outbox', updated_at = ? WHERE id = ?").bind(t, c.req.param("id")),
  ]);
  return c.json({ data: { ok: true } });
});

autopilotRoutes.post("/autopilot/leads/:id/stage", manage, async (c) => {
  const { stage } = await parseJson(c, z.object({ stage: z.enum(["meeting", "won", "lost", "interested"]) }));
  const lead = await c.env.DB.prepare("SELECT l.*, p.company_name FROM autopilot_leads l JOIN prospects p ON p.id = l.prospect_id WHERE l.id = ?").bind(c.req.param("id")).first<Row>();
  if (!lead) throw notFound("Lead");
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE autopilot_leads SET stage = ?, updated_at = ? WHERE id = ?").bind(stage, t, lead.id),
    activityStmt(c.env.DB, { type: "system", subject: `Autopilot: ${lead.company_name} marked ${stage}`, actorId: c.get("user").id, prospectId: String(lead.prospect_id) }),
  ]);
  return c.json({ data: { ok: true } });
});

/** Approve and send a drafted reply now (human-reviewed, so no send window). */
autopilotRoutes.post("/autopilot/messages/:id/send", manage, async (c) => {
  const i = await parseJson(c, editSchema);
  const msg = await c.env.DB.prepare("SELECT m.*, l.email, l.thread_id, l.prospect_id, l.playbook_id FROM autopilot_messages m JOIN autopilot_leads l ON l.id = m.lead_id WHERE m.id = ? AND m.status = 'pending_approval' AND m.kind = 'reply'").bind(c.req.param("id")).first<Row>();
  if (!msg) throw notFound("Draft reply");
  const mb = await c.env.DB.prepare("SELECT * FROM mailboxes WHERE email = ? OR id = (SELECT mailbox_id FROM autopilot_playbooks WHERE id = ?) LIMIT 1").bind(msg.from_email ?? "", msg.playbook_id).first<Mailbox>();
  if (!mb) throw new ApiError(400, "not_configured", "The mailbox for this conversation is no longer connected");
  const u = c.get("user");
  await c.env.DB.prepare("UPDATE autopilot_messages SET subject = ?, body = ?, approved_by = ?, approved_at = ?, status = 'approved', updated_at = ? WHERE id = ?").bind(i.subject, i.body, u.id, now(), now(), msg.id).run();
  const out = await sendMessage(c.env, mb, { ...msg, subject: i.subject, body: i.body, approved_by: u.id }, { ...msg, id: msg.lead_id }, null);
  if (!out.ok) throw new ApiError(502, "provider_error", out.error);
  return c.json({ data: { ok: true } });
});

autopilotRoutes.post("/autopilot/messages/:id/discard", manage, async (c) => {
  await c.env.DB.prepare("UPDATE autopilot_messages SET status = 'rejected', updated_at = ? WHERE id = ? AND status = 'pending_approval'").bind(now(), c.req.param("id")).run();
  return c.json({ data: { ok: true } });
});

autopilotRoutes.get("/autopilot/inbox", manage, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT m.*, p.company_name, l.prospect_id, l.stage AS lead_stage FROM autopilot_messages m JOIN autopilot_leads l ON l.id = m.lead_id JOIN prospects p ON p.id = l.prospect_id
     WHERE m.direction = 'in' ORDER BY m.received_at DESC LIMIT 100`,
  ).all<Row>();
  return c.json({ data: rows.results });
});

// ─── Mailboxes (Google OAuth) ───
autopilotRoutes.get("/mailboxes/google/start", requireRole("admin"), async (c) => {
  const u = c.get("user");
  const exp = Math.floor(Date.now() / 1000) + 600;
  const state = `${u.id}.${exp}.${await signToken(c.env, `oauth:${u.id}:${exp}`)}`;
  return c.json({ data: { url: googleAuthUrl(c.env, redirectUri(c.req.url), state, c.req.query("hint") || undefined) } });
});

autopilotRoutes.get("/mailboxes/google/callback", requireRole("admin"), async (c) => {
  const back = (q: string) => c.redirect(`/autopilot?tab=setup&${q}`, 302);
  const err = c.req.query("error");
  if (err) return back(`mailbox_error=${encodeURIComponent(err === "access_denied" ? "Access was not granted" : err)}`);
  const [uid, exp, sig] = (c.req.query("state") ?? "").split(".");
  const u = c.get("user");
  if (uid !== u.id || Number(exp) < Date.now() / 1000 || !(await verifyToken(c.env, `oauth:${uid}:${exp}`, sig ?? ""))) return back("mailbox_error=The%20sign-in%20link%20expired.%20Try%20again.");
  try {
    const { email, refreshToken } = await exchangeGoogleCode(c.env, c.req.query("code") ?? "", redirectUri(c.req.url));
    const t = now();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO mailboxes (id, provider, email, refresh_token, daily_cap, warmup_started_on, status, connected_by, created_at, updated_at) VALUES (?,?,?,?,30,?,'active',?,?,?)
         ON CONFLICT(email) DO UPDATE SET refresh_token = excluded.refresh_token, status = 'active', last_error = NULL, updated_at = excluded.updated_at`,
      ).bind(newId(), "google", email, refreshToken, t.slice(0, 10), u.id, t, t),
      auditStmt(c.env.DB, { actorId: u.id, action: "mailbox_connect", entityType: "mailbox", entityId: email, summary: `Connected cold-email mailbox ${email}`, ip: clientIp(c) }),
    ]);
    return back(`mailbox=${encodeURIComponent(email)}`);
  } catch (e) {
    return back(`mailbox_error=${encodeURIComponent(e instanceof Error ? e.message : "Connection failed")}`);
  }
});

autopilotRoutes.patch("/mailboxes/:id", requireRole("admin"), async (c) => {
  const i = await parseJson(c, z.object({ from_name: z.string().trim().max(80).nullable(), daily_cap: z.number().int().min(1).max(200), warmup_started_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), status: z.enum(["active", "paused"]) }));
  const r = await c.env.DB.prepare("UPDATE mailboxes SET from_name = ?, daily_cap = ?, warmup_started_on = ?, status = ?, updated_at = ? WHERE id = ?").bind(b(i.from_name), i.daily_cap, b(i.warmup_started_on), i.status, now(), c.req.param("id")).run();
  if (!r.meta.changes) throw notFound("Mailbox");
  return c.json({ data: { ok: true } });
});

autopilotRoutes.post("/mailboxes/:id/test", requireRole("admin"), async (c) => {
  const mb = await c.env.DB.prepare("SELECT * FROM mailboxes WHERE id = ?").bind(c.req.param("id")).first<Mailbox>();
  if (!mb) throw notFound("Mailbox");
  const p = await gmailProfile(c.env, mb);
  await c.env.DB.prepare("UPDATE mailboxes SET status = CASE WHEN status = 'error' THEN 'active' ELSE status END, last_error = NULL, updated_at = ? WHERE id = ?").bind(now(), mb.id).run();
  return c.json({ data: { ok: true, email: p.emailAddress } });
});

autopilotRoutes.delete("/mailboxes/:id", requireRole("admin"), async (c) => {
  const mb = await c.env.DB.prepare("SELECT * FROM mailboxes WHERE id = ?").bind(c.req.param("id")).first<Mailbox>();
  if (!mb) throw notFound("Mailbox");
  // Revoke at Google too, so the stored grant is useless even if a backup leaks.
  const token = await decryptSecret(c.env, mb.refresh_token);
  if (token) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(() => null);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE autopilot_playbooks SET mailbox_id = NULL, status = 'paused', paused_reason = 'Mailbox disconnected', updated_at = ? WHERE mailbox_id = ?").bind(now(), mb.id),
    c.env.DB.prepare("DELETE FROM mailboxes WHERE id = ?").bind(mb.id),
    auditStmt(c.env.DB, { actorId: c.get("user").id, action: "mailbox_disconnect", entityType: "mailbox", entityId: mb.email, summary: `Disconnected ${mb.email}`, ip: clientIp(c) }),
  ]);
  return c.json({ data: { ok: true } });
});

// ─── Do not contact ───
autopilotRoutes.get("/do-not-contact", manage, async (c) => {
  const q = c.req.query("q");
  const rows = await c.env.DB.prepare(`SELECT d.*, u.name AS created_by_name FROM do_not_contact d LEFT JOIN users u ON u.id = d.created_by ${q ? "WHERE d.value LIKE ?" : ""} ORDER BY d.created_at DESC LIMIT 300`).bind(...(q ? [`%${q.toLowerCase()}%`] : [])).all<Row>();
  return c.json({ data: rows.results });
});

autopilotRoutes.post("/do-not-contact", manage, async (c) => {
  const i = await parseJson(c, z.object({ values: z.array(z.string().trim().toLowerCase().regex(/^([^@\s]+@)?[a-z0-9.-]+\.[a-z]{2,}$/, "Use an email address or a domain")).min(1).max(500), reason: z.enum(["manual", "customer", "competitor", "opt_out"]).default("manual"), note: z.string().max(300).optional() }));
  const u = c.get("user");
  await c.env.DB.batch([...i.values.map((v) => addDncStmt(c.env, v, i.reason, "manual", i.note ?? null, u.id)), auditStmt(c.env.DB, { actorId: u.id, action: "dnc_add", entityType: "do_not_contact", entityId: null, summary: `Added ${i.values.length} to do-not-contact (${i.reason})`, ip: clientIp(c) })]);
  return c.json({ data: { added: i.values.length } }, 201);
});

autopilotRoutes.delete("/do-not-contact/:value", requireRole("admin"), async (c) => {
  const v = decodeURIComponent(c.req.param("value")).toLowerCase();
  const row = await c.env.DB.prepare("SELECT reason FROM do_not_contact WHERE value = ?").bind(v).first<{ reason: string }>();
  if (!row) throw notFound("Entry");
  if (row.reason === "opt_out" || row.reason === "complaint") throw new ApiError(409, "conflict", "Opt-outs are permanent and cannot be removed");
  await c.env.DB.batch([c.env.DB.prepare("DELETE FROM do_not_contact WHERE value = ?").bind(v), auditStmt(c.env.DB, { actorId: c.get("user").id, action: "dnc_remove", entityType: "do_not_contact", entityId: v, summary: `Removed ${v} from do-not-contact`, ip: clientIp(c) })]);
  return c.json({ data: { ok: true } });
});

// ─── Revenue cockpit ───
const monthBounds = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { start: start.toISOString(), end: end.toISOString(), startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), days: Math.round((end.getTime() - start.getTime()) / 86_400_000) };
};

autopilotRoutes.get("/cockpit", async (c) => {
  const period = /^\d{4}-\d{2}$/.test(c.req.query("period") ?? "") ? c.req.query("period")! : new Date().toISOString().slice(0, 7);
  const { start, end, startDate, endDate, days } = monthBounds(period);
  const nowIso = now();
  const [goal, won, open, closing, funnel, hot, stale, tasks, replies] = await c.env.DB.batch<Row>([
    c.env.DB.prepare("SELECT * FROM revenue_goals WHERE period = ?").bind(period),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount_minor),0) AS amount, COUNT(*) AS n FROM opportunities WHERE stage = 'closed_won' AND currency = 'INR' AND archived_at IS NULL AND COALESCE(closed_at, updated_at) >= ? AND COALESCE(closed_at, updated_at) < ?").bind(start, end),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount_minor),0) AS amount, COALESCE(SUM(amount_minor * probability / 100),0) AS weighted, COUNT(*) AS n FROM opportunities WHERE stage NOT IN ('closed_won','closed_lost') AND currency = 'INR' AND archived_at IS NULL"),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount_minor),0) AS amount, COALESCE(SUM(amount_minor * probability / 100),0) AS weighted, COUNT(*) AS n FROM opportunities WHERE stage NOT IN ('closed_won','closed_lost') AND currency = 'INR' AND archived_at IS NULL AND expected_close_date >= ? AND expected_close_date < ?").bind(startDate, endDate),
    c.env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM autopilot_leads WHERE created_at >= ? AND created_at < ?) AS found,
         (SELECT COUNT(DISTINCT lead_id) FROM autopilot_messages WHERE direction = 'out' AND status = 'sent' AND kind != 'reply' AND sent_at >= ? AND sent_at < ?) AS emailed,
         (SELECT COUNT(DISTINCT lead_id) FROM autopilot_messages WHERE direction = 'in' AND classification NOT IN ('bounce','out_of_office') AND received_at >= ? AND received_at < ?) AS replied,
         (SELECT COUNT(DISTINCT lead_id) FROM autopilot_messages WHERE direction = 'in' AND classification IN ('interested','question') AND received_at >= ? AND received_at < ?) AS interested,
         (SELECT COUNT(*) FROM autopilot_leads WHERE stage = 'meeting' AND updated_at >= ? AND updated_at < ?) AS meetings,
         (SELECT COUNT(*) FROM autopilot_leads WHERE stage = 'drafted') AS awaiting_approval`,
    ).bind(start, end, start, end, start, end, start, end, start, end),
    c.env.DB.prepare(
      `SELECT o.id, o.name, o.stage, o.amount_minor, o.probability, o.expected_close_date, o.updated_at, a.name AS account_name FROM opportunities o JOIN accounts a ON a.id = o.account_id
       WHERE o.stage IN ('proposal_sent','negotiation','meeting_completed','proposal_prep') AND o.archived_at IS NULL ORDER BY o.amount_minor * o.probability DESC LIMIT 8`,
    ),
    c.env.DB.prepare(
      `SELECT o.id, o.name, o.stage, o.amount_minor, o.updated_at, a.name AS account_name FROM opportunities o JOIN accounts a ON a.id = o.account_id
       WHERE o.stage NOT IN ('closed_won','closed_lost') AND o.archived_at IS NULL AND o.updated_at < ? ORDER BY o.amount_minor DESC LIMIT 6`,
    ).bind(new Date(Date.now() - 4 * 86_400_000).toISOString()),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('open','in_progress') AND archived_at IS NULL AND due_at IS NOT NULL AND due_at <= ?").bind(nowIso),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM autopilot_messages WHERE kind = 'reply' AND direction = 'out' AND status = 'pending_approval'"),
  ]);
  const g = goal.results[0] ?? null;
  const target = Number(g?.target_minor ?? 0);
  const wonAmt = Number(won.results[0]?.amount ?? 0);
  const today = new Date();
  const inMonth = nowIso >= start && nowIso < end;
  const daysLeft = inMonth ? Math.max(1, Math.ceil((Date.parse(end) - today.getTime()) / 86_400_000)) : nowIso < start ? days : 0;
  const gap = Math.max(0, target - wonAmt);
  const avg = Number(g?.avg_deal_minor ?? 0) || null;
  return c.json({
    data: {
      period,
      goal: g ? { target_minor: target, avg_deal_minor: avg } : null,
      won: { amount_minor: wonAmt, deals: Number(won.results[0]?.n ?? 0) },
      open: open.results[0],
      closing_this_period: closing.results[0],
      gap_minor: gap,
      days_left: daysLeft,
      needed_per_day_minor: daysLeft ? Math.ceil(gap / daysLeft) : gap,
      deals_needed: avg ? Math.ceil(gap / avg) : null,
      funnel: funnel.results[0],
      hot_deals: hot.results,
      stale_deals: stale.results,
      overdue_tasks: Number(tasks.results[0]?.n ?? 0),
      replies_to_send: Number(replies.results[0]?.n ?? 0),
    },
  });
});

autopilotRoutes.put("/revenue-goals/:period", manage, async (c) => {
  const period = c.req.param("period");
  if (!/^\d{4}-\d{2}$/.test(period)) throw new ApiError(400, "validation_error", "Period must be YYYY-MM");
  const i = await parseJson(c, z.object({ target_minor: z.number().int().min(0).max(1e13), avg_deal_minor: z.number().int().min(0).max(1e12).nullable() }));
  await c.env.DB.prepare(
    "INSERT INTO revenue_goals (period, target_minor, avg_deal_minor, updated_by, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(period) DO UPDATE SET target_minor = excluded.target_minor, avg_deal_minor = excluded.avg_deal_minor, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
  ).bind(period, i.target_minor, b(i.avg_deal_minor), c.get("user").id, now()).run();
  return c.json({ data: { ok: true } });
});
