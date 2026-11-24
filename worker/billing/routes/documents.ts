import { Hono } from 'hono';
import { z } from 'zod';
import { isTradeDocType, TRADE_DOC_TYPES } from '@billing/shared';
import type { Env } from '../types';
import { locate } from './location';
import type { BusinessVariables } from '../middleware/tenant';
import { renderDocumentFile } from '../invoice-docs';

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


/**
 * /api/documents — quotations, proforma invoices, sales orders, delivery challans, packing lists, purchase orders.
 * Business guard (JWT → membership → billing module) is applied where this router is mounted.
 */
export const documentRoutes = new Hono<{ Bindings: Env; Variables: BusinessVariables }>();

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const lineSchema = z.object({
  itemId: z.string().max(64).nullish(),
  name: z.string().min(1).max(200),
  hsnSac: z.string().max(8).optional(),
  unitId: z.string().max(64).nullish(),
  quantityThousandths: z.number().int().positive(),
  unitPricePaise: z.number().int().min(0),
  discountPaise: z.number().int().min(0).optional(),
  taxRateBasisPoints: z.number().int().min(0).max(4000),
  isTaxInclusive: z.boolean().optional(),
});
const createSchema = z.object({
  docType: z.enum(TRADE_DOC_TYPES),
  /** optional: defaults to the business's default branch */
  branchId: z.string().min(1).max(64).optional(),
  partyId: z.string().min(1).max(64),
  date,
  validUntil: date.optional(),
  lines: z.array(lineSchema).min(1).max(500),
  extraDiscountPaise: z.number().int().min(0).optional(),
  shippingAddress: z.string().max(500).optional(),
  transport: z
    .object({ mode: z.string().max(40).optional(), vehicleNo: z.string().max(20).optional(), lrNo: z.string().max(40).optional(), transporter: z.string().max(100).optional() })
    .optional(),
  notes: z.string().max(2000).optional(),
  terms: z.string().max(4000).optional(),
  status: z.enum(['DRAFT', 'OPEN']).optional(),
});

const userIdOf = (c: any): string => String(c.get('userId') ?? 'system');
const stubOf = (c: any) => c.get('businessStub') as any;
const fail = (c: any, e: unknown, status: 400 | 404 = 400) => {
  const msg = e instanceof Error ? e.message : 'Something went wrong';
  return c.json({ error: msg === 'NOT_FOUND' ? 'Document not found' : msg }, msg === 'NOT_FOUND' ? 404 : status);
};

documentRoutes.get('/', async (c) => {
  const docType = c.req.query('type') ?? '';
  if (!isTradeDocType(docType)) return c.json({ error: 'Unknown document type' }, 400);
  const result = await stubOf(c).listTradeDocuments({
    docType,
    status: c.req.query('status') || undefined,
    partyId: c.req.query('partyId') || undefined,
    startDate: c.req.query('startDate') || undefined,
    endDate: c.req.query('endDate') || undefined,
    search: c.req.query('search') || undefined,
    limit: Number(c.req.query('limit') || 50),
    offset: Number(c.req.query('offset') || 0),
  });
  return c.json(result);
});

documentRoutes.post('/', async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  try {
    const { branchId } = await locate(c, { branchId: parsed.data.branchId });
    const document = await stubOf(c).createTradeDocument({ ...parsed.data, branchId, createdById: userIdOf(c) });
    return c.json({ document }, 201);
  } catch (e) {
    return fail(c, e);
  }
});

documentRoutes.get('/:id', async (c) => {
  try {
    return c.json({ document: await stubOf(c).getTradeDocument(c.req.param('id')) });
  } catch (e) {
    return fail(c, e, 404);
  }
});

const DOC_KIND: Record<string, string> = { QUOTATION: 'Quotation', PROFORMA: 'Proforma invoice', SALES_ORDER: 'Sales order', DELIVERY_CHALLAN: 'Delivery challan', PACKING_LIST: 'Packing list', PURCHASE_ORDER: 'Purchase order' };
documentRoutes.get('/:id/:fmt{pdf|docx}', async (c) => {
  let d: any;
  try {
    d = await stubOf(c).getTradeDocument(c.req.param('id'));
  } catch (e) {
    return fail(c, e, 404);
  }
  const fmt = c.req.param('fmt') as 'pdf' | 'docx';
  const body = await renderDocumentFile(stubOf(c), d, DOC_KIND[d.doc_type] ?? 'Document', fmt, c.req.query('template'));
  return asFile(body, fmt, d.doc_no, c.req.query('inline') === '1');
});

documentRoutes.put('/:id/status', async (c) => {
  const parsed = z.object({ status: z.enum(['OPEN', 'ACCEPTED', 'DECLINED', 'CANCELLED']) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  try {
    return c.json({ document: await stubOf(c).setTradeDocumentStatus(c.req.param('id'), parsed.data.status, userIdOf(c)) });
  } catch (e) {
    return fail(c, e);
  }
});

const convertSchema = z.object({
  target: z.enum([...TRADE_DOC_TYPES, 'INVOICE', 'PURCHASE_BILL']),
  quantities: z.record(z.string().max(64), z.number().int().positive()).optional(),
  date: date.optional(),
  dueDate: date.optional(),
  warehouseId: z.string().max(64).optional(),
});

documentRoutes.post('/:id/convert', async (c) => {
  const parsed = convertSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  try {
    const result = await stubOf(c).convertTradeDocument({ documentId: c.req.param('id'), ...parsed.data, createdById: userIdOf(c) });
    return c.json({ result }, 201);
  } catch (e) {
    return fail(c, e);
  }
});
