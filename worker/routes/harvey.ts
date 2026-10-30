// Harvey bridge: Harvey (the open-source sales agent, running on your PC) pushes the prospects it found
// and what happened in its conversations; it pulls the CRM's do-not-contact list so an opt-out in either
// system stops both. Authenticated with a "harvey" token from Settings → Autopilot (same mechanism as phones).
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/http";
import { activityStmt } from "../lib/audit-log";
import { notifyStmt } from "../audits/run";
import { computeQualification } from "../lib/qualification";
import { b, domainOf, newId, normalizeEmail, normalizeName, now } from "../lib/util";
import { addDncStmt } from "../autopilot/engine";
import { dncMatch } from "../autopilot/rules";

type Row = Record<string, unknown>;
export const harveyRoutes = new Hono<AppEnv>();

harveyRoutes.use("*", async (c, next) => {
  if (c.get("user").deviceKind !== "harvey") throw new ApiError(403, "forbidden", "This token is not a Harvey bridge token");
  await next();
});

const str = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const prospectSchema = z.object({
  harvey_id: z.string().trim().min(1).max(100),
  company_name: z.string().trim().min(1).max(200),
  website: str(300),
  domain: str(200),
  industry: str(120),
  location: str(200),
  company_size: str(60),
  first_name: str(80),
  last_name: str(80),
  title: str(120),
  email: str(200),
  email_verified: z.boolean().optional().default(false),
  phone: str(40),
  linkedin_url: str(300),
  score: z.number().int().min(0).max(100).optional().nullable(),
  personalization: str(2000),
  status: str(40),
});

