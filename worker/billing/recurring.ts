import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Env } from "../env";
import { ApiError } from "../lib/http";
import { newId, now } from "../lib/util";
import { hasPermission } from "../../shared/access";
import { loadAccess, recordAudit } from "./access";
import { emailInvoiceEvent, pushInvoiceToCrm } from "./notify";
import { createInvoiceSchema } from "./routes/sales";

/** Recurring invoices. Managing them needs permission to create invoices directly. */
export const recurringRoutes = new Hono<AppEnv>();

export const FREQUENCIES = ["weekly", "monthly", "quarterly", "half_yearly", "yearly"] as const;
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/** Add one period to a YYYY-MM-DD date. Month steps keep the day (the 31st becomes the last day of a short month). */
export function nextDate(from: string, frequency: (typeof FREQUENCIES)[number]): string {
  const [y, m, d] = from.split("-").map(Number) as [number, number, number];
  if (frequency === "weekly") return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
  const months = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : frequency === "half_yearly" ? 6 : 12;
  const total = m - 1 + months;
  const ny = y + Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

recurringRoutes.use("*", async (c, next) => {
  const a = await loadAccess(c);
  if (!hasPermission(a, "invoice.create")) throw new ApiError(403, "forbidden", "Recurring invoices need permission to create invoices");
  await next();
});

recurringRoutes.get("/", async (c) => {
  const r = await c.env.DB.prepare("SELECT id, title, party_name, frequency, next_run, end_date, active, runs, last_invoice_id, last_invoice_no, last_run_at, last_error, credit_days FROM billing_recurring ORDER BY active DESC, next_run").all();
  return c.json({ data: r.results ?? [] });
});

const createSchema = z.object({ invoiceId: z.string().min(1), frequency: z.enum(FREQUENCIES), firstRun: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), title: z.string().max(120).optional() });

recurringRoutes.post("/", async (c) => {
  const d = createSchema.parse(await c.req.json());
  const companyId = c.req.header("X-Company-Id") || "default";
  const stub: any = c.env.BILLING_DO.get(c.env.BILLING_DO.idFromName(companyId));
  const inv = await stub.getSalesInvoice(d.invoiceId);
  if (!inv) throw new ApiError(404, "not_found", "Invoice not found");
  const payload = {
    partyId: inv.party_id, partyName: inv.party_name, partyGstin: inv.party_gstin || undefined, partyStateCode: inv.party_state_code || "19", paymentMode: "CREDIT",
    items: (inv.lines ?? []).map((l: any) => ({ itemId: l.item_id, name: l.name, hsnSac: l.hsn_sac || "", quantityThousandths: l.quantity_thousandths, unitId: l.unit_id, unitPricePaise: l.unit_price_paise, discountPaise: l.discount_paise ?? 0, taxRatePercent: (l.tax_rate_basis_points ?? 0) / 100, isTaxInclusive: false })),
    notes: inv.notes || undefined, terms: inv.terms || undefined, bankAccountId: inv.bank_account_id || undefined, signatoryName: inv.signatory_name || undefined, enableRoundOff: true,
  };
  const credit = Math.max(0, Math.round((new Date(inv.due_date).getTime() - new Date(inv.date).getTime()) / 86_400_000)) || 15;
  const id = newId();
  await c.env.DB.prepare("INSERT INTO billing_recurring (id, company_id, title, party_name, payload, credit_days, frequency, next_run, end_date, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, companyId, d.title || `${inv.party_name} · ${inv.invoice_no}`, inv.party_name, JSON.stringify(payload), credit, d.frequency, d.firstRun, d.endDate ?? null, c.get("user").id, now())
    .run();
  c.executionCtx.waitUntil(recordAudit(c.env.DB, { companyId, actorId: c.get("user").id, actorName: c.get("user").name, action: "recurring.create", entityType: "billing_recurring", entityId: id, detail: { from: inv.invoice_no, frequency: d.frequency, firstRun: d.firstRun }, status: 201 }));
  return c.json({ data: { id } }, 201);
});

/** "Run now" on a schedule: makes its next invoice immediately (also what the cron does when the date arrives). */
recurringRoutes.post("/:id/run-now", async (c) => {
  const row = await c.env.DB.prepare("SELECT id, next_run FROM billing_recurring WHERE id = ?").bind(c.req.param("id")).first<{ id: string; next_run: string }>();
  if (!row) throw new ApiError(404, "not_found", "Schedule not found");
  const today = istToday();
  if (row.next_run > today) await c.env.DB.prepare("UPDATE billing_recurring SET next_run = ?, last_error = NULL WHERE id = ?").bind(today, row.id).run();
  else await c.env.DB.prepare("UPDATE billing_recurring SET last_error = NULL WHERE id = ?").bind(row.id).run();
  const made = await runDueRecurring(c.env, today);
  const after = await c.env.DB.prepare("SELECT last_invoice_id, last_invoice_no, last_error, next_run FROM billing_recurring WHERE id = ?").bind(row.id).first();
  return c.json({ data: { made, ...after } });
});

recurringRoutes.put("/:id", async (c) => {
  const d = z.object({ active: z.boolean().optional(), nextRun: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), frequency: z.enum(FREQUENCIES).optional() }).parse(await c.req.json());
  const sets: string[] = [];
  const args: unknown[] = [];
  if (d.active !== undefined) (sets.push("active = ?"), args.push(d.active ? 1 : 0));
  if (d.nextRun) (sets.push("next_run = ?"), args.push(d.nextRun));
  if (d.endDate !== undefined) (sets.push("end_date = ?"), args.push(d.endDate));
  if (d.frequency) (sets.push("frequency = ?"), args.push(d.frequency));
  if (!sets.length) return c.json({ data: { id: c.req.param("id") } });
  const r = await c.env.DB.prepare(`UPDATE billing_recurring SET ${sets.join(", ")} WHERE id = ?`).bind(...args, c.req.param("id")).run();
  if (!r.meta.changes) throw new ApiError(404, "not_found", "Schedule not found");
  return c.json({ data: { id: c.req.param("id") } });
});

