import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { auditRunSchema, competitorSchema } from "../../shared/schemas";
import { ApiError, notFound, parseJson } from "../lib/http";
import { auditStmt } from "../lib/audit-log";
import { clientIp } from "../lib/auth";
import { fetchOne } from "../lib/entity";
import { domainOf, newId, now } from "../lib/util";
import { ENTITIES } from "../entities";
import { AUDIT_TYPES, auditType } from "../audits/registry";
import { assertPublicUrl } from "../audits/crawler";
import { enqueue } from "../jobs";
import { saveAssessment } from "./crm";

type Row = Record<string, unknown>;
export const auditRoutes = new Hono<AppEnv>();

auditRoutes.get("/audits/types", (c) =>
  c.json({
    data: AUDIT_TYPES.map(({ rubric, requiresKey, ...t }) => ({
      ...t,
      categories: rubric?.categories ?? [],
      configured: requiresKey ? Boolean(c.env[requiresKey]) : true,
    })),
  }),
);

auditRoutes.get("/accounts/:id/audits", async (c) => {
  const id = c.req.param("id");
  await fetchOne(c, ENTITIES.accounts, id);
  const r = await c.env.DB.prepare(
    `SELECT r.id, r.audit_type, r.audit_version, r.target, r.status, r.progress, r.overall_score, r.error, r.created_at, r.completed_at, u.name AS initiated_by_name,
       (SELECT COUNT(*) FROM audit_findings f WHERE f.run_id = r.id AND f.result IN ('fail','warn')) AS issue_count
     FROM audit_runs r LEFT JOIN users u ON u.id = r.initiated_by WHERE r.account_id = ? ORDER BY r.created_at DESC LIMIT 100`,
  )
    .bind(id)
    .all();
  return c.json({ data: r.results });
});

auditRoutes.post("/accounts/:id/audits", async (c) => {
  const accountId = c.req.param("id");
  const account = await fetchOne(c, ENTITIES.accounts, accountId);
  const input = await parseJson(c, auditRunSchema);
  const type = auditType(input.audit_type);
  if (!type) throw new ApiError(400, "validation_error", "Unknown audit type");
  if (type.requiresKey && !c.env[type.requiresKey]) throw new ApiError(400, "not_configured", `${type.label} needs a ${type.requiresLabel}. Add it in Settings → Configuration.`);
  let target: string;
  if (type.needs === "website" || type.needs === "competitors") {
    target = input.target ?? (account.website as string) ?? "";
    if (!target) throw new ApiError(400, "missing_target", "Add the account's website (or enter a URL) before running this audit");
    try {
      assertPublicUrl(target);
    } catch (e) {
      throw new ApiError(400, "invalid_target", e instanceof Error ? e.message : "Invalid URL");
    }
    if (type.needs === "competitors") {
      const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM account_competitors ac JOIN competitors x ON x.id = ac.competitor_id WHERE ac.account_id = ? AND x.website IS NOT NULL").bind(accountId).first<{ n: number }>();
      if (!n?.n) throw new ApiError(400, "no_competitors", "Add at least one competitor with a website first (Audits tab → Competitors)");
    }
  } else if (type.needs === "website_or_profiles") {
    const any = ["website", "linkedin_url", "instagram_url", "facebook_url", "youtube_url"].some((k) => account[k]);
    if (!any) throw new ApiError(400, "missing_target", "Add the website or at least one social profile to the account first");
    target = String(account.website ?? account.linkedin_url ?? account.instagram_url ?? account.facebook_url ?? account.youtube_url);
  } else {
    target = [account.name, account.city].filter(Boolean).join(", ");
  }
  const running = await c.env.DB.prepare("SELECT id FROM audit_runs WHERE account_id = ? AND audit_type = ? AND status IN ('queued','running') AND created_at > ?")
    .bind(accountId, type.key, new Date(Date.now() - 5 * 60_000).toISOString())
    .first();
  if (running) throw new ApiError(409, "already_running", "This audit is already running for this account");

  const user = c.get("user");
  const id = newId();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO audit_runs (id, account_id, audit_type, audit_version, target, config, status, initiated_by, created_at) VALUES (?,?,?,?,?,?, 'queued', ?, ?)").bind(
      id, accountId, type.key, type.version, target, JSON.stringify({}), user.id, now(),
    ),
    auditStmt(c.env.DB, { actorId: user.id, action: "audit_run", entityType: "account", entityId: accountId, summary: `Started ${type.label} (${target})`, ip: clientIp(c) }),
  ]);
  await enqueue(c.env, c.executionCtx, { kind: "audit", runId: id, userId: user.id, accountId });
  return c.json({ data: { id, status: "queued" } }, 202);
});

