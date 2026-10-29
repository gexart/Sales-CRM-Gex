// Cross-entity CRM routes: timelines, service-fit assessments, account insights,
// prospect conversion, global search, and the record-level audit trail.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { activitySchema, assessmentSchema, convertProspectSchema } from "../../shared/schemas";
import { ASSESSMENT_STATUSES, OUTREACH_ACTIVITY_TYPES, PITCHED_ASSESSMENTS, labelOf } from "../../shared/enums";
import { ApiError, notFound, parseJson } from "../lib/http";
import { activityStmt, auditStmt } from "../lib/audit-log";
import { clientIp, isManager } from "../lib/auth";
import { fetchOne, scopeClause, type EntityDef } from "../lib/entity";
import { b, newId, normalizeEmail, normalizePhone, now } from "../lib/util";
import { ENTITIES } from "../entities";

type Ctx = Context<AppEnv>;
type Row = Record<string, unknown>;
export const crmRoutes = new Hono<AppEnv>();

const PARENTS: Record<string, EntityDef> = {
  account_id: ENTITIES.accounts,
  contact_id: ENTITIES.contacts,
  prospect_id: ENTITIES.prospects,
  opportunity_id: ENTITIES.opportunities,
  campaign_id: ENTITIES.campaigns,
};

// ─── Activities / timelines ───
crmRoutes.get("/activities", async (c) => {
  const q = c.req.query();
  const key = Object.keys(PARENTS).find((k) => q[k]);
  if (!key) throw new ApiError(400, "validation_error", "Provide account_id, contact_id, prospect_id, opportunity_id or campaign_id");
  const id = q[key];
  await fetchOne(c, PARENTS[key], id); // visibility check on the parent record
  let where = `a.${key} = ?`;
  let params: unknown[] = [id];
  if (key === "account_id") {
    // An account's timeline also includes its contacts' and opportunities' activity.
    where = `(a.account_id = ? OR a.contact_id IN (SELECT id FROM contacts WHERE account_id = ?) OR a.opportunity_id IN (SELECT id FROM opportunities WHERE account_id = ?))`;
    params = [id, id, id];
  }
  if (q.types) {
    const types = q.types.split(",").slice(0, 20);
    where += ` AND a.type IN (${types.map(() => "?").join(",")})`;
    params.push(...types);
  }
  const limit = Math.min(parseInt(q.limit ?? "50", 10) || 50, 200);
  const r = await c.env.DB.prepare(
    `SELECT a.*, u.name AS actor_name, (ct.first_name || COALESCE(' ' || ct.last_name,'')) AS contact_name, o.name AS opportunity_name
     FROM activities a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN contacts ct ON ct.id = a.contact_id LEFT JOIN opportunities o ON o.id = a.opportunity_id
     WHERE ${where} ORDER BY a.occurred_at DESC LIMIT ?`,
  )
    .bind(...params, limit)
    .all();
  return c.json({ data: r.results });
});

crmRoutes.post("/activities", async (c) => {
  const input = (await parseJson(c, activitySchema)) as Row;
  const user = c.get("user");
  const links = ["account_id", "contact_id", "prospect_id", "opportunity_id"].filter((k) => input[k]);
  if (!links.length) throw new ApiError(400, "validation_error", "Link the activity to at least one record");
  for (const k of links) await fetchOne(c, PARENTS[k], input[k] as string);
  if (input.contact_id && !input.account_id) {
    const ct = await c.env.DB.prepare("SELECT account_id FROM contacts WHERE id = ?").bind(input.contact_id).first<{ account_id: string | null }>();
    input.account_id = ct?.account_id ?? null;
  }
  if (input.opportunity_id && !input.account_id) {
    const o = await c.env.DB.prepare("SELECT account_id FROM opportunities WHERE id = ?").bind(input.opportunity_id).first<{ account_id: string }>();
    input.account_id = o?.account_id ?? null;
  }
  const occurred = (input.occurred_at as string) ?? now();
  const stmts = [
    activityStmt(c.env.DB, {
      type: input.type as string,
      subject: input.subject as string,
      body: input.body as string,
      actorId: user.id,
      accountId: input.account_id as string,
      contactId: input.contact_id as string,
      prospectId: input.prospect_id as string,
      opportunityId: input.opportunity_id as string,
      occurredAt: occurred,
    }),
  ];
  if (input.contact_id && OUTREACH_ACTIVITY_TYPES.includes(input.type as string)) {
    stmts.push(
      c.env.DB.prepare(
        "UPDATE contacts SET last_contacted_at = MAX(COALESCE(last_contacted_at, ''), ?), updated_at = ? WHERE id = ?",
      ).bind(occurred, now(), input.contact_id),
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ data: { ok: true } }, 201);
});

