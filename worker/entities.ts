import type { EntityDef } from "./lib/entity";
import { ApiError } from "./lib/http";
import { activityStmt, auditStmt } from "./lib/audit-log";
import { isManager, clientIp } from "./lib/auth";
import { domainOf, normalizeEmail, normalizeName, normalizePhone, now } from "./lib/util";
import * as S from "../shared/schemas";
import { STAGE_PROBABILITY, CLOSED_STAGES, labelOf, OPPORTUNITY_STAGES, ACCOUNT_STATUSES, UNSENT_OUTREACH_STATUSES } from "../shared/enums";
import { hasUnresolved, unknownPlaceholders } from "../shared/templating";

type Row = Record<string, unknown>;

const OWNER_JOIN = "LEFT JOIN users u ON u.id = t.owner_id";
const ALL_ROLES: EntityDef["writeRoles"] = ["admin", "manager", "rep"];
const range = (col: string, op: string) => (v: string) => ({ sql: `${col} ${op} ?`, params: [v] });

function duplicateError(matches: Row[], what: string) {
  return new ApiError(409, "possible_duplicate", `This looks like an existing ${what}. Review the matches or save anyway.`, { matches });
}

// ─── Accounts ───
async function findAccountDuplicates(db: D1Database, name: string, website: unknown, excludeId?: string) {
  const domain = domainOf(website as string | null);
  const r = await db
    .prepare(
      `SELECT id, name, website, city FROM accounts
       WHERE archived_at IS NULL AND id != ? AND (name_normalized = ? OR (? IS NOT NULL AND domain = ?)) LIMIT 5`,
    )
    .bind(excludeId ?? "", normalizeName(name), domain, domain)
    .all<Row>();
  return r.results;
}

export const accounts: EntityDef = {
  route: "accounts",
  table: "accounts",
  entityType: "account",
  label: "Account",
  titleOf: (r) => String(r.name),
  schema: S.accountSchema,
  select: `t.*, u.name AS owner_name, sc.name AS source_campaign_name,
    (SELECT COUNT(*) FROM contacts x WHERE x.account_id = t.id AND x.archived_at IS NULL) AS contact_count,
    (SELECT COUNT(*) FROM opportunities o WHERE o.account_id = t.id AND o.archived_at IS NULL AND o.stage NOT IN ('closed_won','closed_lost')) AS open_opportunity_count`,
  from: `accounts t ${OWNER_JOIN} LEFT JOIN campaigns sc ON sc.id = t.source_campaign_id`,
  search: ["t.name", "t.website", "t.city", "t.industry", "t.email", "t.phone"],
  filters: { status: "t.status", type: "t.type", owner_id: "t.owner_id", industry: "t.industry", qualification: "t.qualification", city: "t.city" },
  sorts: { name: "t.name", updated_at: "t.updated_at", created_at: "t.created_at", status: "t.status", city: "t.city", industry: "t.industry" },
  defaultSort: "updated_at",
  repScope: "t.owner_id = ?",
  writeRoles: ALL_ROLES,
  refs: { owner_id: "users", source_campaign_id: "campaigns" },
  derive: (d) => ({
    ...(d.name ? { name_normalized: normalizeName(String(d.name)) } : {}),
    domain: domainOf(d.website as string | null),
  }),
  async beforeWrite(c, d, existing) {
    if (d.force || (existing && d.name === undefined && d.website === undefined)) return;
    const name = String(d.name ?? existing?.name);
    const website = d.website !== undefined ? d.website : existing?.website;
    const nameChanged = !existing || normalizeName(name) !== existing.name_normalized;
    const domainChanged = !existing || domainOf(website as string) !== existing.domain;
    if (!nameChanged && !domainChanged) return;
    const m = await findAccountDuplicates(c.env.DB, name, website, existing?.id as string | undefined);
    if (m.length) throw duplicateError(m, "account");
  },
  extraStatements(c, id, input, existing, after) {
    const db = c.env.DB;
    const user = c.get("user");
    const out: D1PreparedStatement[] = [];
    if (after.source_campaign_id && after.source_campaign_id !== existing?.source_campaign_id) {
      out.push(db.prepare("INSERT OR IGNORE INTO account_campaigns (account_id, campaign_id, created_at) VALUES (?,?,?)").bind(id, after.source_campaign_id, now()));
    }
    if (existing && input.status && input.status !== existing.status) {
      out.push(activityStmt(db, { type: "status_change", subject: `Status: ${labelOf(ACCOUNT_STATUSES, existing.status as string)} → ${labelOf(ACCOUNT_STATUSES, input.status as string)}`, actorId: user.id, accountId: id }));
    }
    return out;
  },
};