async function loadRun(c: Context<AppEnv>, id: string) {
  const run = await c.env.DB.prepare(
    "SELECT r.*, u.name AS initiated_by_name, a.name AS account_name FROM audit_runs r LEFT JOIN users u ON u.id = r.initiated_by JOIN accounts a ON a.id = r.account_id WHERE r.id = ?",
  )
    .bind(id)
    .first<Row>();
  if (!run) throw notFound("Audit");
  await fetchOne(c, ENTITIES.accounts, String(run.account_id));
  return run;
}

export async function loadRunDetail(c: Context<AppEnv>, id: string) {
  const run = await loadRun(c, id);
  const db = c.env.DB;
  const [breakdowns, findings, evidence, products] = await db.batch<Row>([
    db.prepare("SELECT * FROM audit_score_breakdowns WHERE run_id = ? ORDER BY rowid").bind(run.id),
    db.prepare("SELECT * FROM audit_findings WHERE run_id = ? ORDER BY position").bind(run.id),
    db.prepare("SELECT e.* FROM audit_evidence e JOIN audit_findings f ON f.id = e.finding_id WHERE f.run_id = ?").bind(run.id),
    db.prepare("SELECT id, name, sku FROM products WHERE archived_at IS NULL AND status = 'active'"),
  ]);
  const bySku = new Map(products.results.map((p) => [p.sku as string, p]));
  const ev = new Map<string, Row[]>();
  evidence.results.forEach((e) => ev.set(e.finding_id as string, [...(ev.get(e.finding_id as string) ?? []), e]));
  return {
    ...run,
    type_label: auditType(String(run.audit_type))?.label ?? run.audit_type,
    scope: run.scope ? JSON.parse(String(run.scope)) : null,
    warnings: run.warnings ? JSON.parse(String(run.warnings)) : [],
    categories: breakdowns.results,
    findings: findings.results.map((f) => ({
      ...f,
      evidence: ev.get(f.id as string) ?? [],
      related_products: (JSON.parse(String(f.related_skus ?? "[]")) as string[]).map((s) => bySku.get(s)).filter(Boolean),
    })),
  };
}

auditRoutes.get("/audits/:id", async (c) => c.json({ data: await loadRunDetail(c, c.req.param("id")) }));

auditRoutes.post("/audits/:id/cancel", async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  if (!["queued", "running"].includes(String(run.status))) throw new ApiError(409, "not_running", "Only queued or running audits can be cancelled");
  await c.env.DB.prepare("UPDATE audit_runs SET status = 'cancelled', completed_at = ? WHERE id = ? AND status IN ('queued','running')").bind(now(), run.id).run();
  return c.json({ data: { ok: true } });
});

auditRoutes.get("/audits/:id/compare", async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  const db = c.env.DB;
  const other = c.req.query("with")
    ? await db.prepare("SELECT * FROM audit_runs WHERE id = ? AND account_id = ? AND audit_type = ?").bind(c.req.query("with"), run.account_id, run.audit_type).first<Row>()
    : await db
        .prepare("SELECT * FROM audit_runs WHERE account_id = ? AND audit_type = ? AND created_at < ? AND status IN ('completed','completed_warnings') ORDER BY created_at DESC LIMIT 1")
        .bind(run.account_id, run.audit_type, run.created_at)
        .first<Row>();
  if (!other) return c.json({ data: null });
  const [a, b] = await db.batch<Row>([
    db.prepare("SELECT check_id, title, result FROM audit_findings WHERE run_id = ?").bind(other.id),
    db.prepare("SELECT check_id, title, result FROM audit_findings WHERE run_id = ?").bind(run.id),
  ]);
  const before = new Map(a.results.map((f) => [f.check_id, f]));
  const bad = (r: unknown) => r === "fail" || r === "warn";
  return c.json({
    data: {
      previous: { id: other.id, created_at: other.created_at, overall_score: other.overall_score, audit_version: other.audit_version },
      score_change: run.overall_score !== null && other.overall_score !== null ? Number(run.overall_score) - Number(other.overall_score) : null,
      same_rubric: other.audit_version === run.audit_version,
      resolved: b.results.filter((f) => !bad(f.result) && f.result !== "unavailable" && bad(before.get(f.check_id)?.result)).map((f) => f.title),
      new_issues: b.results.filter((f) => bad(f.result) && !bad(before.get(f.check_id)?.result)).map((f) => f.title),
    },
  });
});

