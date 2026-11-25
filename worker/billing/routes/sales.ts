import { Hono } from 'hono';
import { approvalGate, discountBp, type GateLine } from '../services/approval-gate';
import { locate } from './location';
import { z } from 'zod';
import type { Env } from '../types';
import type { BusinessVariables } from '../middleware/tenant';
import { renderDocumentFile } from '../invoice-docs';
import { emailInvoiceEvent, pushInvoiceToCrm } from '../notify';
import { renderThermalReceipt } from '../print-docs';
import { normalizeBillingSettings } from '@billing/shared';

const TDS_RATES: Record<string, number> = { '194C': 2, '194J': 10, '194I': 10, '194H': 5, '194Q': 0.1, '194A': 10, '194O': 1 };
const tdsSchema = z.object({
  section: z.string().min(2).max(10),
  ratePercent: z.number().min(0).max(100).optional(),
  amountPaise: z.number().int().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});


const FILE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const asFile = (body: Uint8Array, fmt: string, name: string, inline = false) =>
  new Response(body as unknown as BodyInit, {
    headers: {
      'content-type': FILE_TYPES[fmt] ?? 'application/octet-stream',
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\w.-]+/g, '_')}.${fmt}"`,
      'cache-control': 'no-store',
    },
  });


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

// 1b. Bill numbers freed by deleted invoices (offered again on the invoice form)
salesRoutes.get('/invoices/free-numbers', async (c) => c.json({ ok: true, numbers: await c.get('businessStub').freeInvoiceNumbers() }));

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
  /** A specific bill number (a freed one) instead of the next in the series */
  invoiceNo: z.string().trim().min(1).max(40).optional(),
  /** When the money received with the invoice came in, and its UTR / cheque number (both optional) */
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  paymentReference: z.string().trim().max(60).optional(),
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
    const env = c.env as any;
    const origin = env.APP_URL || new URL(c.req.url).origin;
    const invId = result?.invoice?.id;
    if (invId) {
      const exec = (c as any).executionCtx;
      if (String(env.BILLING_EMAIL_AUTO || 'on').toLowerCase() !== 'off') exec.waitUntil(emailInvoiceEvent(env, stub, invId, 'invoice', origin));
      if (String(env.AGENCY_CRM_PUSH || 'on').toLowerCase() !== 'off' && env.AGENCY_CRM_HOOK_URL) exec.waitUntil(pushInvoiceToCrm(env, stub, invId, origin, 'invoice.created'));
    }
    return c.json({ ok: true, ...result }, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to create sales invoice' }, 400);
  }
});

// 3d. TDS DEDUCTED BY THE CUSTOMER: the customer pays the invoice net of TDS. The TDS part settles the invoice against
// "TDS Receivable" (an asset you claim back from the tax department), so the books and the invoice balance both stay right.
salesRoutes.post('/invoices/:id/tds', async (c) => {
  const stub = c.get('businessStub');
  const parsed = tdsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Choose the TDS section and the rate or amount', details: parsed.error.flatten() }, 400);
  const inv = await stub.getSalesInvoice(c.req.param('id'));
  const ownOnly = c.get('ownOnlyUserId' as never) as string | undefined;
  if (!inv || (ownOnly && inv.created_by_id !== ownOnly)) return c.json({ error: 'Invoice not found' }, 404);
  if (inv.status === 'CANCELLED') return c.json({ error: 'This invoice is cancelled' }, 400);
  const taxable = (inv.subtotal_paise ?? 0) - (inv.discount_paise ?? 0);
  const rate = parsed.data.ratePercent ?? TDS_RATES[parsed.data.section] ?? 0;
  const amount = parsed.data.amountPaise ?? Math.round((taxable * rate) / 100);
  if (!(amount > 0)) return c.json({ error: 'TDS amount must be above zero' }, 400);
  if (amount > inv.balance_amount_paise) return c.json({ error: 'TDS is more than the balance still due on this invoice' }, 400);
  try {
    const result = await stub.recordSalesPayment({
      invoiceId: inv.id, amountPaise: amount, paymentMode: 'BANK', paymentAccountId: 'acc_sys_1350', branchId: inv.branch_id,
      date: parsed.data.date ?? new Date().toISOString().slice(0, 10), notes: `TDS deducted by customer (${parsed.data.section}, ${rate}%)`, createdById: String(c.get('userId') ?? 'system'),
    });
    return c.json({ ok: true, tdsPaise: amount, ratePercent: rate, ...result });
  } catch (err: any) {
    return c.json({ error: err.message || 'Could not record TDS' }, 400);
  }
});

// 3e. THERMAL RECEIPT (58 or 80 mm, set in Billing settings)
salesRoutes.get('/invoices/:id/thermal', async (c) => {
  const stub = c.get('businessStub');
  const inv = await stub.getSalesInvoice(c.req.param('id'));
  const ownOnly = c.get('ownOnlyUserId' as never) as string | undefined;
  if (!inv || (ownOnly && inv.created_by_id !== ownOnly)) return c.json({ error: 'Invoice not found' }, 404);
  const s = normalizeBillingSettings((await stub.getAllSettings())?.billing_settings);
  const pdf = await renderThermalReceipt(inv, s, s.company.legalName || inv.branch?.name || 'Gexart');
  return asFile(pdf, 'pdf', `${inv.invoice_no}-receipt`, c.req.query('inline') === '1');
});

