import { Hono, type Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/http";
import { newId, now } from "../lib/util";
import { PERMISSIONS, SYSTEM_ROLES, hasPermission, isPermission, type EffectiveAccess } from "../../shared/access";
import { ensureSystemRoles, loadAccess, recordAudit } from "./access";
import { createInvoiceSchema } from "./routes/sales";

/**
 * /api/v1/billing-access/* — who may do what in billing: roles, assignments, invoice approvals, audit log.
 * These endpoints do not touch the books, so they live outside the billing Durable Object.
 */
export const billingAccessRoutes = new Hono<AppEnv>();

const jsonArr = (s: unknown): string[] => {
  try {
    const v = JSON.parse(String(s ?? "[]"));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

async function need(c: Context<AppEnv>, key: string): Promise<EffectiveAccess> {
  const a = await loadAccess(c);
  if (!hasPermission(a, key)) throw new ApiError(403, "forbidden", "You do not have permission for this");
  return a;
}

const audit = (c: Context<AppEnv>, action: string, entityType: string, entityId: string | null, detail?: unknown) => {
  const u = c.get("user");
  c.executionCtx.waitUntil(recordAudit(c.env.DB, { companyId: c.req.header("X-Company-Id") || "default", actorId: u.id, actorName: u.name, action, entityType, entityId, detail, status: 200, ip: c.req.header("cf-connecting-ip") }));
};

function notify(c: Context<AppEnv>, userId: string, title: string, body: string, entityId: string) {
  return c.env.DB.prepare("INSERT INTO notifications (id, user_id, type, title, body, entity_type, entity_id, created_at) VALUES (?,?,?,?,?,?,?,?)").bind(newId(), userId, "billing_approval", title, body, "billing_approval", entityId, now());
}

// ── Who am I, and what exists ─────────────────────────────────────────────────────────────────────────────────────

billingAccessRoutes.get("/me", async (c) => {
  const a = await loadAccess(c);
  return c.json({ data: { isAdmin: a.isAdmin, roleId: a.roleId, roleName: a.roleName, permissions: [...a.permissions], limits: a.limits } });
});

billingAccessRoutes.get("/catalogue", async (c) => {
  await need(c, "roles.manage");
  return c.json({ data: { permissions: PERMISSIONS, templates: SYSTEM_ROLES } });
});

// ── Roles ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const roleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().max(300).optional(),
  permissions: z.array(z.string()).max(200),
  limits: z.object({ maxDiscountPct: z.number().min(0).max(100).optional(), approvalAboveRupees: z.number().min(0).optional() }).default({}),
});

function cleanPerms(list: string[]) {
  const bad = list.filter((k) => !isPermission(k));
  if (bad.length) throw new ApiError(400, "bad_permission", `Unknown permission: ${bad[0]}`);
  return [...new Set(list)];
}

billingAccessRoutes.get("/roles", async (c) => {
  await need(c, "roles.manage");
  await ensureSystemRoles(c.env.DB);
  const rows = await c.env.DB.prepare(
    `SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.billing_role_id = r.id) AS user_count FROM billing_roles r ORDER BY r.is_system DESC, r.name`,
  ).all<Record<string, unknown>>();
  return c.json({ data: (rows.results ?? []).map((r) => ({ ...r, permissions: jsonArr(r.permissions), limits: JSON.parse(String(r.limits || "{}")) })) });
});

billingAccessRoutes.post("/roles", async (c) => {
  await need(c, "roles.manage");
  const d = roleSchema.parse(await c.req.json());
  const perms = cleanPerms(d.permissions);
  const id = `role_${newId().slice(0, 12)}`;
  const t = now();
  try {
    await c.env.DB.prepare("INSERT INTO billing_roles (id, name, description, is_system, permissions, limits, created_by, created_at, updated_at) VALUES (?,?,?,0,?,?,?,?,?)")
      .bind(id, d.name, d.description ?? null, JSON.stringify(perms), JSON.stringify(d.limits), c.get("user").id, t, t)
      .run();
  } catch {
    throw new ApiError(409, "duplicate", "A role with this name already exists");
  }
  audit(c, "role.create", "billing_role", id, { name: d.name, permissions: d.permissions });
  return c.json({ data: { id } }, 201);
});

billingAccessRoutes.put("/roles/:id", async (c) => {
  await need(c, "roles.manage");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT is_system FROM billing_roles WHERE id = ?").bind(id).first<{ is_system: number }>();
  if (!row) throw new ApiError(404, "not_found", "Role not found");
  if (row.is_system) throw new ApiError(409, "system_role", "Built-in roles cannot be edited. Duplicate it as a new role instead.");
  const d = roleSchema.parse(await c.req.json());
  const perms = cleanPerms(d.permissions);
  try {
    await c.env.DB.prepare("UPDATE billing_roles SET name=?, description=?, permissions=?, limits=?, updated_at=? WHERE id=?")
      .bind(d.name, d.description ?? null, JSON.stringify(perms), JSON.stringify(d.limits), now(), id)
      .run();
  } catch {
    throw new ApiError(409, "duplicate", "A role with this name already exists");
  }
  audit(c, "role.update", "billing_role", id, { name: d.name, permissions: d.permissions, limits: d.limits });
  return c.json({ data: { id } });
});

billingAccessRoutes.delete("/roles/:id", async (c) => {
  await need(c, "roles.manage");
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT is_system, (SELECT COUNT(*) FROM users WHERE billing_role_id = ?) AS n FROM billing_roles WHERE id = ?").bind(id, id).first<{ is_system: number; n: number }>();
  if (!row) throw new ApiError(404, "not_found", "Role not found");
  if (row.is_system) throw new ApiError(409, "system_role", "Built-in roles cannot be deleted");
  if (row.n > 0) throw new ApiError(409, "in_use", `${row.n} user(s) still have this role. Reassign them first.`);
  await c.env.DB.prepare("DELETE FROM billing_roles WHERE id = ?").bind(id).run();
  audit(c, "role.delete", "billing_role", id);
  return c.json({ data: { id } });
});

// ── Assign roles to users ─────────────────────────────────────────────────────────────────────────────────────────

billingAccessRoutes.get("/users", async (c) => {
  await need(c, "roles.manage");
  const rows = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role AS crm_role, u.status, u.billing_role_id, r.name AS billing_role_name, u.billing_extra_permissions AS extra, u.billing_denied_permissions AS denied
     FROM users u LEFT JOIN billing_roles r ON r.id = u.billing_role_id ORDER BY u.name`,
  ).all<Record<string, unknown>>();
  return c.json({ data: (rows.results ?? []).map(({ extra, denied, ...u }) => ({ ...u, extra: jsonArr(extra), denied: jsonArr(denied) })) });
});

const assignSchema = z.object({ roleId: z.string().nullable(), extra: z.array(z.string()).default([]), denied: z.array(z.string()).default([]) });

billingAccessRoutes.put("/users/:id", async (c) => {
  await need(c, "roles.manage");
  const id = c.req.param("id");
  const d = assignSchema.parse(await c.req.json());
  if (d.roleId) {
    await ensureSystemRoles(c.env.DB);
    const r = await c.env.DB.prepare("SELECT id FROM billing_roles WHERE id = ?").bind(d.roleId).first();
    if (!r) throw new ApiError(404, "not_found", "Role not found");
  }
  const res = await c.env.DB.prepare("UPDATE users SET billing_role_id=?, billing_extra_permissions=?, billing_denied_permissions=?, updated_at=? WHERE id=?")
    .bind(d.roleId, JSON.stringify(cleanPerms(d.extra)), JSON.stringify(cleanPerms(d.denied)), now(), id)
    .run();
  if (!res.meta.changes) throw new ApiError(404, "not_found", "User not found");
  audit(c, "user.billing_access", "user", id, d);
  return c.json({ data: { id } });
});

// ── Invoice approvals ─────────────────────────────────────────────────────────────────────────────────────────────

const APPROVAL_COLS = "a.id, a.kind, a.status, a.requested_by, u.name AS requested_by_name, a.party_name, a.amount_paise, a.reason, a.decided_by, d.name AS decided_by_name, a.decided_at, a.decision_note, a.result_id, a.result_no, a.created_at";

billingAccessRoutes.get("/approvals", async (c) => {
  const access = await loadAccess(c);
  if (!hasPermission(access, "billing.access")) throw new ApiError(403, "forbidden", "You do not have access to billing");
  const user = c.get("user");
  const status = c.req.query("status");
  const seeAll = hasPermission(access, "invoice.approve") || hasPermission(access, "approvals.view_all");
  const where: string[] = [];
  const args: unknown[] = [];
  if (!seeAll) {
    where.push("a.requested_by = ?");
    args.push(user.id);
  }
  if (status && ["pending", "approved", "rejected", "cancelled"].includes(status)) {
    where.push("a.status = ?");
    args.push(status);
  }
  const rows = await c.env.DB.prepare(
    `SELECT ${APPROVAL_COLS} FROM billing_approvals a JOIN users u ON u.id = a.requested_by LEFT JOIN users d ON d.id = a.decided_by
     ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.created_at DESC LIMIT 200`,
  )
    .bind(...args)
    .all();
  const pending = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM billing_approvals WHERE status='pending'${seeAll ? "" : " AND requested_by = ?"}`).bind(...(seeAll ? [] : [user.id])).first<{ n: number }>();
  return c.json({ data: rows.results ?? [], pending: pending?.n ?? 0, canDecide: hasPermission(access, "invoice.approve") });
});

