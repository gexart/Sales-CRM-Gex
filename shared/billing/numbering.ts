/**
 * Document numbering (invoices, POS bills, KOTs, purchase bills, …).
 *
 * A number = prefix + zero-padded running number + suffix. Prefix and suffix may contain tokens:
 *   {FY}     financial-year label, e.g. 26-27 (1 April – 31 March)
 *   {FYYYYY} long financial year, e.g. 2026-27
 *   {YYYY}   calendar year, {YY} two-digit year, {MM} month, {DD} day
 *   {BRANCH} branch code
 * A customer may have its own prefix / suffix; it replaces the series prefix / suffix but keeps the
 * series' running number, so the series stays gapless (GST rule 46: unique, consecutive per series per FY).
 */

export interface FinancialYear {
  /** e.g. "26-27" */
  label: string;
  /** e.g. "2026-27" */
  longLabel: string;
  /** First calendar year of the FY, e.g. 2026 */
  startYear: number;
}

/** Financial year of a date in India (Asia/Kolkata calendar date, 1 April – 31 March). */
export function financialYearOf(date: Date | string = new Date()): FinancialYear {
  const d = typeof date === 'string' ? new Date(date) : date;
  // Use the India calendar date so 31-Mar 23:00 UTC (= 1-Apr IST) lands in the new FY.
  const ist = new Date(d.getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const startYear = ist.getUTCMonth() >= 3 ? y : y - 1;
  const a = String(startYear).slice(-2);
  const b = String(startYear + 1).slice(-2);
  return { label: `${a}-${b}`, longLabel: `${startYear}-${b}`, startYear };
}

export interface DocNumberParts {
  prefix: string;
  suffix?: string | null;
  number: number;
  padding?: number;
  date?: Date | string;
  branchCode?: string | null;
  /** Customer-specific prefix / suffix (replace the series ones when non-empty). */
  partyPrefix?: string | null;
  partySuffix?: string | null;
}

export const MAX_DOC_NUMBER_LENGTH = 16; // GST e-invoice / GSTR-1 limit for document numbers

function applyTokens(template: string, date: Date, fy: FinancialYear, branchCode: string): string {
  const ist = new Date(date.getTime() + 330 * 60_000);
  const yyyy = String(ist.getUTCFullYear());
  return template
    .replace(/\{FYYYYY\}/g, fy.longLabel)
    .replace(/\{FY\}/g, fy.label)
    .replace(/\{YYYY\}/g, yyyy)
    .replace(/\{YY\}/g, yyyy.slice(-2))
    .replace(/\{MM\}/g, String(ist.getUTCMonth() + 1).padStart(2, '0'))
    .replace(/\{DD\}/g, String(ist.getUTCDate()).padStart(2, '0'))
    .replace(/\{BRANCH\}/g, branchCode);
}

/** Build the printed document number. */
export function formatDocNumber(p: DocNumberParts): string {
  if (!Number.isInteger(p.number) || p.number < 1) throw new Error('Document number must be a positive integer');
  const date = p.date ? (typeof p.date === 'string' ? new Date(p.date) : p.date) : new Date();
  const fy = financialYearOf(date);
  const branch = (p.branchCode ?? '').trim();
  const prefix = p.partyPrefix && p.partyPrefix.trim() ? p.partyPrefix : p.prefix;
  const suffix = p.partySuffix && p.partySuffix.trim() ? p.partySuffix : (p.suffix ?? '');
  const padding = Math.min(Math.max(Math.trunc(p.padding ?? 4), 1), 10);
  return `${applyTokens(prefix, date, fy, branch)}${String(p.number).padStart(padding, '0')}${applyTokens(suffix, date, fy, branch)}`;
}

/** Allowed characters in a prefix / suffix template (GST allows letters, digits, "-" and "/"). */
const TEMPLATE_RE = /^(?:[A-Za-z0-9/-]|\{(?:FY|FYYYYY|YYYY|YY|MM|DD|BRANCH)\})*$/;

/** Validate a prefix/suffix template. Returns an error message, or null when valid. */
export function validateNumberTemplate(template: string): string | null {
  if (template.length > 24) return 'Keep it to 24 characters or fewer';
  if (!TEMPLATE_RE.test(template)) return 'Use only letters, digits, "/", "-" and {FY}, {YYYY}, {YY}, {MM}, {DD}, {BRANCH}';
  return null;
}

/** Turn a stored literal FY (e.g. "GX/25-26/") into a token template ("GX/{FY}/") for rolling over to a new FY. */
export function templatizeFinancialYear(template: string, fyLabel: string): string {
  return fyLabel ? template.split(fyLabel).join('{FY}') : template;
}

/** Default prefixes for every document type (used when a series has to be created). */
export const DEFAULT_DOC_PREFIXES: Record<string, string> = {
  INVOICE: 'INV/{FY}/',
  POS_BILL: 'POS/{FY}/',
  QUOTATION: 'QT/{FY}/',
  PROFORMA: 'PI/{FY}/',
  SALES_ORDER: 'SO/{FY}/',
  DELIVERY_CHALLAN: 'DC/{FY}/',
  PACKING_LIST: 'PL/{FY}/',
  CREDIT_NOTE: 'CN/{FY}/',
  PAYMENT_IN: 'REC/{FY}/',
  PAYMENT_OUT: 'PAY/{FY}/',
  PURCHASE_ORDER: 'PO/{FY}/',
  PURCHASE_BILL: 'PB/{FY}/',
  DEBIT_NOTE: 'DN/{FY}/',
  EXPENSE: 'EXP/{FY}/',
  KOT: 'KOT/{FY}/',
  RESTAURANT_BILL: 'RB/{FY}/',
  TRANSFER: 'ST/{FY}/',
  ADJUSTMENT: 'ADJ/{FY}/',
  GRN: 'GRN/{FY}/',
};

/** Human labels for the numbering settings screen, grouped by the module that uses them. */
export const DOC_TYPE_LABELS: Record<string, { label: string; module: 'billing' | 'pos_retail' | 'restaurant' | 'inventory' }> = {
  INVOICE: { label: 'Sales invoice', module: 'billing' },
  QUOTATION: { label: 'Quotation / estimate', module: 'billing' },
  PROFORMA: { label: 'Proforma invoice', module: 'billing' },
  SALES_ORDER: { label: 'Sales order', module: 'billing' },
  DELIVERY_CHALLAN: { label: 'Delivery challan', module: 'billing' },
  PACKING_LIST: { label: 'Packing list', module: 'billing' },
  CREDIT_NOTE: { label: 'Credit note', module: 'billing' },
  PAYMENT_IN: { label: 'Payment receipt', module: 'billing' },
  PAYMENT_OUT: { label: 'Payment made', module: 'billing' },
  PURCHASE_ORDER: { label: 'Purchase order', module: 'billing' },
  PURCHASE_BILL: { label: 'Purchase bill', module: 'billing' },
  DEBIT_NOTE: { label: 'Debit note', module: 'billing' },
  EXPENSE: { label: 'Expense', module: 'billing' },
  POS_BILL: { label: 'POS bill', module: 'pos_retail' },
  RESTAURANT_BILL: { label: 'Restaurant bill', module: 'restaurant' },
  KOT: { label: 'Kitchen order ticket (KOT)', module: 'restaurant' },
  TRANSFER: { label: 'Stock transfer', module: 'inventory' },
  ADJUSTMENT: { label: 'Stock adjustment', module: 'inventory' },
  GRN: { label: 'Goods receipt note', module: 'inventory' },
};
