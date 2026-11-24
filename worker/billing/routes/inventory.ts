import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import { locate } from './location';
import type { BusinessVariables } from '../middleware/tenant';

export const inventoryRoutes = new Hono<{ Bindings: Env; Variables: BusinessVariables }>();

// Zod schemas
const transferStockSchema = z.object({
  branchId: z.string().optional(),
  sourceWarehouseId: z.string().min(1, 'Source warehouse is required'),
  destinationWarehouseId: z.string().min(1, 'Destination warehouse is required'),
  date: z.string().optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1, 'Item is required'),
        variantId: z.string().optional(),
        batchId: z.string().optional(),
        quantityThousandths: z.number().positive('Quantity must be greater than 0'),
      }),
    )
    .min(1, 'At least one line is required'),
  notes: z.string().optional(),
});

const adjustStockSchema = z.object({
  branchId: z.string().optional(),
  warehouseId: z.string().min(1, 'Warehouse is required'),
  reason: z.enum(['PHYSICAL_COUNT', 'DAMAGE', 'THEFT', 'EXPIRY', 'CORRECTION']),
  date: z.string().optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1, 'Item is required'),
        variantId: z.string().optional(),
        batchId: z.string().optional(),
        adjustmentType: z.enum(['INCREASE', 'DECREASE']),
        quantityThousandths: z.number().positive('Quantity must be greater than 0'),
        ratePaise: z.number().nonnegative().optional(),
      }),
    )
    .min(1, 'At least one line is required'),
  notes: z.string().optional(),
});

const createBatchSchema = z.object({
  itemId: z.string().min(1, 'Item is required'),
  batchNo: z.string().min(1, 'Batch number is required'),
  mfgDate: z.string().optional(),
  expiryDate: z.string().optional(),
  mrpPaise: z.number().nonnegative().optional(),
  salePricePaise: z.number().nonnegative().optional(),
  purchasePricePaise: z.number().nonnegative().optional(),
  quantityThousandths: z.number().nonnegative().optional(),
});

const createRecipeSchema = z.object({
  menuItemId: z.string().min(1, 'Menu item ID is required'),
  name: z.string().min(1, 'Recipe name is required'),
  instructions: z.string().optional(),
  isBatch: z.boolean().optional().default(false),
  yieldQuantityThousandths: z.number().positive().optional().default(1000),
  items: z
    .array(
      z.object({
        rawItemId: z.string().min(1, 'Raw item ID is required'),
        quantityThousandths: z.number().positive('Quantity must be greater than 0'),
        unitId: z.string().optional(),
      }),
    )
    .min(1, 'At least one ingredient is required'),
});

const consumeRecipeSchema = z.object({
  menuItemId: z.string().min(1, 'Menu item ID is required'),
  quantityThousandths: z.number().positive().default(1000),
  warehouseId: z.string().min(1, 'Warehouse is required'),
  branchId: z.string().optional(),
  docNo: z.string().optional().default('POS-KOT'),
  docId: z.string().optional().default('DIRECT'),
});

function getStub(c: any) {
  return (
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    )
  );
}

// 1. GET /api/inventory/summary
inventoryRoutes.get('/summary', async (c) => {
  const stub = getStub(c);
  const warehouseId = c.req.query('warehouseId');
  const search = c.req.query('search') || c.req.query('q');

  const summary = await (stub as any).getStockSummary(warehouseId, search);
  return c.json({ summary });
});

// 2. GET /api/inventory/low-stock
inventoryRoutes.get('/low-stock', async (c) => {
  const stub = getStub(c);
  const warehouseId = c.req.query('warehouseId');

  const items = await (stub as any).getLowStockItems(warehouseId);
  return c.json({ items });
});

// 3. GET /api/inventory/ledger/:itemId
inventoryRoutes.get('/ledger/:itemId', async (c) => {
  const stub = getStub(c);
  const itemId = c.req.param('itemId');
  const warehouseId = c.req.query('warehouseId');

  const ledger = await (stub as any).getStockLedger(itemId, warehouseId);
  return c.json({ ledger });
});

