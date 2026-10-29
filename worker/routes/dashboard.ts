// Dashboard and report metrics, computed from stored records only.
// Sales reps see figures for records they own; managers see the whole team.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/http";
import { isManager } from "../lib/auth";
import { now } from "../lib/util";

export const dashboardRoutes = new Hono<AppEnv>();
type Row = Record<string, unknown>;

function period(q: Record<string, string>) {
  const to = q.to && !isNaN(Date.parse(q.to)) ? new Date(q.to).toISOString() : now();
  const from = q.from && !isNaN(Date.parse(q.from)) ? new Date(q.from).toISOString() : new Date(Date.now() - 30 * 86400_000).toISOString();
  if (from > to) throw new ApiError(400, "validation_error", "'from' must be before 'to'");
  return { from, to };
}

dashboardRoutes.get("/dashboard", async (c) => {
  const user = c.get("user");
  const { from, to } = period(c.req.query());
  const mgr = isManager(user);
  const own = (alias: string) => (mgr ? "" : ` AND ${alias}.owner_id = '${user.id.replace(/'/g, "")}'`);
  const t = now();
  const db = c.env.DB;
  const OUTREACH = "('call','email','linkedin','whatsapp')";
  const actScope = mgr
    ? ""
    : ` AND (a.actor_id = '${user.id}' OR a.account_id IN (SELECT id FROM accounts WHERE owner_id = '${user.id}'))`;

  const [counts, pipelineCur, wonCur, stages, funnel, recentAct, upcoming, recentProspects, campaigns, sources, owners, recentAccounts, productPerf, industries, extra] =
    await db.batch<Row>([
      db.prepare(
        `SELECT
          (SELECT COUNT(*) FROM accounts t WHERE archived_at IS NULL${own("t")}) AS accounts,
          (SELECT COUNT(*) FROM contacts t WHERE archived_at IS NULL${own("t")}) AS contacts,
          (SELECT COUNT(*) FROM prospects t WHERE archived_at IS NULL AND status NOT IN ('converted','disqualified')${own("t")}) AS prospects,
          (SELECT COUNT(*) FROM prospects t WHERE archived_at IS NULL AND status = 'qualified'${own("t")}) AS qualified_prospects,
          (SELECT COUNT(*) FROM opportunities t WHERE archived_at IS NULL AND stage NOT IN ('closed_won','closed_lost')${own("t")}) AS open_opportunities,
          (SELECT COUNT(*) FROM tasks t WHERE archived_at IS NULL AND type = 'meeting' AND status IN ('open','in_progress') AND due_at >= ?${own("t")}) AS meetings_scheduled,
          (SELECT COUNT(*) FROM tasks t WHERE archived_at IS NULL AND status IN ('open','in_progress') AND due_at < ?${own("t")}) AS overdue_tasks,
          (SELECT COUNT(*) FROM activities a WHERE type IN ${OUTREACH} AND occurred_at BETWEEN ? AND ?${actScope}) AS outreach_activities,
          (SELECT COUNT(*) FROM opportunities t WHERE stage = 'closed_won' AND closed_at BETWEEN ? AND ?${own("t")}) AS won_count,
          (SELECT COUNT(*) FROM opportunities t WHERE stage IN ('closed_won','closed_lost') AND closed_at BETWEEN ? AND ?${own("t")}) AS closed_count,
          (SELECT COUNT(*) FROM outreach_messages t WHERE status IN ('sent','delivered','replied','bounced') AND sent_at BETWEEN ? AND ?${own("t")}) AS messages_sent,
          (SELECT COUNT(*) FROM outreach_messages t WHERE status = 'replied' AND sent_at BETWEEN ? AND ?${own("t")}) AS messages_replied,
          (SELECT COUNT(*) FROM outreach_messages t WHERE status = 'bounced' AND sent_at BETWEEN ? AND ?${own("t")}) AS messages_bounced,
          (SELECT COUNT(*) FROM outreach_messages t WHERE status IN ('draft','ready_for_review','approved') AND archived_at IS NULL${own("t")}) AS messages_unsent`,
      ).bind(t, t, from, to, from, to, from, to, from, to, from, to, from, to),
      db.prepare(
        `SELECT currency, SUM(amount_minor) AS amount_minor, SUM(amount_minor * probability / 100) AS weighted_minor FROM opportunities t
         WHERE archived_at IS NULL AND stage NOT IN ('closed_won','closed_lost')${own("t")} GROUP BY currency ORDER BY amount_minor DESC`,
      ),
      db.prepare(
        `SELECT currency, SUM(amount_minor) AS amount_minor FROM opportunities t WHERE stage = 'closed_won' AND closed_at BETWEEN ? AND ?${own("t")} GROUP BY currency`,
      ).bind(from, to),
      db.prepare(
        `SELECT stage, COUNT(*) AS n, SUM(amount_minor) AS amount_minor FROM opportunities t WHERE archived_at IS NULL${own("t")} GROUP BY stage`,
      ),
      db.prepare(`SELECT status, COUNT(*) AS n FROM prospects t WHERE archived_at IS NULL${own("t")} GROUP BY status`),
      db.prepare(
        `SELECT a.id, a.type, a.subject, a.occurred_at, a.account_id, a.contact_id, a.opportunity_id, a.prospect_id, u.name AS actor_name, ac.name AS account_name
         FROM activities a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN accounts ac ON ac.id = a.account_id
         WHERE 1=1${actScope} ORDER BY a.occurred_at DESC LIMIT 10`,
      ),
      db.prepare(
        `SELECT t.id, t.title, t.type, t.due_at, t.priority, t.status, ac.name AS account_name, t.account_id FROM tasks t LEFT JOIN accounts ac ON ac.id = t.account_id
         WHERE t.archived_at IS NULL AND t.status IN ('open','in_progress')${mgr ? ` AND t.owner_id = '${user.id}'` : own("t")}
         ORDER BY t.due_at IS NULL, t.due_at LIMIT 8`,
      ),
      db.prepare(
        `SELECT id, company_name, status, industry, geography, created_at FROM prospects t WHERE archived_at IS NULL${own("t")} ORDER BY created_at DESC LIMIT 6`,
      ),
      db.prepare(
        `SELECT cp.id, cp.name, cp.status, cp.target_leads,
           (SELECT COUNT(*) FROM prospects p WHERE p.campaign_id = cp.id AND p.archived_at IS NULL) AS prospects,
           (SELECT COUNT(*) FROM prospects p WHERE p.campaign_id = cp.id AND p.status = 'qualified') AS qualified,
           (SELECT COUNT(*) FROM prospect_conversions pc WHERE pc.campaign_id = cp.id) AS converted,
           (SELECT COUNT(*) FROM opportunities o WHERE o.campaign_id = cp.id AND o.archived_at IS NULL) AS opportunities,
           (SELECT COALESCE(SUM(amount_minor),0) FROM opportunities o WHERE o.campaign_id = cp.id AND o.stage = 'closed_won') AS won_minor
         FROM campaigns cp WHERE cp.archived_at IS NULL AND cp.status IN ('active','paused','completed','planned') ORDER BY cp.start_date DESC LIMIT 8`,
      ),
      db.prepare(
        `SELECT COALESCE(discovery_source, 'unknown') AS source, COUNT(*) AS n FROM prospects t WHERE created_at BETWEEN ? AND ?${own("t")} GROUP BY 1 ORDER BY n DESC`,
      ).bind(from, to),
      mgr
        ? db.prepare(
            `SELECT u.id, u.name,
               (SELECT COUNT(*) FROM opportunities o WHERE o.owner_id = u.id AND o.archived_at IS NULL AND o.stage NOT IN ('closed_won','closed_lost')) AS open_opps,
               (SELECT COALESCE(SUM(amount_minor),0) FROM opportunities o WHERE o.owner_id = u.id AND o.archived_at IS NULL AND o.stage NOT IN ('closed_won','closed_lost')) AS pipeline_minor,
               (SELECT COALESCE(SUM(amount_minor),0) FROM opportunities o WHERE o.owner_id = u.id AND o.stage = 'closed_won' AND o.closed_at BETWEEN ? AND ?) AS won_minor,
               (SELECT COUNT(*) FROM activities a WHERE a.actor_id = u.id AND a.type IN ${OUTREACH} AND a.occurred_at BETWEEN ? AND ?) AS outreach,
               (SELECT COUNT(*) FROM tasks t WHERE t.owner_id = u.id AND t.status = 'completed' AND t.completed_at BETWEEN ? AND ?) AS tasks_completed
             FROM users u WHERE u.status = 'active' ORDER BY u.name`,
          ).bind(from, to, from, to, from, to)
        : db.prepare("SELECT 1 WHERE 0"),
      db.prepare(
        `SELECT id, name, status, city, industry, updated_at FROM accounts t WHERE archived_at IS NULL${own("t")} ORDER BY updated_at DESC LIMIT 6`,
      ),
      db.prepare(
        `SELECT p.id, p.name, p.category,
           (SELECT COUNT(*) FROM account_service_assessments s WHERE s.product_id = p.id AND s.status IN ('discussed','proposed','won','lost')) AS pitched,
           (SELECT COUNT(*) FROM account_service_assessments s WHERE s.product_id = p.id AND s.status = 'won') AS won_accounts,
           (SELECT COUNT(DISTINCT op.opportunity_id) FROM opportunity_products op JOIN opportunities o ON o.id = op.opportunity_id WHERE op.product_id = p.id AND o.archived_at IS NULL) AS deals,
           (SELECT COALESCE(SUM(op.unit_price_minor * op.quantity), 0) FROM opportunity_products op JOIN opportunities o ON o.id = op.opportunity_id WHERE op.product_id = p.id AND o.stage = 'closed_won') AS won_minor
         FROM products p WHERE p.archived_at IS NULL ORDER BY pitched + deals DESC, p.name LIMIT 18`,
      ),
      db.prepare(`SELECT COALESCE(industry, 'Not recorded') AS industry, COUNT(*) AS n FROM prospects t WHERE archived_at IS NULL${own("t")} GROUP BY 1 ORDER BY n DESC LIMIT 10`),
      db.prepare(
        `SELECT (SELECT COUNT(*) FROM call_recordings r WHERE r.started_at BETWEEN ? AND ?${mgr ? "" : ` AND r.user_id = '${user.id}'`}) AS calls,
                (SELECT COUNT(*) FROM audit_runs r WHERE r.created_at BETWEEN ? AND ?) AS audits,
                (SELECT COUNT(*) FROM generated_documents d WHERE d.created_at BETWEEN ? AND ?) AS documents`,
      ).bind(from, to, from, to, from, to),
    ]);

  const k = counts.results[0] ?? {};
  return c.json({
    data: {
      period: { from, to },
      scope: mgr ? "team" : "mine",
      kpis: {
        ...k,
        win_rate: Number(k.closed_count) > 0 ? Number(k.won_count) / Number(k.closed_count) : null,
        // Replies among messages sent in the period; manual drafts are never counted as sent.
        reply_rate: Number(k.messages_sent) > 0 ? Number(k.messages_replied) / Number(k.messages_sent) : null,
        pipeline: pipelineCur.results,
        won: wonCur.results,
      },
      stages: stages.results,
      prospect_funnel: funnel.results,
      recent_activity: recentAct.results,
      my_tasks: upcoming.results,
      recent_prospects: recentProspects.results,
      campaigns: campaigns.results,
      lead_sources: sources.results,
      owners: owners.results,
      recent_accounts: recentAccounts.results,
      product_performance: productPerf.results,
      industries: industries.results,
      activity_counts: extra.results[0] ?? {},
    },
  });
});
