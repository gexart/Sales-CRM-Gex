/**
 * GexGrow module manifest — THE single source of truth for:
 *  - the module catalogue shown on the website pricing page, signup "choose modules" step and Subscription page
 *  - default prices (super-admin can override prices per module in D1 `modules` table)
 *  - sidebar / + New menu / command palette / mobile nav / settings tabs / report lists in the app
 *  - which API path prefixes need which module (API guard returns 403 MODULE_NOT_ENABLED)
 *  - which app routes need which module (app redirects to /upgrade/:module)
 *
 * Nothing else in the codebase may hard-code module lists.
 */

export const MODULE_KEYS = [
  'billing',
  'inventory',
  'pos_retail',
  'restaurant',
  'online_orders',
  'accounting_pro',
  'compliance',
  'projects',
  'crm',
  'hr_payroll',
  'manufacturing',
  'multi_branch',
  'integrations',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export const CORE_MODULE: ModuleKey = 'billing';

/** lucide-react icon names (the app maps these to components). */
export type IconName =
  | 'LayoutDashboard' | 'FileText' | 'FilePen' | 'ShoppingCart' | 'Receipt' | 'Boxes' | 'Warehouse'
  | 'IndianRupee' | 'Users' | 'Truck' | 'FolderKanban' | 'Sparkles' | 'BarChart3' | 'BookOpen'
  | 'Landmark' | 'Store' | 'UtensilsCrossed' | 'Bike' | 'ShieldCheck' | 'TrendingUp' | 'UserCog'
  | 'ShoppingBag' | 'Factory' | 'Building2' | 'Plug' | 'Settings' | 'CreditCard' | 'Package'
  | 'ClipboardList' | 'FileSpreadsheet' | 'Wallet' | 'ScanBarcode' | 'Calculator' | 'Link'
  | 'BellRing' | 'Repeat' | 'FileCheck2' | 'ChefHat' | 'Clock' | 'Gift' | 'Megaphone' | 'Contact';

export type MenuId =
  | 'dashboard' | 'sales' | 'quotations' | 'purchases' | 'expenses' | 'items' | 'inventory' | 'payments'
  | 'customers' | 'vendors' | 'accounting' | 'compliance' | 'projects' | 'pos' | 'restaurant' | 'crm'
  | 'hr' | 'manufacturing' | 'users' | 'insights' | 'reports' | 'integrations';

export interface MenuDef {
  id: MenuId;
  label: string;
  icon: IconName;
  /** Sidebar section label (uppercase small caption). Menus with the same section are grouped. */
  section: 'main' | 'sell' | 'buy' | 'stock' | 'money' | 'people' | 'grow' | 'insight' | 'admin';
  order: number;
}

/** Top-level sidebar menus, Swipe-like order. A menu only shows if at least one visible item belongs to it. */
export const MENUS: MenuDef[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard', section: 'main', order: 0 },
  { id: 'sales', label: 'Sales', icon: 'FileText', section: 'sell', order: 10 },
  { id: 'quotations', label: 'Quotations+', icon: 'FilePen', section: 'sell', order: 11 },
  { id: 'pos', label: 'Retail POS', icon: 'Store', section: 'sell', order: 12 },
  { id: 'restaurant', label: 'Restaurant', icon: 'UtensilsCrossed', section: 'sell', order: 13 },
  { id: 'purchases', label: 'Purchases', icon: 'ShoppingCart', section: 'buy', order: 20 },
  { id: 'expenses', label: 'Expenses+', icon: 'Receipt', section: 'buy', order: 21 },
  { id: 'items', label: 'Products & Services', icon: 'Boxes', section: 'stock', order: 30 },
  { id: 'inventory', label: 'Inventory', icon: 'Warehouse', section: 'stock', order: 31 },
  { id: 'manufacturing', label: 'Manufacturing', icon: 'Factory', section: 'stock', order: 32 },
  { id: 'payments', label: 'Payments', icon: 'IndianRupee', section: 'money', order: 40 },
  { id: 'accounting', label: 'Accounting', icon: 'BookOpen', section: 'money', order: 41 },
  { id: 'compliance', label: 'GST & E-Way', icon: 'ShieldCheck', section: 'money', order: 42 },
  { id: 'customers', label: 'Customers', icon: 'Users', section: 'people', order: 50 },
  { id: 'vendors', label: 'Vendors', icon: 'Truck', section: 'people', order: 51 },
  { id: 'projects', label: 'Projects', icon: 'FolderKanban', section: 'people', order: 52 },
  { id: 'crm', label: 'CRM', icon: 'TrendingUp', section: 'grow', order: 60 },
  { id: 'hr', label: 'HR & Payroll', icon: 'UserCog', section: 'grow', order: 61 },
  { id: 'insights', label: 'Insights', icon: 'Sparkles', section: 'insight', order: 70 },
  { id: 'reports', label: 'Reports', icon: 'BarChart3', section: 'insight', order: 71 },
  { id: 'integrations', label: 'Integrations', icon: 'Plug', section: 'insight', order: 72 },
  { id: 'users', label: 'Admin', icon: 'UserCog', section: 'admin', order: 90 },
];

export const SECTION_LABELS: Record<MenuDef['section'], string> = {
  main: '',
  sell: 'Sell',
  buy: 'Buy',
  stock: 'Stock',
  money: 'Money',
  people: 'People',
  grow: 'Grow',
  insight: 'Insights',
  admin: 'Admin',
};

export interface NavItem {
  id: string;
  menu: MenuId;
  label: string;
  route: string;
  /** Permission code required to see the item (owner/admin have '*'). */
  permission?: string;
  /** Extra route prefixes that should highlight this item (detail/new pages). */
  matches?: string[];
}

export interface QuickCreate {
  id: string;
  label: string;
  route: string;
  icon: IconName;
  permission?: string;
  /** Keyboard hint shown in the + New menu */
  hint?: string;
}

export interface ModuleDef {
  key: ModuleKey;
  name: string;
  icon: IconName;
  tagline: string;
  description: string;
  features: string[];
  /** Default list price in paise (super-admin can override in D1). */
  priceMonthlyPaise: number;
  priceYearlyPaise: number;
  isCore: boolean;
  /** Modules this one needs to work (selected automatically in the cart). */
  requires: ModuleKey[];
  /** API path prefixes (after `/api`) owned by this module. Longest prefix wins. */
  apiPrefixes: string[];
  /** App route prefixes owned by this module. Longest prefix wins. */
  routePrefixes: string[];
  nav: NavItem[];
  quickCreate: QuickCreate[];
  /** Report ids shown on the Reports page when this module is enabled. */
  reports: { id: string; label: string; category: string; route: string }[];
  /** Onboarding checklist entries for this module. */
  onboarding: { id: string; title: string; route: string }[];
}

const P = (rupees: number) => rupees * 100;

export const MODULES: ModuleDef[] = [
  {
    key: 'billing',
    name: 'Billing & Accounting',
    icon: 'FileText',
    tagline: 'GST invoices, quotations, purchases, payments and books — the core of GexGrow.',
    description:
      'Everything a business needs to bill and get paid: GST invoices, quotations to sales orders to challans, purchases, expenses, payments, customers, vendors, basic accounting and 40+ reports.',
    features: [
      'GST invoices, credit notes, proforma & bill of supply',
      'Quotations → Sales orders → Delivery challans → Invoice',
      'Purchase bills, purchase orders, debit notes, expenses',
      'Payments in/out, payment links & auto reminders',
      'Customers & vendors with ledgers, aging, statements',
      'Chart of accounts, journals, bank & cash books',
      'Reports: P&L, balance sheet, GSTR-1/3B, day book, aging',
      'Insights dashboard & document settings (3 templates)',
    ],
    priceMonthlyPaise: P(499),
    priceYearlyPaise: P(4990),
    isCore: true,
    requires: [],
    apiPrefixes: [
      '/business', '/masters', '/sales', '/purchases', '/expenses', '/reports', '/settings', '/notifications',
      '/accounting', '/payments', '/documents', '/insights', '/integrations', '/platform',
    ],
    routePrefixes: [
      '/', '/dashboard', '/admin-center', '/sales', '/purchases', '/expenses', '/income', '/items', '/payments', '/customers', '/vendors', '/parties',
      '/accounting', '/reports', '/insights', '/integrations', '/settings', '/subscription', '/banking',
    ],
    nav: [
      { id: 'dashboard', menu: 'dashboard', label: 'Dashboard', route: '/dashboard' },
      { id: 'invoices', menu: 'sales', label: 'Invoices', route: '/sales/invoices', permission: 'invoice.view' },
      { id: 'credit-notes', menu: 'sales', label: 'Credit Notes', route: '/sales/credit-notes', permission: 'invoice.view' },
      { id: 'recurring', menu: 'sales', label: 'Subscriptions', route: '/sales/subscriptions', permission: 'invoice.view' },
      { id: 'quotations', menu: 'quotations', label: 'Quotations', route: '/sales/quotations', permission: 'invoice.view' },
      { id: 'sales-orders', menu: 'quotations', label: 'Sales Orders', route: '/sales/sales-orders', permission: 'invoice.view' },
      { id: 'proforma', menu: 'quotations', label: 'Pro Forma Invoices', route: '/sales/proforma', permission: 'invoice.view' },
      { id: 'delivery-challans', menu: 'quotations', label: 'Delivery Challans', route: '/sales/delivery-challans', permission: 'invoice.view' },
      { id: 'packing-lists', menu: 'quotations', label: 'Packing Lists', route: '/sales/packing-lists', permission: 'invoice.view' },
      { id: 'bills', menu: 'purchases', label: 'Purchases', route: '/purchases/bills', permission: 'purchase.view' },
      { id: 'purchase-orders', menu: 'purchases', label: 'Purchase Orders', route: '/purchases/orders', permission: 'purchase.view' },
      { id: 'debit-notes', menu: 'purchases', label: 'Debit Notes', route: '/purchases/debit-notes', permission: 'purchase.view' },
      { id: 'expenses', menu: 'expenses', label: 'Expenses', route: '/expenses', permission: 'expense.view' },
      { id: 'recurring-expenses', menu: 'expenses', label: 'Recurring Expenses', route: '/expenses/recurring', permission: 'expense.view' },
      { id: 'indirect-income', menu: 'expenses', label: 'Indirect Income', route: '/income', permission: 'expense.view' },
      { id: 'items', menu: 'items', label: 'Products & Services', route: '/items', permission: 'item.view' },
      { id: 'payments-in', menu: 'payments', label: 'Payments Received', route: '/payments/received', permission: 'payment.record' },
      { id: 'payments-out', menu: 'payments', label: 'Payments Made', route: '/payments/made', permission: 'payment.record' },
      { id: 'payment-links', menu: 'payments', label: 'Payment Links', route: '/payments/links', permission: 'payment.record' },
      { id: 'reminders', menu: 'payments', label: 'Payment Reminders', route: '/payments/reminders', permission: 'payment.record' },
      { id: 'customers', menu: 'customers', label: 'Customers', route: '/customers', permission: 'party.view' },
      { id: 'vendors', menu: 'vendors', label: 'Vendors', route: '/vendors', permission: 'party.view' },
      { id: 'coa', menu: 'accounting', label: 'Chart of Accounts', route: '/accounting/chart-of-accounts', permission: 'report.accounting' },
      { id: 'journals', menu: 'accounting', label: 'Journals & Vouchers', route: '/accounting/journals', permission: 'report.accounting' },
      { id: 'banks', menu: 'accounting', label: 'Bank & Cash', route: '/accounting/banks', permission: 'report.accounting' },
      { id: 'insights', menu: 'insights', label: 'Insights', route: '/insights', permission: 'report.view' },
      { id: 'reports', menu: 'reports', label: 'Reports', route: '/reports', permission: 'report.view' },
      { id: 'integrations', menu: 'integrations', label: 'Integrations', route: '/integrations', permission: 'settings.manage' },
      { id: 'numbering', menu: 'users', label: 'Bill Numbering', route: '/numbering', permission: 'settings.manage' },
    ],
    quickCreate: [
      { id: 'invoice', label: 'Invoice', route: '/sales/invoices/new', icon: 'FileText', permission: 'invoice.create', hint: 'Alt+I' },
      { id: 'quotation', label: 'Quotation', route: '/sales/quotations/new', icon: 'FilePen', permission: 'invoice.create' },
      { id: 'purchase', label: 'Purchase', route: '/purchases/bills/new', icon: 'ShoppingCart', permission: 'purchase.manage' },
      { id: 'expense', label: 'Expense', route: '/expenses?new=1', icon: 'Receipt', permission: 'expense.manage' },
      { id: 'payment-in', label: 'Payment Received', route: '/payments/received?new=1', icon: 'IndianRupee', permission: 'payment.record' },
      { id: 'customer', label: 'Customer', route: '/customers?new=1', icon: 'Users', permission: 'party.manage' },
      { id: 'vendor', label: 'Vendor', route: '/vendors?new=1', icon: 'Truck', permission: 'party.manage' },
      { id: 'product', label: 'Product', route: '/items?new=1', icon: 'Boxes', permission: 'item.manage' },
    ],
    reports: [
      { id: 'sales-summary', label: 'Sales summary', category: 'Sales', route: '/reports/sales' },
      { id: 'sales-by-customer', label: 'Sales by customer', category: 'Sales', route: '/reports/sales?by=customer' },
      { id: 'sales-by-item', label: 'Sales by item', category: 'Sales', route: '/reports/sales?by=item' },
      { id: 'sales-by-hsn', label: 'HSN-wise sales', category: 'GST', route: '/reports/sales?by=hsn' },
      { id: 'purchases', label: 'Purchase register', category: 'Purchases', route: '/reports/purchases' },
      { id: 'expenses', label: 'Expense report', category: 'Purchases', route: '/reports/expenses' },
      { id: 'gstr1', label: 'GSTR-1', category: 'GST', route: '/reports/gstr1' },
      { id: 'gstr3b', label: 'GSTR-3B summary', category: 'GST', route: '/reports/gstr3b' },
      { id: 'receivables', label: 'Receivables aging', category: 'Parties', route: '/reports/aging?type=receivable' },
      { id: 'payables', label: 'Payables aging', category: 'Parties', route: '/reports/aging?type=payable' },
      { id: 'party-ledger', label: 'Party ledger', category: 'Parties', route: '/reports/party-ledger' },
      { id: 'day-book', label: 'Day book', category: 'Accounts', route: '/reports/day-book' },
      { id: 'cash-book', label: 'Cash & bank book', category: 'Accounts', route: '/reports/cash-book' },
      { id: 'pnl', label: 'Profit & Loss', category: 'Accounts', route: '/reports/financial?tab=pnl' },
      { id: 'balance-sheet', label: 'Balance Sheet', category: 'Accounts', route: '/reports/financial?tab=bs' },
      { id: 'trial-balance', label: 'Trial Balance', category: 'Accounts', route: '/reports/trial-balance' },
    ],
    onboarding: [
      { id: 'profile', title: 'Complete business profile & GSTIN', route: '/settings/company' },
      { id: 'item', title: 'Add your first product or service', route: '/items?new=1' },
      { id: 'customer', title: 'Add a customer', route: '/customers?new=1' },
      { id: 'invoice', title: 'Create your first invoice', route: '/sales/invoices/new' },
      { id: 'bank', title: 'Add bank account & UPI for payments', route: '/accounting/banks' },
    ],
  },
  {
    key: 'inventory',
    name: 'Inventory & Warehouses',
    icon: 'Warehouse',
    tagline: 'Multi-warehouse stock, batches, expiry, transfers and barcode labels.',
    description: 'Real-time stock across warehouses with batches, serial numbers, FEFO expiry, transfers, adjustments, low-stock alerts and barcode label printing.',
    features: ['Multi-warehouse stock & valuation', 'Batches, serials & expiry (FEFO)', 'Stock transfers & adjustments', 'Low-stock alerts & reorder levels', 'Barcode label printing', 'Stock reports & timeline'],
    priceMonthlyPaise: P(399),
    priceYearlyPaise: P(3990),
    isCore: false,
    requires: [],
    apiPrefixes: ['/inventory'],
    routePrefixes: ['/inventory'],
    nav: [
      { id: 'stock', menu: 'inventory', label: 'Stock Overview', route: '/inventory/stock', permission: 'stock.view' },
      { id: 'warehouses', menu: 'inventory', label: 'Warehouses', route: '/inventory/warehouses', permission: 'stock.view' },
      { id: 'transfers', menu: 'inventory', label: 'Stock Transfers', route: '/inventory/transfers', permission: 'stock.transfer' },
      { id: 'adjustments', menu: 'inventory', label: 'Adjustments', route: '/inventory/adjustments', permission: 'stock.adjust' },
      { id: 'batches', menu: 'inventory', label: 'Batches & Expiry', route: '/inventory/batches', permission: 'stock.view' },
      { id: 'low-stock', menu: 'inventory', label: 'Low Stock', route: '/inventory/low-stock', permission: 'stock.view' },
      { id: 'inventory-reorder', menu: 'inventory', label: 'Reorder', route: '/inventory/reorder', permission: 'stock.view' },
      { id: 'barcodes', menu: 'inventory', label: 'Barcode Labels', route: '/inventory/barcodes', permission: 'item.view' },
    ],
    quickCreate: [{ id: 'stock-adjust', label: 'Stock Adjustment', route: '/inventory/adjustments?new=1', icon: 'Package', permission: 'stock.adjust' }],
    reports: [
      { id: 'stock-summary', label: 'Stock summary', category: 'Stock', route: '/reports/stock' },
      { id: 'stock-ledger', label: 'Item stock ledger', category: 'Stock', route: '/reports/stock?view=ledger' },
      { id: 'expiry', label: 'Expiring batches', category: 'Stock', route: '/inventory/batches' },
    ],
    onboarding: [{ id: 'warehouse', title: 'Set up warehouses & opening stock', route: '/inventory/warehouses' }],
  },
  {
    key: 'pos_retail',
    name: 'Retail POS',
    icon: 'Store',
    tagline: 'Fast counter billing with barcode, weighing scale and offline mode.',
    description: 'Full-screen point of sale with barcode scanning, hold/recall, split payments, cash shifts, thermal printing and offline billing that syncs later.',
    features: ['Barcode & weighing-scale billing', 'Hold / recall bills, split tender', 'Cash register shifts with X/Z reports', 'Thermal 58/80mm printing', 'Offline billing with gapless sync', 'Customer display screen'],
    priceMonthlyPaise: P(599),
    priceYearlyPaise: P(5990),
    isCore: false,
    requires: [],
    apiPrefixes: ['/pos', '/offline', '/hardware'],
    routePrefixes: ['/pos', '/settings/offline'],
    nav: [
      { id: 'pos', menu: 'pos', label: 'POS Billing', route: '/pos', permission: 'pos.use' },
      { id: 'pos-bills', menu: 'pos', label: 'Bill History & Returns', route: '/pos/bills', permission: 'pos.use' },
      { id: 'pos-reports', menu: 'pos', label: 'POS Reports & Shifts', route: '/pos/reports', permission: 'report.view' },
      { id: 'pos-offers', menu: 'pos', label: 'Offers & Coupons', route: '/pos/offers', permission: 'settings.manage' },
      { id: 'pos-devices', menu: 'pos', label: 'Devices & Offline', route: '/settings/offline', permission: 'settings.manage' },
      { id: 'pos-numbering', menu: 'users', label: 'Bill Numbering', route: '/pos/numbering', permission: 'settings.manage' },
    ],
    quickCreate: [{ id: 'pos-bill', label: 'POS Bill', route: '/pos', icon: 'Store', permission: 'pos.use', hint: 'F2' }],
    reports: [{ id: 'shift-report', label: 'POS sales & shift (Z) report', category: 'POS', route: '/pos/reports' }],
    onboarding: [{ id: 'pos', title: 'Open your first POS shift', route: '/pos' }],
  },
  {
    key: 'restaurant',
    name: 'Restaurant',
    icon: 'UtensilsCrossed',
    tagline: 'Tables, KOT, kitchen display and menu — built for Indian restaurants.',
    description: 'Floor plans with live table status, captain ordering, KOT printing, kitchen display, menu with stations and recipes.',
    features: ['Floor & table management', 'KOT printing & kitchen display (KDS)', 'Menu, variants, add-ons, stations', 'Split / merge / transfer tables', 'Dine-in, takeaway, delivery', 'Recipe-based food costing'],
    priceMonthlyPaise: P(799),
    priceYearlyPaise: P(7990),
    isCore: false,
    requires: [],
    apiPrefixes: ['/restaurant'],
    routePrefixes: ['/restaurant', '/kds'],
    nav: [
      { id: 'tables', menu: 'restaurant', label: 'Tables & Orders', route: '/restaurant/tables', permission: 'restaurant.order' },
      { id: 'kds', menu: 'restaurant', label: 'Kitchen Display', route: '/restaurant/kds', permission: 'kds.view' },
      { id: 'menu', menu: 'restaurant', label: 'Menu', route: '/restaurant/menu', permission: 'restaurant.table_manage' },
      { id: 'restaurant-reports', menu: 'restaurant', label: 'Reports & Day Close', route: '/restaurant/reports', permission: 'report.view' },
      { id: 'restaurant-numbering', menu: 'users', label: 'Bill Numbering', route: '/restaurant/numbering', permission: 'settings.manage' },
    ],
    quickCreate: [{ id: 'table-order', label: 'Table Order', route: '/restaurant/tables', icon: 'ChefHat', permission: 'restaurant.order' }],
    reports: [{ id: 'restaurant-day-close', label: 'Restaurant day close', category: 'Restaurant', route: '/restaurant/reports' }],
    onboarding: [
      { id: 'floors', title: 'Create floors & tables', route: '/restaurant/tables' },
      { id: 'menu', title: 'Add your menu', route: '/restaurant/menu' },
    ],
  },
  {
    key: 'online_orders',
    name: 'Online Orders (Swiggy / Zomato)',
    icon: 'Bike',
    tagline: 'Swiggy, Zomato and QR table orders straight into your KOT.',
    description: 'Aggregator orders via UrbanPiper land in one screen with auto-KOT, item on/off sync, rider status and payout reconciliation.',
    features: ['Swiggy & Zomato via UrbanPiper', 'Auto-accept & auto-KOT', 'Item stock on/off sync', 'QR table ordering', 'Payout reconciliation'],
    priceMonthlyPaise: P(499),
    priceYearlyPaise: P(4990),
    isCore: false,
    requires: ['restaurant'],
    apiPrefixes: ['/online-orders'],
    routePrefixes: ['/restaurant/online-orders'],
    nav: [{ id: 'online-orders', menu: 'restaurant', label: 'Online Orders', route: '/restaurant/online-orders', permission: 'restaurant.order' }],
    quickCreate: [],
    reports: [{ id: 'aggregator-payouts', label: 'Aggregator payouts', category: 'Restaurant', route: '/restaurant/online-orders?tab=reconciliation' }],
    onboarding: [{ id: 'aggregator', title: 'Connect Swiggy / Zomato', route: '/restaurant/online-orders?tab=settings' }],
  },
  {
    key: 'accounting_pro',
    name: 'Accounting Pro',
    icon: 'Landmark',
    tagline: 'Bank reconciliation, GST returns, TDS, Tally export and period lock.',
    description: 'Accountant-grade tools: bank statement import with auto-match, cheque register, TDS/TCS, GSTR-1/3B/2B reconciliation, Tally XML export, fixed assets and period lock.',
    features: ['Bank reconciliation (CSV/XLSX/PDF import, auto-match)', 'GSTR-1, GSTR-3B & 2B reconciliation', 'TDS / TCS register', 'Cheque management', 'Tally XML export', 'Fixed assets & depreciation', 'Period lock & year-end close'],
    priceMonthlyPaise: P(599),
    priceYearlyPaise: P(5990),
    isCore: false,
    requires: [],
    apiPrefixes: [
      '/accounting/bank-recon', '/accounting/cheques', '/accounting/tds', '/accounting/gst', '/accounting/tally-xml',
      '/accounting/period-lock', '/accounting/lock-gst-month', '/accounting/year-end-close', '/accounting/fixed-assets',
      '/accounting/cost-centres', '/accounting/advances', '/accounting/inventory-valuation',
    ],
    routePrefixes: [
      '/accounting/bank-recon', '/accounting/cheques', '/accounting/tds', '/accounting/gst-returns', '/accounting/tally-export',
      '/accounting/period-lock', '/accounting/fixed-assets',
    ],
    nav: [
      { id: 'bank-recon', menu: 'accounting', label: 'Bank Reconciliation', route: '/accounting/bank-recon', permission: 'accounting.manage' },
      { id: 'gst-returns', menu: 'accounting', label: 'GST Returns', route: '/accounting/gst-returns', permission: 'report.accounting' },
      { id: 'cheques', menu: 'accounting', label: 'Cheques', route: '/accounting/cheques', permission: 'accounting.manage' },
      { id: 'tds', menu: 'accounting', label: 'TDS / TCS', route: '/accounting/tds', permission: 'accounting.manage' },
      { id: 'fixed-assets', menu: 'accounting', label: 'Fixed Assets', route: '/accounting/fixed-assets', permission: 'accounting.manage' },
      { id: 'tally', menu: 'accounting', label: 'Tally Export', route: '/accounting/tally-export', permission: 'report.accounting' },
      { id: 'period-lock', menu: 'accounting', label: 'Period Lock', route: '/accounting/period-lock', permission: 'accounting.manage' },
    ],
    quickCreate: [{ id: 'journal', label: 'Journal Voucher', route: '/accounting/journals?new=1', icon: 'BookOpen', permission: 'accounting.manage' }],
    reports: [
      { id: 'tds-report', label: 'TDS report', category: 'Accounts', route: '/accounting/tds' },
      { id: 'gstr2b', label: 'GSTR-2B reconciliation', category: 'GST', route: '/accounting/gst-returns?tab=2b' },
    ],
    onboarding: [{ id: 'bank-recon', title: 'Import your first bank statement', route: '/accounting/bank-recon' }],
  },
  {
    key: 'compliance',
    name: 'E-Invoice & E-Way Bill',
    icon: 'ShieldCheck',
    tagline: 'One-click IRN e-invoices and e-way bills from your invoices.',
    description: 'Generate IRN + signed QR e-invoices and e-way bills directly from invoices and challans through a GST Suvidha Provider, cancel within 24h, and track validity.',
    features: ['E-invoice IRN & signed QR', 'E-way bill generation & extension', 'Bulk generation', 'Auto from invoices & challans', 'Cancel within 24 hours'],
    priceMonthlyPaise: P(399),
    priceYearlyPaise: P(3990),
    isCore: false,
    requires: [],
    apiPrefixes: ['/einvoice'],
    routePrefixes: ['/sales/e-invoices', '/e-way-bills'],
    nav: [
      { id: 'e-invoices', menu: 'sales', label: 'E-Invoices', route: '/sales/e-invoices', permission: 'invoice.view' },
      { id: 'e-way-bills', menu: 'compliance', label: 'E-Way Bills', route: '/e-way-bills', permission: 'invoice.view' },
    ],
    quickCreate: [],
    reports: [],
    onboarding: [{ id: 'gsp', title: 'Connect e-invoice credentials', route: '/integrations?focus=gsp' }],
  },
  {
    key: 'projects',
    name: 'Projects & Timesheets',
    icon: 'FolderKanban',
    tagline: 'Track projects, tasks, hours and bill clients from timesheets.',
    description: 'Projects per customer with tasks, timesheets, billable hours and expenses, budget vs actual, and one-click invoice from unbilled time.',
    features: ['Projects per customer', 'Tasks & timesheets', 'Billable hours & expenses', 'Budget vs actual', 'Invoice from project'],
    priceMonthlyPaise: P(299),
    priceYearlyPaise: P(2990),
    isCore: false,
    requires: [],
    apiPrefixes: ['/projects'],
    routePrefixes: ['/projects'],
    nav: [
      { id: 'projects', menu: 'projects', label: 'Projects', route: '/projects', permission: 'invoice.view' },
      { id: 'timesheets', menu: 'projects', label: 'Timesheets', route: '/projects/timesheets', permission: 'invoice.view' },
    ],
    quickCreate: [{ id: 'project', label: 'Project', route: '/projects?new=1', icon: 'FolderKanban', permission: 'invoice.create' }],
    reports: [{ id: 'project-profit', label: 'Project profitability', category: 'Projects', route: '/projects?view=profitability' }],
    onboarding: [{ id: 'project', title: 'Create your first project', route: '/projects?new=1' }],
  },
  {
    key: 'crm',
    name: 'CRM & Loyalty',
    icon: 'TrendingUp',
    tagline: 'Leads, deals pipeline, loyalty points and WhatsApp campaigns.',
    description: 'Capture leads, move deals through a pipeline, run loyalty and gift cards, send WhatsApp/SMS campaigns with opt-out, and collect feedback.',
    features: ['Leads & deals pipeline', 'Activities & follow-ups', 'Loyalty points & gift cards', 'WhatsApp / SMS campaigns', 'Customer feedback & NPS'],
    priceMonthlyPaise: P(499),
    priceYearlyPaise: P(4990),
    isCore: false,
    requires: [],
    apiPrefixes: ['/crm'],
    routePrefixes: ['/crm'],
    nav: [
      { id: 'crm-pipeline', menu: 'crm', label: 'Pipeline', route: '/crm/pipeline', permission: 'party.view' },
      { id: 'crm-leads', menu: 'crm', label: 'Leads', route: '/crm/leads', permission: 'party.view' },
      { id: 'crm-followups', menu: 'crm', label: 'Follow-ups', route: '/crm/follow-ups', permission: 'party.view' },
      { id: 'crm-tickets', menu: 'crm', label: 'Support Tickets', route: '/crm/tickets', permission: 'party.view' },
      { id: 'crm-forecast', menu: 'crm', label: 'Overview & Forecast', route: '/crm', permission: 'party.view' },
      { id: 'crm-loyalty', menu: 'crm', label: 'Loyalty & Gift Cards', route: '/crm/loyalty', permission: 'party.view' },
      { id: 'crm-campaigns', menu: 'crm', label: 'Campaigns', route: '/crm/campaigns', permission: 'party.manage' },
      { id: 'crm-feedback', menu: 'crm', label: 'Feedback', route: '/crm/feedback', permission: 'party.view' },
    ],
    quickCreate: [{ id: 'lead', label: 'Lead', route: '/crm/leads?new=1', icon: 'Contact', permission: 'party.manage' }],
    reports: [],
    onboarding: [{ id: 'lead', title: 'Add your first lead', route: '/crm/leads?new=1' }],
  },
  {
    key: 'hr_payroll',
    name: 'HR & Payroll',
    icon: 'UserCog',
    tagline: 'Staff, attendance, leave and payroll with PF, ESI and PT.',
    description: 'Employee directory, attendance, leave, salary structures and monthly payroll with PF/ESI/PT, payslips and bank transfer files.',
    features: ['Employee directory', 'Attendance & leave', 'Payroll with PF / ESI / PT', 'Payslips & salary advances', 'Bank transfer export'],
    priceMonthlyPaise: P(499),
    priceYearlyPaise: P(4990),
    isCore: false,
    requires: [],
    apiPrefixes: ['/hr'],
    routePrefixes: ['/hr'],
    nav: [
      { id: 'hr-staff', menu: 'hr', label: 'Employees', route: '/hr', permission: 'user.manage' },
      { id: 'hr-attendance', menu: 'hr', label: 'Attendance', route: '/hr/attendance', permission: 'user.manage' },
      { id: 'hr-leaves', menu: 'hr', label: 'Leaves', route: '/hr/leaves', permission: 'user.manage' },
      { id: 'hr-payroll', menu: 'hr', label: 'Payroll', route: '/hr/payroll', permission: 'user.manage' },
    ],
    quickCreate: [{ id: 'employee', label: 'Employee', route: '/hr?new=1', icon: 'UserCog', permission: 'user.manage' }],
    reports: [{ id: 'payroll-register', label: 'Payroll register', category: 'HR', route: '/hr/payroll' }],
    onboarding: [{ id: 'employee', title: 'Add your employees', route: '/hr?new=1' }],
  },
  {
    key: 'manufacturing',
    name: 'Manufacturing',
    icon: 'Factory',
    tagline: 'Bill of materials, production orders, job work and costing.',
    description: 'Multi-level BOMs, production orders that consume raw material and cost finished goods, job work, wastage and MRP-lite shortages.',
    features: ['Multi-level BOM', 'Production orders & costing', 'Job work in/out', 'Wastage tracking', 'Raw material shortage planning'],
    priceMonthlyPaise: P(699),
    priceYearlyPaise: P(6990),
    isCore: false,
    requires: ['inventory'],
    apiPrefixes: ['/mfg'],
    routePrefixes: ['/mfg'],
    nav: [
      { id: 'mfg-boms', menu: 'manufacturing', label: 'Bill of Materials', route: '/mfg/boms', permission: 'stock.adjust' },
      { id: 'mfg-orders', menu: 'manufacturing', label: 'Production Orders', route: '/mfg/orders', permission: 'stock.adjust' },
      { id: 'mfg-job-work', menu: 'manufacturing', label: 'Job Work', route: '/mfg/job-work', permission: 'stock.adjust' },
      { id: 'mfg-mrp', menu: 'manufacturing', label: 'Material Planning', route: '/mfg/mrp-lite', permission: 'stock.view' },
      { id: 'mfg-costing', menu: 'manufacturing', label: 'Costing', route: '/mfg/costing', permission: 'stock.view' },
    ],
    quickCreate: [{ id: 'production', label: 'Production Order', route: '/mfg/orders?new=1', icon: 'Factory', permission: 'stock.adjust' }],
    reports: [],
    onboarding: [{ id: 'bom', title: 'Create a bill of materials', route: '/mfg/boms' }],
  },
  {
    key: 'multi_branch',
    name: 'Multi-Branch',
    icon: 'Building2',
    tagline: 'Run many outlets with separate series, stock and staff access.',
    description: 'Add branches with their own GSTIN, document series, warehouses and staff access, and compare branch performance.',
    features: ['Unlimited branches', 'GSTIN & series per branch', 'Branch-wise stock & staff', 'Branch comparison reports'],
    priceMonthlyPaise: P(799),
    priceYearlyPaise: P(7990),
    isCore: false,
    requires: [],
    apiPrefixes: ['/settings/branches'],
    routePrefixes: ['/settings/branches'],
    nav: [],
    quickCreate: [],
    reports: [{ id: 'branch-compare', label: 'Branch comparison', category: 'Sales', route: '/reports/sales?by=branch' }],
    onboarding: [{ id: 'branch', title: 'Add your branches', route: '/settings/branches' }],
  },
  {
    key: 'integrations',
    name: 'Integrations & API',
    icon: 'Plug',
    tagline: 'Webhooks, API keys, Tally sync, Shiprocket and Google Sheets.',
    description: 'Connect GexGrow to other tools: REST API keys, outgoing webhooks, Tally sync, Shiprocket, Google Sheets export and Zapier-style automations.',
    features: ['REST API keys', 'Outgoing webhooks', 'Tally sync', 'Shiprocket & Google Sheets', 'Approval workflows & custom fields'],
    priceMonthlyPaise: P(299),
    priceYearlyPaise: P(2990),
    isCore: false,
    requires: [],
    apiPrefixes: ['/platform/keys', '/platform/approvals', '/platform/custom-fields', '/platform/migrate', '/integrations/webhooks'],
    routePrefixes: ['/integrations/developer'],
    nav: [],
    quickCreate: [],
    reports: [],
    onboarding: [],
  },
];

export const MODULE_MAP: Record<ModuleKey, ModuleDef> = Object.fromEntries(MODULES.map((m) => [m.key, m])) as Record<
  ModuleKey,
  ModuleDef
>;

export function isModuleKey(v: string): v is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(v);
}

