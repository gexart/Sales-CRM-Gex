import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import type { BusinessVariables } from '../middleware/tenant';

export const accountingRoutes = new Hono<{ Bindings: Env; Variables: BusinessVariables }>();

const getStub = (c: any) =>
  c.get('businessStub') ||
  c.env.BILLING_DO.get(
    c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
  );

// GET /api/accounting/accounts - List chart of accounts
accountingRoutes.get('/accounts', async (c) => {
  const stub = getStub(c);
  const accounts: any[] = await stub.listAccounts();
  return c.json({ ok: true, accounts });
});

// GET /api/accounting/trial-balance - Retrieve Trial Balance
accountingRoutes.get('/trial-balance', async (c) => {
  const stub = getStub(c);
  const asOfDate = c.req.query('asOfDate');
  const tb = await stub.getTrialBalance(asOfDate);
  return c.json({
    ok: true,
    trialBalance: tb,
    isBalanced: tb.differencePaise === 0,
  });
});

// POST /api/accounting/vouchers - Create manual voucher (JOURNAL, CONTRA, RECEIPT, PAYMENT)
const voucherSchema = z.object({
  voucherType: z.enum(['JOURNAL', 'CONTRA', 'RECEIPT', 'PAYMENT']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  narration: z.string().min(1),
  branchId: z.string().min(1),
  lines: z
    .array(
      z.object({
        accountId: z.string().min(1),
        partyId: z.string().optional(),
        debitPaise: z.number().int().min(0).default(0),
        creditPaise: z.number().int().min(0).default(0),
        narration: z.string().optional(),
      }),
    )
    .min(2),
});

accountingRoutes.post('/vouchers', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const parsed = voucherSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);
  }

  try {
    const res = await (stub as any).createVoucher(parsed.data);
    return c.json({ ok: true, voucher: res }, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to post voucher' }, 400);
  }
});

// Legacy backward compatibility for /journal-entry
accountingRoutes.post('/journal-entry', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const parsed = voucherSchema.omit({ voucherType: true }).safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);
  }

  try {
    const res = await (stub as any).createVoucher({
      ...parsed.data,
      voucherType: 'JOURNAL',
    });
    return c.json({ ok: true, entry: res }, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to post manual journal entry' }, 400);
  }
});

