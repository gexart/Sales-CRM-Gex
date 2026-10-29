// Executes one queued audit run and persists findings, evidence and scores.
// Safe to retry: only a run still in "queued" status is picked up.
import type { Env } from "../env";
import { crawl } from "./crawler";
import { evaluate, SCOPE_NOTE } from "./rubrics";
import { auditType } from "./registry";
import { competitorAudit, detectTech, gbpAudit, socialAudit, type AuditOutcome } from "./extra";
import { activityStmt } from "../lib/audit-log";
import { newId, now } from "../lib/util";

type Row = Record<string, unknown>;

export async function runAudit(env: Env, runId: string, userId: string, accountId: string) {
  const db = env.DB;
  const claimed = await db.prepare("UPDATE audit_runs SET status = 'running', started_at = ?, progress = 5 WHERE id = ? AND status = 'queued'").bind(now(), runId).run();
  if (!claimed.meta.changes) return;
  const run = (await db.prepare("SELECT * FROM audit_runs WHERE id = ?").bind(runId).first<Row>())!;
  const account = (await db.prepare("SELECT * FROM accounts WHERE id = ?").bind(accountId).first<Row>())!;
  const type = auditType(String(run.audit_type))!;
  const progress = (p: number) => db.prepare("UPDATE audit_runs SET progress = ? WHERE id = ? AND status = 'running'").bind(Math.min(p, 95), runId).run().then(() => undefined);

  let outcome: AuditOutcome;
  try {
    if (type.rubric) {
      const result = await crawl(String(run.target), progress);
      const e = evaluate(type.rubric, result);
      const warnings: string[] = [];
      if (result.pageErrors.length) warnings.push(`${result.pageErrors.length} page(s) could not be fetched.`);
      if (result.skippedByRobots.length) warnings.push(`${result.skippedByRobots.length} URL(s) skipped because robots.txt disallows them.`);
      outcome = {
        ...e,
        warnings,
        failed: result.homepage ? undefined : (result.homepageError ?? "The website could not be reached"),
        scope: {
          note: SCOPE_NOTE,
          pages: result.pages.map((p) => ({ url: p.finalUrl, status: p.status, ms: p.timeMs })),
          page_errors: result.pageErrors,
          skipped_by_robots: result.skippedByRobots,
          links_discovered: result.linksDiscovered,
          links_checked: result.linkChecks.length,
          robots: result.robots.status,
          sitemap: result.sitemap,
          scanned_at: result.scannedAt,
          ...(type.key === "tech" ? { technologies: detectTech(result) } : {}),
        },
      };
    } else if (type.key === "social") {
      outcome = await socialAudit(env, account, progress);
    } else if (type.key === "gbp") {
      outcome = await gbpAudit(env, account, progress);
    } else {
      const comps = (
        await db.prepare("SELECT c.name, c.website FROM account_competitors ac JOIN competitors c ON c.id = ac.competitor_id WHERE ac.account_id = ? AND c.website IS NOT NULL LIMIT 3").bind(accountId).all<{ name: string; website: string }>()
      ).results;
      outcome = await competitorAudit(account, comps, progress);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Audit failed";
    await db.batch([
      db.prepare("UPDATE audit_runs SET status = 'failed', error = ?, completed_at = ? WHERE id = ? AND status = 'running'").bind(msg.slice(0, 500), now(), runId),
      notifyStmt(db, userId, `audit:${runId}`, `${type.label} failed`, msg.slice(0, 300), "account", accountId),
    ]);
    return;
  }

  const unavailable = outcome.findings.filter((f) => f.result === "unavailable").length;
  if (unavailable) outcome.warnings.push(`${unavailable} check(s) could not be completed and are excluded from the score.`);
  const status = outcome.failed ? "failed" : outcome.warnings.length ? "completed_warnings" : "completed";
  const t = now();
  const stmts: D1PreparedStatement[] = [];
  outcome.findings.forEach((f, i) => {
    const fid = newId();
    stmts.push(
      db.prepare(
        `INSERT INTO audit_findings (id, run_id, check_id, category, result, severity, title, detail, recommendation, effort, related_skus, position) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(fid, runId, f.checkId, f.category, f.result, f.severity, f.title, f.detail, f.recommendation, f.effort, JSON.stringify(f.skus), i),
    );
    for (const e of f.evidence.slice(0, 8)) {
      stmts.push(db.prepare("INSERT INTO audit_evidence (id, finding_id, url, observation, captured_at) VALUES (?,?,?,?,?)").bind(newId(), fid, e.url, String(e.observation).slice(0, 500), t));
    }
  });
  for (const c of outcome.categories) {
    stmts.push(
      db.prepare("INSERT INTO audit_score_breakdowns (run_id, category, label, weight, score, checks_passed, checks_failed, checks_unavailable) VALUES (?,?,?,?,?,?,?,?)").bind(
        runId, c.category, c.label, c.weight, c.score, c.passed, c.failed, c.unavailable,
      ),
    );
  }
  const fails = outcome.findings.filter((f) => f.result === "fail").length;
  const warns = outcome.findings.filter((f) => f.result === "warn").length;
  stmts.push(
    db.prepare("UPDATE audit_runs SET status = ?, progress = 100, overall_score = ?, scope = ?, warnings = ?, error = ?, completed_at = ? WHERE id = ? AND status = 'running'").bind(
      status, outcome.failed ? null : outcome.overall, JSON.stringify(outcome.scope), JSON.stringify(outcome.warnings), outcome.failed ?? null, t, runId,
    ),
    activityStmt(db, {
      type: "audit",
      subject: `${type.label} ${outcome.failed ? "failed" : `completed${outcome.overall !== null ? ` · score ${outcome.overall}/100` : ""}`}`,
      body: outcome.failed ?? `${fails} failed and ${warns} partially passed checks.`,
      actorId: userId,
      accountId,
      meta: { audit_run_id: runId },
    }),
    notifyStmt(db, userId, `audit:${runId}`, `${type.label} ${outcome.failed ? "failed" : "finished"}: ${account.name}`, outcome.failed ?? `Score ${outcome.overall ?? "N/A"}/100 · ${fails + warns} issue(s)`, "audit_run", runId),
  );
  await db.batch(stmts);
}

export function notifyStmt(db: D1Database, userId: string, dedupeKey: string, title: string, body: string | null, entityType: string, entityId: string) {
  return db
    .prepare("INSERT OR IGNORE INTO notifications (id, user_id, type, title, body, entity_type, entity_id, dedupe_key, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(newId(), userId, entityType, title.slice(0, 200), body, entityType, entityId, dedupeKey, now());
}
