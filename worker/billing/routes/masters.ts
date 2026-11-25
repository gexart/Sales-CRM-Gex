import { Hono } from 'hono';
import { z } from 'zod';
import { validateNumberTemplate, normalizeBillingSettings } from '@billing/shared';
import { renderBarcodeLabels } from '../print-docs';
import { lookupGstin } from '../services/gstin-lookup';
import type { Env } from '../types';
import type { BusinessVariables } from '../middleware/tenant';

export const mastersRoutes = new Hono<{ Bindings: Env; Variables: BusinessVariables }>();

// 1. PARTIES
mastersRoutes.get('/parties', async (c) => {
  const stub = c.get('businessStub');
  const type = c.req.query('type');
  const search = c.req.query('search') || c.req.query('q');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const result = await stub.listParties({ type, search, limit, offset });
  return c.json(result);
});

const numberTemplate = z
  .string()
  .max(24)
  .refine((v) => validateNumberTemplate(v) === null, { message: 'Use letters, digits, "/", "-" and {FY} {YYYY} {MM} {DD} {BRANCH}' });

/** Customer / vendor fields (POST validates all, PUT validates the ones sent). */
const partySchema = z.object({
  name: z.string().min(1, 'Party name is required'),
  type: z.enum(['CUSTOMER', 'VENDOR', 'BOTH']).default('CUSTOMER'),
  phone: z.string().min(10, 'Valid 10-digit phone number is required'),
  company: z.string().max(200).optional(),
  email: z.string().email().optional().or(z.literal('')),
  gstin: z.string().max(15).optional(),
  pan: z.string().max(10).optional(),
  billingAddress: z.string().max(500).optional(),
  shippingAddress: z.string().max(500).optional(),
  stateCode: z.string().default('19'),
  creditLimitPaise: z.number().int().min(0).default(0),
  creditDays: z.number().int().min(0).default(0),
  openingBalancePaise: z.number().int().default(0),
  openingBalanceType: z.enum(['RECEIVE', 'PAY']).default('RECEIVE'),
  tags: z.array(z.string().max(40)).max(30).default([]),
  notes: z.string().max(2000).optional(),
  /** Customer-wise bill numbering: replaces the series prefix / suffix for this customer's documents. */
  docPrefix: numberTemplate.optional().or(z.literal('')),
  docSuffix: numberTemplate.optional().or(z.literal('')),
});

// GET /api/masters/gstin/:gstin — validate a GSTIN and auto-fill party details (state, PAN; name/address/status
// when a GST data provider is configured). Rate-limited per business to protect the paid provider.
mastersRoutes.get('/gstin/:gstin', async (c) => {
  const gstin = c.req.param('gstin');
  if (!/^[0-9A-Za-z]{15}$/.test(gstin)) return c.json({ error: 'GSTIN must be 15 letters/digits', code: 'INVALID_GSTIN' }, 400);
  const limiter = (c.env as Env).API_LIMITER;
  if (limiter) {
    const { success } = await limiter.limit({ key: `gstin:${c.req.header('X-Business-Id') ?? 'anon'}` });
    if (!success) return c.json({ error: 'Too many GSTIN lookups. Try again in a minute.', code: 'RATE_LIMITED' }, 429);
  }
  const details = await lookupGstin(gstin, c.env as any);
  return c.json({ details });
});

mastersRoutes.post('/parties', async (c) => {
  const stub = c.get('businessStub');
  const body = await c.req.json().catch(() => ({}));

  const schema = partySchema;

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);
  }

  try {
    const party = await stub.createParty(parsed.data);
    return c.json({ success: true, party }, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Error creating party' }, 400);
  }
});

mastersRoutes.get('/parties/:id', async (c) => {
  const stub = c.get('businessStub');
  const id = c.req.param('id');
  const party = await stub.getParty(id);
  if (!party) return c.json({ error: 'Party not found' }, 404);
  return c.json(party);
});