// ─── Account service-fit assessments ───
crmRoutes.get("/accounts/:id/assessments", async (c) => {
  const id = c.req.param("id");
  await fetchOne(c, ENTITIES.accounts, id);
  const r = await c.env.DB.prepare(
    `SELECT p.id AS product_id, p.name, p.sku, p.category, COALESCE(s.status, 'not_assessed') AS status, s.note, s.source, s.updated_at, u.name AS updated_by_name
     FROM products p LEFT JOIN account_service_assessments s ON s.product_id = p.id AND s.account_id = ? LEFT JOIN users u ON u.id = s.updated_by
     WHERE p.archived_at IS NULL AND (p.status = 'active' OR s.status IS NOT NULL)
     ORDER BY p.category, p.name`,
  )
    .bind(id)
    .all();
  return c.json({ data: r.results });
});

export async function saveAssessment(c: Ctx, accountId: string, productId: string, status: string, note: string | null | undefined, source = "user") {
  const user = c.get("user");
  const product = await c.env.DB.prepare("SELECT id, name FROM products WHERE id = ?").bind(productId).first<{ name: string }>();
  if (!product) throw notFound("Product");
  const prev = await c.env.DB.prepare("SELECT status FROM account_service_assessments WHERE account_id = ? AND product_id = ?")
    .bind(accountId, productId)
    .first<{ status: string }>();
  const t = now();
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO account_service_assessments (id, account_id, product_id, status, note, source, updated_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT (account_id, product_id) DO UPDATE SET status = excluded.status, note = excluded.note, source = excluded.source, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(newId(), accountId, productId, status, b(note), source, user.id, t, t),
  ];
  if ((prev?.status ?? "not_assessed") !== status) {
    const subject = `Service fit · ${product.name}: ${labelOf(ASSESSMENT_STATUSES, prev?.status ?? "not_assessed")} → ${labelOf(ASSESSMENT_STATUSES, status)}`;
    stmts.push(activityStmt(c.env.DB, { type: "status_change", subject, body: note ?? null, actorId: user.id, accountId, meta: { product_id: productId, source } }));
    stmts.push(auditStmt(c.env.DB, { actorId: user.id, action: "assessment", entityType: "account", entityId: accountId, summary: subject, ip: clientIp(c) }));
    const rel = { discussed: "pitched", proposed: "proposed", won: "sold" }[status];
    if (rel) {
      stmts.push(
        c.env.DB.prepare("INSERT OR IGNORE INTO account_products (account_id, product_id, relationship, created_at) VALUES (?,?,?,?)").bind(accountId, productId, rel, t),
      );
    }
  }
  await c.env.DB.batch(stmts);
}

crmRoutes.put("/accounts/:id/assessments/:productId", async (c) => {
  const id = c.req.param("id");
  await fetchOne(c, ENTITIES.accounts, id);
  const input = await parseJson(c, assessmentSchema);
  await saveAssessment(c, id, c.req.param("productId"), input.status, input.note);
  return c.json({ data: { ok: true } });
});

