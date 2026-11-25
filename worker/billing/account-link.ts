import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/http";
import { now } from "../lib/util";
import { hasPermission } from "../../shared/access";
import { INDIAN_STATES, validateGstin } from "@billing/shared";
import { loadAccess, recordAudit } from "./access";

/**
 * CRM account -> billing customer. "Create invoice" on an account finds or creates the matching customer (details copied from the
 * account and its main contact), remembers the link, and the account then shows its invoices and what is due.
 */
export const accountLinkRoutes = new Hono<AppEnv>();

accountLinkRoutes.use("*", async (c, next) => {
  if (!hasPermission(await loadAccess(c), "billing.access")) throw new ApiError(403, "forbidden", "You do not have access to billing");
  await next();
});

const stubOf = (c: { env: AppEnv["Bindings"]; req: { header: (n: string) => string | undefined } }): any => c.env.BILLING_DO.get(c.env.BILLING_DO.idFromName(c.req.header("X-Company-Id") || "default")); // eslint-disable-line @typescript-eslint/no-explicit-any

accountLinkRoutes.get("/:accountId", async (c) => {
  const id = c.req.param("accountId");
  const access = await loadAccess(c);
  const link = await c.env.DB.prepare("SELECT party_id FROM billing_party_links WHERE account_id = ?").bind(id).first<{ party_id: string }>();
  if (!link) return c.json({ data: { linked: false } });
  const out: Record<string, unknown> = { linked: true, partyId: link.party_id };
  if (hasPermission(access, "invoice.view")) {
    const stub = stubOf(c);
    const ownOnly = !hasPermission(access, "invoice.view_all") ? c.get("user").id : undefined;
    const r = await stub.listSalesInvoices({ partyId: link.party_id, limit: 6, createdById: ownOnly });
    out.invoices = (r.invoices ?? []).map((i: any) => ({ id: i.id, invoiceNo: i.invoice_no, date: i.date, totalPaise: i.total_paise, balancePaise: i.balance_amount_paise, status: i.status })); // eslint-disable-line @typescript-eslint/no-explicit-any
    if (hasPermission(access, "sales_analysis.view")) out.totals = r.totals;
  }
  return c.json({ data: out });
});

const bodySchema = z.object({ gstin: z.string().trim().toUpperCase().optional() });

const stubForCompany = (env: AppEnv["Bindings"], companyId: string): any => env.BILLING_DO.get(env.BILLING_DO.idFromName(companyId)); // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Finds or creates the billing customer for a CRM account and remembers the link. An existing customer with the same name or GSTIN is
 * reused. Used by "Create invoice" on an account and automatically when a deal is won.
 */
