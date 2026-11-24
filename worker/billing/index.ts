import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/http";
import { hasPermission } from "../../shared/access";
import { loadAccess, ruleFor, recordAudit } from "./access";
import { newId, now } from "../lib/util";
import { placeholderIds } from "./middleware/placeholder-ids";
import { createInvoiceSchema, salesRoutes } from "./routes/sales";
import { discountBp, type GateLine } from "./services/approval-gate";
import { mastersRoutes } from "./routes/masters";
import { accountingRoutes } from "./routes/accounting";
import { purchaseRoutes } from "./routes/purchases";
import { expenseRoutes } from "./routes/expenses";
import { inventoryRoutes } from "./routes/inventory";
import { reportRoutes } from "./routes/reports";
import { settingsRoutes } from "./routes/settings";
import { notificationRoutes } from "./routes/notifications";
import { documentRoutes } from "./routes/documents";
import { paymentRoutes } from "./routes/payments";
import { einvoiceRouter } from "./routes/einvoice";
import { offlineRouter } from "./routes/offline";

export { BillingDO } from "./billing-do";

/**
 * Billing, finance and accounting. Each company's books live in their own Durable Object (SQLite), so a posting is one
 * atomic transaction and companies are isolated. Mounted at /api/v1/billing/*.
 *
 * ACCESS (see shared/access.ts, worker/billing/access.ts): every request is checked against the caller's billing role.
 * Routes without a rule are administrator-only (deny by default). Writes are audited. Invoices from people who may only
 * "request" them (or who exceed their limits) are parked in billing_approvals and only created when approved.
 */
export const billingRoutes = new Hono<AppEnv>();

const ready = new Set<string>();
const PREFIX = "/api/v1/billing";

type EstLine = { quantityThousandths: number; unitPricePaise: number; discountPaise?: number; taxRatePercent?: number; isTaxInclusive?: boolean };

/** Rough invoice value in paise (after discount, with tax) used for approval thresholds and the approver's list. */
export function estimateTotalPaise(items: EstLine[], extraDiscountPaise = 0): number {
  let total = 0;
  for (const l of items) {
    const net = Math.round((l.quantityThousandths * l.unitPricePaise) / 1000) - (l.discountPaise ?? 0);
    total += l.isTaxInclusive ? net : Math.round(net * (1 + (l.taxRatePercent ?? 0) / 100));
  }
  return Math.max(0, total - extraDiscountPaise);
}

const CONVERT_RE = /^\/documents\/[^/]+\/convert$/;