billingAccessRoutes.get("/approvals/:id", async (c) => {
  const access = await loadAccess(c);
  const user = c.get("user");
  const row = await c.env.DB.prepare(`SELECT ${APPROVAL_COLS}, a.payload FROM billing_approvals a JOIN users u ON u.id = a.requested_by LEFT JOIN users d ON d.id = a.decided_by WHERE a.id = ?`).bind(c.req.param("id")).first<Record<string, unknown>>();
  const seeAll = hasPermission(access, "invoice.approve") || hasPermission(access, "approvals.view_all");
  if (!row || (!seeAll && row.requested_by !== user.id)) throw new ApiError(404, "not_found", "Approval request not found");
  return c.json({ data: { ...row, payload: JSON.parse(String(row.payload)) } });
});

billingAccessRoutes.post("/approvals/:id/approve", async (c) => {
  const access = await need(c, "invoice.approve");
  const user = c.get("user");
  const id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as { note?: string };
  const row = await c.env.DB.prepare("SELECT * FROM billing_approvals WHERE id = ?").bind(id).first<Record<string, string | number | null>>();
  if (!row) throw new ApiError(404, "not_found", "Approval request not found");
  if (row.requested_by === user.id && !access.isAdmin) throw new ApiError(403, "self_approval", "You cannot approve your own request");
  // Claim it atomically so a double click or two approvers cannot create two invoices.
  const claim = await c.env.DB.prepare("UPDATE billing_approvals SET status='approved', decided_by=?, decided_at=?, decision_note=? WHERE id=? AND status='pending'")
    .bind(user.id, now(), body.note ?? null, id)
    .run();
  if (!claim.meta.changes) throw new ApiError(409, "already_decided", "This request has already been decided");

  const companyId = String(row.company_id || "default");
  try {
    const stub: any = c.env.BILLING_DO.get(c.env.BILLING_DO.idFromName(companyId));
    await stub.initBusiness({ businessId: companyId, businessName: c.env.APP_NAME || "Gexart", stateCode: "19", address: "", phone: "" });
    const data = createInvoiceSchema.parse(JSON.parse(String(row.payload)));
    const loc = (await stub.resolveLocation({ branchId: data.branchId ?? null, warehouseId: data.warehouseId ?? null })) as { branchId: string; warehouseId: string | null };
    // The invoice belongs to the person who asked for it; the approval record shows who released it.
    const result: any = await stub.createSalesInvoice({ ...data, branchId: loc.branchId, warehouseId: loc.warehouseId ?? undefined, createdById: String(row.requested_by) } as never);
    const inv = result?.invoice ?? result;
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE billing_approvals SET result_id=?, result_no=? WHERE id=?").bind(inv?.id ?? null, inv?.invoiceNo ?? null, id),
      notify(c, String(row.requested_by), "Invoice approved", `${row.party_name}: invoice ${inv?.invoiceNo ?? ""} is ready`, id),
    ]);
    audit(c, "approval.approve", "billing_approval", id, { invoiceId: inv?.id, invoiceNo: inv?.invoiceNo });
    return c.json({ data: { id, status: "approved", invoiceId: inv?.id, invoiceNo: inv?.invoiceNo } });
  } catch (e: any) {
    // Put it back so it can be fixed or rejected; nothing was created.
    await c.env.DB.prepare("UPDATE billing_approvals SET status='pending', decided_by=NULL, decided_at=NULL, decision_note=? WHERE id=?").bind(`Could not create the invoice: ${e?.message ?? e}`, id).run();
    throw new ApiError(422, "create_failed", `The invoice could not be created: ${e?.message ?? "unknown error"}`);
  }
});