/** Legacy codes used by the first build, mapped to the new keys. */
const LEGACY_ALIASES: Record<string, ModuleKey> = {
  retail_pos: 'pos_retail',
  pos: 'pos_retail',
  core_billing: 'billing',
  purchases: 'billing',
  accounting: 'billing',
  mfg: 'manufacturing',
  einvoice: 'compliance',
};

/** Normalise a stored module list: map legacy codes, drop unknowns, always include billing, add dependencies. */
export function normalizeModules(input: readonly string[] | null | undefined): ModuleKey[] {
  const out = new Set<ModuleKey>([CORE_MODULE]);
  for (const raw of input ?? []) {
    const k = isModuleKey(raw) ? raw : LEGACY_ALIASES[raw];
    if (k) out.add(k);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const k of [...out]) {
      for (const dep of MODULE_MAP[k].requires) {
        if (!out.has(dep)) {
          out.add(dep);
          changed = true;
        }
      }
    }
  }
  return MODULE_KEYS.filter((k) => out.has(k));
}

function longestPrefixOwner(path: string, pick: (m: ModuleDef) => string[]): ModuleKey | null {
  let best: { key: ModuleKey; len: number } | null = null;
  for (const m of MODULES) {
    for (const prefix of pick(m)) {
      const hit = prefix === '/' ? path === '/' : path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
      if (hit && (!best || prefix.length > best.len)) best = { key: m.key, len: prefix.length };
    }
  }
  return best?.key ?? null;
}

