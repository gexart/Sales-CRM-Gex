import { b, newId, now } from "./util";

export type Changes = Record<string, [unknown, unknown]>;

export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Changes {
  const out: Changes = {};
  for (const k of Object.keys(after)) {
    if (k === "updated_at" || k === "password_hash" || k === "password_salt") continue;
    if ((before[k] ?? null) !== (after[k] ?? null)) out[k] = [before[k] ?? null, after[k] ?? null];
  }
  return out;
}

export function auditStmt(
  db: D1Database,
  e: { actorId: string | null; action: string; entityType: string; entityId: string | null; summary?: string; changes?: Changes; ip?: string | null },
) {
  return db
    .prepare(
      "INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, summary, changes, ip, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .bind(newId(), e.actorId, e.action, e.entityType, b(e.entityId), b(e.summary), e.changes ? JSON.stringify(e.changes) : null, b(e.ip), now());
}

export function activityStmt(
  db: D1Database,
  a: {
    type: string;
    subject: string;
    body?: string | null;
    actorId: string | null;
    accountId?: string | null;
    contactId?: string | null;
    prospectId?: string | null;
    opportunityId?: string | null;
    campaignId?: string | null;
    meta?: unknown;
    occurredAt?: string;
  },
) {
  const t = now();
  return db
    .prepare(
      `INSERT INTO activities (id, type, subject, body, account_id, contact_id, prospect_id, opportunity_id, campaign_id, actor_id, occurred_at, meta, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      newId(),
      a.type,
      a.subject,
      b(a.body),
      b(a.accountId),
      b(a.contactId),
      b(a.prospectId),
      b(a.opportunityId),
      b(a.campaignId),
      a.actorId,
      a.occurredAt ?? t,
      a.meta ? JSON.stringify(a.meta) : null,
      t,
    );
}
