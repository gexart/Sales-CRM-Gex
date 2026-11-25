import { Hono } from 'hono';
import type { Env } from '../types';
import type { BusinessVariables } from '../middleware/tenant';

export const reportRoutes = new Hono<{ Bindings: Env; Variables: BusinessVariables }>();

const getStub = (c: any) => {
  const stub = c.get('businessStub');
  if (!stub) {
    const businessId = c.req.header('X-Business-Id') || 'biz_default';
    return c.env.BILLING_DO.get(c.env.BILLING_DO.idFromName(businessId));
  }
  return stub;
};

// 1. GET /api/reports/profit-loss
reportRoutes.get('/profit-loss', async (c) => {
  const stub = getStub(c);
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const branchId = c.req.query('branchId') || c.req.header('X-Branch-Id');

  const report = await (stub as any).getProfitAndLoss({ startDate, endDate, branchId });
  return c.json(report);
});

// 2. GET /api/reports/balance-sheet
reportRoutes.get('/balance-sheet', async (c) => {
  const stub = getStub(c);
  const asOfDate = c.req.query('asOfDate');
  const branchId = c.req.query('branchId') || c.req.header('X-Branch-Id');

  const report = await (stub as any).getBalanceSheet({ asOfDate, branchId });
  return c.json(report);
});

// GST for a month, worked out from the invoice lines
reportRoutes.get('/gst-summary', async (c) => {
  try {
    return c.json({ ok: true, ...(await getStub(c).gstSummary(c.req.query('month') || new Date().toISOString().substring(0, 7))) });
  } catch (err: any) {
    return c.json({ error: err.message || 'Could not build the GST report' }, 400);
  }
});

// 3. GET /api/reports/gstr1
reportRoutes.get('/gstr1', async (c) => {
  const stub = getStub(c);
  const returnPeriod = c.req.query('returnPeriod');
  const branchId = c.req.query('branchId') || c.req.header('X-Branch-Id');

  const report = await (stub as any).getGstr1Report({ returnPeriod, branchId });
  return c.json(report);
});

// 4. GET /api/reports/aging
reportRoutes.get('/aging', async (c) => {
  const stub = getStub(c);
  const type = (c.req.query('type') as 'RECEIVABLES' | 'PAYABLES') || 'RECEIVABLES';
  const report = await (stub as any).getAgingReport(type);
  return c.json({ rows: report });
});