// 4. POST /api/inventory/transfers
inventoryRoutes.post('/transfers', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const parsed = transferStockSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { branchId } = await locate(c, { branchId: parsed.data.branchId });

  try {
    const result = await (stub as any).transferStock({
      ...parsed.data,
      branchId,
      createdById: c.get('userId') || 'SYSTEM',
    });
    return c.json({ success: true, ...result }, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Stock transfer failed' }, 400);
  }
});

// 5. POST /api/inventory/adjustments
inventoryRoutes.post('/adjustments', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const parsed = adjustStockSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { branchId } = await locate(c, { branchId: parsed.data.branchId });

  try {
    const result = await (stub as any).adjustStock({
      ...parsed.data,
      branchId,
      createdById: c.get('userId') || 'SYSTEM',
    });
    return c.json({ success: true, ...result }, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Stock adjustment failed' }, 400);
  }
});

// 6. GET /api/inventory/batches
inventoryRoutes.get('/batches', async (c) => {
  const stub = getStub(c);
  const itemId = c.req.query('itemId');
  const nearExpiryDays = c.req.query('nearExpiryDays') ? Number(c.req.query('nearExpiryDays')) : undefined;

  const batches = await (stub as any).getBatches(itemId, nearExpiryDays);
  return c.json({ batches });
});

// 7. POST /api/inventory/batches
inventoryRoutes.post('/batches', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const parsed = createBatchSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  try {
    const result = await (stub as any).createBatch(parsed.data);
    return c.json({ success: true, ...result }, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Batch creation failed' }, 400);
  }
});

// 8. GET /api/inventory/recipes/:menuItemId
inventoryRoutes.get('/recipes/:menuItemId', async (c) => {
  const stub = getStub(c);
  const menuItemId = c.req.param('menuItemId');

  const recipe = await (stub as any).getRecipe(menuItemId);
  return c.json({ recipe });
});

// 9. POST /api/inventory/recipes
inventoryRoutes.post('/recipes', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const parsed = createRecipeSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  try {
    const result = await (stub as any).createRecipe(parsed.data);
    return c.json({ success: true, ...result }, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Recipe creation failed' }, 400);
  }
});

// 10. POST /api/inventory/recipes/consume
inventoryRoutes.post('/recipes/consume', async (c) => {
  const stub = getStub(c);
  const body = await c.req.json();
  const parsed = consumeRecipeSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { branchId } = await locate(c, { branchId: parsed.data.branchId });

  try {
    const result = await (stub as any).consumeRecipe({
      ...parsed.data,
      branchId,
    });
    return c.json({ success: true, ...result });
  } catch (err: any) {
    return c.json({ error: err.message || 'Recipe consumption failed' }, 400);
  }
});


// Reorder planning: what to buy, from whom; turn it into draft purchase orders in one step
inventoryRoutes.get('/reorder', async (c) => {
  const stub = c.get('businessStub') as any;
  return c.json({ success: true, data: await stub.reorderSuggestions() });
});

inventoryRoutes.post('/reorder/purchase-orders', async (c) => {
  const { z } = await import('zod');
  const parsed = z
    .object({ lines: z.array(z.object({ itemId: z.string().min(1).max(64), vendorId: z.string().min(1, 'Choose a vendor').max(64), quantityThousandths: z.number().int().positive(), unitPricePaise: z.number().int().min(0).optional() })).min(1, 'Pick at least one item') })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400);
  try {
    const stub = c.get('businessStub') as any;
    const docs = await stub.createReorderPurchaseOrders(parsed.data.lines, String(c.get('userId') ?? 'system'));
    return c.json({ success: true, data: docs }, 201);
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'Could not create purchase orders' }, 400);
  }
});

// Rack / bin locations
inventoryRoutes.get('/locations', async (c) => {
  const stub = c.get('businessStub') as any;
  return c.json({ success: true, data: await stub.listItemLocations(c.req.query('warehouseId') || undefined) });
});

inventoryRoutes.put('/locations', async (c) => {
  const { z } = await import('zod');
  const parsed = z.object({ itemId: z.string().min(1).max(64), warehouseId: z.string().max(64).optional(), rackBin: z.string().trim().min(1, 'Enter the rack / bin').max(40) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400);
  try {
    const stub = c.get('businessStub') as any;
    return c.json({ success: true, data: await stub.setItemLocation(parsed.data.itemId, parsed.data.warehouseId, parsed.data.rackBin) });
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'Could not save' }, 400);
  }
});
