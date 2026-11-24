export const PERMISSIONS = [
  // Invoices & Billing
  'invoice.view',
  'invoice.create',
  'invoice.edit',
  'invoice.cancel',
  'invoice.delete_draft',
  'invoice.print',
  'invoice.share',
  'payment.record',

  // POS
  'pos.use',
  'pos.discount',
  'pos.price_override',
  'pos.shift_manage',

  // Restaurant
  'restaurant.order',
  'restaurant.kot',
  'restaurant.settle',
  'restaurant.cancel_item',
  'restaurant.table_manage',
  'kds.view',
  'kds.manage',

  // Inventory & Stock
  'item.view',
  'item.manage',
  'stock.view',
  'stock.adjust',
  'stock.transfer',

  // Purchases & Expenses
  'purchase.view',
  'purchase.manage',
  'expense.view',
  'expense.manage',

  // Parties (Customers & Vendors)
  'party.view',
  'party.manage',

  // Accounting & Reports
  'report.view',
  'report.accounting',
  'accounting.manage',

  // Settings & Admin
  'settings.manage',
  'user.manage',
  'branch.manage',
  'subscription.manage',
  'business.delete',
] as const;

export const ALL_PERMISSIONS: readonly string[] = PERMISSIONS;
export type Permission = (typeof PERMISSIONS)[number];


export const SYSTEM_ROLES = {
  SUPER_ADMIN: 'Super Admin',
  SUPPORT: 'Gexart Support',
  OWNER: 'Business Owner',
  BRANCH_MANAGER: 'Branch Manager',
  CASHIER: 'Cashier',
  WAITER: 'Waiter/Captain',
  KITCHEN: 'Kitchen Staff',
  INVENTORY_MANAGER: 'Inventory Manager',
  ACCOUNTANT: 'Accountant',
  HR_MANAGER: 'HR Manager',
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