/** Module that owns an API path. `path` is relative to `/api` (e.g. `/pos/checkout`). */
export function moduleForApiPath(path: string): ModuleKey | null {
  return longestPrefixOwner(path, (m) => m.apiPrefixes);
}

/** Module that owns an app route (e.g. `/restaurant/tables`). Unknown routes belong to billing. */
export function moduleForRoute(path: string): ModuleKey {
  return longestPrefixOwner(path, (m) => m.routePrefixes) ?? CORE_MODULE;
}

export interface Visibility {
  modules: readonly ModuleKey[];
  /** User permission codes; '*' = all. */
  permissions: readonly string[];
}

function permitted(perm: string | undefined, permissions: readonly string[]): boolean {
  return !perm || permissions.includes('*') || permissions.includes(perm);
}

export interface BuiltMenu extends MenuDef {
  items: NavItem[];
}

/** Sidebar menus for this business + user. Only enabled modules and permitted items appear. */
export function buildNavigation(v: Visibility): BuiltMenu[] {
  const enabled = new Set(v.modules);
  const items = MODULES.filter((m) => enabled.has(m.key)).flatMap((m) => m.nav).filter((n) => permitted(n.permission, v.permissions));
  return MENUS.map((menu) => ({ ...menu, items: items.filter((i) => i.menu === menu.id) }))
    .filter((m) => m.items.length > 0)
    .sort((a, b) => a.order - b.order);
}

