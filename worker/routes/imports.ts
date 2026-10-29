// CSV import (prospects) with mapping, row validation, duplicate review and explicit
// confirmation; CSV export that respects record visibility and is audit-logged.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { importCommitSchema, importPreviewSchema, prospectSchema } from "../../shared/schemas";
import { ApiError, notFound, parseJson } from "../lib/http";
import { auditStmt } from "../lib/audit-log";
import { clientIp, isManager } from "../lib/auth";
import { scopeClause, type EntityDef } from "../lib/entity";
import { computeQualification } from "../lib/qualification";
import { b, domainOf, newId, normalizeName, now } from "../lib/util";
import { ENTITIES } from "../entities";

type Row = Record<string, unknown>;
export const importRoutes = new Hono<AppEnv>();

/** RFC 4180 CSV parser (quotes, escaped quotes, CRLF, embedded newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') (field += '"'), i++;
        else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") (row.push(field), (field = ""));
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}

export const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const PROSPECT_FIELDS: { field: string; label: string; synonyms: string[] }[] = [
  { field: "company_name", label: "Company name", synonyms: ["company", "business", "organisation", "organization", "name", "businessname"] },
  { field: "website", label: "Website", synonyms: ["url", "site", "web", "domain"] },
  { field: "industry", label: "Industry", synonyms: ["category", "sector", "vertical"] },
  { field: "geography", label: "Location", synonyms: ["city", "location", "region", "area", "state"] },
  { field: "company_size", label: "Company size", synonyms: ["size", "employees"] },
  { field: "contact_name", label: "Contact name", synonyms: ["contact", "person", "owner", "fullname"] },
  { field: "contact_title", label: "Contact title", synonyms: ["title", "designation", "role", "position"] },
  { field: "email", label: "Email", synonyms: ["mail", "emailaddress"] },
  { field: "phone", label: "Phone", synonyms: ["mobile", "phonenumber", "contactnumber", "telephone"] },
  { field: "linkedin_url", label: "LinkedIn URL", synonyms: ["linkedin"] },
  { field: "service_fit", label: "Service fit", synonyms: ["services", "need", "interest"] },
  { field: "estimated_value", label: "Estimated value (INR)", synonyms: ["value", "budget", "dealvalue"] },
  { field: "research_notes", label: "Research notes", synonyms: ["notes", "remarks", "comments"] },
  { field: "next_action", label: "Next action", synonyms: ["nextstep", "action"] },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function autoMap(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const f of PROSPECT_FIELDS) {
    const idx = headers.findIndex((h) => norm(h) === norm(f.field) || norm(h) === norm(f.label) || f.synonyms.includes(norm(h)));
    if (idx >= 0 && !Object.values(m).includes(headers[idx])) m[f.field] = headers[idx];
  }
  return m;
}

importRoutes.get("/template/prospects.csv", () => {
  const header = PROSPECT_FIELDS.map((f) => f.label).join(",");
  const example = ["Example Hospital", "examplehospital.in", "Healthcare", "Kolkata", "51-200", "Asha Roy", "Director", "asha@examplehospital.in", "+91 98300 00000", "", "SEO; website redesign", "150000", "Found via referral", "Call next week"].map(csvCell).join(",");
  return new Response(`${header}\n${example}\n`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="gexart-prospects-template.csv"' } });
});

interface PreviewRow {
  index: number;
  status: "valid" | "duplicate" | "error";
  data: Row;
  errors: string[];
  duplicate?: { kind: string; id: string | null; name: string };
}

importRoutes.post("/prospects/preview", async (c) => {
  const input = await parseJson(c, importPreviewSchema);
  const user = c.get("user");
  const rows = parseCsv(input.csv);
  if (rows.length < 2) throw new ApiError(400, "validation_error", "The file needs a header row and at least one data row");
  if (rows.length > 5001) throw new ApiError(400, "validation_error", "Import up to 5,000 rows at a time");
  const headers = rows[0].map((h) => h.trim());
  const mapping = input.mapping && Object.keys(input.mapping).length ? input.mapping : autoMap(headers);
  if (!mapping.company_name) throw new ApiError(400, "mapping_required", "Map a column to Company name", { headers, mapping });

  const out: PreviewRow[] = rows.slice(1).map((cells, i) => {
    const get = (field: string) => {
      const col = mapping[field];
      const idx = col ? headers.indexOf(col) : -1;
      return idx >= 0 ? (cells[idx] ?? "").trim() : "";
    };
    const raw: Row = Object.fromEntries(PROSPECT_FIELDS.filter((f) => f.field !== "estimated_value").map((f) => [f.field, get(f.field)]));
    const value = get("estimated_value").replace(/[^\d.]/g, "");
    if (value) raw.estimated_value_minor = Math.round(Number(value) * 100);
    raw.discovery_source = "csv_import";
    raw.status = "discovered";
    const parsed = prospectSchema.safeParse(raw);
    if (!parsed.success) {
      return { index: i, status: "error", data: raw, errors: parsed.error.issues.map((x) => `${x.path.join(".") || "row"}: ${x.message}`) };
    }
    return { index: i, status: "valid", data: parsed.data as Row, errors: [] };
  });

  // Duplicate detection: within the file, then against existing prospects and accounts.
  const seen = new Map<string, number>();
  for (const r of out.filter((x) => x.status === "valid")) {
    const keys = [`n:${normalizeName(String(r.data.company_name))}`, ...(domainOf(r.data.website as string) ? [`d:${domainOf(r.data.website as string)}`] : [])];
    const hit = keys.find((k) => seen.has(k));
    if (hit !== undefined) {
      r.status = "duplicate";
      r.duplicate = { kind: "row in this file", id: null, name: `row ${seen.get(hit)! + 2}` };
    } else keys.forEach((k) => seen.set(k, r.index));
  }
  const names = [...new Set(out.filter((r) => r.status === "valid").map((r) => normalizeName(String(r.data.company_name))))];
  const domains = [...new Set(out.filter((r) => r.status === "valid").map((r) => domainOf(r.data.website as string)).filter((d): d is string => !!d))];
  const existing: Row[] = [];
  for (let i = 0; i < Math.max(names.length, domains.length); i += 40) {
    const n = names.slice(i, i + 40);
    const d = domains.slice(i, i + 40);
    const nIn = n.length ? n.map(() => "?").join(",") : "NULL";
    const dIn = d.length ? d.map(() => "?").join(",") : "NULL";
    const r = await c.env.DB.prepare(
      `SELECT 'prospect' AS kind, id, company_name AS name, name_normalized, domain FROM prospects WHERE archived_at IS NULL AND (name_normalized IN (${nIn}) OR domain IN (${dIn}))
       UNION ALL SELECT 'account', id, name, name_normalized, domain FROM accounts WHERE archived_at IS NULL AND (name_normalized IN (${nIn}) OR domain IN (${dIn}))`,
    )
      .bind(...n, ...d, ...n, ...d)
      .all<Row>();
    existing.push(...r.results);
  }
  for (const r of out.filter((x) => x.status === "valid")) {
    const nm = normalizeName(String(r.data.company_name));
    const dm = domainOf(r.data.website as string);
    const hit = existing.find((e) => e.name_normalized === nm || (dm && e.domain === dm));
    if (hit) (r.status = "duplicate"), (r.duplicate = { kind: String(hit.kind), id: String(hit.id), name: String(hit.name) });
  }

  const id = newId();
  const key = `imports/${id}.json`;
  await c.env.FILES.put(key, JSON.stringify(out), { httpMetadata: { contentType: "application/json" } });
  const counts = { valid: out.filter((r) => r.status === "valid").length, duplicate: out.filter((r) => r.status === "duplicate").length, error: out.filter((r) => r.status === "error").length };
  await c.env.DB.prepare(
    "INSERT INTO import_jobs (id, entity, file_name, status, total_rows, valid_rows, duplicate_rows, error_rows, mapping, payload_key, errors, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(id, "prospects", b(input.file_name), "previewed", out.length, counts.valid, counts.duplicate, counts.error, JSON.stringify(mapping), key, JSON.stringify(out.filter((r) => r.status === "error").map((r) => ({ row: r.index + 2, errors: r.errors }))), user.id, now())
    .run();
  return c.json({ data: { id, headers, mapping, fields: PROSPECT_FIELDS.map(({ field, label }) => ({ field, label })), counts, rows: out } });
});

importRoutes.post("/:id/commit", async (c) => {
  const user = c.get("user");
  const job = await c.env.DB.prepare("SELECT * FROM import_jobs WHERE id = ?").bind(c.req.param("id")).first<Row>();
  if (!job || (job.created_by !== user.id && !isManager(user))) throw notFound("Import");
  if (job.status !== "previewed") throw new ApiError(409, "already_imported", "This import has already been processed");
  const input = await parseJson(c, importCommitSchema);
  const obj = await c.env.FILES.get(String(job.payload_key));
  if (!obj) throw new ApiError(409, "expired", "The preview data is no longer available. Upload the file again.");
  const rows = (await obj.json()) as PreviewRow[];
  const wanted = new Set(input.rows);
  const chosen = rows.filter((r) => wanted.has(r.index) && (r.status === "valid" || (r.status === "duplicate" && input.include_duplicates)));
  const campaign = input.campaign_id ? await c.env.DB.prepare("SELECT id, target_industry, target_geography FROM campaigns WHERE id = ?").bind(input.campaign_id).first<Row>() : null;
  if (input.campaign_id && !campaign) throw notFound("Campaign");
  const owner = input.owner_id && isManager(user) ? input.owner_id : user.id;
  const t = now();
  const db = c.env.DB;
  // Claim the job first so a double-click cannot import twice.
  const claim = await db.prepare("UPDATE import_jobs SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'previewed'").bind(t, job.id).run();
  if (!claim.meta.changes) throw new ApiError(409, "already_imported", "This import has already been processed");
  let created = 0;
  for (let i = 0; i < chosen.length; i += 40) {
    const stmts: D1PreparedStatement[] = [];
    for (const r of chosen.slice(i, i + 40)) {
      const d = r.data;
      const pid = newId();
      const q = computeQualification({ ...(d as Record<string, string>), campaign: campaign as never });
      stmts.push(
        db.prepare(
          `INSERT INTO prospects (id, company_name, name_normalized, website, domain, industry, geography, company_size, contact_name, contact_title, email, phone, linkedin_url,
             discovery_source, campaign_id, service_fit, estimated_value_minor, currency, status, owner_id, research_notes, next_action,
             qualification_score, qualification_level, qualification_factors, qualification_scored_at, created_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'csv_import', ?,?,?, 'INR', 'discovered', ?,?,?, ?,?,?,?, ?,?,?)`,
        ).bind(
          pid, d.company_name, normalizeName(String(d.company_name)), b(d.website), domainOf(d.website as string), b(d.industry), b(d.geography), b(d.company_size), b(d.contact_name), b(d.contact_title),
          b(d.email), b(d.phone), b(d.linkedin_url), b(campaign?.id), b(d.service_fit), b(d.estimated_value_minor), owner, b(d.research_notes), b(d.next_action),
          q.score, q.level, JSON.stringify(q.factors), t, user.id, t, t,
        ),
      );
      if (campaign) stmts.push(db.prepare("INSERT OR IGNORE INTO campaign_prospects (campaign_id, prospect_id, created_at) VALUES (?,?,?)").bind(campaign.id, pid, t));
      created++;
    }
    await db.batch(stmts);
  }
  await db.batch([
    db.prepare("UPDATE import_jobs SET created_rows = ? WHERE id = ?").bind(created, job.id),
    auditStmt(db, { actorId: user.id, action: "import", entityType: "prospect", entityId: String(job.id), summary: `Imported ${created} prospect(s) from ${job.file_name ?? "CSV"}`, ip: clientIp(c) }),
  ]);
  c.executionCtx.waitUntil(c.env.FILES.delete(String(job.payload_key)));
  return c.json({ data: { created, skipped: rows.length - created } });
});

importRoutes.get("/", async (c) => {
  const user = c.get("user");
  const r = await c.env.DB.prepare(
    `SELECT j.id, j.entity, j.file_name, j.status, j.total_rows, j.valid_rows, j.duplicate_rows, j.error_rows, j.created_rows, j.created_at, j.completed_at, u.name AS created_by_name
     FROM import_jobs j LEFT JOIN users u ON u.id = j.created_by ${isManager(user) ? "" : "WHERE j.created_by = ?"} ORDER BY j.created_at DESC LIMIT 50`,
  )
    .bind(...(isManager(user) ? [] : [user.id]))
    .all();
  return c.json({ data: r.results });
});

importRoutes.get("/:id/errors.csv", async (c) => {
  const user = c.get("user");
  const job = await c.env.DB.prepare("SELECT * FROM import_jobs WHERE id = ?").bind(c.req.param("id")).first<Row>();
  if (!job || (job.created_by !== user.id && !isManager(user))) throw notFound("Import");
  const errs = JSON.parse(String(job.errors ?? "[]")) as { row: number; errors: string[] }[];
  const csv = ["Row,Errors", ...errs.map((e) => `${e.row},${csvCell(e.errors.join("; "))}`)].join("\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="import-${job.id}-errors.csv"` } });
});

// ─── Export ───
const EXPORT_COLUMNS: Record<string, string[]> = {
  accounts: ["name", "website", "industry", "company_size", "city", "state", "country", "email", "phone", "type", "status", "qualification", "lead_source", "owner_name", "created_at", "updated_at"],
  contacts: ["first_name", "last_name", "job_title", "account_name", "email", "phone", "decision_role", "status", "last_contacted_at", "next_follow_up_at", "owner_name", "created_at"],
  prospects: ["company_name", "website", "industry", "geography", "contact_name", "contact_title", "email", "phone", "status", "qualification_level", "qualification_score", "service_fit", "campaign_name", "owner_name", "created_at"],
  opportunities: ["name", "account_name", "stage", "amount_minor", "currency", "probability", "expected_close_date", "owner_name", "campaign_name", "created_at", "closed_at"],
  tasks: ["title", "type", "status", "priority", "due_at", "account_name", "contact_name", "owner_name", "completed_at", "outcome"],
  products: ["name", "sku", "category", "pricing_model", "default_price_minor", "currency", "billing_frequency", "status", "internal_cost_minor"],
};

importRoutes.get("/export/:entity", async (c) => {
  const entity = c.req.param("entity").replace(/\.csv$/, "");
  const def = (ENTITIES as Record<string, EntityDef>)[entity];
  let cols = EXPORT_COLUMNS[entity];
  if (!def || !cols) throw notFound("Export");
  const user = c.get("user");
  if (!isManager(user)) cols = cols.filter((x) => x !== "internal_cost_minor");
  const scope = scopeClause(def, user);
  const where = ["t.archived_at IS NULL", ...(scope ? [scope.sql] : [])];
  const params: unknown[] = [...(scope?.params ?? [])];
  const q = c.req.query();
  for (const [key, col] of Object.entries(def.filters)) {
    if (!q[key]) continue;
    const vals = q[key].split(",").slice(0, 20);
    where.push(`${col} IN (${vals.map(() => "?").join(",")})`);
    params.push(...vals);
  }
  const r = await c.env.DB.prepare(`SELECT ${def.select} FROM ${def.from} WHERE ${where.join(" AND ")} ORDER BY t.created_at DESC LIMIT 10000`).bind(...params).all<Row>();
  const rows = r.results.map((row) => cols.map((k) => (k.endsWith("_minor") && row[k] !== null && row[k] !== undefined ? Number(row[k]) / 100 : row[k])));
  const header = cols.map((k) => k.replace(/_minor$/, "")).join(",");
  const csv = [header, ...rows.map((cells) => cells.map(csvCell).join(","))].join("\n");
  await auditStmt(c.env.DB, { actorId: user.id, action: "export", entityType: def.entityType, entityId: null, summary: `Exported ${r.results.length} ${entity}`, ip: clientIp(c) }).run();
  return new Response(`﻿${csv}\n`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="gexart-${entity}-${now().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
});
