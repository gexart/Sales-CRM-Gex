import { newId } from '@billing/shared';
import { allocateDocNumber, type NumberingSql } from './numbering';

/**
 * The one way to write a row in `payments` (money in from customers, money out to vendors).
 * Fixes earlier POS / restaurant / purchase code that wrote columns that do not exist or skipped required ones.
 */
export interface PaymentRowInput {
  branchId: string;
  partyId: string;
  type: 'IN' | 'OUT';
  mode: string;
  amountPaise: number;
  date: string;
  referenceNo?: string | null;
  invoiceId?: string | null;
  accountId?: string | null;
  notes?: string | null;
  createdById: string;
}

function rows(cur: any): any[] {
  if (!cur) return [];
  if (typeof cur.toArray === 'function') return cur.toArray();
  if (typeof cur[Symbol.iterator] === 'function') return [...cur];
  const out: any[] = [];
  if (typeof cur.next === 'function') for (let r = cur.next(); r && !r.done; r = cur.next()) out.push(r.value);
  return out;
}

/** Cash → Cash in hand (1001); everything else → Bank (1010), unless an account is given. */
export function moneyAccountFor(sql: NumberingSql, mode: string | undefined, accountId?: string | null): string {
  if (accountId) return accountId;
  const code = (mode ?? 'CASH').toUpperCase() === 'CASH' ? '1001' : '1010';
  // Same statement text as PostingService.getAccountByCode.
  const acc = rows(sql.exec('SELECT id, code, name, type FROM accounts WHERE code = ?', code))[0];
  if (!acc) throw new Error('No cash/bank account configured');
  return String(acc.id);
}

/** The shared "Walk-in Customer" party for counter sales without a named customer. */
export function walkInPartyId(sql: NumberingSql, stateCode = '19'): string {
  const existing = rows(sql.exec("SELECT id FROM parties WHERE name = 'Walk-in Customer' AND deleted_at IS NULL LIMIT 1"))[0];
  if (existing) return String(existing.id);
  const id = newId();
  const now = new Date().toISOString();
  sql.exec(
    "INSERT INTO parties (id, type, name, phone, state_code, created_at, updated_at) VALUES (?, 'CUSTOMER', 'Walk-in Customer', '', ?, ?, ?)",
    id, stateCode, now, now,
  );
  return id;
}

export function recordPaymentRow(sql: NumberingSql, p: PaymentRowInput): { id: string; paymentNo: string } {
  if (!Number.isInteger(p.amountPaise) || p.amountPaise <= 0) throw new Error('Payment amount must be greater than zero');
  const id = newId();
  const { docNumber } = allocateDocNumber(sql, { docType: p.type === 'IN' ? 'PAYMENT_IN' : 'PAYMENT_OUT', branchId: p.branchId, date: p.date });
  sql.exec(
    `INSERT INTO payments (id, payment_no, branch_id, party_id, type, mode, amount_paise, date, reference_no, invoice_id, account_id, notes, created_by_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, docNumber, p.branchId, p.partyId, p.type, p.mode, p.amountPaise, p.date, p.referenceNo ?? null, p.invoiceId ?? null,
    moneyAccountFor(sql, p.mode, p.accountId), p.notes ?? null, p.createdById, new Date().toISOString(),
  );
  return { id, paymentNo: docNumber };
}

export interface ListPaymentsParams {
  type: 'IN' | 'OUT';
  startDate?: string;
  endDate?: string;
  mode?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

/** Payments Received / Made with party name, linked invoice number, per-mode totals. */
export function listPayments(sql: NumberingSql, p: ListPaymentsParams) {
  let where = 'WHERE p.type = ?';
  const args: unknown[] = [p.type];
  if (p.startDate) {
    where += ' AND p.date >= ?';
    args.push(p.startDate);
  }
  if (p.endDate) {
    where += ' AND p.date <= ?';
    args.push(p.endDate);
  }
  if (p.mode) {
    where += ' AND p.mode = ?';
    args.push(p.mode);
  }
  if (p.search) {
    const q = `%${p.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where += " AND (p.payment_no LIKE ? ESCAPE '\\' OR pt.name LIKE ? ESCAPE '\\' OR p.reference_no LIKE ? ESCAPE '\\')";
    args.push(q, q, q);
  }
  const from = 'FROM payments p LEFT JOIN parties pt ON pt.id = p.party_id LEFT JOIN invoices i ON i.id = p.invoice_id';
  const byMode = rows(sql.exec(`SELECT p.mode AS mode, COUNT(*) AS n, COALESCE(SUM(p.amount_paise), 0) AS total ${from} ${where} GROUP BY p.mode`, ...args));
  const limit = Math.min(Math.max(Math.trunc(p.limit ?? 50) || 50, 1), 500);
  const offset = Math.max(Math.trunc(p.offset ?? 0) || 0, 0);
  const payments = rows(
    sql.exec(
      `SELECT p.id, p.payment_no, p.date, p.mode, p.amount_paise, p.reference_no, p.notes, p.invoice_id, i.invoice_no, pt.name AS party_name
       ${from} ${where} ORDER BY p.date DESC, p.created_at DESC LIMIT ? OFFSET ?`,
      ...args, limit, offset,
    ),
  );
  const totalPaise = byMode.reduce((s, r) => s + Number(r.total), 0);
  const count = byMode.reduce((s, r) => s + Number(r.n), 0);
  return {
    payments,
    totalCount: count,
    totalPaise,
    byMode: Object.fromEntries(byMode.map((r) => [String(r.mode), Number(r.total)])),
  };
}
