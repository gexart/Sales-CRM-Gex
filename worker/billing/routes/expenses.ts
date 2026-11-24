import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import { locate } from './location';
import type { BusinessVariables } from '../middleware/tenant';

export const expenseRoutes = new Hono<{ Bindings: Env; Variables: BusinessVariables }>();

const createExpenseSchema = z.object({
  branchId: z.string().optional(),
  categoryAccountId: z.string().min(1, 'Expense category is required'),
  paymentAccountId: z.string().min(1, 'Payment account (Cash/Bank) is required'),
  amountPaise: z.number().positive('Expense amount must be positive'),
  date: z.string().optional(),
  taxRateBasisPoints: z.number().nonnegative().optional().default(0),
  isInterState: z.boolean().optional().default(false),
  claimsItc: z.boolean().optional().default(false),
  paymentMode: z.enum(['CASH', 'BANK', 'UPI']).optional().default('CASH'),
  referenceNo: z.string().optional(),
  payee: z.string().optional(),
  notes: z.string().optional(),
  receiptFileKey: z.string().optional(),
});

// GET /api/expenses
expenseRoutes.get('/', async (c) => {
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );
  const categoryAccountId = c.req.query('categoryAccountId');
  const branchId = c.req.query('branchId');
  const search = c.req.query('search') || c.req.query('q');

  const expenses = await (stub as any).listExpenses({
    categoryAccountId,
    branchId,
    search,
  });

  return c.json({ expenses });
});

// GET /api/expenses/summary
expenseRoutes.get('/summary', async (c) => {
  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );
  const branchId = c.req.query('branchId');

  const summary = await (stub as any).getExpenseSummary(branchId);
  return c.json({ summary });
});

// POST /api/expenses
expenseRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parse = createExpenseSchema.safeParse(body);
  if (!parse.success) {
    return c.json({ error: 'Invalid expense input', details: parse.error.format() }, 400);
  }

  const stub =
    c.get('businessStub') ||
    c.env.BILLING_DO.get(
      c.env.BILLING_DO.idFromName(c.req.header('X-Business-Id') || 'biz_default'),
    );

  const data = parse.data;
  const { branchId } = await locate(c, { branchId: data.branchId });

  const expense = await (stub as any).createExpense({
    ...data,
    branchId,
    createdById: c.get('userId') || 'system',
  });

  return c.json({ expense }, 201);
});