// ─── Account intelligence (rule-based, every item traceable to stored records) ───
crmRoutes.get("/accounts/:id/insights", async (c) => {
  const id = c.req.param("id");
  const account = await fetchOne(c, ENTITIES.accounts, id);
  const db = c.env.DB;
  const [contacts, opps, lastAct, nextTask, audits, services, assets] = await db.batch<Row>([
    db.prepare(
      `SELECT id, (first_name || COALESCE(' ' || last_name,'')) AS name, job_title, decision_role, email, phone, status, last_contacted_at
       FROM contacts WHERE account_id = ? AND archived_at IS NULL
       ORDER BY CASE decision_role WHEN 'decision_maker' THEN 0 WHEN 'champion' THEN 1 WHEN 'influencer' THEN 2 ELSE 3 END, updated_at DESC LIMIT 6`,
    ).bind(id),
    db.prepare(
      `SELECT id, name, stage, amount_minor, currency, probability, expected_close_date FROM opportunities
       WHERE account_id = ? AND archived_at IS NULL ORDER BY CASE WHEN stage IN ('closed_won','closed_lost') THEN 1 ELSE 0 END, updated_at DESC`,
    ).bind(id),
    db.prepare(
      `SELECT a.type, a.subject, a.occurred_at FROM activities a
       WHERE a.account_id = ? OR a.contact_id IN (SELECT id FROM contacts WHERE account_id = ?) OR a.opportunity_id IN (SELECT id FROM opportunities WHERE account_id = ?)
       ORDER BY a.occurred_at DESC LIMIT 1`,
    ).bind(id, id, id),
    db.prepare(
      `SELECT id, title, due_at, type FROM tasks WHERE account_id = ? AND status IN ('open','in_progress') AND archived_at IS NULL
       ORDER BY due_at IS NULL, due_at LIMIT 1`,
    ).bind(id),
    db.prepare(
      `SELECT r.id, r.audit_type, r.status, r.overall_score, r.completed_at, r.created_at FROM audit_runs r
       WHERE r.account_id = ? AND r.id = (SELECT id FROM audit_runs r2 WHERE r2.account_id = r.account_id AND r2.audit_type = r.audit_type ORDER BY created_at DESC LIMIT 1)`,
    ).bind(id),
    db.prepare(
      `SELECT p.id, p.name, p.sku, COALESCE(s.status,'not_assessed') AS status, s.note, s.source
       FROM products p LEFT JOIN account_service_assessments s ON s.product_id = p.id AND s.account_id = ?
       WHERE p.archived_at IS NULL AND p.status = 'active' ORDER BY p.name`,
    ).bind(id),
    db.prepare(
      `SELECT DISTINCT sa.id, sa.name, sa.type FROM sales_assets sa JOIN asset_associations aa ON aa.asset_id = sa.id
       WHERE sa.archived_at IS NULL AND ((aa.entity_type = 'account' AND aa.entity_id = ?)
         OR (aa.entity_type = 'product' AND aa.entity_id IN (SELECT product_id FROM account_service_assessments WHERE account_id = ? AND status IN ('relevant','discussed','proposed'))))
       LIMIT 6`,
    ).bind(id, id),
  ]);

  const open = opps.results.filter((o) => !["closed_won", "closed_lost"].includes(o.stage as string));
  const svc = services.results;
  const opportunities = svc.filter((s) => s.status === "relevant" || s.status === "needs_assessment");
  const pitched = svc.filter((s) => PITCHED_ASSESSMENTS.includes(s.status as string));
  const notPitched = svc.filter((s) => !PITCHED_ASSESSMENTS.includes(s.status as string) && s.status !== "not_applicable");

  // Next steps are deterministic rules over the record; each one states its reason.
  const steps: { text: string; reason: string }[] = [];
  const hasDM = contacts.results.some((x) => x.decision_role === "decision_maker");
  if (!account.website) steps.push({ text: "Add the company website", reason: "Website, SEO and AEO audits need a website URL." });
  else if (!audits.results.some((a) => a.audit_type === "website" && String(a.status).startsWith("completed")))
    steps.push({ text: "Run a website audit", reason: "No completed website audit on record." });
  if (!contacts.results.length) steps.push({ text: "Add a contact", reason: "No contacts are linked to this account." });
  else if (!hasDM) steps.push({ text: "Identify the decision-maker", reason: "No linked contact is marked as decision maker." });
  if (svc.every((s) => s.status === "not_assessed")) steps.push({ text: "Assess service fit", reason: "No Gexart services have been assessed for this account." });
  if (opportunities.length && !open.length)
    steps.push({ text: "Create an opportunity", reason: `${opportunities.length} service(s) are marked relevant but there is no open opportunity.` });
  if (!nextTask.results.length) steps.push({ text: "Schedule the next action", reason: "There is no open task for this account." });
  if (!account.qualification) steps.push({ text: "Set a qualification level", reason: "Qualification has not been recorded." });

  return c.json({
    data: {
      qualification: account.qualification ?? null,
      qualification_note: account.qualification_note ?? null,
      contacts: contacts.results,
      has_decision_maker: hasDM,
      open_opportunities: open,
      open_pipeline_minor: open.reduce((s, o) => s + Number(o.amount_minor ?? 0), 0),
      weighted_pipeline_minor: open.reduce((s, o) => s + Math.floor((Number(o.amount_minor ?? 0) * Number(o.probability ?? 0)) / 100), 0),
      won_minor: opps.results.filter((o) => o.stage === "closed_won").reduce((s, o) => s + Number(o.amount_minor ?? 0), 0),
      last_activity: lastAct.results[0] ?? null,
      next_task: nextTask.results[0] ?? null,
      audits: audits.results,
      service_opportunities: opportunities,
      services_pitched: pitched,
      services_not_pitched: notPitched,
      relevant_assets: assets.results,
      next_steps: steps,
    },
  });
});