// ─── Contacts ───
export const contacts: EntityDef = {
  route: "contacts",
  table: "contacts",
  entityType: "contact",
  label: "Contact",
  titleOf: (r) => [r.first_name, r.last_name].filter(Boolean).join(" "),
  schema: S.contactSchema,
  select: `t.*, (t.first_name || COALESCE(' ' || t.last_name, '')) AS full_name, a.name AS account_name, u.name AS owner_name`,
  from: `contacts t LEFT JOIN accounts a ON a.id = t.account_id ${OWNER_JOIN}`,
  search: ["t.first_name", "t.last_name", "(t.first_name || ' ' || COALESCE(t.last_name,''))", "t.email", "t.phone", "t.job_title", "a.name"],
  filters: { status: "t.status", account_id: "t.account_id", owner_id: "t.owner_id", decision_role: "t.decision_role" },
  sorts: { name: "t.first_name", account: "a.name", updated_at: "t.updated_at", created_at: "t.created_at", next_follow_up_at: "t.next_follow_up_at", last_contacted_at: "t.last_contacted_at" },
  defaultSort: "updated_at",
  repScope: "t.owner_id = ? OR t.account_id IN (SELECT id FROM accounts WHERE owner_id = ?)",
  repScopeParams: 2,
  writeRoles: ALL_ROLES,
  refs: { account_id: "accounts", owner_id: "users" },
  derive: (d) => ({ email_normalized: normalizeEmail(d.email as string), phone_normalized: normalizePhone(d.phone as string) }),
  async beforeWrite(c, d, existing) {
    if (d.force) return;
    const email = d.email !== undefined ? normalizeEmail(d.email as string) : null;
    const phone = d.phone !== undefined ? normalizePhone(d.phone as string) : null;
    const checkEmail = email && email !== existing?.email_normalized;
    const checkPhone = phone && phone !== existing?.phone_normalized;
    if (!checkEmail && !checkPhone) return;
    const r = await c.env.DB.prepare(
      `SELECT c.id, (c.first_name || COALESCE(' ' || c.last_name,'')) AS name, c.email, c.phone, a.name AS account_name
       FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id
       WHERE c.archived_at IS NULL AND c.id != ? AND ((? IS NOT NULL AND c.email_normalized = ?) OR (? IS NOT NULL AND c.phone_normalized = ?)) LIMIT 5`,
    )
      .bind(existing?.id ?? "", checkEmail ? email : null, email, checkPhone ? phone : null, phone)
      .all<Row>();
    if (r.results.length) throw duplicateError(r.results, "contact");
  },
  extraStatements(c, id, input, existing) {
    if (!existing || input.account_id === undefined || input.account_id === existing.account_id) return [];
    // Moving a contact keeps its activity rows (keyed by contact_id); record the move itself.
    return [activityStmt(c.env.DB, { type: "system", subject: "Contact moved to another account", actorId: c.get("user").id, contactId: id, accountId: (input.account_id as string) ?? null, meta: { from: existing.account_id, to: input.account_id } })];
  },
};

