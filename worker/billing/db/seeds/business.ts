import { newId } from '@billing/shared';

export interface SeedBusinessOptions {
  businessId: string;
  businessName: string;
  stateCode: string; // e.g. "19"
  address: string;
  phone: string;
  gstin?: string;
  invoicePrefix?: string; // e.g. "GX/26-27/"
}

export interface UnitDefinition {
  name: string;
  code: string;
  symbol: string;
  isDecimalAllowed: boolean;
  isDefault: boolean;
}

export const SEED_UNITS: UnitDefinition[] = [
  { name: 'Pieces', code: 'PCS', symbol: 'pcs', isDecimalAllowed: false, isDefault: true },
  { name: 'Kilograms', code: 'KG', symbol: 'kg', isDecimalAllowed: true, isDefault: false },
  { name: 'Grams', code: 'GM', symbol: 'g', isDecimalAllowed: true, isDefault: false },
  { name: 'Litres', code: 'LTR', symbol: 'l', isDecimalAllowed: true, isDefault: false },
  { name: 'Millilitres', code: 'ML', symbol: 'ml', isDecimalAllowed: true, isDefault: false },
  { name: 'Metres', code: 'MTR', symbol: 'm', isDecimalAllowed: true, isDefault: false },
  { name: 'Boxes', code: 'BOX', symbol: 'box', isDecimalAllowed: false, isDefault: false },
  { name: 'Packets', code: 'PCK', symbol: 'pkt', isDecimalAllowed: false, isDefault: false },
  { name: 'Dozens', code: 'DOZ', symbol: 'doz', isDecimalAllowed: false, isDefault: false },
  { name: 'Plates', code: 'PLATE', symbol: 'plt', isDecimalAllowed: false, isDefault: false },
  { name: 'Servings', code: 'SERVE', symbol: 'srv', isDecimalAllowed: false, isDefault: false },
];

export interface TaxRateDefinition {
  name: string;
  rateBasisPoints: number;
  igstBasisPoints: number;
  cgstBasisPoints: number;
  sgstBasisPoints: number;
  cessBasisPoints: number;
  isActive: boolean;
  isDefault: boolean;
}

export const SEED_TAX_RATES: TaxRateDefinition[] = [
  { name: 'GST 0% (Exempt)', rateBasisPoints: 0, igstBasisPoints: 0, cgstBasisPoints: 0, sgstBasisPoints: 0, cessBasisPoints: 0, isActive: true, isDefault: false },
  { name: 'GST 0.25% (Precious Stones)', rateBasisPoints: 25, igstBasisPoints: 25, cgstBasisPoints: 12, sgstBasisPoints: 13, cessBasisPoints: 0, isActive: true, isDefault: false },
  { name: 'GST 3% (Gold & Jewellery)', rateBasisPoints: 300, igstBasisPoints: 300, cgstBasisPoints: 150, sgstBasisPoints: 150, cessBasisPoints: 0, isActive: true, isDefault: false },
  { name: 'GST 5% (Essential Goods/Food)', rateBasisPoints: 500, igstBasisPoints: 500, cgstBasisPoints: 250, sgstBasisPoints: 250, cessBasisPoints: 0, isActive: true, isDefault: false },
  { name: 'GST 18% (Standard Rate)', rateBasisPoints: 1800, igstBasisPoints: 1800, cgstBasisPoints: 900, sgstBasisPoints: 900, cessBasisPoints: 0, isActive: true, isDefault: true },
  { name: 'GST 40% (Luxury/Sin Goods)', rateBasisPoints: 4000, igstBasisPoints: 4000, cgstBasisPoints: 2000, sgstBasisPoints: 2000, cessBasisPoints: 0, isActive: true, isDefault: false },
  // Legacy / Inactive rates
  { name: 'GST 12% (Legacy)', rateBasisPoints: 1200, igstBasisPoints: 1200, cgstBasisPoints: 600, sgstBasisPoints: 600, cessBasisPoints: 0, isActive: false, isDefault: false },
  { name: 'GST 28% (Legacy)', rateBasisPoints: 2800, igstBasisPoints: 2800, cgstBasisPoints: 1400, sgstBasisPoints: 1400, cessBasisPoints: 0, isActive: false, isDefault: false },
];

export interface ChartOfAccountItem {
  code: string;
  name: string;
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  subtype: string;
  isSystem: boolean;
}