export function buildQuickCreate(v: Visibility): QuickCreate[] {
  const enabled = new Set(v.modules);
  return MODULES.filter((m) => enabled.has(m.key)).flatMap((m) => m.quickCreate).filter((q) => permitted(q.permission, v.permissions));
}

export function buildReports(v: Visibility) {
  const enabled = new Set(v.modules);
  return MODULES.filter((m) => enabled.has(m.key)).flatMap((m) => m.reports);
}

export function buildOnboarding(modules: readonly ModuleKey[]) {
  const enabled = new Set(modules);
  return MODULES.filter((m) => enabled.has(m.key)).flatMap((m) => m.onboarding.map((o) => ({ ...o, module: m.key })));
}

// ---------------------------------------------------------------------------
// Workspaces — Module Home shows one card per workspace; opening a card shows ONLY that workspace's
// navigation. A workspace groups a main module with its add-ons (e.g. Restaurant + Online Orders).
// ---------------------------------------------------------------------------
export const WORKSPACE_KEYS = [
  'billing', 'pos_retail', 'restaurant', 'inventory', 'crm', 'hr_payroll', 'manufacturing', 'projects',
] as const;
export type WorkspaceKey = (typeof WORKSPACE_KEYS)[number];

/** Master lists shared across workspaces (one list per business). */
export const SHARED_LISTS = ['customers', 'vendors', 'products'] as const;
export type SharedList = (typeof SHARED_LISTS)[number];
export type ShareLevel = 'none' | 'view' | 'add' | 'edit';
export const SHARE_LEVELS: readonly ShareLevel[] = ['none', 'view', 'add', 'edit'];
export type DataSharing = Record<WorkspaceKey, Record<SharedList, ShareLevel>>;