crmRoutes.get("/accounts/:id/campaigns", async (c) => {
  const id = c.req.param("id");
  await fetchOne(c, ENTITIES.accounts, id);
  const r = await c.env.DB.prepare(
    `SELECT cp.id, cp.name, cp.code, cp.status, cp.type, ac.created_at AS linked_at FROM account_campaigns ac JOIN campaigns cp ON cp.id = ac.campaign_id WHERE ac.account_id = ? ORDER BY ac.created_at DESC`,
  )
    .bind(id)
    .all();
  return c.json({ data: r.results });
});

// ─── Prospect conversion (atomic) ───
crmRoutes.post("/prospects/:id/convert", async (c) => {
  const user = c.get("user");
  const pid = c.req.param("id");
  await fetchOne(c, ENTITIES.prospects, pid);
  const p = await c.env.DB.prepare("SELECT * FROM prospects WHERE id = ?").bind(pid).first<Row>();
  if (!p) throw notFound("Prospect");
  if (p.status === "converted" || p.converted_account_id) throw new ApiError(409, "already_converted", "This prospect has already been converted");
  if (p.status !== "qualified") throw new ApiError(400, "not_qualified", "Only qualified prospects can be converted");
  const input = await parseJson(c, convertProspectSchema);
  const db = c.env.DB;
  const t = now();
  const stmts: D1PreparedStatement[] = [];

  let accountId: string;
  let accountCreated = false;
  if (input.account_mode === "link") {
    if (!input.account_id) throw new ApiError(400, "validation_error", "Choose the account to link");
    await fetchOne(c, ENTITIES.accounts, input.account_id);
    accountId = input.account_id;
  } else {
    // Refuse to create an obvious duplicate; the user must link instead. Never merge silently.
    const dup = await db
      .prepare(
        "SELECT id, name, website FROM accounts WHERE archived_at IS NULL AND (name_normalized = ? OR (? IS NOT NULL AND domain = ?)) LIMIT 5",
      )
      .bind(p.name_normalized, p.domain, p.domain)
      .all<Row>();
    if (dup.results.length) {
      throw new ApiError(409, "possible_duplicate", "An account that looks like this company already exists. Link to it instead.", { matches: dup.results });
    }
    accountId = newId();
    accountCreated = true;
    stmts.push(
      db.prepare(
        `INSERT INTO accounts (id, name, name_normalized, website, domain, industry, company_size, city, phone, linkedin_url, owner_id, type, status,
           lead_source, source_campaign_id, source_prospect_id, notes, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,'prospect','qualified',?,?,?,?,?,?,?)`,
      ).bind(
        accountId, p.company_name, p.name_normalized, b(p.website), b(p.domain), b(p.industry), b(p.company_size), b(p.geography), b(p.phone),
        b(p.linkedin_url), b(p.owner_id ?? user.id), b(p.discovery_source), b(p.campaign_id), pid, b(p.research_notes), user.id, t, t,
      ),
    );
  }

  let contactId: string | null = null;
  const first = input.contact_first_name ?? (p.contact_name ? String(p.contact_name).split(" ")[0] : null);
  if (input.create_contact && first) {
    const last = input.contact_last_name ?? (p.contact_name ? String(p.contact_name).split(" ").slice(1).join(" ") || null : null);
    const email = normalizeEmail(p.email as string);
    const existing = email
      ? await db.prepare("SELECT id FROM contacts WHERE email_normalized = ? AND archived_at IS NULL").bind(email).first<{ id: string }>()
      : null;
    if (existing) {
      contactId = existing.id; // link rather than duplicate a known person
    } else {
      contactId = newId();
      stmts.push(
        db.prepare(
          `INSERT INTO contacts (id, account_id, first_name, last_name, job_title, email, email_normalized, phone, phone_normalized, linkedin_url, owner_id, status, source, source_prospect_id, created_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,'not_contacted',?,?,?,?,?)`,
        ).bind(
          contactId, accountId, first, b(last), b(p.contact_title), b(p.email), email, b(p.phone), normalizePhone(p.phone as string), null,
          b(p.owner_id ?? user.id), b(p.discovery_source), pid, user.id, t, t,
        ),
      );
    }
  }

  stmts.push(
    // Unique key on prospect_id: a concurrent second conversion fails here and the whole batch rolls back.
    db.prepare(
      "INSERT INTO prospect_conversions (prospect_id, account_id, contact_id, account_created, campaign_id, converted_by, converted_at) VALUES (?,?,?,?,?,?,?)",
    ).bind(pid, accountId, contactId, accountCreated ? 1 : 0, b(p.campaign_id), user.id, t),
    db.prepare(
      "UPDATE prospects SET status = 'converted', converted_account_id = ?, converted_contact_id = ?, converted_at = ?, updated_at = ? WHERE id = ?",
    ).bind(accountId, contactId, t, t, pid),
    // Carry the prospect's history onto the account timeline without rewriting the prospect link.
    db.prepare("UPDATE activities SET account_id = ? WHERE prospect_id = ? AND account_id IS NULL").bind(accountId, pid),
    db.prepare("UPDATE tasks SET account_id = ? WHERE prospect_id = ? AND account_id IS NULL").bind(accountId, pid),
  );
  if (p.campaign_id) {
    stmts.push(db.prepare("INSERT OR IGNORE INTO account_campaigns (account_id, campaign_id, created_at) VALUES (?,?,?)").bind(accountId, p.campaign_id, t));
  }
  stmts.push(
    activityStmt(db, {
      type: "conversion",
      subject: `Converted prospect "${p.company_name}"${accountCreated ? " into a new account" : " and linked to an existing account"}`,
      actorId: user.id,
      accountId,
      contactId,
      prospectId: pid,
      campaignId: p.campaign_id as string,
    }),
    auditStmt(db, {
      actorId: user.id,
      action: "convert",
      entityType: "prospect",
      entityId: pid,
      summary: `Converted to account ${accountId}${contactId ? ` and contact ${contactId}` : ""}`,
      ip: clientIp(c),
    }),
  );
  await db.batch(stmts);
  return c.json({ data: { prospect_id: pid, account_id: accountId, contact_id: contactId, account_created: accountCreated } });
});