// ─── Products ───
export const products: EntityDef = {
  route: "products",
  table: "products",
  entityType: "product",
  label: "Product",
  titleOf: (r) => String(r.name),
  schema: S.productSchema,
  select: `t.*, (SELECT COUNT(*) FROM opportunity_products op WHERE op.product_id = t.id) AS opportunity_count`,
  from: "products t",
  search: ["t.name", "t.sku", "t.short_description", "t.target_industries"],
  filters: { category: "t.category", status: "t.status", pricing_model: "t.pricing_model" },
  sorts: { name: "t.name", sku: "t.sku", category: "t.category", default_price_minor: "t.default_price_minor", updated_at: "t.updated_at" },
  defaultSort: "name",
  defaultDir: "asc",
  writeRoles: ["admin", "manager"],
  redact: (r, u) => (isManager(u) ? r : { ...r, internal_cost_minor: undefined }),
};

// ─── Campaigns ───
export const campaigns: EntityDef = {
  route: "campaigns",
  table: "campaigns",
  entityType: "campaign",
  label: "Campaign",
  titleOf: (r) => String(r.name),
  schema: S.campaignSchema,
  select: `t.*, u.name AS owner_name,
    (SELECT json_group_array(product_id) FROM campaign_products WHERE campaign_id = t.id) AS product_ids_json,
    (SELECT COUNT(*) FROM prospects p WHERE p.campaign_id = t.id AND p.archived_at IS NULL) AS prospect_count,
    (SELECT COUNT(*) FROM opportunities o WHERE o.campaign_id = t.id AND o.archived_at IS NULL) AS opportunity_count`,
  from: `campaigns t ${OWNER_JOIN}`,
  search: ["t.name", "t.code", "t.target_industry", "t.target_geography"],
  filters: { status: "t.status", type: "t.type", owner_id: "t.owner_id" },
  customFilters: { starts_after: range("t.start_date", ">="), starts_before: range("t.start_date", "<=") },
  sorts: { name: "t.name", start_date: "t.start_date", status: "t.status", updated_at: "t.updated_at", budget_minor: "t.budget_minor" },
  defaultSort: "updated_at",
  writeRoles: ["admin", "manager"],
  refs: { owner_id: "users" },
  virtual: ["product_ids"],
  async beforeWrite(_c, d, existing) {
    const start = d.start_date ?? existing?.start_date;
    const end = d.end_date ?? existing?.end_date;
    if (start && end && String(end) < String(start)) throw new ApiError(400, "validation_error", "End date must be on or after the start date");
  },
  extraStatements(c, id, input) {
    if (!Array.isArray(input.product_ids)) return [];
    const db = c.env.DB;
    return [
      db.prepare("DELETE FROM campaign_products WHERE campaign_id = ?").bind(id),
      ...(input.product_ids as string[]).map((pid) =>
        db.prepare("INSERT OR IGNORE INTO campaign_products (campaign_id, product_id, created_at) SELECT ?, id, ? FROM products WHERE id = ?").bind(id, now(), pid),
      ),
    ];
  },
};