// 3c. EMAIL THE CLIENT / SEND TO THE AGENCY CRM (buttons on the invoice screen)
salesRoutes.post('/invoices/:id/email', async (c) => {
  const stub = c.get('businessStub');
  const body: any = await c.req.json().catch(() => ({}));
  const env = c.env as any;
  const r = await emailInvoiceEvent(env, stub, c.req.param('id'), body.kind === 'reminder' ? 'reminder' : 'invoice', env.APP_URL || new URL(c.req.url).origin, { to: body.to });
  return c.json({ ok: r.sent, ...r }, r.sent ? 200 : 502);
});

salesRoutes.post('/invoices/:id/crm', async (c) => {
  const stub = c.get('businessStub');
  const env = c.env as any;
  const r = await pushInvoiceToCrm(env, stub, c.req.param('id'), env.APP_URL || new URL(c.req.url).origin, 'manual');
  // The reason goes in `error` so the screen shows it instead of a bare "502".
  return r.ok ? c.json(r) : c.json({ ...r, error: r.message }, 502);
});

// 3a. CREDIT NOTES (list)
salesRoutes.get('/credit-notes', async (c) => c.json({ ok: true, notes: await c.get('businessStub').listCreditNotes() }));

// 3b. INVOICE AS PDF OR WORD (Gexart letterhead)
salesRoutes.get('/invoices/:id/:fmt{pdf|docx}', async (c) => {
  const stub = c.get('businessStub');
  const inv = await stub.getSalesInvoice(c.req.param('id'));
  const ownOnly = c.get('ownOnlyUserId' as never) as string | undefined;
  if (!inv || (ownOnly && (inv as { created_by_id?: string }).created_by_id !== ownOnly)) return c.json({ error: 'Invoice not found' }, 404);
  const fmt = c.req.param('fmt') as 'pdf' | 'docx';
  const body = await renderDocumentFile(stub, inv, inv.invoice_type === 'BILL_OF_SUPPLY' ? 'Bill of supply' : 'Tax invoice', fmt, c.req.query('template'));
  return asFile(body, fmt, inv.invoice_no, c.req.query('inline') === '1');
});

// 4. RECORD PAYMENT AGAINST INVOICE
const recordPaymentSchema = z.object({
  amountPaise: z.number().int().min(1),
  paymentMode: z.enum(['CASH', 'BANK', 'UPI', 'CARD', 'NET_BANKING', 'CHEQUE']).default('CASH'),
  paymentAccountId: z.string().optional(),
  branchId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** UTR / transaction or cheque number (optional) */
  referenceNo: z.string().trim().max(60).optional(),
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
    const env = c.env as any;
    const origin = env.APP_URL || new URL(c.req.url).origin;
    const exec = (c as any).executionCtx;
    if (String(env.BILLING_EMAIL_AUTO || 'on').toLowerCase() !== 'off') exec.waitUntil(emailInvoiceEvent(env, stub, invoiceId, 'payment', origin, { paidPaise: parsed.data.amountPaise }));
    if (String(env.AGENCY_CRM_PUSH || 'on').toLowerCase() !== 'off' && env.AGENCY_CRM_HOOK_URL) exec.waitUntil(pushInvoiceToCrm(env, stub, invoiceId, origin, 'payment.received', undefined, { amountPaise: parsed.data.amountPaise, mode: parsed.data.paymentMode, date: parsed.data.date, ref: parsed.data.referenceNo }));
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

// 5b. EDIT INVOICE (keeps the bill number; a cancelled invoice that is edited comes back, so its number can go to another client)
salesRoutes.put('/invoices/:id', async (c) => {
  const stub = c.get('businessStub');
  const parsed = createInvoiceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);
  const ownOnly = c.get('ownOnlyUserId' as never) as string | undefined;
  const existing = await stub.getSalesInvoice(c.req.param('id'));
  if (!existing || (ownOnly && existing.created_by_id !== ownOnly)) return c.json({ error: 'Invoice not found' }, 404);
  try {
    const loc = await locate(c, { branchId: parsed.data.branchId ?? existing.branch_id, warehouseId: parsed.data.warehouseId });
    const { invoiceNo: _ignored, ...data } = parsed.data;
    const result = await stub.editSalesInvoice(c.req.param('id'), { ...data, branchId: loc.branchId, warehouseId: loc.warehouseId ?? undefined, createdById: String(c.get('userId') ?? 'system') });
    return c.json({ ok: true, ...result });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to edit invoice' }, 400);
  }
});

// 5c. DELETE INVOICE (frees the bill number; payments must be removed first)
salesRoutes.delete('/invoices/:id', async (c) => {
  const stub = c.get('businessStub');
  const body = await c.req.json().catch(() => ({}));
  const reason = String(body?.reason || 'Deleted by user').slice(0, 300);
  try {
    return c.json({ ok: true, ...(await stub.deleteSalesInvoice(c.req.param('id'), reason)) });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to delete invoice' }, 400);
  }
});

// 5d. REMOVE A RECORDED PAYMENT
salesRoutes.delete('/payments/:id', async (c) => {
  const stub = c.get('businessStub');
  const body = await c.req.json().catch(() => ({}));
  const reason = String(body?.reason || 'Removed by user').slice(0, 300);
  try {
    return c.json({ ok: true, ...(await stub.removeSalesPayment(c.req.param('id'), reason)) });
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to remove payment' }, 400);
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