export interface WorkspaceDef {
  key: WorkspaceKey;
  name: string;
  icon: IconName;
  tagline: string;
  /** Card accent colour (hex). */
  accent: string;
  /** Route opened when the card is clicked. */
  home: string;
  /** Module whose purchase unlocks the workspace. */
  primary: ModuleKey;
  /** Modules whose nav items appear inside this workspace (only the enabled ones). */
  modules: ModuleKey[];
  /** Route of this workspace's Users & Roles page. */
  usersRoute: string;
  /** Routes where this workspace shows the shared master lists (when Master Admin allows). */
  listRoutes: Partial<Record<SharedList, string>>;
  /** Route prefixes that belong to this workspace even though another module owns them. */
  extraPrefixes: string[];
}

export const WORKSPACES: WorkspaceDef[] = [
  {
    key: 'billing', name: 'Billing & Accounting', icon: 'FileText', accent: '#FF7A1A', home: '/dashboard', primary: 'billing',
    tagline: 'Invoices, quotations, purchases, payments, GST and books',
    modules: ['billing', 'compliance', 'accounting_pro', 'inventory', 'multi_branch', 'integrations'],
    usersRoute: '/users', listRoutes: {}, extraPrefixes: [],
  },
  {
    key: 'pos_retail', name: 'Retail POS', icon: 'Store', accent: '#3B82F6', home: '/pos', primary: 'pos_retail',
    tagline: 'Fast counter billing, customers, products and shifts',
    modules: ['pos_retail'],
    usersRoute: '/pos/users', listRoutes: { customers: '/pos/customers', products: '/pos/products' },
    extraPrefixes: ['/settings/offline'],
  },
  {
    key: 'restaurant', name: 'Restaurant', icon: 'UtensilsCrossed', accent: '#E5484D', home: '/restaurant/tables', primary: 'restaurant',
    tagline: 'Tables, KOT, kitchen display, menu, Swiggy & Zomato',
    modules: ['restaurant', 'online_orders'],
    usersRoute: '/restaurant/users', listRoutes: { customers: '/restaurant/customers', products: '/restaurant/products' },
    extraPrefixes: ['/kds'],
  },
  {
    key: 'inventory', name: 'Inventory', icon: 'Warehouse', accent: '#12B76A', home: '/inventory/stock', primary: 'inventory',
    tagline: 'Stock, warehouses, batches, transfers and barcodes',
    modules: ['inventory'],
    usersRoute: '/inventory/users', listRoutes: { products: '/inventory/products', vendors: '/inventory/vendors' },
    extraPrefixes: [],
  },
  {
    key: 'crm', name: 'CRM & Loyalty', icon: 'TrendingUp', accent: '#8B5CF6', home: '/crm/pipeline', primary: 'crm',
    tagline: 'Leads, pipeline, loyalty and WhatsApp campaigns',
    modules: ['crm'],
    usersRoute: '/crm/users', listRoutes: { customers: '/crm/customers' }, extraPrefixes: [],
  },
  {
    key: 'hr_payroll', name: 'HR & Payroll', icon: 'UserCog', accent: '#0EA5E9', home: '/hr', primary: 'hr_payroll',
    tagline: 'Employees, attendance, leave and payroll',
    modules: ['hr_payroll'],
    usersRoute: '/hr/users', listRoutes: {}, extraPrefixes: [],
  },
  {
    key: 'manufacturing', name: 'Manufacturing', icon: 'Factory', accent: '#F5A524', home: '/mfg/boms', primary: 'manufacturing',
    tagline: 'BOM, production orders, job work and costing',
    modules: ['manufacturing'],
    usersRoute: '/mfg/users', listRoutes: { products: '/mfg/products' }, extraPrefixes: [],
  },
  {
    key: 'projects', name: 'Projects', icon: 'FolderKanban', accent: '#14B8A6', home: '/projects', primary: 'projects',
    tagline: 'Projects, tasks, timesheets and project billing',
    modules: ['projects'],
    usersRoute: '/projects/users', listRoutes: { customers: '/projects/customers' }, extraPrefixes: [],
  },
];