// ─── Prospects ───
export const prospects: EntityDef = {
  route: "prospects",
  table: "prospects",
  entityType: "prospect",
  label: "Prospect",
  titleOf: (r) => String(r.company_name),
  schema: S.prospectSchema,
  select: `t.*, u.name AS owner_name, cp.name AS campaign_name, ca.name AS converted_account_name`,
  from: `prospects t ${OWNER_JOIN} LEFT JOIN campaigns cp ON cp.id = t.campaign_id LEFT JOIN accounts ca ON ca.id = t.converted_account_id`,
  search: ["t.company_name", "t.website", "t.contact_name", "t.industry", "t.geography", "t.email", "t.service_fit"],
  filters: { status: "t.status", owner_id: "t.owner_id", campaign_id: "t.campaign_id", industry: "t.industry", discovery_source: "t.discovery_source" },
  sorts: { company_name: "t.company_name", status: "t.status", updated_at: "t.updated_at", created_at: "t.created_at", estimated_value_minor: "t.estimated_value_minor" },
  defaultSort: "updated_at",
  repScope: "t.owner_id = ?",
  writeRoles: ALL_ROLES,
  refs: { owner_id: "users", campaign_id: "campaigns" },
  derive: (d) => ({
    ...(d.company_name ? { name_normalized: normalizeName(String(d.company_name)) } : {}),
    domain: domainOf(d.website as string | null),
  }),
  async beforeWrite(c, d, existing) {
    if (d.status === "converted" && existing?.status !== "converted") {
      throw new ApiError(400, "invalid_status", "Use the Convert action to convert a prospect");
    }
    if (existing?.status === "converted" && d.status && d.status !== "converted") {
      throw new ApiError(400, "invalid_status", "A converted prospect cannot change status");
    }
    if (d.force || (existing && d.company_name === undefined && d.website === undefined)) return;
    const name = normalizeName(String(d.company_name ?? existing?.company_name));
    const domain = domainOf((d.website !== undefined ? d.website : existing?.website) as string);
    if (existing && name === existing.name_normalized && domain === existing.domain) return;
    const r = await c.env.DB.prepare(
      `SELECT 'prospect' AS kind, id, company_name AS name, website, status FROM prospects WHERE archived_at IS NULL AND id != ? AND (name_normalized = ? OR (? IS NOT NULL AND domain = ?))
       UNION ALL
       SELECT 'account', id, name, website, status FROM accounts WHERE archived_at IS NULL AND (name_normalized = ? OR (? IS NOT NULL AND domain = ?)) LIMIT 8`,
    )
      .bind(existing?.id ?? "", name, domain, domain, name, domain, domain)
      .all<Row>();
    if (r.results.length) throw duplicateError(r.results, "prospect or account");
  },
  extraStatements(c, id, _input, existing, after) {
    if (!after.campaign_id || after.campaign_id === existing?.campaign_id) return [];
    return [c.env.DB.prepare("INSERT OR IGNORE INTO campaign_prospects (campaign_id, prospect_id, created_at) VALUES (?,?,?)").bind(after.campaign_id, id, now())];
  },
};

// ─── Opportunities ───
export const opportunities: EntityDef = {
  route: "opportunities",
  table: "opportunities",
  entityType: "opportunity",
  label: "Opportunity",
  titleOf: (r) => String(r.name),
  schema: S.opportunitySchema,
  select: `t.*, a.name AS account_name, u.name AS owner_name, cp.name AS campaign_name,
    (pc.first_name || COALESCE(' ' || pc.last_name, '')) AS primary_contact_name,
    CAST(t.amount_minor * t.probability / 100 AS INTEGER) AS weighted_minor`,
  from: `opportunities t JOIN accounts a ON a.id = t.account_id ${OWNER_JOIN} LEFT JOIN campaigns cp ON cp.id = t.campaign_id LEFT JOIN contacts pc ON pc.id = t.primary_contact_id`,
  search: ["t.name", "a.name", "t.next_action"],
  filters: { stage: "t.stage", owner_id: "t.owner_id", account_id: "t.account_id", campaign_id: "t.campaign_id" },
  customFilters: {
    open: (v) => (v === "1" ? { sql: "t.stage NOT IN ('closed_won','closed_lost')", params: [] } : null),
    close_after: range("t.expected_close_date", ">="),
    close_before: range("t.expected_close_date", "<="),
  },
  sorts: { name: "t.name", amount_minor: "t.amount_minor", expected_close_date: "t.expected_close_date", stage: "t.stage", updated_at: "t.updated_at", account: "a.name" },
  defaultSort: "updated_at",
  repScope: "t.owner_id = ? OR t.account_id IN (SELECT id FROM accounts WHERE owner_id = ?)",
  repScopeParams: 2,
  writeRoles: ALL_ROLES,
  refs: { account_id: "accounts", primary_contact_id: "contacts", campaign_id: "campaigns", owner_id: "users" },
  async beforeWrite(c, d, existing) {
    if (d.primary_contact_id) {
      const accountId = d.account_id ?? existing?.account_id;
      const ok = await c.env.DB.prepare("SELECT 1 FROM contacts WHERE id = ? AND account_id = ?").bind(d.primary_contact_id, accountId).first();
      if (!ok) throw new ApiError(400, "invalid_reference", "The primary contact must belong to the opportunity's account");
    }
    const stageChanged = d.stage !== undefined && d.stage !== existing?.stage;
    if (stageChanged || !existing) {
      const stage = String(d.stage ?? "new");
      if (d.probability === undefined) d.probability = STAGE_PROBABILITY[stage];
      d.closed_at = CLOSED_STAGES.includes(stage) ? now() : null;
    }
  },
  extraStatements(c, id, input, existing, after) {
    if (!existing || input.stage === undefined || input.stage === existing.stage) return [];
    const user = c.get("user");
    const subject = `Stage: ${labelOf(OPPORTUNITY_STAGES, existing.stage as string)} → ${labelOf(OPPORTUNITY_STAGES, input.stage as string)}`;
    return [
      activityStmt(c.env.DB, { type: "stage_change", subject, actorId: user.id, opportunityId: id, accountId: after.account_id as string, meta: { from: existing.stage, to: input.stage } }),
      auditStmt(c.env.DB, { actorId: user.id, action: "stage_change", entityType: "opportunity", entityId: id, summary: subject, ip: clientIp(c) }),
    ];
  },
};