mastersRoutes.put('/parties/:id', async (c) => {
  const stub = c.get('businessStub');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = partySchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);
  }

  try {
    // Only the fields that were sent: schema defaults must never overwrite the credit limit, opening balance, tags or numbering.
    const sent = Object.fromEntries(Object.entries(parsed.data).filter(([k]) => Object.prototype.hasOwnProperty.call(body, k)));
    const updated = await stub.updateParty(id, sent);
    return c.json({ success: true, party: updated });
  } catch (err: any) {
    return c.json({ error: err.message || 'Error updating party' }, 400);
  }
});

mastersRoutes.delete('/parties/:id', async (c) => {
  const stub = c.get('businessStub');
  const id = c.req.param('id');
  await stub.deleteParty(id);
  return c.json({ success: true });
});

mastersRoutes.get('/parties/:id/ledger', async (c) => {
  const stub = c.get('businessStub');
  const id = c.req.param('id');
  try {
    const ledger = await stub.getPartyLedger(id);
    return c.json(ledger);
  } catch (err: any) {
    return c.json({ error: err.message || 'Error fetching ledger' }, 404);
  }
});

// 2. ITEMS
mastersRoutes.get('/items', async (c) => {
  const stub = c.get('businessStub');
  const search = c.req.query('search') || c.req.query('q');
  const type = c.req.query('type');
  const categoryId = c.req.query('categoryId');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const result = await stub.listItems({ search, type, categoryId, limit, offset });
  return c.json(result);
});

mastersRoutes.get('/items/labels', async (c) => {
  const stub = c.get('businessStub');
  const ids = String(c.req.query('ids') || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 100);
  const copies = Math.min(Math.max(parseInt(c.req.query('copies') || '1', 10) || 1, 1), 100);
  if (!ids.length) return c.json({ error: 'Choose at least one item' }, 400);
  const items: any[] = [];
  for (const id of ids) {
    const it = await stub.getItem(id);
    if (it) items.push(it);
  }
  if (!items.length) return c.json({ error: 'Items not found' }, 404);
  const s = normalizeBillingSettings((await stub.getAllSettings())?.billing_settings);
  const pdf = await renderBarcodeLabels(items, s, s.company.legalName || 'Gexart', copies);
  return new Response(pdf as unknown as BodyInit, { headers: { 'content-type': 'application/pdf', 'content-disposition': `${c.req.query('inline') === '1' ? 'inline' : 'attachment'}; filename="labels.pdf"`, 'cache-control': 'no-store' } });
});

mastersRoutes.get('/items/search', async (c) => {
  const stub = c.get('businessStub');
  const q = c.req.query('q') || c.req.query('search') || '';
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const items = await stub.searchItems(q, limit);
  return c.json({ items });
});

mastersRoutes.post('/items', async (c) => {
  const stub = c.get('businessStub');
  const body = await c.req.json().catch(() => ({}));

  const schema = z.object({
    name: z.string().min(1, 'Item name is required'),
    type: z.enum(['GOODS', 'SERVICE']).default('GOODS'),
    categoryId: z.string().optional(),
    brand: z.string().optional(),
    sku: z.string().optional(),
    barcode: z.string().optional(),
    hsnSac: z.string().optional(),
    unitId: z.string().min(1, 'Unit is required'),
    secondaryUnitId: z.string().optional(),
    conversionFactorThousandths: z.number().int().default(1000),
    salePricePaise: z.number().int().min(0, 'Sale price cannot be negative'),
    purchasePricePaise: z.number().int().min(0).default(0),
    mrpPaise: z.number().int().min(0).default(0),
    wholesalePricePaise: z.number().int().min(0).default(0),
    taxRateId: z.string().min(1, 'Tax rate is required'),
    priceIncludesTax: z.boolean().default(false),
    cessBasisPoints: z.number().int().default(0),
    openingStockThousandths: z.number().int().default(0),
    lowStockLevelThousandths: z.number().int().default(0),
    trackBatch: z.boolean().default(false),
    trackExpiry: z.boolean().default(false),
    isActive: z.boolean().default(true),
    showInPos: z.boolean().default(true),
    showInRestaurant: z.boolean().default(false),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);
  }

  try {
    const item = await stub.createItem(parsed.data);
    return c.json({ success: true, item }, 201);
  } catch (err: any) {
    return c.json({ error: err.message || 'Error creating item' }, 400);
  }
});