// ─── Global search ───
const SEARCH: { def: EntityDef; title: string; sub: string; kind: string }[] = [
  { def: ENTITIES.accounts, title: "t.name", sub: "COALESCE(t.city, t.industry, t.website)", kind: "account" },
  { def: ENTITIES.contacts, title: "(t.first_name || COALESCE(' ' || t.last_name,''))", sub: "COALESCE(a.name, t.email)", kind: "contact" },
  { def: ENTITIES.prospects, title: "t.company_name", sub: "t.status", kind: "prospect" },
  { def: ENTITIES.opportunities, title: "t.name", sub: "a.name", kind: "opportunity" },
  { def: ENTITIES.campaigns, title: "t.name", sub: "t.code", kind: "campaign" },
  { def: ENTITIES.products, title: "t.name", sub: "t.sku", kind: "product" },
  { def: ENTITIES.tasks, title: "t.title", sub: "t.status", kind: "task" },
];
crmRoutes.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ data: [] });
  const term = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const user = c.get("user");
  const stmts = SEARCH.map(({ def, title, sub, kind }) => {
    const scope = scopeClause(def, user);
    return c.env.DB.prepare(
      `SELECT '${kind}' AS kind, t.id, ${title} AS title, ${sub} AS subtitle FROM ${def.from}
       WHERE t.archived_at IS NULL AND (${def.search.map((s) => `${s} LIKE ? ESCAPE '\\'`).join(" OR ")})${scope ? ` AND ${scope.sql}` : ""}
       ORDER BY t.updated_at DESC LIMIT 5`,
    ).bind(...def.search.map(() => term), ...(scope?.params ?? []));
  });
  const results = await c.env.DB.batch<Row>(stmts);
  return c.json({ data: results.flatMap((r) => r.results) });
});

// ─── Record-level audit trail ───
crmRoutes.get("/audit-logs", async (c) => {
  const { entity_type, entity_id } = c.req.query();
  const user = c.get("user");
  if (!entity_type || !entity_id) {
    if (!isManager(user)) throw new ApiError(403, "forbidden", "Only managers can view the full audit log");
    const r = await c.env.DB.prepare(
      "SELECT l.*, u.name AS actor_name FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id ORDER BY l.created_at DESC LIMIT 200",
    ).all();
    return c.json({ data: r.results });
  }
  const def = Object.values(ENTITIES).find((d) => d.entityType === entity_type);
  if (!def) throw new ApiError(400, "validation_error", "Unknown entity type");
  await fetchOne(c, def, entity_id);
  const r = await c.env.DB.prepare(
    "SELECT l.*, u.name AS actor_name FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id WHERE l.entity_type = ? AND l.entity_id = ? ORDER BY l.created_at DESC LIMIT 100",
  )
    .bind(entity_type, entity_id)
    .all();
  return c.json({ data: r.results });
});