billingRoutes.use("*", async (c, next) => {
  const user = c.get("user");
  const access = await loadAccess(c);
  if (!hasPermission(access, "billing.access")) throw new ApiError(403, "forbidden", "You do not have access to billing");
  const can = (k: string) => hasPermission(access, k);

  const path = (c.req.path.startsWith(PREFIX) ? c.req.path.slice(PREFIX.length) : c.req.path).replace(/\/+$/, "") || "/";
  const method = c.req.method;
  const companyId = c.req.header("X-Company-Id") || "default";
  const hints: { docType?: string; target?: string } = {};
  if (method === "POST" && (path === "/documents" || CONVERT_RE.test(path))) {
    const body: any = await c.req.json().catch(() => null);
    hints.docType = body?.docType;
    hints.target = body?.target;
  }

  const rule = ruleFor(method, path, hints);
  let divert = false;
  if (!access.isAdmin) {
    if (CONVERT_RE.test(path) && hints.target === "INVOICE") {
      if (!(can("invoice.create") && can("documents.convert"))) {
        throw new ApiError(403, "forbidden", "Converting into a sales invoice needs permission to create invoices directly. Request the invoice instead.");
      }
    } else if (!rule) {
      throw new ApiError(403, "forbidden", "This action is not available to your role");
    } else if ("special" in rule) {
      if (!can("invoice.create") && !can("invoice.request")) throw new ApiError(403, "forbidden", "Your role cannot create or request sales invoices");
      divert = !can("invoice.create");
    } else if (rule.all.some((k) => !can(k))) {
      throw new ApiError(403, "forbidden", "Your role does not allow this action");
    }
  }

  // Sales invoices: requests, discount caps and value thresholds all end up as a pending approval.
  if (method === "POST" && path === "/sales/invoices") {
    const raw = await c.req.json().catch(() => null);
    const parsed = createInvoiceSchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "Validation failed", details: parsed.error.format() }, 400);
    const d = parsed.data;
    const reasons: string[] = [];
    if (divert) reasons.push("Your role can only request invoices");
    const total = estimateTotalPaise(d.items, d.extraDiscountPaise);
    if (!access.isAdmin) {
      const maxPct = access.limits.maxDiscountPct ?? 0;
      const discPct = discountBp(d.items as GateLine[], d.extraDiscountPaise) / 100;
      if (maxPct > 0 && discPct > maxPct) reasons.push(`Discount ${discPct.toFixed(1)}% is above your ${maxPct}% limit`);
      const above = (access.limits.approvalAboveRupees ?? 0) * 100;
      if (above > 0 && total >= above) reasons.push("Invoice value is at or above your approval threshold");
    }
    if (reasons.length) {
      // A phone that was offline retries with the same reference; answer with the request it already made.
      const clientRef = (c.req.header("x-client-ref") || "").slice(0, 64) || null;
      if (clientRef) {
        const dup = await c.env.DB.prepare("SELECT id FROM billing_approvals WHERE requested_by = ? AND client_ref = ?").bind(user.id, clientRef).first<{ id: string }>();
        if (dup) return c.json({ ok: true, pending: true, approvalId: dup.id, duplicate: true, message: "Already sent for approval.", reasons }, 202);
      }
      const id = newId();
      await c.env.DB.prepare(
        "INSERT INTO billing_approvals (id, company_id, kind, status, requested_by, payload, party_name, amount_paise, reason, created_at, client_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
        .bind(id, companyId, "sales_invoice", "pending", user.id, JSON.stringify(d), d.partyName, total, reasons.join("; "), now(), clientRef)
        .run();
      // Tell everyone who can approve (and admins) that something is waiting.
      const approvers = await c.env.DB.prepare(
        `SELECT u.id FROM users u LEFT JOIN billing_roles r ON r.id = u.billing_role_id
         WHERE u.status='active' AND u.id <> ? AND (u.role='admin' OR r.permissions LIKE '%"invoice.approve"%' OR u.billing_extra_permissions LIKE '%"invoice.approve"%')`,
      )
        .bind(user.id)
        .all<{ id: string }>();
      const t = now();
      const stmts = (approvers.results ?? []).map((a) =>
        c.env.DB.prepare("INSERT INTO notifications (id, user_id, type, title, body, entity_type, entity_id, created_at) VALUES (?,?,?,?,?,?,?,?)").bind(
          newId(), a.id, "billing_approval", "Invoice waiting for approval", `${user.name}: ${d.partyName} · ₹${(total / 100).toLocaleString("en-IN")}`, "billing_approval", id, t,
        ),
      );
      if (stmts.length) await c.env.DB.batch(stmts);
      c.executionCtx.waitUntil(
        recordAudit(c.env.DB, { companyId, actorId: user.id, actorName: user.name, action: "approval.request", entityType: "billing_approval", entityId: id, status: 202, detail: { reasons, party: d.partyName, amountPaise: total }, ip: c.req.header("cf-connecting-ip") }),
      );
      return c.json({ ok: true, pending: true, approvalId: id, message: "Sent for approval. The invoice is created only after it is approved.", reasons }, 202);
    }
  }

  const stub = c.env.BILLING_DO.get(c.env.BILLING_DO.idFromName(companyId));
  if (!ready.has(companyId)) {
    await stub.initBusiness({ businessId: companyId, businessName: c.env.APP_NAME || "Gexart", stateCode: "19", address: "", phone: "" });
    ready.add(companyId);
  }
  c.set("billingStub" as never, stub as never);
  c.set("businessStub" as never, stub as never);
  c.set("businessId" as never, companyId as never);
  c.set("userId" as never, user.id as never);
  c.set("membership" as never, { id: user.id, userId: user.id, businessId: companyId, roleKey: access.isAdmin || can("settings.manage") ? "owner" : "member", permissions: access.isAdmin ? ["*"] : [...access.permissions], branchIds: ["*"] } as never);
  if (!can("invoice.view_all") && /^\/sales\/invoices/.test(path)) c.set("ownOnlyUserId" as never, user.id as never);

  await next();

  // People without these permissions never receive the figures, even if they call the API directly.
  const ct = c.res.headers.get("content-type") || "";
  if (method === "GET" && ct.includes("application/json")) {
    const strip: string[] = [];
    if (!can("sales_analysis.view") && path === "/sales/invoices") strip.push("totals", "counts");
    const hideCost = !can("items.view_cost") && /^\/masters\/items/.test(path);
    if (strip.length || hideCost) {
      const j: any = await c.res.clone().json().catch(() => null);
      if (j) {
        for (const k of strip) delete j[k];
        if (hideCost) {
          const scrub = (v: any): void => {
            if (Array.isArray(v)) v.forEach(scrub);
            else if (v && typeof v === "object") {
              for (const k of Object.keys(v)) {
                if (k === "purchasePricePaise" || k === "purchase_price_paise") delete v[k];
                else scrub(v[k]);
              }
            }
          };
          scrub(j);
        }
        const headers = new Headers(c.res.headers);
        headers.delete("content-length");
        c.res = new Response(JSON.stringify(j), { status: c.res.status, headers });
      }
    }
  }

  if (method !== "GET" && method !== "HEAD") {
    c.executionCtx.waitUntil(
      recordAudit(c.env.DB, { companyId, actorId: user.id, actorName: user.name, action: `${method} ${path}`, status: c.res.status, ip: c.req.header("cf-connecting-ip") }),
    );
  }
});
billingRoutes.use("*", placeholderIds);

const mount: Array<[string, Hono<any>]> = [
  ["/masters", mastersRoutes], ["/accounting", accountingRoutes], ["/sales", salesRoutes], ["/purchases", purchaseRoutes],
  ["/expenses", expenseRoutes], ["/inventory", inventoryRoutes], ["/reports", reportRoutes], ["/settings", settingsRoutes],
  ["/notifications", notificationRoutes], ["/documents", documentRoutes], ["/payments", paymentRoutes],
  ["/einvoice", einvoiceRouter], ["/offline", offlineRouter],
];
for (const [path, router] of mount) billingRoutes.route(path, router);