// POST /api/accounting/opening-balances
accountingRoutes.post('/opening-balances', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const schema = z.object({
    branchId: z.string().min(1),
    openingDate: z.string().optional(),
    balances: z.array(
      z.object({
        accountId: z.string().min(1),
        debitPaise: z.number().int().min(0).default(0),
        creditPaise: z.number().int().min(0).default(0),
      }),
    ),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);

  try {
    const res = await (stub as any).setOpeningBalances(
      parsed.data.branchId,
      parsed.data.balances,
      parsed.data.openingDate,
    );
    return c.json({ ok: true, result: res });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// Period Lock routes
accountingRoutes.get('/period-lock', async (c) => {
  const stub = getStub(c);
  const settings = await (stub as any).getPeriodLockSettings();
  return c.json({ ok: true, settings });
});

accountingRoutes.post('/period-lock', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const schema = z.object({ lockedUntilDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid date format' }, 400);

  const res = await (stub as any).setPeriodLock(parsed.data.lockedUntilDate);
  return c.json({ ok: true, result: res });
});

accountingRoutes.post('/lock-gst-month', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const schema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid month format' }, 400);

  const res = await (stub as any).lockGstMonth(parsed.data.month);
  return c.json({ ok: true, result: res });
});

accountingRoutes.post('/year-end-close', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const schema = z.object({ financialYear: z.string().regex(/^\d{2}-\d{2}$/) });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid financial year format e.g. 26-27' }, 400);

  try {
    const res = await (stub as any).closeFinancialYear(parsed.data.financialYear);
    return c.json({ ok: true, result: res });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// Bank Recon routes
accountingRoutes.post('/bank-recon/import', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const schema = z.object({
    bankAccountId: z.string().min(1),
    statementDate: z.string(),
    filename: z.string().min(1),
    lines: z.array(
      z.object({
        date: z.string(),
        description: z.string(),
        referenceNo: z.string().optional(),
        amountPaise: z.number().int().min(1),
        type: z.enum(['CREDIT', 'DEBIT']),
        balancePaise: z.number().int().optional(),
      }),
    ),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);

  const res = await (stub as any).importBankStatement(parsed.data);
  return c.json({ ok: true, result: res }, 201);
});

accountingRoutes.post('/bank-recon/auto-match', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const schema = z.object({ bankAccountId: z.string().min(1) });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'bankAccountId required' }, 400);

  const res = await (stub as any).autoMatchBankStatement(parsed.data.bankAccountId);
  return c.json({ ok: true, result: res });
});

accountingRoutes.post('/bank-recon/manual-match', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const schema = z.object({
    statementLineId: z.string().min(1),
    journalLineId: z.string().min(1),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'statementLineId and journalLineId required' }, 400);

  await (stub as any).manualMatchStatementLine(parsed.data.statementLineId, parsed.data.journalLineId);
  return c.json({ ok: true, message: 'Matched successfully' });
});

accountingRoutes.post('/bank-recon/create-entry', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const schema = z.object({
    statementLineId: z.string().min(1),
    categoryAccountId: z.string().min(1),
    branchId: z.string().min(1),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);

  try {
    const res = await (stub as any).createEntryFromUnmatchedLine(
      parsed.data.statementLineId,
      parsed.data.categoryAccountId,
      parsed.data.branchId,
    );
    return c.json({ ok: true, entry: res }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

accountingRoutes.get('/bank-recon/lines', async (c) => {
  const stub = getStub(c);
  const bankAccountId = c.req.query('bankAccountId');
  if (!bankAccountId) return c.json({ error: 'bankAccountId query param is required' }, 400);
  const lines = await (stub as any).listBankStatementLines(bankAccountId, c.req.query('status') === 'ALL');
  return c.json({ ok: true, lines });
});

accountingRoutes.get('/bank-recon/report', async (c) => {
  const stub = getStub(c);
  const bankAccountId = c.req.query('bankAccountId');
  if (!bankAccountId) return c.json({ error: 'bankAccountId query param is required' }, 400);
  const asOfDate = c.req.query('asOfDate');
  const report = await (stub as any).getBankReconciliationReport(bankAccountId, asOfDate);
  return c.json({ ok: true, report });
});

// Cheques & TDS
accountingRoutes.get('/cheques', async (c) => {
  const stub = getStub(c);
  const status = c.req.query('status');
  const type = c.req.query('type');
  const bankAccountId = c.req.query('bankAccountId');
  const cheques = await (stub as any).listCheques({ status, type, bankAccountId });
  return c.json({ ok: true, cheques });
});

accountingRoutes.post('/cheques', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const schema = z.object({
    bankAccountId: z.string().min(1),
    partyId: z.string().optional(),
    type: z.enum(['RECEIVED', 'ISSUED']),
    chequeNo: z.string().min(1),
    chequeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amountPaise: z.number().int().min(1),
    payeePayerName: z.string().min(1),
    notes: z.string().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);

  try {
    const res = await (stub as any).recordCheque(parsed.data);
    return c.json({ ok: true, cheque: res }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

accountingRoutes.patch('/cheques/:id/status', async (c) => {
  const stub = getStub(c);
  const chequeId = c.req.param('id');
  const body = await c.req.json();
  const schema = z.object({
    status: z.enum(['CLEARED', 'BOUNCED']),
    clearingDate: z.string().optional(),
    bounceChargesPaise: z.number().int().min(0).optional(),
    branchId: z.string().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);

  try {
    await (stub as any).updateChequeStatus(chequeId, parsed.data.status, parsed.data);
    return c.json({ ok: true, message: `Cheque status updated to ${parsed.data.status}` });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

accountingRoutes.post('/tds', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const schema = z.object({
    voucherType: z.string().min(1),
    voucherId: z.string().min(1),
    partyId: z.string().optional(),
    pan: z.string().optional(),
    section: z.string().min(1),
    taxableAmountPaise: z.number().int().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);

  try {
    const res = await (stub as any).recordTdsEntry(parsed.data);
    return c.json({ ok: true, tds: res }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

accountingRoutes.get('/tds/report', async (c) => {
  const stub = getStub(c);
  const fy = c.req.query('financialYear');
  const report = await (stub as any).getTdsPayableReport(fy);
  return c.json({ ok: true, report });
});

accountingRoutes.post('/advances/adjust', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const schema = z.object({
    paymentId: z.string().min(1),
    invoiceId: z.string().optional(),
    purchaseBillId: z.string().optional(),
    adjustedAmountPaise: z.number().int().min(1),
    adjustedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);

  try {
    const res = await (stub as any).adjustAdvancePayment(parsed.data);
    return c.json({ ok: true, result: res });
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// GST Returns
accountingRoutes.get('/gst/gstr-1', async (c) => {
  const stub = getStub(c);
  const month = c.req.query('month') || new Date().toISOString().substring(0, 7);
  const gstr1 = await (stub as any).generateGstr1(month);
  return c.json({ ok: true, gstr1 });
});

accountingRoutes.get('/gst/gstr-3b', async (c) => {
  const stub = getStub(c);
  const month = c.req.query('month') || new Date().toISOString().substring(0, 7);
  const gstr3b = await (stub as any).generateGstr3b(month);
  return c.json({ ok: true, gstr3b });
});

accountingRoutes.post('/gst/gstr-2b/reconcile', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const schema = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    records: z.array(
      z.object({
        supplierGstin: z.string(),
        tradeName: z.string().optional(),
        invoiceNo: z.string(),
        invoiceDate: z.string(),
        invoiceValuePaise: z.number().int(),
        taxableValuePaise: z.number().int(),
        igstPaise: z.number().int(),
        cgstPaise: z.number().int(),
        sgstPaise: z.number().int(),
        cessPaise: z.number().int().default(0),
        itcAvailable: z.boolean().default(true),
      }),
    ),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);

  const res = await (stub as any).reconcileGstr2b(parsed.data.records, parsed.data.month);
  return c.json({ ok: true, reconciliation: res });
});

// Tally XML Export
accountingRoutes.get('/tally-xml', async (c) => {
  const stub = getStub(c);
  const companyName = c.req.query('companyName') || 'GexGrow Merchant';
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const xml = await (stub as any).exportTallyXml(companyName, startDate, endDate);
  return c.text(xml, 200, {
    'Content-Type': 'application/xml',
    'Content-Disposition': `attachment; filename="tally-export-${Date.now()}.xml"`,
  });
});

// Cost Centres & Fixed Assets
accountingRoutes.get('/cost-centres', async (c) => {
  const stub = getStub(c);
  const costCentres = await (stub as any).listCostCentres();
  return c.json({ ok: true, costCentres });
});

accountingRoutes.post('/cost-centres', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const schema = z.object({
    name: z.string().min(1),
    code: z.string().min(1),
    category: z.enum(['BRANCH', 'DEPARTMENT', 'PROJECT']).optional(),
    branchId: z.string().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);

  const res = await (stub as any).createCostCentre(parsed.data);
  return c.json({ ok: true, costCentre: res }, 201);
});

accountingRoutes.post('/cost-centres/budget', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const schema = z.object({
    costCentreId: z.string().min(1),
    financialYear: z.string().min(1),
    budgetPaise: z.number().int().min(1),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);

  await (stub as any).setCostCentreBudget(parsed.data.costCentreId, parsed.data.financialYear, parsed.data.budgetPaise);
  return c.json({ ok: true, message: 'Budget set' });
});

accountingRoutes.get('/cost-centres/report', async (c) => {
  const stub = getStub(c);
  const fy = c.req.query('financialYear') || '26-27';
  const report = await (stub as any).getCostCentreBudgetReport(fy);
  return c.json({ ok: true, report });
});

accountingRoutes.get('/fixed-assets', async (c) => {
  const stub = getStub(c);
  const assets = await (stub as any).listFixedAssets();
  return c.json({ ok: true, assets });
});

accountingRoutes.post('/fixed-assets', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const schema = z.object({
    assetName: z.string().min(1),
    assetCode: z.string().min(1),
    costCentreId: z.string().optional(),
    purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    purchaseCostPaise: z.number().int().min(1),
    depreciationMethod: z.enum(['WDV', 'SLM']),
    depreciationRateBasisPoints: z.number().int().min(1),
    salvageValuePaise: z.number().int().min(0).optional(),
    assetAccountId: z.string().min(1),
    depreciationExpenseAccountId: z.string().min(1),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);

  try {
    const res = await (stub as any).createFixedAsset(parsed.data);
    return c.json({ ok: true, asset: res }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

accountingRoutes.post('/fixed-assets/:id/depreciate', async (c) => {
  const stub = getStub(c);
  const assetId = c.req.param('id');
  const body = await c.req.json();
  const schema = z.object({
    financialYear: z.string().min(1),
    branchId: z.string().min(1),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);

  try {
    const res = await (stub as any).postAssetDepreciationRun(assetId, parsed.data.financialYear, parsed.data.branchId);
    return c.json({ ok: true, result: res }, 201);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// Inventory valuation method
accountingRoutes.get('/inventory-valuation', async (c) => {
  const stub = getStub(c);
  const method = await (stub as any).getInventoryValuationMethod();
  return c.json({ ok: true, method });
});

accountingRoutes.post('/inventory-valuation', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const schema = z.object({ method: z.enum(['WEIGHTED_AVERAGE', 'FIFO']) });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid method: must be WEIGHTED_AVERAGE or FIFO' }, 400);

  const res = await (stub as any).setInventoryValuationMethod(parsed.data.method);
  return c.json({ ok: true, result: res });
});
