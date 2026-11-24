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

accountLinkRoutes.post("/:accountId", async (c) => {
  const id = c.req.param("accountId");
  const user = c.get("user");
  const access = await loadAccess(c);
  const body = bodySchema.parse(await c.req.json().catch(() => ({})));
  const stub = stubOf(c);
  const existing = await c.env.DB.prepare("SELECT party_id FROM billing_party_links WHERE account_id = ?").bind(id).first<{ party_id: string }>();
  if (existing) return c.json({ data: { partyId: existing.party_id, created: false } });

  const a = await c.env.DB.prepare("SELECT * FROM accounts WHERE id = ? AND archived_at IS NULL").bind(id).first<Record<string, string | null>>();
  if (!a) throw new ApiError(404, "not_found", "Account not found");
  const contact = await c.env.DB.prepare("SELECT first_name, last_name, email, phone FROM contacts WHERE account_id = ? AND archived_at IS NULL ORDER BY (phone IS NOT NULL) DESC, created_at LIMIT 1").bind(id).first<Record<string, string | null>>();

  // An existing customer with the same name (or GSTIN) is reused instead of duplicated.
  const wanted = String(a.legal_name || a.name).trim().toLowerCase();
  const found = await stub.listParties({ search: String(a.name).slice(0, 40), limit: 30 });
  const match = (found.parties ?? []).find((p: any) => (body.gstin && p.gstin === body.gstin) || [p.name, p.company].some((n: string | undefined) => String(n ?? "").trim().toLowerCase() === wanted || String(n ?? "").trim().toLowerCase() === String(a.name).trim().toLowerCase())); // eslint-disable-line @typescript-eslint/no-explicit-any
  let partyId: string;
  let created = false;
  if (match) partyId = match.id;
  else {
    if (!hasPermission(access, "parties.manage")) throw new ApiError(403, "forbidden", "This client is not a billing customer yet and your role cannot add customers");
    if (body.gstin && !validateGstin(body.gstin).isValid) throw new ApiError(400, "bad_gstin", "That GSTIN is not valid");
    const stateName = String(a.state ?? "").trim().toLowerCase();
    const stateCode = body.gstin ? body.gstin.slice(0, 2) : INDIAN_STATES.find((s) => s.name.toLowerCase() === stateName)?.code ?? "19";
    const phone = String(a.phone || contact?.phone || "").replace(/[^0-9+]/g, "");
    const address = [a.address, a.city, a.state, a.postal_code].filter(Boolean).join(", ");
    const rec = await stub.createParty({
      type: "CUSTOMER", name: a.name, company: a.legal_name && a.legal_name !== a.name ? a.legal_name : undefined, phone, email: a.email || contact?.email || undefined,
      gstin: body.gstin || undefined, billingAddress: address || undefined, stateCode, notes: `From CRM account ${a.name}`,
    });
    partyId = rec.id;
    created = true;
  }
  await c.env.DB.prepare("INSERT INTO billing_party_links (account_id, company_id, party_id, created_by, created_at) VALUES (?,?,?,?,?)").bind(id, c.req.header("X-Company-Id") || "default", partyId, user.id, now()).run();
  c.executionCtx.waitUntil(recordAudit(c.env.DB, { actorId: user.id, actorName: user.name, action: "account.to_billing", entityType: "account", entityId: id, detail: { partyId, created }, status: 201 }));
  return c.json({ data: { partyId, created } }, 201);
});