// ─── Tasks ───
export const tasks: EntityDef = {
  route: "tasks",
  table: "tasks",
  entityType: "task",
  label: "Task",
  titleOf: (r) => String(r.title),
  schema: S.taskSchema,
  select: `t.*, u.name AS owner_name, a.name AS account_name, p.company_name AS prospect_name, o.name AS opportunity_name,
    (ct.first_name || COALESCE(' ' || ct.last_name, '')) AS contact_name`,
  from: `tasks t ${OWNER_JOIN} LEFT JOIN accounts a ON a.id = t.account_id LEFT JOIN prospects p ON p.id = t.prospect_id
    LEFT JOIN opportunities o ON o.id = t.opportunity_id LEFT JOIN contacts ct ON ct.id = t.contact_id`,
  search: ["t.title", "t.description", "a.name", "p.company_name"],
  filters: { status: "t.status", owner_id: "t.owner_id", priority: "t.priority", type: "t.type", account_id: "t.account_id", contact_id: "t.contact_id", prospect_id: "t.prospect_id", opportunity_id: "t.opportunity_id" },
  customFilters: {
    open: (v) => (v === "1" ? { sql: "t.status IN ('open','in_progress')", params: [] } : null),
    due_before: range("t.due_at", "<"),
    due_after: range("t.due_at", ">="),
    mine: (v, u) => (v === "1" ? { sql: "t.owner_id = ?", params: [u.id] } : null),
  },
  sorts: { due_at: "t.due_at", priority: "CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END", title: "t.title", updated_at: "t.updated_at", status: "t.status" },
  defaultSort: "due_at",
  defaultDir: "asc",
  repScope: "t.owner_id = ? OR t.created_by = ?",
  repScopeParams: 2,
  writeRoles: ALL_ROLES,
  refs: { account_id: "accounts", contact_id: "contacts", prospect_id: "prospects", opportunity_id: "opportunities", owner_id: "users" },
  async beforeWrite(_c, d, existing) {
    const wasClosed = existing && ["completed", "cancelled"].includes(String(existing.status));
    if (wasClosed && d.status && ["open", "in_progress"].includes(String(d.status)) && !d.reopen) {
      throw new ApiError(409, "task_closed", "This task is closed. Confirm that you want to reopen it.");
    }
    if (d.status !== undefined && d.status !== existing?.status) {
      d.completed_at = d.status === "completed" ? now() : null;
    }
  },
  extraStatements(c, id, input, existing, after) {
    if (input.status !== "completed" || existing?.status === "completed") return [];
    return [
      activityStmt(c.env.DB, {
        type: "task_completed",
        subject: `Completed task: ${after.title}`,
        body: (after.outcome as string) ?? null,
        actorId: c.get("user").id,
        accountId: after.account_id as string,
        contactId: after.contact_id as string,
        prospectId: after.prospect_id as string,
        opportunityId: after.opportunity_id as string,
        meta: { task_id: id },
      }),
    ];
  },
};


