import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import type { BusinessVariables } from '../middleware/tenant';

export const einvoiceRouter = new Hono<{ Bindings: Env; Variables: BusinessVariables }>();

// 1. Generate IRN
einvoiceRouter.post('/irn/:invoiceId', async (c) => {
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );
  const invoiceId = c.req.param('invoiceId');
  try {
    const result = await stub.generateEInvoice(invoiceId);
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message, suggestion: err.suggestion }, 400);
  }
});

// 2. Cancel IRN within 24h
const cancelIrnSchema = z.object({
  cancelReason: z.enum(['1', '2', '3', '4']),
  cancelRemarks: z.string().optional(),
});

einvoiceRouter.post('/cancel-irn/:invoiceId', async (c) => {
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );
  const invoiceId = c.req.param('invoiceId');
  const body = await c.req.json().catch(() => ({}));
  const parsed = cancelIrnSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid input' }, 400);
  }

  try {
    const result = await stub.cancelEInvoice(invoiceId, parsed.data.cancelReason, parsed.data.cancelRemarks);
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message, suggestion: err.suggestion }, 400);
  }
});

// 3. Bulk generate IRN
const bulkGenerateSchema = z.object({
  invoiceIds: z.array(z.string()).min(1),
});

einvoiceRouter.post('/bulk-generate', async (c) => {
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );
  const body = await c.req.json().catch(() => ({}));
  const parsed = bulkGenerateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'invoiceIds array is required' }, 400);
  }

  const results = await stub.bulkGenerateEInvoices(parsed.data.invoiceIds);
  return c.json({ success: true, data: results });
});

// 4. Generate E-Way Bill
const generateEwbSchema = z.object({
  transMode: z.enum(['1', '2', '3', '4']),
  transDistanceKm: z.number().positive(),
  transporterId: z.string().optional(),
  transporterName: z.string().optional(),
  transDocNo: z.string().optional(),
  vehicleNo: z.string().optional(),
  vehicleType: z.enum(['REGULAR', 'OVER_DIMENSIONAL']).optional(),
});

einvoiceRouter.post('/ewb/:invoiceId', async (c) => {
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );
  const invoiceId = c.req.param('invoiceId');
  const body = await c.req.json().catch(() => ({}));
  const parsed = generateEwbSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid transport details' }, 400);
  }

  try {
    const result = await stub.generateEWayBill(invoiceId, parsed.data);
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message, suggestion: err.suggestion }, 400);
  }
});

// 5. Update vehicle on E-Way Bill
const updateVehicleSchema = z.object({
  vehicleNo: z.string().min(1),
  fromPlace: z.string().min(1),
  fromStateCode: z.number(),
  reasonCode: z.enum(['1', '2', '3', '4']),
});

einvoiceRouter.post('/ewb/update-vehicle/:ewbId', async (c) => {
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );
  const ewbId = c.req.param('ewbId');
  const body = await c.req.json().catch(() => ({}));
  const parsed = updateVehicleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid vehicle update input' }, 400);
  }

  try {
    const result = await stub.updateEwbVehicle(
      ewbId,
      parsed.data.vehicleNo,
      parsed.data.fromPlace,
      parsed.data.fromStateCode,
      parsed.data.reasonCode,
    );
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message, suggestion: err.suggestion }, 400);
  }
});

// 6. Cancel E-Way Bill
const cancelEwbSchema = z.object({
  cancelReason: z.enum(['1', '2', '3', '4']),
  cancelRemarks: z.string().optional(),
});

einvoiceRouter.post('/ewb/cancel/:ewbId', async (c) => {
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );
  const ewbId = c.req.param('ewbId');
  const body = await c.req.json().catch(() => ({}));
  const parsed = cancelEwbSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid cancel reason' }, 400);
  }

  try {
    const result = await stub.cancelEWayBill(ewbId, parsed.data.cancelReason, parsed.data.cancelRemarks);
    return c.json({ success: true, data: result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message, suggestion: err.suggestion }, 400);
  }
});

// 7. Get GST status
einvoiceRouter.get('/status/:invoiceId', async (c) => {
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );
  const invoiceId = c.req.param('invoiceId');
  const result = await stub.getInvoiceGstStatus(invoiceId);
  return c.json({ success: true, data: result });
});