harveyRoutes.post("/prospects", async (c) => {
  const { items } = await (async () => {
    const body = await c.req.json().catch(() => null);
    const r = z.object({ items: z.array(prospectSchema).max(500) }).safeParse(body);
    if (!r.success) throw new ApiError(400, "validation_error", "Invalid prospects payload", r.error.issues.slice(0, 5));
    return r.data;
  })();
  const u = c.get("user");
  const dnc = (await c.env.DB.prepare("SELECT value FROM do_not_contact").all<{ value: string }>()).results.map((r) => r.value);
  const t = now();
  let created = 0, updated = 0, skipped = 0;
  for (const p of items) {
    const email = normalizeEmail(p.email);
    const domain = p.domain || domainOf(p.website);
    if ((email && dncMatch(email, dnc)) || (domain && dncMatch(`x@${domain}`, dnc))) {
      skipped++;
      continue;
    }
    const ref = `harvey:${p.harvey_id}`;
    const contact = [p.first_name, p.last_name].filter(Boolean).join(" ") || null;
    const notes = p.personalization ? `Harvey research: ${p.personalization}` : null;
    const existing = await c.env.DB.prepare(
      `SELECT id FROM prospects WHERE archived_at IS NULL AND (external_ref = ? OR (? IS NOT NULL AND email = ?) OR (? IS NOT NULL AND domain = ?)) ORDER BY external_ref = ? DESC LIMIT 1`,
    ).bind(ref, email, email, domain, domain, ref).first<{ id: string }>();
    if (existing) {
      await c.env.DB.prepare(
        `UPDATE prospects SET external_ref = COALESCE(external_ref, ?), contact_name = COALESCE(contact_name, ?), contact_title = COALESCE(contact_title, ?), email = COALESCE(email, ?),
           phone = COALESCE(phone, ?), linkedin_url = COALESCE(linkedin_url, ?), website = COALESCE(website, ?), industry = COALESCE(industry, ?),
           research_notes = CASE WHEN ? IS NULL OR instr(COALESCE(research_notes,''), ?) > 0 THEN research_notes ELSE TRIM(COALESCE(research_notes,'') || char(10) || ?) END, updated_at = ? WHERE id = ?`,
      ).bind(ref, b(contact), b(p.title), b(email), b(p.phone), b(p.linkedin_url), b(p.website), b(p.industry), b(notes), b(notes), b(notes), t, existing.id).run();
      updated++;
      continue;
    }
    const q = computeQualification({ industry: p.industry, geography: p.location, website: p.website, email, phone: p.phone, contact_name: contact, contact_title: p.title });
    await c.env.DB.prepare(
      `INSERT INTO prospects (id, company_name, name_normalized, website, domain, industry, geography, company_size, contact_name, contact_title, email, phone, linkedin_url,
         discovery_source, status, owner_id, research_notes, qualification_score, qualification_level, qualification_factors, qualification_scored_at, external_ref, created_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'harvey','discovered',?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      newId(), p.company_name, normalizeName(p.company_name), b(p.website), b(domain), b(p.industry), b(p.location), b(p.company_size), b(contact), b(p.title), b(email), b(p.phone), b(p.linkedin_url),
      u.id, b(notes), Math.max(q.score, p.score ?? 0), q.level, JSON.stringify(q.factors), t, ref, u.id, t, t,
    ).run();
    created++;
  }
  return c.json({ data: { created, updated, skipped_do_not_contact: skipped } });
});

const eventSchema = z.object({
  event_id: z.string().trim().min(1).max(200),
  harvey_prospect_id: str(100),
  email: str(200),
  type: z.enum(["sent", "reply", "opt_out", "bounce", "meeting"]),
  subject: str(300),
  body: str(8000),
  intent: str(60),
  at: z.string().datetime({ offset: true }).optional().nullable(),
});

harveyRoutes.post("/events", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ items: z.array(eventSchema).max(500) }).safeParse(body);
  if (!parsed.success) throw new ApiError(400, "validation_error", "Invalid events payload", parsed.error.issues.slice(0, 5));
  const u = c.get("user");
  let recorded = 0, duplicate = 0, unmatched = 0;
  for (const e of parsed.data.items) {
    const fresh = await c.env.DB.prepare("INSERT OR IGNORE INTO webhook_events (provider, event_id, received_at) VALUES ('harvey', ?, ?)").bind(e.event_id, now()).run();
    if (!fresh.meta.changes) {
      duplicate++;
      continue;
    }
    const email = normalizeEmail(e.email);
    const p = await c.env.DB.prepare("SELECT id, company_name, owner_id FROM prospects WHERE (? IS NOT NULL AND external_ref = ?) OR (? IS NOT NULL AND email = ?) ORDER BY external_ref IS NOT NULL DESC LIMIT 1")
      .bind(e.harvey_prospect_id ? `harvey:${e.harvey_prospect_id}` : null, e.harvey_prospect_id ? `harvey:${e.harvey_prospect_id}` : null, email, email)
      .first<Row>();
    const stmts: D1PreparedStatement[] = [];
    if ((e.type === "opt_out" || e.type === "bounce") && email) stmts.push(addDncStmt(c.env, email, e.type === "opt_out" ? "opt_out" : "bounce", "harvey", e.body?.slice(0, 300) ?? null, null));
    if (p) {
      const label = { sent: "Harvey sent", reply: "Reply received (via Harvey)", opt_out: "Opted out (via Harvey)", bounce: "Email bounced (via Harvey)", meeting: "Meeting booked (via Harvey)" }[e.type];
      stmts.push(activityStmt(c.env.DB, { type: e.type === "meeting" ? "meeting" : "email", subject: `${label}${e.subject ? `: ${e.subject}` : ""}`.slice(0, 300), body: e.body, actorId: null, prospectId: String(p.id), occurredAt: e.at ?? now(), meta: { source: "harvey", intent: e.intent } }));
      if ((e.type === "reply" && e.intent !== "opt_out") || e.type === "meeting") {
        const owner = String(p.owner_id ?? u.id);
        stmts.push(
          notifyStmt(c.env.DB, owner, `harvey:${e.event_id}`, `${e.type === "meeting" ? "📅 Meeting booked" : "💬 Reply"}: ${p.company_name}${e.intent ? ` (${e.intent})` : ""}`, (e.body ?? "").slice(0, 300) || null, "prospect", String(p.id)),
          c.env.DB.prepare(`INSERT INTO tasks (id, title, type, prospect_id, due_at, priority, owner_id, status, created_by, created_at, updated_at) VALUES (?,?,?,?,?,'high',?,'open',NULL,?,?)`).bind(
            newId(), `${e.type === "meeting" ? "Prepare for meeting with" : "Follow up Harvey reply from"} ${p.company_name}`.slice(0, 200), e.type === "meeting" ? "meeting" : "follow_up_call", p.id, now(), owner, now(), now(),
          ),
        );
      }
    } else unmatched++;
    if (stmts.length) await c.env.DB.batch(stmts);
    recorded++;
  }
  return c.json({ data: { recorded, duplicate, unmatched } });
});

harveyRoutes.get("/do-not-contact", async (c) => {
  const rows = await c.env.DB.prepare("SELECT value, kind, reason FROM do_not_contact ORDER BY value").all<Row>();
  return c.json({ data: rows.results });
});