// ─── Outreach (Phase 3) ───

export const templates: EntityDef = {
  route: "templates",
  table: "email_templates",
  entityType: "email_template",
  label: "Template",
  titleOf: (r) => String(r.name),
  schema: S.templateSchema,
  select: `t.*, u.name AS owner_name, p.name AS product_name`,
  from: `email_templates t ${OWNER_JOIN} LEFT JOIN products p ON p.id = t.product_id`,
  search: ["t.name", "t.subject", "t.body", "t.intended_industry"],
  filters: { status: "t.status", category: "t.category", product_id: "t.product_id", owner_id: "t.owner_id" },
  sorts: { name: "t.name", updated_at: "t.updated_at", category: "t.category" },
  defaultSort: "name",
  defaultDir: "asc",
  writeRoles: ALL_ROLES,
  refs: { product_id: "products" },
  async beforeWrite(c, d, existing) {
    const user = c.get("user");
    if (!existing) d.owner_id = user.id;
    else if (!isManager(user) && existing.owner_id !== user.id) {
      throw new ApiError(403, "forbidden", "Only the template's owner or a manager can change it");
    }
    const unknown = unknownPlaceholders((d.subject ?? existing?.subject) as string, (d.body ?? existing?.body) as string);
    if (unknown.length) {
      throw new ApiError(400, "unknown_placeholder", `Unsupported placeholder(s): ${unknown.map((u) => `{{${u}}}`).join(", ")}`, { unknown });
    }
  },
};