billingAccessRoutes.post("/approvals/:id/reject", async (c) => {
  await need(c, "invoice.approve");
  const user = c.get("user");
  const id = c.req.param("id");
  const { reason } = z.object({ reason: z.string().trim().min(3, "Please give a reason").max(500) }).parse(await c.req.json().catch(() => ({})));
  const row = await c.env.DB.prepare("SELECT requested_by, party_name FROM billing_approvals WHERE id = ?").bind(id).first<{ requested_by: string; party_name: string }>();
  if (!row) throw new ApiError(404, "not_found", "Approval request not found");
  const res = await c.env.DB.prepare("UPDATE billing_approvals SET status='rejected', decided_by=?, decided_at=?, decision_note=? WHERE id=? AND status='pending'").bind(user.id, now(), reason, id).run();
  if (!res.meta.changes) throw new ApiError(409, "already_decided", "This request has already been decided");
  await notify(c, row.requested_by, "Invoice rejected", `${row.party_name}: ${reason}`, id).run();
  audit(c, "approval.reject", "billing_approval", id, { reason });
  return c.json({ data: { id, status: "rejected" } });
});

billingAccessRoutes.post("/approvals/:id/cancel", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const res = await c.env.DB.prepare("UPDATE billing_approvals SET status='cancelled', decided_at=? WHERE id=? AND requested_by=? AND status='pending'").bind(now(), id, user.id).run();
  if (!res.meta.changes) throw new ApiError(409, "cannot_cancel", "Only your own pending requests can be withdrawn");
  audit(c, "approval.cancel", "billing_approval", id);
  return c.json({ data: { id, status: "cancelled" } });
});

// ── Audit log ─────────────────────────────────────────────────────────────────────────────────────────────────────

billingAccessRoutes.get("/audit", async (c) => {
  await need(c, "audit.view");
  const limit = Math.min(200, Number(c.req.query("limit") || 50));
  const offset = Math.max(0, Number(c.req.query("offset") || 0));
  const actor = c.req.query("actor");
  const rows = await c.env.DB.prepare(`SELECT * FROM billing_audit ${actor ? "WHERE actor_id = ?" : ""} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...(actor ? [actor] : []), limit, offset)
    .all();
  return c.json({ data: rows.results ?? [] });
});

