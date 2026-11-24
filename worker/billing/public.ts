import { Hono } from "hono";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/http";

/**
 * The page a customer opens from the WhatsApp message: /i/:token. No login; the long random token is the key.
 * Only what the customer needs is returned (never internal ids, who created it, or other customers).
 */
export const publicBillingRoutes = new Hono<AppEnv>();

let hits = new Map<string, { n: number; reset: number }>();
publicBillingRoutes.get("/invoice/:token", async (c) => {
  // Cheap guard against token guessing: 60 lookups a minute per address.
  const ip = c.req.header("cf-connecting-ip") || "local";
  const t = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < t) hits.set(ip, { n: 1, reset: t + 60_000 });
  else if (++h.n > 60) throw new ApiError(429, "rate_limited", "Too many requests. Try again in a minute.");
  if (hits.size > 5000) hits = new Map();

  const stub: any = c.env.BILLING_DO.get(c.env.BILLING_DO.idFromName("default"));
  const r = await stub.getPublicInvoice(c.req.param("token"));
  if (!r?.invoice) throw new ApiError(404, "not_found", "This invoice link is not valid.");
  const i = r.invoice;
  return c.json({
    data: {
      invoiceNo: i.invoice_no,
      date: i.date,
      dueDate: i.due_date,
      status: i.status,
      partyName: i.party_name,
      partyGstin: i.party_gstin,
      subtotalPaise: i.subtotal_paise,
      discountPaise: i.discount_paise,
      taxPaise: i.tax_total_paise,
      roundOffPaise: i.round_off_paise,
      totalPaise: i.total_paise,
      paidPaise: i.paid_amount_paise,
      balancePaise: i.balance_amount_paise,
      amountInWords: i.amountInWords,
      notes: i.notes,
      seller: i.branch ? { name: i.branch.name, gstin: i.branch.gstin, address: i.branch.address, phone: i.branch.phone } : null,
      lines: (i.lines ?? []).map((l: any) => ({ name: l.name, hsn: l.hsn_sac, qty: l.quantity_thousandths / 1000, pricePaise: l.unit_price_paise, discountPaise: l.discount_paise, gstPct: l.tax_rate_basis_points / 100, totalPaise: l.line_total_paise })),
      upiDeepLink: i.balance_amount_paise > 0 && i.status !== "CANCELLED" ? r.upiDeepLink : null,
    },
  });
});