export const SEED_CHART_OF_ACCOUNTS: ChartOfAccountItem[] = [
  // ASSETS (1000 - 1999)
  { code: '1001', name: 'Cash in Hand', type: 'ASSET', subtype: 'CASH', isSystem: true },
  { code: '1010', name: 'Bank Accounts', type: 'ASSET', subtype: 'BANK', isSystem: true },
  { code: '1100', name: 'Sundry Debtors (Receivables)', type: 'ASSET', subtype: 'RECEIVABLE', isSystem: true },
  { code: '1200', name: 'Stock in Hand (Inventory)', type: 'ASSET', subtype: 'INVENTORY', isSystem: true },
  { code: '1210', name: 'Finished Goods Stock', type: 'ASSET', subtype: 'INVENTORY', isSystem: true },
  { code: '1150', name: 'Staff Advances', type: 'ASSET', subtype: 'CURRENT_ASSET', isSystem: true },
  { code: '1310', name: 'Input CGST', type: 'ASSET', subtype: 'TAX_INPUT', isSystem: true },
  { code: '1320', name: 'Input SGST', type: 'ASSET', subtype: 'TAX_INPUT', isSystem: true },
  { code: '1330', name: 'Input IGST', type: 'ASSET', subtype: 'TAX_INPUT', isSystem: true },
  { code: '1340', name: 'Input Cess', type: 'ASSET', subtype: 'TAX_INPUT', isSystem: true },
  { code: '1501', name: 'Fixed Assets', type: 'ASSET', subtype: 'FIXED_ASSET', isSystem: true },
  { code: '1502', name: 'Accumulated Depreciation', type: 'ASSET', subtype: 'FIXED_ASSET', isSystem: true },

  // LIABILITIES (2000 - 2999)
  { code: '2001', name: 'Sundry Creditors (Payables)', type: 'LIABILITY', subtype: 'PAYABLE', isSystem: true },
  { code: '2110', name: 'Output CGST', type: 'LIABILITY', subtype: 'TAX_OUTPUT', isSystem: true },
  { code: '2120', name: 'Output SGST', type: 'LIABILITY', subtype: 'TAX_OUTPUT', isSystem: true },
  { code: '2130', name: 'Output IGST', type: 'LIABILITY', subtype: 'TAX_OUTPUT', isSystem: true },
  { code: '2140', name: 'Output Cess', type: 'LIABILITY', subtype: 'TAX_OUTPUT', isSystem: true },
  { code: '2150', name: 'TDS Payable', type: 'LIABILITY', subtype: 'TAX_OUTPUT', isSystem: true },
  { code: '2160', name: 'TCS Payable', type: 'LIABILITY', subtype: 'TAX_OUTPUT', isSystem: true },
  { code: '2210', name: 'Salaries Payable', type: 'LIABILITY', subtype: 'CURRENT_LIABILITY', isSystem: true },
  { code: '2220', name: 'PF & ESI Payable', type: 'LIABILITY', subtype: 'CURRENT_LIABILITY', isSystem: true },
  { code: '2230', name: 'Professional Tax Payable', type: 'LIABILITY', subtype: 'CURRENT_LIABILITY', isSystem: true },

  // EQUITY (3000 - 3999)
  { code: '3001', name: "Owner's Capital", type: 'EQUITY', subtype: 'EQUITY', isSystem: true },
  { code: '3010', name: 'Drawings', type: 'EQUITY', subtype: 'EQUITY', isSystem: true },
  { code: '3999', name: 'Opening Balance Equity', type: 'EQUITY', subtype: 'EQUITY', isSystem: true },

  // INCOME (4000 - 4999)
  { code: '4001', name: 'Sales Revenue', type: 'INCOME', subtype: 'DIRECT_INCOME', isSystem: true },
  { code: '4010', name: 'Sales Returns', type: 'INCOME', subtype: 'DIRECT_INCOME', isSystem: true },
  { code: '4020', name: 'Service Charge Income', type: 'INCOME', subtype: 'DIRECT_INCOME', isSystem: true },
  { code: '4030', name: 'Discount Received', type: 'INCOME', subtype: 'INDIRECT_INCOME', isSystem: true },
  { code: '4100', name: 'Interest & Other Income', type: 'INCOME', subtype: 'INDIRECT_INCOME', isSystem: true },

  // EXPENSES (5000 - 5999)
  { code: '5001', name: 'Purchases (Cost of Goods Sold)', type: 'EXPENSE', subtype: 'DIRECT_EXPENSE', isSystem: true },
  { code: '5010', name: 'Purchase Returns', type: 'EXPENSE', subtype: 'DIRECT_EXPENSE', isSystem: true },
  { code: '5020', name: 'Discount Allowed', type: 'EXPENSE', subtype: 'DIRECT_EXPENSE', isSystem: true },
  { code: '5030', name: 'Round Off', type: 'EXPENSE', subtype: 'DIRECT_EXPENSE', isSystem: true },
  { code: '5101', name: 'Rent Expense', type: 'EXPENSE', subtype: 'INDIRECT_EXPENSE', isSystem: false },
  { code: '5102', name: 'Salary & Wages', type: 'EXPENSE', subtype: 'INDIRECT_EXPENSE', isSystem: false },
  { code: '5103', name: 'Electricity & Utilities', type: 'EXPENSE', subtype: 'INDIRECT_EXPENSE', isSystem: false },
  { code: '5104', name: 'Internet & Telephone', type: 'EXPENSE', subtype: 'INDIRECT_EXPENSE', isSystem: false },
  { code: '5105', name: 'Transport & Delivery', type: 'EXPENSE', subtype: 'INDIRECT_EXPENSE', isSystem: false },
  { code: '5106', name: 'Repairs & Maintenance', type: 'EXPENSE', subtype: 'INDIRECT_EXPENSE', isSystem: false },
  { code: '5201', name: 'Bank Charges', type: 'EXPENSE', subtype: 'INDIRECT_EXPENSE', isSystem: true },
  { code: '5300', name: 'Depreciation Expense', type: 'EXPENSE', subtype: 'INDIRECT_EXPENSE', isSystem: true },
  { code: '5199', name: 'Miscellaneous Expenses', type: 'EXPENSE', subtype: 'INDIRECT_EXPENSE', isSystem: false },
];

