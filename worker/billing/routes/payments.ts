import { Hono } from 'hono';
import type { Env } from '../types';
import type { BusinessVariables } from '../middleware/tenant';
import { getStateByCode, normalizeBillingSettings } from '@billing/shared';
import { renderPaymentReceipt } from '../payment-receipt';

/** /api/payments — Payments Received (type=IN) and Payments Made (type=OUT), with filters and totals. */
export const paymentRoutes = new Hono<{ Bindings: Env; Variables: BusinessVariables }>();

const isDate = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

paymentRoutes.get('/', async (c) => {
  const type = c.req.query('type');
  if (type !== 'IN' && type !== 'OUT') return c.json({ error: 'type must be IN or OUT' }, 400);
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const result = await (c.get('businessStub') as any).listPayments({
    type,
    startDate: isDate(startDate) ? startDate : undefined,
    endDate: isDate(endDate) ? endDate : undefined,
    mode: c.req.query('mode') || undefined,
    search: (c.req.query('search') || '').slice(0, 100) || undefined,
    limit: Math.min(Math.max(Number(c.req.query('limit') || 50) || 50, 1), 500),
    offset: Math.max(Number(c.req.query('offset') || 0) || 0, 0),
  });
  return c.json(result);
});

/** Receipt for one payment received, as a PDF (?inline=1 opens it in the browser instead of downloading). */
paymentRoutes.get('/:id/receipt', async (c) => {
  const stub = c.get('businessStub') as any;
  const data = await stub.paymentReceiptData(c.req.param('id'));
  if (!data) return c.json({ error: 'Payment not found' }, 404);
  const s = normalizeBillingSettings((await stub.getAllSettings())?.billing_settings);
  const { payment: p, party, invoice, branch } = data;
  const lines = (a: string | null | undefined) => String(a ?? '').split(/[\r\n]+|,\s*/).map((x) => x.trim()).filter(Boolean);
  const addr = lines(branch?.address);
  const pickedSig = s.branding.signatures[0];
  const pdf = await renderPaymentReceipt({
    receiptNo: String(p.payment_no),
    date: String(p.date),
    mode: String(p.mode),
    referenceNo: p.reference_no,
    notes: p.notes,
    amountPaise: Number(p.amount_paise),
    party: { name: String(party.name), gstin: party.gstin, phone: party.phone, address: party.billing_address },
    invoice: invoice ? { no: String(invoice.invoice_no), date: String(invoice.date), totalPaise: Number(invoice.total_paise), paidPaise: Number(invoice.paid_amount_paise), balancePaise: Number(invoice.balance_amount_paise) } : null,
    company: { name: s.company.legalName || branch?.name || 'Gexart', gstin: branch?.gstin ?? null, addressLines: [addr.slice(0, 3).join(', '), addr.slice(3).join(', ')].filter(Boolean), phone: s.company.mobile || branch?.phone || null, email: s.company.email || null },
    signature: { dataUrl: pickedSig?.signature || s.branding.signature || null, stampDataUrl: pickedSig?.stamp || null, name: pickedSig?.name || s.branding.signatoryName || null },
    footer: s.preferences.footerText || 'This is a computer generated receipt.',
  });
  void getStateByCode;
  const name = String(p.payment_no).replace(/[^\w.-]+/g, '_');
  return new Response(pdf, { headers: { 'content-type': 'application/pdf', 'content-disposition': `${c.req.query('inline') === '1' ? 'inline' : 'attachment'}; filename="${name}.pdf"`, 'cache-control': 'private, no-store' } });
});
