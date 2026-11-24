import { Hono } from 'hono';
import { approvalGate, grossPaise, type GateLine } from '../services/approval-gate';
import { z } from 'zod';
import type { Env } from '../types';
import { locate } from './location';
import type { BusinessVariables } from '../middleware/tenant';
import { newId } from '@billing/shared';

export const purchaseRoutes = new Hono<{ Bindings: Env; Variables: BusinessVariables }>();

const TDS_RATES: Record<string, number> = { '194C': 2, '194J': 10, '194I': 10, '194H': 5, '194Q': 0.1, '194A': 10, '194O': 1 };
const tdsSchema = z.object({
  section: z.string().min(2).max(10),
  ratePercent: z.number().min(0).max(100).optional(),
  amountPaise: z.number().int().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});


// Zod schemas
const createPurchaseBillSchema = z.object({
  branchId: z.string().optional(),
  warehouseId: z.string().optional(),
  partyId: z.string().min(1, 'Vendor party is required'),
  vendorBillNo: z.string().optional(),
  vendorInvoiceDate: z.string().optional(),
  date: z.string().optional(),
  dueDate: z.string().optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1, 'Item is required'),
        quantityThousandths: z.number().positive('Quantity must be greater than 0'),
        unitPricePaise: z.number().nonnegative('Unit price must be non-negative'),
        taxRateBasisPoints: z.number().nonnegative().default(0),
        discountPaise: z.number().nonnegative().optional().default(0),
      }),
    )
    .min(1, 'At least one line item is required'),
  rcmApplicable: z.boolean().optional().default(false),
  itcEligibility: z.enum(['ELIGIBLE', 'INELIGIBLE', 'BLOCKED_17_5']).optional().default('ELIGIBLE'),
  paidAmountPaise: z.number().nonnegative().optional().default(0),
  paymentMode: z.enum(['CASH', 'BANK', 'UPI']).optional(),
  paymentAccountId: z.string().optional(),
  notes: z.string().optional(),
  receiptFileKey: z.string().optional(),
});

const recordPaymentSchema = z.object({
  amountPaise: z.number().positive('Amount must be positive'),
  paymentMode: z.enum(['CASH', 'BANK', 'UPI']),
  paymentAccountId: z.string().optional(),
  referenceNo: z.string().optional(),
  date: z.string().optional(),
  notes: z.string().optional(),
});

const createDebitNoteSchema = z.object({
  billId: z.string().min(1, 'Bill ID is required'),
  reason: z.string().min(1, 'Reason is required'),
  date: z.string().optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1, 'Item is required'),
        quantityThousandths: z.number().positive(),
        unitPricePaise: z.number().nonnegative(),
        taxRateBasisPoints: z.number().nonnegative().default(0),
      }),
    )
    .min(1, 'At least one line item is required'),
});

// GET /api/purchases/bills
purchaseRoutes.get('/bills', async (c) => {
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );
  const status = c.req.query('status');
  const search = c.req.query('search') || c.req.query('q');
  const partyId = c.req.query('partyId');
  const branchId = c.req.query('branchId');

  const bills = await (stub as any).listPurchaseBills({
    status,
    search,
    partyId,
    branchId,
  });

  return c.json({ bills });
});

// GET /api/purchases/bills/:id
purchaseRoutes.get('/bills/:id', async (c) => {
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );
  const id = c.req.param('id');
  const bill = await (stub as any).getPurchaseBill(id);

  if (!bill) {
    return c.json({ error: 'Purchase bill not found' }, 404);
  }

  return c.json({ bill });
});

// POST /api/purchases/bills
purchaseRoutes.post('/bills', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parse = createPurchaseBillSchema.safeParse(body);
  if (!parse.success) {
    return c.json({ error: 'Invalid purchase bill input', details: parse.error.format() }, 400);
  }

  const data = parse.data;
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );

  // Purchases above the Master Admin's limit wait for approval
  const gross = grossPaise(data.lines as GateLine[]) - data.lines.reduce((a: number, l: any) => a + (l.discountPaise ?? 0), 0);
  const held = await approvalGate(c, 'PURCHASE', data.partyId, gross);
  if (held) return held;

  const loc = await locate(c, { branchId: data.branchId, warehouseId: data.warehouseId });
  const branchId = loc.branchId;
  const warehouseId = loc.warehouseId;
  if (!warehouseId) return c.json({ error: 'Create a warehouse for this branch first' }, 400);

  const bill = await (stub as any).createPurchaseBill({
    ...data,
    branchId,
    warehouseId,
  });

  return c.json({ bill }, 201);
});

