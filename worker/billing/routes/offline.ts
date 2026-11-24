import { Hono } from 'hono';
import { locate } from './location';
import { z } from 'zod';
import type { Env } from '../types';
import { requirePublicBusinessId } from '../middleware/tenant';
import type { BusinessVariables } from '../middleware/tenant';

export const offlineRouter = new Hono<{ Bindings: Env; Variables: BusinessVariables }>();

// Helper to get BusinessDO stub
function getStub(c: any) {
  return (
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(requirePublicBusinessId(c)),
    )
  );
}

// Schemas
const registerDeviceSchema = z.object({
  branchId: z.string().min(1, 'Branch ID is required'),
  deviceCode: z.string().min(1, 'Device Code is required'),
  deviceName: z.string().min(1, 'Device Name is required'),
});

const syncBatchSchema = z.object({
  deviceId: z.string().min(1, 'Device ID is required'),
  mutations: z.array(
    z.object({
      mutationId: z.string().min(1, 'Mutation UUID is required'),
      entityType: z.enum(['INVOICE', 'KOT', 'PAYMENT']),
      payload: z.any(),
    }),
  ).min(1, 'At least one mutation is required in batch'),
});

// ==========================================
// 1. DEVICE REGISTRATION & MASTERS CACHE
// ==========================================

offlineRouter.post('/devices', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json().catch(() => ({}));
  const parsed = registerDeviceSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message }, 400);
  }
  const result = await stub.registerPosDevice(parsed.data);
  return c.json({ success: true, data: result }, 201);
});

offlineRouter.get('/devices', async (c) => {
  const stub = getStub(c);
  const branchId = c.req.query('branchId');
  const devices = await stub.listPosDevices(branchId);
  return c.json({ success: true, data: devices });
});

offlineRouter.get('/cache', async (c) => {
  const stub = getStub(c);
  const branchId = (await locate(c, { branchId: c.req.query('branchId') || null })).branchId;
  const deviceCode = c.req.query('deviceCode');
  const cache = await stub.getOfflineMastersCache(branchId, deviceCode);
  return c.json({ success: true, data: cache });
});

// ==========================================
// 2. BATCH SYNC & CONFLICTS
// ==========================================

offlineRouter.post('/sync', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json().catch(() => ({}));
  const parsed = syncBatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.issues[0]?.message }, 400);
  }
  const result = await stub.syncOfflineMutations(parsed.data);
  return c.json({ success: true, data: result });
});

offlineRouter.get('/conflicts', async (c) => {
  const stub = getStub(c);
  const branchId = c.req.query('branchId');
  const conflicts = await stub.listOfflineConflicts(branchId);
  return c.json({ success: true, data: conflicts });
});

