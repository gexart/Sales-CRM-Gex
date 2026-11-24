import { Hono } from 'hono';
import { approvalGate, discountBp, type GateLine } from '../services/approval-gate';
import { locate } from './location';
import { z } from 'zod';
import type { Env } from '../types';
import type { BusinessVariables } from '../middleware/tenant';

export const salesRoutes = new Hono<{ Bindings: Env; Variables: BusinessVariables }>();

// 1. LIST INVOICES
salesRoutes.get('/invoices', async (c) => {
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );

  const status = c.req.query('status');
  const partyId = c.req.query('partyId');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const search = c.req.query('search') || c.req.query('q');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const result = await stub.listSalesInvoices({
    status,
    partyId,
    startDate,
    endDate,
    search,
    limit,
    offset,
    createdById: (c.get('ownOnlyUserId' as never) as string | undefined) || undefined,
  });

  return c.json({ ok: true, ...result });
});

// 2. GET INVOICE DETAIL
salesRoutes.get('/invoices/:id', async (c) => {
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );
  const id = c.req.param('id');
  const invoice = await stub.getSalesInvoice(id);

  const ownOnly = c.get('ownOnlyUserId' as never) as string | undefined;
  if (!invoice || (ownOnly && (invoice as { createdById?: string }).createdById !== ownOnly)) {
    return c.json({ error: 'Invoice not found' }, 404);
  }

  // Seller = this company (D1) + the invoice's branch (address, GSTIN). Printed on the invoice.
  const businessId = c.get('businessId') as string | undefined;
  // The CRM has no `businesses` table (that was GexPro's control plane); the company profile arrives with the letterhead work.
  const biz = null as Record<string, string | null> | null;
  void businessId;
  const br = (invoice as { branch?: Record<string, string | null> | null }).branch ?? null;
  const seller = biz
    ? {
        name: biz.legal_name ?? biz.trade_name ?? '',
        tradeName: biz.trade_name && biz.trade_name !== biz.legal_name ? biz.trade_name : undefined,
        gstin: br?.gstin || biz.gstin || undefined,
        stateCode: br?.state_code || biz.state_code || '',
        address: br?.address || [biz.address, biz.pincode].filter(Boolean).join(' - '),
        phone: [br?.phone || biz.phone, biz.alt_phone].filter(Boolean).join(', '),
        email: biz.email || undefined,
        website: biz.website || undefined,
      }
    : null;

  return c.json({ ok: true, invoice: { ...invoice, seller } });
});

// 3. CREATE INVOICE
export const createInvoiceSchema = z.object({
  invoiceType: z.enum(['REGULAR', 'BILL_OF_SUPPLY', 'EXPORT', 'SEZ']).default('REGULAR'),
  /** optional: defaults to the business's default branch */
  branchId: z.string().min(1).optional(),
  warehouseId: z.string().min(1).optional(),
  partyId: z.string().optional(),
  partyName: z.string().min(1, 'Customer name is required'),
  partyGstin: z.string().optional(),
  partyStateCode: z.string().default('19'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMode: z.enum(['CASH', 'BANK', 'UPI', 'CREDIT', 'CARD']).default('CASH'),
  paymentAccountId: z.string().optional(),
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        variantId: z.string().optional(),
        name: z.string().min(1),
        hsnSac: z.string().default(''),
        quantityThousandths: z.number().int().min(1),
        unitId: z.string().min(1),
        unitPricePaise: z.number().int().min(0),
        discountPaise: z.number().int().min(0).default(0),
        taxRatePercent: z.number().min(0).default(0),
        isTaxInclusive: z.boolean().default(false),
        cessPercent: z.number().min(0).default(0),
      }),
    )
    .min(1, 'At least one line item is required'),
  extraDiscountPaise: z.number().int().min(0).default(0),
  enableRoundOff: z.boolean().default(true),
  paidAmountPaise: z.number().int().min(0).default(0),
  notes: z.string().max(2000).optional(),
  terms: z.string().max(4000).optional(),
  /** Dispatch / shipping address printed as "Ship to" */
  shippingAddress: z.string().max(500).optional(),
  transport: z
    .object({ transporter: z.string().max(100).optional(), vehicleNo: z.string().max(20).optional(), lrNo: z.string().max(40).optional() })
    .optional(),
  /** Bank account printed for payment (from Bank & Cash) */
  bankAccountId: z.string().max(64).optional(),
  /** Name printed under "Authorised signatory" */
  signatoryName: z.string().max(80).optional(),
});

salesRoutes.post('/invoices', async (c) => {
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );

  const body = await c.req.json();
  const parsed = createInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);
  }

  const userId = String(c.get('userId') ?? 'system');

  // Discounts above the Master Admin's limit wait for approval
  const held = await approvalGate(c, 'INVOICE', parsed.data.partyId, discountBp(parsed.data.items as GateLine[], parsed.data.extraDiscountPaise));
  if (held) return held;

  try {
    const loc = await locate(c, { branchId: parsed.data.branchId, warehouseId: parsed.data.warehouseId });
    const result = await stub.createSalesInvoice({
      ...parsed.data,
      branchId: loc.branchId,
      warehouseId: loc.warehouseId ?? undefined,
      createdById: userId,
    });
    return c.json({ ok: true, ...result }, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to create sales invoice' }, 400);
  }
});

// 4. RECORD PAYMENT AGAINST INVOICE
const recordPaymentSchema = z.object({
  amountPaise: z.number().int().min(1),
  paymentMode: z.enum(['CASH', 'BANK', 'UPI', 'CARD', 'NET_BANKING', 'CHEQUE']).default('CASH'),
  paymentAccountId: z.string().optional(),
  branchId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
});

salesRoutes.post('/invoices/:id/payments', async (c) => {
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );
  const invoiceId = c.req.param('id');
  const body = await c.req.json();
  const parsed = recordPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);
  }

  const userId = String(c.get('userId') ?? 'system');

  try {
    const result = await stub.recordSalesPayment({
      invoiceId,
      ...parsed.data,
      createdById: userId,
    });
    return c.json({ ok: true, ...result });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to record payment' }, 400);
  }
});

// 5. CREATE CREDIT NOTE
const createCreditNoteSchema = z.object({
  branchId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().min(1, 'Reason for credit note is required'),
  totalAmountPaise: z.number().int().min(1).optional(),
});

salesRoutes.post('/invoices/:id/credit-note', async (c) => {
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );
  const invoiceId = c.req.param('id');
  const body = await c.req.json();
  const parsed = createCreditNoteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);
  }

  const userId = String(c.get('userId') ?? 'system');

  try {
    const result = await stub.createSalesCreditNote({
      invoiceId,
      ...parsed.data,
      createdById: userId,
    });
    return c.json({ ok: true, ...result }, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to create credit note' }, 400);
  }
});

// 6. CANCEL INVOICE
salesRoutes.post('/invoices/:id/cancel', async (c) => {
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );
  const invoiceId = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const reason = body.reason || 'Cancelled by user';

  try {
    const success = await stub.cancelSalesInvoice(invoiceId, reason);
    return c.json({ ok: true, success });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to cancel invoice' }, 400);
  }
});

// 7. PUBLIC SHARE LINK RESOLVER: connect.gexgrow.com/i/:token
salesRoutes.get('/public/:token', async (c) => {
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );
  const token = c.req.param('token');
  const result = await stub.getPublicInvoice(token);

  if (!result) {
    return c.json({ error: 'Invoice not found or link expired' }, 404);
  }

  return c.json({ ok: true, ...result });
});