export async function ensureCustomerForAccount(
  env: AppEnv["Bindings"],
  companyId: string,
  accountId: string,
  actor: { id: string; name: string },
  opts: { gstin?: string; canCreate: boolean },
): Promise<{ partyId: string; created: boolean }> {
  const stub = stubForCompany(env, companyId);
  const existing = await env.DB.prepare("SELECT party_id FROM billing_party_links WHERE account_id = ?").bind(accountId).first<{ party_id: string }>();
  if (existing) return { partyId: existing.party_id, created: false };

  const a = await env.DB.prepare("SELECT * FROM accounts WHERE id = ? AND archived_at IS NULL").bind(accountId).first<Record<string, string | null>>();
  if (!a) throw new ApiError(404, "not_found", "Account not found");
  const contact = await env.DB.prepare("SELECT first_name, last_name, email, phone FROM contacts WHERE account_id = ? AND archived_at IS NULL ORDER BY (phone IS NOT NULL) DESC, created_at LIMIT 1").bind(accountId).first<Record<string, string | null>>();

  const wanted = String(a.legal_name || a.name).trim().toLowerCase();
  const found = await stub.listParties({ search: String(a.name).slice(0, 40), limit: 30 });
  const match = (found.parties ?? []).find((p: any) => (opts.gstin && p.gstin === opts.gstin) || [p.name, p.company].some((n: string | undefined) => String(n ?? "").trim().toLowerCase() === wanted || String(n ?? "").trim().toLowerCase() === String(a.name).trim().toLowerCase())); // eslint-disable-line @typescript-eslint/no-explicit-any
  let partyId: string;
  let created = false;
  if (match) partyId = match.id;
  else {
    if (!opts.canCreate) throw new ApiError(403, "forbidden", "This client is not a billing customer yet and your role cannot add customers");
    if (opts.gstin && !validateGstin(opts.gstin).isValid) throw new ApiError(400, "bad_gstin", "That GSTIN is not valid");
    const stateName = String(a.state ?? "").trim().toLowerCase();
    const stateCode = opts.gstin ? opts.gstin.slice(0, 2) : INDIAN_STATES.find((s) => s.name.toLowerCase() === stateName)?.code ?? "19";
    const phone = String(a.phone || contact?.phone || "").replace(/[^0-9+]/g, "");
    const address = [a.address, a.city, a.state, a.postal_code].filter(Boolean).join(", ");
    const rec = await stub.createParty({
      type: "CUSTOMER", name: a.name, company: a.legal_name && a.legal_name !== a.name ? a.legal_name : undefined, phone, email: a.email || contact?.email || undefined,
      gstin: opts.gstin || undefined, billingAddress: address || undefined, stateCode, notes: `From CRM account ${a.name}`,
    });
    partyId = rec.id;
    created = true;
  }
  await env.DB.prepare("INSERT OR IGNORE INTO billing_party_links (account_id, company_id, party_id, created_by, created_at) VALUES (?,?,?,?,?)").bind(accountId, companyId, partyId, actor.id, now()).run();
  await recordAudit(env.DB, { actorId: actor.id, actorName: actor.name, action: "account.to_billing", entityType: "account", entityId: accountId, detail: { partyId, created }, status: 201 });
  return { partyId, created };
}

/**
 * A deal was won: the account becomes an active customer in the CRM and a billing customer you can invoice. Never throws,
 * so saving the deal can never fail because of this.
 */
export async function onDealWon(env: AppEnv["Bindings"], companyId: string, accountId: string | null | undefined, actor: { id: string; name: string }): Promise<void> {
  if (!accountId) return;
  try {
    await ensureCustomerForAccount(env, companyId, accountId, actor, { canCreate: true });
    await env.DB.prepare("UPDATE accounts SET status = 'active_customer', updated_at = ? WHERE id = ? AND status != 'active_customer'").bind(now(), accountId).run();
  } catch (e) {
    console.warn("deal won -> billing customer", e instanceof Error ? e.message : e);
  }
}

// Every account that already has a won deal becomes a billing customer (managers; safe to repeat).
accountLinkRoutes.post("/sync-won", async (c) => {
  const user = c.get("user");
  const access = await loadAccess(c);
  if (!hasPermission(access, "parties.manage")) throw new ApiError(403, "forbidden", "Your role cannot add customers");
  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT o.account_id AS id FROM opportunities o WHERE o.stage = 'closed_won' AND o.archived_at IS NULL AND o.account_id IS NOT NULL
       AND o.account_id NOT IN (SELECT account_id FROM billing_party_links)`,
  ).all<{ id: string }>();
  let created = 0, linked = 0, failed = 0;
  for (const r of rows.results ?? []) {
    try {
      const out = await ensureCustomerForAccount(c.env, c.req.header("X-Company-Id") || "default", r.id, user, { canCreate: true });
      if (out.created) created++;
      else linked++;
      await c.env.DB.prepare("UPDATE accounts SET status = 'active_customer', updated_at = ? WHERE id = ? AND status != 'active_customer'").bind(now(), r.id).run();
    } catch {
      failed++;
    }
  }
  return c.json({ data: { checked: rows.results?.length ?? 0, created, linked, failed } });
});

accountLinkRoutes.post("/:accountId", async (c) => {
  const id = c.req.param("accountId");
  const user = c.get("user");
  const access = await loadAccess(c);
  const body = bodySchema.parse(await c.req.json().catch(() => ({})));
  const out = await ensureCustomerForAccount(c.env, c.req.header("X-Company-Id") || "default", id, user, { gstin: body.gstin, canCreate: hasPermission(access, "parties.manage") });
  return c.json({ data: out }, out.created ? 201 : 200);
});