export const WORKSPACE_MAP: Record<WorkspaceKey, WorkspaceDef> = Object.fromEntries(WORKSPACES.map((w) => [w.key, w])) as Record<
  WorkspaceKey,
  WorkspaceDef
>;

export function isWorkspaceKey(v: string): v is WorkspaceKey {
  return (WORKSPACE_KEYS as readonly string[]).includes(v);
}

/** Default sharing: Billing owns the master lists; other workspaces get what they usually need. */
export function defaultDataSharing(): DataSharing {
  return {
    billing: { customers: 'edit', vendors: 'edit', products: 'edit' },
    pos_retail: { customers: 'add', vendors: 'none', products: 'add' },
    restaurant: { customers: 'add', vendors: 'none', products: 'add' },
    inventory: { customers: 'none', vendors: 'view', products: 'edit' },
    crm: { customers: 'edit', vendors: 'none', products: 'none' },
    hr_payroll: { customers: 'none', vendors: 'none', products: 'none' },
    manufacturing: { customers: 'none', vendors: 'none', products: 'view' },
    projects: { customers: 'view', vendors: 'none', products: 'none' },
  };
}

/** Merge a stored (possibly partial / untrusted) sharing config over the defaults. Billing always keeps full edit. */
export function normalizeDataSharing(input: unknown): DataSharing {
  const out = defaultDataSharing();
  if (input && typeof input === 'object') {
    for (const ws of WORKSPACE_KEYS) {
      const row = (input as Record<string, unknown>)[ws];
      if (!row || typeof row !== 'object') continue;
      for (const list of SHARED_LISTS) {
        const lvl = (row as Record<string, unknown>)[list];
        if (typeof lvl === 'string' && (SHARE_LEVELS as readonly string[]).includes(lvl)) out[ws][list] = lvl as ShareLevel;
      }
    }
  }
  out.billing = { customers: 'edit', vendors: 'edit', products: 'edit' };
  return out;
}