mastersRoutes.post('/items/bulk', async (c) => {
  const stub = c.get('businessStub');
  const body = await c.req.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : [];

  if (items.length === 0) {
    return c.json({ error: 'Items array cannot be empty' }, 400);
  }

  try {
    // Imported rows carry a unit name and a GST rate; the engine wants the matching ids.
    const [units, taxes]: [any[], any[]] = [await stub.listUnits(), await stub.listTaxRates()];
    const unitOf = (name?: string) => {
      const n = String(name || '').trim().toLowerCase();
      return units.find((u) => [u.code, u.symbol, u.name].some((x) => String(x || '').toLowerCase() === n)) ?? units.find((u) => u.is_default) ?? units[0];
    };
    const taxOf = (bp: number) => taxes.find((t) => t.rate_basis_points === bp) ?? taxes.find((t) => t.rate_basis_points === 1800) ?? taxes[0];
    const prepared = items
      .filter((it: any) => it && String(it.name || '').trim())
      .map((it: any) => {
        const { unit, taxRateBasisPoints, ...rest } = it;
        return {
          ...rest,
          name: String(it.name).trim(),
          type: it.type ?? (String(it.hsnSac || '').startsWith('99') ? 'SERVICE' : 'GOODS'),
          unitId: it.unitId ?? unitOf(unit)?.id,
          taxRateId: it.taxRateId ?? taxOf(Number(taxRateBasisPoints ?? 1800))?.id,
        };
      });
    if (!prepared.length) return c.json({ error: 'No valid rows to import' }, 400);
    const result = await stub.bulkInsertItems(prepared);
    return c.json({ success: true, insertedCount: result.insertedCount });
  } catch (err: any) {
    return c.json({ error: err.message || 'Bulk insert failed' }, 400);
  }
});

mastersRoutes.get('/items/:id', async (c) => {
  const stub = c.get('businessStub');
  const id = c.req.param('id');
  const item = await stub.getItem(id);
  if (!item) return c.json({ error: 'Item not found' }, 404);
  return c.json(item);
});

mastersRoutes.put('/items/:id', async (c) => {
  const stub = c.get('businessStub');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));

  try {
    const item = await stub.updateItem(id, body);
    return c.json({ success: true, item });
  } catch (err: any) {
    return c.json({ error: err.message || 'Error updating item' }, 400);
  }
});

mastersRoutes.delete('/items/:id', async (c) => {
  const stub = c.get('businessStub');
  const id = c.req.param('id');
  await stub.deleteItem(id);
  return c.json({ success: true });
});

// 3. BANK ACCOUNTS
mastersRoutes.get('/banks', async (c) => {
  const stub = c.get('businessStub');
  const banks = await stub.listBankAccounts();
  return c.json({ bankAccounts: banks });
});

mastersRoutes.post('/banks', async (c) => {
  const stub = c.get('businessStub');
  const body = await c.req.json().catch(() => ({}));

  const schema = z.object({
    name: z.string().min(1, 'Account name is required'),
    accountType: z.enum(['BANK', 'CASH']).default('BANK'),
    accountNumber: z.string().optional(),
    ifsc: z.string().optional(),
    branch: z.string().optional(),
    upiId: z.string().optional(),
    openingBalancePaise: z.number().int().default(0),
    isDefault: z.boolean().default(false),
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.format() }, 400);
  }

  const account = await stub.createBankAccount(parsed.data);
  return c.json({ success: true, account }, 201);
});

mastersRoutes.delete('/banks/:id', async (c) => {
  const stub = c.get('businessStub');
  const id = c.req.param('id');
  await stub.deleteBankAccount(id);
  return c.json({ success: true });
});

// 4. UNITS & TAXES
mastersRoutes.get('/units', async (c) => {
  const stub = c.get('businessStub');
  const units = await stub.listUnits();
  return c.json({ units });
});

mastersRoutes.get('/taxes', async (c) => {
  const stub = c.get('businessStub');
  const taxes = await stub.listTaxRates();
  return c.json({ taxRates: taxes });
});