export const outreach: EntityDef = {
  route: "outreach",
  table: "outreach_messages",
  entityType: "outreach",
  label: "Outreach",
  titleOf: (r) => String(r.title),
  schema: S.outreachSchema,
  select: `t.*, u.name AS owner_name, a.name AS account_name, ct.email AS contact_email,
    (ct.first_name || COALESCE(' ' || ct.last_name, '')) AS contact_name, pr.company_name AS prospect_name,
    cp.name AS campaign_name, tp.name AS template_name, p.name AS product_name`,
  from: `outreach_messages t ${OWNER_JOIN} LEFT JOIN accounts a ON a.id = t.account_id LEFT JOIN contacts ct ON ct.id = t.contact_id
    LEFT JOIN prospects pr ON pr.id = t.prospect_id LEFT JOIN campaigns cp ON cp.id = t.campaign_id
    LEFT JOIN email_templates tp ON tp.id = t.template_id LEFT JOIN products p ON p.id = t.product_id`,
  search: ["t.title", "t.subject", "a.name", "ct.first_name", "ct.last_name", "ct.email", "pr.company_name"],
  filters: {
    status: "t.status", channel: "t.channel", account_id: "t.account_id", contact_id: "t.contact_id", prospect_id: "t.prospect_id",
    campaign_id: "t.campaign_id", owner_id: "t.owner_id", sequence_enrollment_id: "t.sequence_enrollment_id",
  },
  customFilters: {
    unsent: (v) => (v === "1" ? { sql: "t.status IN ('draft','ready_for_review','approved')", params: [] } : null),
    sent: (v) => (v === "1" ? { sql: "t.status IN ('sent','delivered','replied','bounced')", params: [] } : null),
  },
  sorts: { title: "t.title", updated_at: "t.updated_at", planned_send_at: "t.planned_send_at", sent_at: "t.sent_at", status: "t.status" },
  defaultSort: "updated_at",
  repScope: "t.owner_id = ? OR t.account_id IN (SELECT id FROM accounts WHERE owner_id = ?)",
  repScopeParams: 2,
  writeRoles: ALL_ROLES,
  refs: { contact_id: "contacts", account_id: "accounts", prospect_id: "prospects", campaign_id: "campaigns", product_id: "products", template_id: "email_templates", owner_id: "users" },
  async beforeWrite(c, d, existing) {
    if (d.channel === "brevo" && !c.env.BREVO_API_KEY) {
      throw new ApiError(400, "not_available", "Brevo is not configured. Use the manual email workflow.");
    }
    if (existing && !UNSENT_OUTREACH_STATUSES.includes(String(existing.status))) {
      const locked = ["subject", "body", "channel", "contact_id", "account_id", "prospect_id", "status"].filter((k) => d[k] !== undefined && d[k] !== existing[k]);
      if (locked.length) throw new ApiError(409, "already_sent", "This message has already been sent; its content and status can no longer be edited");
    }
    if (d.contact_id && d.account_id === undefined && !existing?.account_id) {
      const ct = await c.env.DB.prepare("SELECT account_id FROM contacts WHERE id = ?").bind(d.contact_id).first<{ account_id: string | null }>();
      d.account_id = ct?.account_id ?? null;
    }
    const merged = { ...existing, ...d };
    if (!merged.contact_id && !merged.account_id && !merged.prospect_id) {
      throw new ApiError(400, "validation_error", "Link the outreach to a contact, account or prospect");
    }
    const unknown = unknownPlaceholders(merged.subject as string, merged.body as string);
    if (unknown.length) throw new ApiError(400, "unknown_placeholder", `Unsupported placeholder(s): ${unknown.map((u) => `{{${u}}}`).join(", ")}`);
    if (merged.status === "approved" || merged.status === "ready_for_review") {
      if (!merged.body) throw new ApiError(400, "validation_error", "Write the message before submitting it");
      if (merged.status === "approved" && hasUnresolved(merged.subject as string, merged.body as string)) {
        throw new ApiError(400, "unresolved_placeholders", "Resolve every {{placeholder}} before approving");
      }
    }
  },
};

export const sequences: EntityDef = {
  route: "sequences",
  table: "outreach_sequences",
  entityType: "sequence",
  label: "Sequence",
  titleOf: (r) => String(r.name),
  schema: S.sequenceSchema,
  select: `t.*, u.name AS owner_name,
    (SELECT COUNT(*) FROM sequence_steps s WHERE s.sequence_id = t.id) AS step_count,
    (SELECT MAX(day_offset) FROM sequence_steps s WHERE s.sequence_id = t.id) AS span_days,
    (SELECT COUNT(*) FROM sequence_enrollments e WHERE e.sequence_id = t.id AND e.status = 'active') AS active_enrollments`,
  from: `outreach_sequences t ${OWNER_JOIN}`,
  search: ["t.name", "t.description"],
  filters: { status: "t.status" },
  sorts: { name: "t.name", updated_at: "t.updated_at" },
  defaultSort: "name",
  defaultDir: "asc",
  writeRoles: ["admin", "manager"],
  virtual: ["steps"],
  async beforeWrite(c, d, existing) {
    if (!existing) {
      d.owner_id = c.get("user").id;
      if (!Array.isArray(d.steps) || !d.steps.length) throw new ApiError(400, "validation_error", "Add at least one step");
    }
    for (const s of (d.steps as Row[] | undefined) ?? []) {
      if (s.template_id && !(await c.env.DB.prepare("SELECT 1 FROM email_templates WHERE id = ?").bind(s.template_id).first())) {
        throw new ApiError(400, "invalid_reference", "A step uses a template that does not exist");
      }
    }
  },
  extraStatements(c, id, input) {
    if (!Array.isArray(input.steps)) return [];
    const db = c.env.DB;
    const steps = [...(input.steps as Row[])].sort((a, b) => Number(a.day_offset) - Number(b.day_offset));
    return [
      db.prepare("DELETE FROM sequence_steps WHERE sequence_id = ?").bind(id),
      ...steps.map((s, i) =>
        db.prepare("INSERT INTO sequence_steps (id, sequence_id, position, day_offset, channel, template_id, task_type, note) VALUES (?,?,?,?,?,?,?,?)").bind(
          crypto.randomUUID(), id, i + 1, s.day_offset, s.channel, s.template_id ?? null, s.task_type ?? "send_email", s.note ?? null,
        ),
      ),
    ];
  },
};