/**
 * Seeds a newly provisioned BusinessDO SQLite database with default units,
 * tax rates, Indian SME chart of accounts, default branch, warehouse, and doc series.
 */
export function seedBusinessDatabase(sql: any, options: SeedBusinessOptions): void {
  const now = new Date().toISOString();
  const currentFy = '26-27'; // 1 April 2026 - 31 March 2027

  // All values are bound parameters (never interpolated) — names like "Owner's Capital" and user-entered
  // addresses must not break or inject SQL.
  // 1. Seed Units
  for (const u of SEED_UNITS) {
    sql.exec(
      `INSERT OR IGNORE INTO units (id, name, code, symbol, is_decimal_allowed, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      newId(), u.name, u.code, u.symbol, u.isDecimalAllowed ? 1 : 0, u.isDefault ? 1 : 0, now,
    );
  }

  // 2. Seed Tax Rates
  for (const t of SEED_TAX_RATES) {
    sql.exec(
      `INSERT OR IGNORE INTO tax_rates (id, name, rate_basis_points, igst_basis_points, cgst_basis_points, sgst_basis_points, cess_basis_points, is_active, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId(), t.name, t.rateBasisPoints, t.igstBasisPoints, t.cgstBasisPoints, t.sgstBasisPoints, t.cessBasisPoints, t.isActive ? 1 : 0, t.isDefault ? 1 : 0, now,
    );
  }

  // 3. Seed Chart of Accounts
  for (const a of SEED_CHART_OF_ACCOUNTS) {
    sql.exec(
      `INSERT OR IGNORE INTO accounts (id, code, name, type, subtype, parent_id, is_system, party_id, balance_paise, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, 0, ?, ?)`,
      newId(), a.code, a.name, a.type, a.subtype, a.isSystem ? 1 : 0, now, now,
    );
  }

  // 4. Default Branch ("Main Branch")
  const defaultBranchId = newId();
  sql.exec(
    `INSERT OR IGNORE INTO branches (id, name, code, gstin, state_code, address, phone, is_default, created_at, updated_at)
     VALUES (?, 'Main Branch', 'MAIN', ?, ?, ?, ?, 1, ?, ?)`,
    defaultBranchId, options.gstin ?? null, options.stateCode, options.address, options.phone, now, now,
  );

  // 5. Default Warehouse ("Main Warehouse")
  const defaultWarehouseId = newId();
  sql.exec(
    `INSERT OR IGNORE INTO warehouses (id, branch_id, name, is_default, created_at, updated_at) VALUES (?, ?, 'Main Warehouse', 1, ?, ?)`,
    defaultWarehouseId, defaultBranchId, now, now,
  );

  // 6. Default Document Series
  const pfx = options.invoicePrefix || 'GX/26-27/';
  const seriesDefinitions = [
    { type: 'INVOICE', prefix: pfx, next: 1 },
    { type: 'POS_BILL', prefix: 'POS/26-27/', next: 1 },
    { type: 'QUOTATION', prefix: 'QT/26-27/', next: 1 },
    { type: 'CREDIT_NOTE', prefix: 'CN/26-27/', next: 1 },
    { type: 'PAYMENT_IN', prefix: 'REC/26-27/', next: 1 },
    { type: 'PAYMENT_OUT', prefix: 'PAY/26-27/', next: 1 },
    { type: 'PURCHASE_ORDER', prefix: 'PO/26-27/', next: 1 },
    { type: 'PURCHASE_BILL', prefix: 'PB/26-27/', next: 1 },
    { type: 'DEBIT_NOTE', prefix: 'DN/26-27/', next: 1 },
    { type: 'EXPENSE', prefix: 'EXP/26-27/', next: 1 },
    { type: 'KOT', prefix: 'KOT/26-27/', next: 1 },
    { type: 'SALES_ORDER', prefix: 'SO/26-27/', next: 1 },
    { type: 'PROFORMA', prefix: 'PI/26-27/', next: 1 },
    { type: 'DELIVERY_CHALLAN', prefix: 'DC/26-27/', next: 1 },
    { type: 'PACKING_LIST', prefix: 'PL/26-27/', next: 1 },
  ];

  for (const s of seriesDefinitions) {
    sql.exec(
      `INSERT OR IGNORE INTO document_series (id, branch_id, doc_type, prefix, next_number, fy_suffix_enabled, financial_year, padding, is_default, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, 4, 1, ?)`,
      newId(), defaultBranchId, s.type, s.prefix, s.next, currentFy, now,
    );
  }
}

