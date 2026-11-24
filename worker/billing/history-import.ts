import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../env";
import { ApiError } from "../lib/http";
import { billingSettingsSchema, normalizeBillingSettings } from "@billing/shared";
import { recordAudit } from "./access";

/**
 * One-time load of invoices made in another billing tool (read from their PDFs): company details, bank, notes and terms, signature,
 * customers, products, every invoice with its original number and date, and the payments already received.
 * Administrators only. Refuses to run on a workspace that already has invoices, so it can never double up.
 */
export const historyImportRoutes = new Hono<AppEnv>();

historyImportRoutes.use("*", async (c, next) => {
  if (c.get("user").role !== "admin") throw new ApiError(403, "forbidden", "Only an administrator can import old invoices");
  await next();
});

const money = z.number().int().min(0);
const fileSchema = z.object({
  company: z.object({
    name: z.string().min(1), gstin: z.string().nullable().optional(), address: z.string().default(""), mobile: z.string().default(""), email: z.string().default(""), website: z.string().default(""),
    notes: z.string().default(""), terms: z.string().default(""), logoDataUrl: z.string().default(""), signatureDataUrl: z.string().default(""), signatoryName: z.string().default(""),
    bankDetails: z.object({ bank: z.string().nullable(), account: z.string().nullable(), ifsc: z.string().nullable(), branch: z.string().nullable() }).optional(),
  }),
  numbering: z.object({ prefix: z.string(), suffix: z.string(), padding: z.number().int().min(1).max(10) }),
  invoices: z.array(z.object({
    n: z.number().int().min(1), invoiceNo: z.string(), date: z.string(), dueDate: z.string(), stateCode: z.string().default("19"),
    party: z.object({ name: z.string().min(1), company: z.string().nullable().optional(), gstin: z.string().nullable().optional(), address: z.string().default("") }),
    items: z.array(z.object({ name: z.string().min(1), hsn: z.string().default(""), ratePaise: money, qty: z.number().positive(), unit: z.string().default("PCS"), amountPaise: money, description: z.string().optional() })).min(1),
    gstPercent: z.number().min(0).max(100), totalPaise: money, paidPaise: money,
  })).min(1).max(500),
  dryRun: z.boolean().default(false),
  markPaid: z.boolean().default(true),
});

historyImportRoutes.get("/status", async (c) => {
  const stub: any = c.env.BILLING_DO.get(c.env.BILLING_DO.idFromName("default"));
  await stub.initBusiness({ businessId: "default", businessName: c.env.APP_NAME || "Gexart", stateCode: "19", address: "", phone: "" });
  return c.json({ data: { invoices: await stub.countInvoices() } });
});