// POST /api/purchases/bills/:id/payments
purchaseRoutes.post('/bills/:id/payments', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parse = recordPaymentSchema.safeParse(body);
  if (!parse.success) {
    return c.json({ error: 'Invalid payment input', details: parse.error.format() }, 400);
  }

  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );
  const billId = c.req.param('id');

  const updatedBill = await (stub as any).recordPurchasePayment(billId, parse.data);
  return c.json({ bill: updatedBill });
});

// POST /api/purchases/debit-notes
// TDS DEDUCTED FROM THE VENDOR: part of the bill is settled against "TDS Payable" (a liability you deposit with the tax department).
purchaseRoutes.post('/bills/:id/tds', async (c) => {
  const stub: any = c.get('businessStub');
  const parsed = tdsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Choose the TDS section and the rate or amount', details: parsed.error.flatten() }, 400);
  const bill = await stub.getPurchaseBill(c.req.param('id'));
  if (!bill) return c.json({ error: 'Purchase not found' }, 404);
  const taxable = (bill.subtotal_paise ?? 0) - (bill.discount_paise ?? 0);
  const rate = parsed.data.ratePercent ?? TDS_RATES[parsed.data.section] ?? 0;
  const amount = parsed.data.amountPaise ?? Math.round((taxable * rate) / 100);
  const due = (bill.total_paise ?? 0) - (bill.paid_amount_paise ?? 0);
  if (!(amount > 0)) return c.json({ error: 'TDS amount must be above zero' }, 400);
  if (amount > due) return c.json({ error: 'TDS is more than the balance still due on this purchase' }, 400);
  const date = parsed.data.date ?? new Date().toISOString().slice(0, 10);
  try {
    const result = await stub.recordPurchasePayment(c.req.param('id'), { amountPaise: amount, paymentMode: 'BANK', paymentAccountId: 'acc_sys_2240', date, notes: `TDS deducted from vendor (${parsed.data.section}, ${rate}%)` });
    await stub.recordTdsEntry({ voucherType: 'PURCHASE_BILL', voucherId: bill.id, partyId: bill.party_id, section: parsed.data.section, taxableAmountPaise: taxable, date }).catch(() => undefined);
    return c.json({ ok: true, tdsPaise: amount, ratePercent: rate, ...result });
  } catch (err: any) {
    return c.json({ error: err.message || 'Could not record TDS' }, 400);
  }
});

purchaseRoutes.get('/debit-notes', async (c) => c.json({ ok: true, notes: await (c.get('businessStub') as any).listDebitNotes() }));

purchaseRoutes.post('/debit-notes', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parse = createDebitNoteSchema.safeParse(body);
  if (!parse.success) {
    return c.json({ error: 'Invalid debit note input', details: parse.error.format() }, 400);
  }

  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );

  const debitNote = await (stub as any).createDebitNote(parse.data);
  return c.json({ debitNote }, 201);
});

// POST /api/purchases/upload-receipt (R2 file upload)
purchaseRoutes.post('/upload-receipt', async (c) => {
  const body = await c.req.parseBody();
  const file = body['file'];

  if (!file || typeof file === 'string') {
    return c.json({ error: 'No file uploaded' }, 400);
  }

  const fileKey = `receipts/${c.get('businessId') || 'biz_default'}/${newId()}-${(file as File).name}`;
  const fileBuffer = await (file as File).arrayBuffer();

  // Never report a file as saved when there is no storage to save it in
  if (!c.env?.FILES) return c.json({ error: 'File storage is not set up yet. Please try again later.', code: 'STORAGE_UNAVAILABLE' }, 503);
  await c.env.FILES.put(fileKey, fileBuffer, {
    httpMetadata: { contentType: (file as File).type },
  });

  return c.json({
    fileKey,
    fileName: (file as File).name,
    size: (file as File).size,
  });
});
