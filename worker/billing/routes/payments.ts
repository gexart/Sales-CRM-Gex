import { Hono } from 'hono';
import type { Env } from '../types';
import type { BusinessVariables } from '../middleware/tenant';

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