const routeHit = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** Routes shared by every workspace (they keep whichever workspace the user is in). */
const NEUTRAL_PREFIXES = ['/settings', '/subscription', '/upgrade', '/admin-center', '/reports'];

/**
 * Workspace for a route. `/` (Module Home) → null. Neutral routes keep `current`.
 * Otherwise the route's owning module decides, preferring `current` when it contains that module.
 */
export function workspaceForRoute(path: string, current: WorkspaceKey | null = null): WorkspaceKey | null {
  if (path === '/') return null;
  for (const w of WORKSPACES) {
    if (w.usersRoute !== '/users' && routeHit(path, w.usersRoute)) return w.key;
    if (Object.values(w.listRoutes).some((r) => r !== undefined && routeHit(path, r))) return w.key;
    if (w.extraPrefixes.some((p) => routeHit(path, p))) return w.key;
  }
  if (NEUTRAL_PREFIXES.some((p) => routeHit(path, p))) return current ?? 'billing';
  const owner = moduleForRoute(path);
  if (current && WORKSPACE_MAP[current].modules.includes(owner)) return current;
  return (WORKSPACES.find((w) => w.primary === owner) ?? WORKSPACES.find((w) => w.modules.includes(owner)))?.key ?? 'billing';
}

/** Workspaces whose primary module the business has bought. */
export function enabledWorkspaces(modules: readonly ModuleKey[]): WorkspaceDef[] {
  return WORKSPACES.filter((w) => modules.includes(w.primary));
}

/** Workspace a list route belongs to, plus the access level Master Admin granted there. */
export function sharedListAccess(path: string, sharing: DataSharing): { workspace: WorkspaceKey; list: SharedList; level: ShareLevel } | null {
  for (const w of WORKSPACES) {
    for (const list of SHARED_LISTS) {
      const r = w.listRoutes[list];
      if (r !== undefined && routeHit(path, r)) return { workspace: w.key, list, level: sharing[w.key][list] };
    }
  }
  return null;
}

const LIST_LABEL: Record<SharedList, { label: string; menu: MenuId; perm: string }> = {
  customers: { label: 'Customers', menu: 'customers', perm: 'party.view' },
  vendors: { label: 'Vendors', menu: 'vendors', perm: 'party.view' },
  products: { label: 'Products', menu: 'items', perm: 'item.view' },
};

export interface WorkspaceVisibility extends Visibility {
  sharing?: DataSharing;
}