auditRoutes.post("/audits/:id/apply-services", async (c) => {
  const run = await loadRun(c, c.req.param("id"));
  const { product_ids, finding_ids } = await parseJson(
    c,
    z.object({ product_ids: z.array(z.string().max(64)).min(1).max(30), finding_ids: z.array(z.string().max(64)).max(100).default([]) }),
  );
  const findings = finding_ids.length
    ? (await c.env.DB.prepare(`SELECT title FROM audit_findings WHERE run_id = ? AND id IN (${finding_ids.map(() => "?").join(",")})`).bind(run.id, ...finding_ids).all<{ title: string }>()).results
    : [];
  const type = auditType(String(run.audit_type));
  const note = `From ${type?.label ?? "audit"} on ${String(run.created_at).slice(0, 10)}${findings.length ? `: ${findings.map((f) => f.title).join("; ")}` : ""}`.slice(0, 2000);
  const existing = await c.env.DB.prepare(`SELECT product_id, status FROM account_service_assessments WHERE account_id = ?`).bind(run.account_id).all<{ product_id: string; status: string }>();
  const current = new Map(existing.results.map((r) => [r.product_id, r.status]));
  let updated = 0;
  for (const pid of product_ids) {
    const s = current.get(pid) ?? "not_assessed";
    if (!["not_assessed", "needs_assessment"].includes(s)) continue;
    await saveAssessment(c, String(run.account_id), pid, "relevant", note, `audit:${run.id}`);
    updated++;
  }
  return c.json({ data: { updated, skipped: product_ids.length - updated } });
});

// ─── Competitors ───
auditRoutes.get("/accounts/:id/competitors", async (c) => {
  const id = c.req.param("id");
  await fetchOne(c, ENTITIES.accounts, id);
  const r = await c.env.DB.prepare("SELECT x.* FROM account_competitors ac JOIN competitors x ON x.id = ac.competitor_id WHERE ac.account_id = ? ORDER BY x.name").bind(id).all();
  return c.json({ data: r.results });
});

auditRoutes.post("/accounts/:id/competitors", async (c) => {
  const id = c.req.param("id");
  await fetchOne(c, ENTITIES.accounts, id);
  const input = await parseJson(c, competitorSchema);
  if (input.website) {
    try {
      assertPublicUrl(input.website);
    } catch (e) {
      throw new ApiError(400, "invalid_target", e instanceof Error ? e.message : "Invalid URL");
    }
  }
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM account_competitors WHERE account_id = ?").bind(id).first<{ n: number }>();
  if ((count?.n ?? 0) >= 10) throw new ApiError(400, "limit", "Up to 10 competitors per account");
  const domain = domainOf(input.website);
  const existing = domain ? await c.env.DB.prepare("SELECT id FROM competitors WHERE domain = ?").bind(domain).first<{ id: string }>() : null;
  const cid = existing?.id ?? newId();
  const t = now();
  await c.env.DB.batch([
    ...(existing ? [] : [c.env.DB.prepare("INSERT INTO competitors (id, name, website, domain, notes, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(cid, input.name, input.website ?? null, domain, input.notes ?? null, c.get("user").id, t, t)]),
    c.env.DB.prepare("INSERT OR IGNORE INTO account_competitors (account_id, competitor_id, created_at) VALUES (?,?,?)").bind(id, cid, t),
  ]);
  return c.json({ data: { id: cid } }, 201);
});

auditRoutes.delete("/accounts/:id/competitors/:cid", async (c) => {
  const id = c.req.param("id");
  await fetchOne(c, ENTITIES.accounts, id);
  await c.env.DB.prepare("DELETE FROM account_competitors WHERE account_id = ? AND competitor_id = ?").bind(id, c.req.param("cid")).run();
  return c.json({ data: { ok: true } });
});