historyImportRoutes.post("/", async (c) => {
  const f = fileSchema.parse(await c.req.json());
  const user = c.get("user");
  const stub: any = c.env.BILLING_DO.get(c.env.BILLING_DO.idFromName("default"));
  await stub.initBusiness({ businessId: "default", businessName: c.env.APP_NAME || "Gexart", stateCode: "19", address: "", phone: "" });
  const existing: number = await stub.countInvoices();
  if (existing > 0 && !f.dryRun) throw new ApiError(409, "not_empty", `This workspace already has ${existing} invoice(s). The old-invoice import only runs on an empty one.`);

  const invoices = [...f.invoices].sort((a, b) => a.n - b.n);
  const partyKey = (p: { gstin?: string | null; name: string }) => (p.gstin || p.name).toUpperCase();
  const itemKey = (i: { name: string; hsn: string }) => `${i.name.toLowerCase()}|${i.hsn}`;
  const parties = new Map(invoices.map((i) => [partyKey(i.party), i.party]));
  const items = new Map<string, (typeof invoices)[number]["items"][number]>();
  for (const inv of invoices) for (const it of inv.items) items.set(itemKey(it), it); // last price wins
  const summary = {
    dryRun: f.dryRun, existingInvoices: existing, customers: parties.size, products: items.size, invoices: invoices.length,
    billedPaise: invoices.reduce((a, i) => a + i.totalPaise, 0), receivedPaise: invoices.reduce((a, i) => a + i.paidPaise, 0),
  };
  if (f.dryRun) return c.json({ data: summary });

  const warnings: string[] = [];
  const [units, taxes]: [any[], any[]] = [await stub.listUnits(), await stub.listTaxRates()];
  const unitOf = (name: string) => units.find((u) => [u.code, u.symbol, u.name].some((x) => String(x || "").toLowerCase() === name.toLowerCase())) ?? units.find((u) => u.is_default) ?? units[0];
  const taxOf = (pct: number) => taxes.find((t) => t.rate_basis_points === Math.round(pct * 100)) ?? taxes.find((t) => t.rate_basis_points === 1800) ?? taxes[0];

  // 1. Company, bank, notes and terms, signature
  const branch = (await stub.listBranches())[0];
  const mobile = f.company.mobile.split(",")[0]!.trim();
  await stub.updateBranch(branch.id, { name: f.company.name, gstin: f.company.gstin || null, address: f.company.address, phone: mobile, stateCode: (f.company.gstin || "19").slice(0, 2) });
  let bankId = "";
  const bd = f.company.bankDetails;
  if (bd?.bank && bd.account) {
    const existingBank = (await stub.listBankAccounts()).find((b: any) => b.last4 === bd.account!.slice(-4) && b.ifsc === bd.ifsc);
    bankId = existingBank?.id ?? (await stub.createBankAccount({ name: bd.bank, accountType: "BANK", accountNumber: bd.account, ifsc: bd.ifsc ?? undefined, branch: bd.branch ?? undefined, isDefault: true })).id;
  }
  const current = normalizeBillingSettings((await stub.getAllSettings())?.billing_settings);
  const merged = billingSettingsSchema.parse({
    ...current,
    company: { legalName: f.company.name, mobile: f.company.mobile, email: f.company.email, website: f.company.website },
    branding: { ...current.branding, logo: f.company.logoDataUrl, signature: f.company.signatureDataUrl, signatoryName: f.company.signatoryName, signatures: f.company.signatureDataUrl ? [{ id: "sig_main", name: f.company.signatoryName || f.company.name, signature: f.company.signatureDataUrl, stamp: "" }] : current.branding.signatures },
    notesTerms: { ...current.notesTerms, INVOICE: { notes: f.company.notes, terms: f.company.terms }, QUOTATION: { notes: f.company.notes, terms: f.company.terms }, PROFORMA: { notes: f.company.notes, terms: f.company.terms } },
    textTemplates: { notes: [...current.textTemplates.notes, ...(f.company.notes ? [{ id: "notes_std", name: "Standard note", text: f.company.notes }] : [])], terms: [...current.textTemplates.terms, ...(f.company.terms ? [{ id: "terms_std", name: "Standard terms", text: f.company.terms }] : [])] },
    preferences: { ...current.preferences, defaultBankAccountId: bankId || current.preferences.defaultBankAccountId },
    template: { id: "classic-black" },
  });
  await stub.setSetting("billing_settings", merged);

  // 2. Numbering: their format (GX/22/26-27), continuing after the last imported number
  await stub.saveNumbering({ docType: "INVOICE", prefix: f.numbering.prefix, suffix: f.numbering.suffix, padding: f.numbering.padding });
  await stub.setNextNumber("INVOICE", invoices[0]!.n);

  // 3. Customers and products
  const partyIds = new Map<string, string>();
  for (const [key, p] of parties) {
    const gstin = p.gstin?.trim().toUpperCase() || undefined;
    const rec = await stub.createParty({ type: "CUSTOMER", name: p.name, company: p.company || undefined, phone: "", gstin, billingAddress: p.address || undefined, stateCode: (gstin || "19").slice(0, 2), creditDays: 0 });
    partyIds.set(key, rec.id);
  }
  const itemIds = new Map<string, { id: string; unitId: string }>();
  for (const [key, it] of items) {
    const pct = invoices.find((i) => i.items.some((x) => itemKey(x) === key))!.gstPercent;
    const u = unitOf(it.unit);
    const rec = await stub.createItem({ name: it.name, type: it.hsn.startsWith("99") ? "SERVICE" : "GOODS", hsnSac: it.hsn || undefined, unitId: u.id, salePricePaise: it.ratePaise, purchasePricePaise: 0, taxRateId: taxOf(pct).id, priceIncludesTax: false });
    itemIds.set(key, { id: rec.id, unitId: u.id });
  }

  // 4. Invoices in order, then the payments already received. Stock may go negative (as it did in the old tool).
  const loc = (await stub.resolveLocation({ branchId: null, warehouseId: null })) as { branchId: string; warehouseId: string | null };
  const negBefore = (await stub.getAllSettings())?.allow_negative_stock;
  await stub.setSetting("allow_negative_stock", "true");
  let created = 0, paid = 0;
  const mismatches: string[] = [];
  try {
    for (const inv of invoices) {
      try {
        const r: any = await stub.createSalesInvoice({
          invoiceType: "REGULAR", branchId: loc.branchId, warehouseId: loc.warehouseId ?? undefined, partyId: partyIds.get(partyKey(inv.party)), partyName: inv.party.name, partyGstin: inv.party.gstin || undefined,
          partyStateCode: (inv.party.gstin || inv.stateCode || "19").slice(0, 2), date: inv.date, dueDate: inv.dueDate, paymentMode: "CREDIT", enableRoundOff: true, bankAccountId: bankId || undefined,
          signatoryName: f.company.signatoryName || undefined, notes: f.company.notes || undefined, terms: f.company.terms || undefined, createdById: user.id,
          items: inv.items.map((it) => ({ itemId: itemIds.get(itemKey(it))!.id, name: it.description ? `${it.name}\n${it.description}` : it.name, hsnSac: it.hsn, quantityThousandths: Math.round(it.qty * 1000), unitId: itemIds.get(itemKey(it))!.unitId, unitPricePaise: it.ratePaise, discountPaise: 0, taxRatePercent: inv.gstPercent, isTaxInclusive: false })),
        });
        const made = r?.invoice ?? r;
        created++;
        const gotTotal = made?.totalPaise ?? made?.total_paise;
        if (gotTotal !== inv.totalPaise) mismatches.push(`${inv.invoiceNo}: file ₹${inv.totalPaise / 100}, created ₹${(gotTotal ?? 0) / 100}`);
        if (made?.invoiceNo && made.invoiceNo !== inv.invoiceNo) warnings.push(`${inv.invoiceNo} was numbered ${made.invoiceNo}`);
        if (f.markPaid && inv.paidPaise > 0) {
          await stub.recordSalesPayment({ invoiceId: made.id, amountPaise: Math.min(inv.paidPaise, gotTotal ?? inv.paidPaise), paymentMode: "BANK", paymentAccountId: bankId ? undefined : undefined, branchId: loc.branchId, date: inv.date, notes: "Imported from old invoice", createdById: user.id });
          paid++;
        }
      } catch (e) {
        warnings.push(`${inv.invoiceNo} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    await stub.setSetting("allow_negative_stock", negBefore ?? "false");
  }
  c.executionCtx.waitUntil(recordAudit(c.env.DB, { actorId: user.id, actorName: user.name, action: "import.history", entityType: "billing", detail: { ...summary, created, paid, warnings: warnings.length }, status: 200 }));
  return c.json({ data: { ...summary, createdInvoices: created, paymentsRecorded: paid, totalMismatches: mismatches, warnings } });
});