/** Sidebar for ONE workspace: its modules' items + shared lists Master Admin allows + Users & Roles. */
export function buildWorkspaceNavigation(ws: WorkspaceKey, v: WorkspaceVisibility): BuiltMenu[] {
  const def = WORKSPACE_MAP[ws];
  const enabled = new Set(v.modules.filter((m) => def.modules.includes(m)));
  const items: NavItem[] = MODULES.filter((m) => enabled.has(m.key)).flatMap((m) => m.nav);
  const sharing = v.sharing ?? defaultDataSharing();
  for (const list of SHARED_LISTS) {
    const route = def.listRoutes[list];
    if (route !== undefined && sharing[ws][list] !== 'none') {
      const l = LIST_LABEL[list];
      items.push({ id: `${ws}-${list}`, menu: l.menu, label: l.label, route, permission: l.perm });
    }
  }
  items.push({ id: `${ws}-users`, menu: 'users', label: 'Users & Roles', route: def.usersRoute, permission: 'user.manage' });
  const visible = items.filter((n) => permitted(n.permission, v.permissions));
  return MENUS.map((menu) => ({ ...menu, items: visible.filter((i) => i.menu === menu.id) }))
    .filter((m) => m.items.length > 0)
    .sort((a, b) => a.order - b.order);
}

/** + New menu for ONE workspace. */
export function buildWorkspaceQuickCreate(ws: WorkspaceKey, v: Visibility): QuickCreate[] {
  const def = WORKSPACE_MAP[ws];
  return buildQuickCreate({ modules: v.modules.filter((m) => def.modules.includes(m)), permissions: v.permissions });
}

// ---------------------------------------------------------------------------
// Business types & recommended presets (signup step "Choose modules")
// ---------------------------------------------------------------------------
export const BUSINESS_TYPES = [
  { id: 'RETAIL', label: 'Retail shop / Kirana', recommended: ['billing', 'inventory', 'pos_retail'] },
  { id: 'WHOLESALE', label: 'Wholesale / Distributor', recommended: ['billing', 'inventory', 'compliance', 'accounting_pro'] },
  { id: 'RESTAURANT', label: 'Restaurant / Café / Cloud kitchen', recommended: ['billing', 'restaurant', 'online_orders', 'inventory'] },
  { id: 'SERVICES', label: 'Services / Agency / Consultant', recommended: ['billing', 'projects', 'crm'] },
  { id: 'MANUFACTURING', label: 'Manufacturer', recommended: ['billing', 'inventory', 'manufacturing', 'compliance'] },
  { id: 'PHARMACY', label: 'Pharmacy / Medical store', recommended: ['billing', 'inventory', 'pos_retail'] },
  { id: 'OTHER', label: 'Other business', recommended: ['billing'] },
] as const satisfies readonly { id: string; label: string; recommended: readonly ModuleKey[] }[];

export type BusinessType = (typeof BUSINESS_TYPES)[number]['id'];

export function recommendedModules(type: string): ModuleKey[] {
  const t = BUSINESS_TYPES.find((b) => b.id === type);
  return normalizeModules(t ? [...t.recommended] : [CORE_MODULE]);
}

// ---------------------------------------------------------------------------
// Pricing (pure maths, integer paise)
// ---------------------------------------------------------------------------
export type BillingInterval = 'monthly' | 'yearly';

export interface ModulePrice {
  key: ModuleKey;
  monthlyPaise: number;
  yearlyPaise: number;
}

export function defaultPrices(): ModulePrice[] {
  return MODULES.map((m) => ({ key: m.key, monthlyPaise: m.priceMonthlyPaise, yearlyPaise: m.priceYearlyPaise }));
}

export interface PriceQuote {
  modules: { key: ModuleKey; name: string; pricePaise: number }[];
  interval: BillingInterval;
  subtotalPaise: number;
  discountPaise: number;
  taxablePaise: number;
  /** 18% GST on SaaS (CGST+SGST if buyer state == seller state, else IGST). */
  gstPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  /** Yearly saving vs paying 12 × monthly. */
  yearlySavingPaise: number;
}

export const SAAS_GST_RATE_BP = 1800;
export const GEXART_STATE_CODE = '19';

/** Rounds half-up to whole paise. Inputs are integers so this is exact integer maths. */
function pct(amountPaise: number, basisPoints: number): number {
  return Math.floor((amountPaise * basisPoints + 5000) / 10000);
}

export function quoteModules(opts: {
  modules: readonly string[];
  interval: BillingInterval;
  prices?: readonly ModulePrice[];
  buyerStateCode?: string;
  discountPaise?: number;
}): PriceQuote {
  const keys = normalizeModules(opts.modules);
  const prices = new Map((opts.prices ?? defaultPrices()).map((p) => [p.key, p]));
  const lines = keys.map((k) => {
    const p = prices.get(k) ?? defaultPrices().find((d) => d.key === k)!;
    return { key: k, name: MODULE_MAP[k].name, pricePaise: opts.interval === 'yearly' ? p.yearlyPaise : p.monthlyPaise };
  });
  const subtotalPaise = lines.reduce((s, l) => s + l.pricePaise, 0);
  const discountPaise = Math.min(Math.max(0, Math.trunc(opts.discountPaise ?? 0)), subtotalPaise);
  const taxablePaise = subtotalPaise - discountPaise;
  const intra = (opts.buyerStateCode ?? GEXART_STATE_CODE) === GEXART_STATE_CODE;
  const gstPaise = pct(taxablePaise, SAAS_GST_RATE_BP);
  const cgstPaise = intra ? Math.floor(gstPaise / 2) : 0;
  const sgstPaise = intra ? gstPaise - cgstPaise : 0;
  const igstPaise = intra ? 0 : gstPaise;
  const monthlyTotal = keys.reduce((s, k) => s + (prices.get(k)?.monthlyPaise ?? MODULE_MAP[k].priceMonthlyPaise), 0);
  const yearlyTotal = keys.reduce((s, k) => s + (prices.get(k)?.yearlyPaise ?? MODULE_MAP[k].priceYearlyPaise), 0);
  return {
    modules: lines,
    interval: opts.interval,
    subtotalPaise,
    discountPaise,
    taxablePaise,
    gstPaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    totalPaise: taxablePaise + gstPaise,
    yearlySavingPaise: Math.max(0, monthlyTotal * 12 - yearlyTotal),
  };
}

export const DEFAULT_TRIAL_DAYS = 14;
/** Days after expiry during which the business is read-only (data visible + exportable) before full lock. */
export const READ_ONLY_GRACE_DAYS = 15;

export type AccessMode = 'full' | 'read_only' | 'locked' | 'none';

/** Access mode from a subscription's status and period end. */
export function accessModeFor(sub: { status: string; currentPeriodEnd: string | null } | null, now = new Date()): AccessMode {
  if (!sub) return 'none';
  if (sub.status === 'SUSPENDED') return 'locked';
  if (!sub.currentPeriodEnd) return 'full';
  const end = new Date(sub.currentPeriodEnd).getTime();
  if (Number.isNaN(end) || now.getTime() <= end) return 'full';
  const daysPast = (now.getTime() - end) / 86_400_000;
  return daysPast <= READ_ONLY_GRACE_DAYS ? 'read_only' : 'locked';
}