// ─── Price book ───
export const packages: EntityDef = {
  route: "packages",
  table: "product_packages",
  entityType: "package",
  label: "Package",
  titleOf: (r) => String(r.name),
  schema: S.packageSchema,
  select: `t.*, p.name AS product_name, p.sku AS product_sku, p.category AS product_category`,
  from: `product_packages t JOIN products p ON p.id = t.product_id`,
  search: ["t.name", "t.description", "p.name", "p.sku"],
  filters: { product_id: "t.product_id", status: "t.status", category: "p.category" },
  sorts: { position: "p.category, p.name, t.position", name: "t.name", price_minor: "t.price_minor", updated_at: "t.updated_at" },
  defaultSort: "position",
  defaultDir: "asc",
  writeRoles: ["admin", "manager"],
  refs: { product_id: "products" },
};

// ─── Sales assets (files live in private R2; see routes/assets.ts) ───
export const assets: EntityDef = {
  route: "assets",
  table: "sales_assets",
  entityType: "sales_asset",
  label: "Asset",
  titleOf: (r) => String(r.name),
  schema: S.assetUpdateSchema,
  select: `t.*, u.name AS owner_name,
    (SELECT COUNT(*) FROM asset_associations aa WHERE aa.asset_id = t.id) AS link_count,
    NOT EXISTS (SELECT 1 FROM sales_assets n WHERE n.previous_version_id = t.id) AS is_latest`,
  from: `sales_assets t ${OWNER_JOIN}`,
  search: ["t.name", "t.description", "t.file_name", "t.intended_industry"],
  filters: { type: "t.type", visibility: "t.visibility", owner_id: "t.owner_id", source: "t.source" },
  customFilters: {
    latest: (v) => (v === "1" ? { sql: "NOT EXISTS (SELECT 1 FROM sales_assets n WHERE n.previous_version_id = t.id)", params: [] } : null),
    linked: (v) => {
      const [type, id] = v.split(":");
      return type && id ? { sql: "t.id IN (SELECT asset_id FROM asset_associations WHERE entity_type = ? AND entity_id = ?)", params: [type, id] } : null;
    },
  },
  sorts: { name: "t.name", updated_at: "t.updated_at", type: "t.type", size_bytes: "t.size_bytes" },
  defaultSort: "updated_at",
  repScope: "t.visibility = 'internal' OR t.owner_id = ?",
  writeRoles: ALL_ROLES,
  refs: { owner_id: "users" },
  async beforeWrite(c, d, existing) {
    const user = c.get("user");
    if (existing && !isManager(user) && existing.owner_id !== user.id) throw new ApiError(403, "forbidden", "Only the asset's owner or a manager can change it");
    if (!existing) {
      d.source = "upload";
      d.created_by = user.id;
      if (!d.external_url) throw new ApiError(400, "validation_error", "Upload a file or provide an external URL");
    }
  },
};

export const ENTITIES = { accounts, contacts, products, campaigns, prospects, opportunities, tasks, templates, outreach, sequences, packages, assets };