recurringRoutes.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM billing_recurring WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ data: { id: c.req.param("id") } });
});

/** Called by the cron every 15 minutes: creates the invoices that are due today (India time) and moves each schedule forward. */
export async function runDueRecurring(env: Env, today = istToday()): Promise<number> {
  const due = await env.DB.prepare("SELECT * FROM billing_recurring WHERE active = 1 AND next_run <= ? AND (end_date IS NULL OR end_date >= ?) ORDER BY next_run LIMIT 20").bind(today, today).all<Record<string, any>>();
  let made = 0;
  for (const s of due.results ?? []) {
    // After a failure wait a few hours instead of retrying on every cron tick.
    if (s.last_error && s.last_run_at && Date.now() - new Date(s.last_run_at).getTime() < 6 * 3600_000) continue;
    const stub: any = env.BILLING_DO.get(env.BILLING_DO.idFromName(s.company_id || "default"));
    try {
      const body = createInvoiceSchema.parse({ ...JSON.parse(s.payload), date: today, dueDate: addDays(today, s.credit_days ?? 15) });
      await stub.initBusiness({ businessId: s.company_id || "default", businessName: env.APP_NAME || "Gexart", stateCode: "19", address: "", phone: "" });
      const loc = (await stub.resolveLocation({ branchId: null, warehouseId: null })) as { branchId: string; warehouseId: string | null };
      const result: any = await stub.createSalesInvoice({ ...body, branchId: loc.branchId, warehouseId: loc.warehouseId ?? undefined, createdById: s.created_by });
      const inv = result?.invoice ?? result;
      const nxt = nextDate(s.next_run, s.frequency);
      await env.DB.batch([
        env.DB.prepare("UPDATE billing_recurring SET runs = runs + 1, last_invoice_id = ?, last_invoice_no = ?, last_run_at = ?, last_error = NULL, next_run = ?, active = CASE WHEN end_date IS NOT NULL AND ? > end_date THEN 0 ELSE 1 END WHERE id = ?").bind(inv?.id ?? null, inv?.invoiceNo ?? null, now(), nxt, nxt, s.id),
        env.DB.prepare("INSERT INTO notifications (id, user_id, type, title, body, entity_type, entity_id, created_at) VALUES (?,?,?,?,?,?,?,?)").bind(newId(), s.created_by, "billing_recurring", "Recurring invoice created", `${s.party_name}: ${inv?.invoiceNo ?? ""}`, "billing_recurring", s.id, now()),
      ]);
      made++;
      const origin = env.APP_URL || "https://sales-crm-gexart.tech-gexart.workers.dev";
      if (inv?.id) {
        if (String(env.BILLING_EMAIL_AUTO || "on").toLowerCase() !== "off") await emailInvoiceEvent(env, stub, inv.id, "invoice", origin);
        if (String(env.AGENCY_CRM_PUSH || "on").toLowerCase() !== "off" && env.AGENCY_CRM_HOOK_URL) await pushInvoiceToCrm(env, stub, inv.id, origin, "invoice.created");
      }
    } catch (e) {
      await env.DB.prepare("UPDATE billing_recurring SET last_error = ?, last_run_at = ? WHERE id = ?").bind(e instanceof Error ? e.message.slice(0, 300) : "Failed", now(), s.id).run();
    }
  }
  return made;
}
