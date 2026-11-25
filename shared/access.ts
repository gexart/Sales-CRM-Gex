/**
 * Billing, finance and accounting access control.
 * A user has ONE billing role (a named bundle of permissions) plus optional per-user extras and denials.
 * CRM administrators always have every permission. Everything not listed here is denied.
 */

export interface PermissionDef {
  key: string;
  label: string;
  group: string;
}

const P = (group: string, items: Array<[string, string]>): PermissionDef[] => items.map(([key, label]) => ({ key, label, group }));

export const PERMISSIONS: PermissionDef[] = [
  ...P("Access", [["billing.access", "Open the billing area"]]),
  ...P("Quotations & proforma", [
    ["quotation.create", "Create quotations"],
    ["proforma.create", "Create proforma invoices"],
    ["sales_order.create", "Create sales orders"],
    ["challan.create", "Create delivery challans / packing lists"],
    ["documents.view", "View quotations, proforma, orders and challans"],
    ["documents.edit", "Change status of those documents"],
    ["documents.convert", "Convert documents (e.g. quotation to proforma or order)"],
  ]),
  ...P("Sales invoices", [
    ["invoice.view", "View sales invoices"],
    ["invoice.view_all", "View invoices created by other people"],
    ["invoice.request", "Request a sales invoice (needs approval before it exists)"],
    ["invoice.create", "Create sales invoices directly"],
    ["invoice.approve", "Approve or reject requested invoices"],
    ["invoice.cancel", "Cancel sales invoices"],
    ["invoice.edit", "Edit sales invoices that have no payments"],
    ["invoice.delete", "Delete sales invoices and free their bill number"],
    ["payment.remove", "Remove recorded payments"],
    ["invoice.credit_note", "Issue credit notes"],
    ["payment.receive", "Record payments received"],
  ]),
  ...P("Purchases & expenses", [
    ["purchases.view", "View purchases"],
    ["purchases.create", "Create purchase bills and debit notes"],
    ["purchase_order.create", "Create purchase orders"],
    ["payment.pay", "Record payments made to vendors"],
    ["expenses.view", "View expenses"],
    ["expenses.create", "Record expenses"],
  ]),
  ...P("Parties, items & stock", [
    ["parties.view", "View customers and vendors"],
    ["parties.manage", "Add, edit and delete customers and vendors"],
    ["items.view", "View products and services"],
    ["items.manage", "Add, edit and delete products and services"],
    ["items.view_cost", "See purchase cost and margins"],
    ["banks.manage", "Manage bank and cash accounts"],
    ["inventory.view", "View stock"],
    ["inventory.manage", "Transfers, adjustments, batches"],
  ]),
  ...P("Money & reports", [
    ["collections.view", "View payments and collections"],
    ["sales_analysis.view", "See sales totals, counts and analysis"],
    ["reports.view", "View financial and GST reports"],
    ["accounting.view", "View ledgers, trial balance, cheques, assets"],
    ["accounting.post", "Post vouchers, journals, reconciliation, TDS"],
    ["accounting.close", "Opening balances, period lock, year-end close"],
    ["accounting.export", "Export accounting data (Tally)"],
    ["einvoice.manage", "Generate e-invoice and e-way bills"],
  ]),
  ...P("Administration", [
    ["settings.view", "View billing settings"],
    ["settings.manage", "Change billing settings and numbering"],
    ["roles.manage", "Create roles and assign them to users"],
    ["approvals.view_all", "See every approval request"],
    ["audit.view", "View the billing audit log"],
  ]),
];

export const ALL_PERMISSION_KEYS: string[] = PERMISSIONS.map((p) => p.key);
const known = new Set(ALL_PERMISSION_KEYS);
export const isPermission = (k: string) => known.has(k);

/** Per-role limits. 0 or missing means "no limit". */
export interface RoleLimits {
  /** Highest line/extra discount (percent of gross) this role may give without approval. */
  maxDiscountPct?: number;
  /** An invoice at or above this total (rupees) always waits for approval, even for roles that may create directly. */
  approvalAboveRupees?: number;
}

export interface RoleTemplate {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  limits: RoleLimits;
}

const view = ["billing.access", "documents.view", "invoice.view", "invoice.view_all", "purchases.view", "expenses.view", "parties.view", "items.view", "inventory.view", "collections.view", "sales_analysis.view", "reports.view", "accounting.view"];

export const SYSTEM_ROLES: RoleTemplate[] = [
  {
    id: "role_finance_manager",
    name: "Finance Manager",
    description: "Runs billing, approves invoices and sees everything except role administration.",
    permissions: ALL_PERMISSION_KEYS.filter((k) => !["roles.manage"].includes(k)),
    limits: {},
  },
  {
    id: "role_accountant",
    name: "Accountant",
    description: "Books of account, payments, purchases and reports. Cannot approve invoices or change roles.",
    permissions: ALL_PERMISSION_KEYS.filter((k) => !["roles.manage", "invoice.approve", "settings.manage", "invoice.request"].includes(k)),
    limits: {},
  },
  {
    id: "role_sales_executive",
    name: "Sales Executive",
    description: "Creates quotations, proforma invoices and orders. Cannot create sales invoices or see sales analysis.",
    permissions: ["billing.access", "quotation.create", "proforma.create", "sales_order.create", "documents.view", "documents.edit", "parties.view", "parties.manage", "items.view"],
    limits: { maxDiscountPct: 10 },
  },
  {
    id: "role_billing_agent",
    name: "Billing Agent",
    description: "Requests sales invoices; each one waits for approval. No analysis, collections or reports.",
    permissions: ["billing.access", "invoice.view", "invoice.request", "documents.view", "parties.view", "parties.manage", "items.view"],
    limits: { maxDiscountPct: 5 },
  },
  {
    id: "role_auditor",
    name: "Auditor",
    description: "Read-only access to everything, including the audit log.",
    permissions: [...view, "audit.view", "approvals.view_all", "accounting.export"],
    limits: {},
  },
  {
    id: "role_viewer",
    name: "View only",
    description: "Can look at documents and parties. Nothing else.",
    permissions: ["billing.access", "documents.view", "invoice.view", "parties.view", "items.view"],
    limits: {},
  },
];

export interface EffectiveAccess {
  /** True for CRM administrators: every permission, no limits. */
  isAdmin: boolean;
  roleId: string | null;
  roleName: string | null;
  permissions: Set<string>;
  limits: RoleLimits;
}

export function buildAccess(args: {
  isAdmin: boolean;
  role: { id: string; name: string; permissions: string[]; limits: RoleLimits } | null;
  extra?: string[];
  denied?: string[];
}): EffectiveAccess {
  if (args.isAdmin) return { isAdmin: true, roleId: null, roleName: "Administrator", permissions: new Set(ALL_PERMISSION_KEYS), limits: {} };
  const set = new Set<string>(args.role?.permissions ?? []);
  for (const k of args.extra ?? []) if (isPermission(k)) set.add(k);
  for (const k of args.denied ?? []) set.delete(k);
  // Holding any billing permission implies the right to open the area; having none means no access.
  if (set.size > 0 && args.role) set.add("billing.access");
  for (const k of [...set]) if (!isPermission(k)) set.delete(k);
  return { isAdmin: false, roleId: args.role?.id ?? null, roleName: args.role?.name ?? null, permissions: set, limits: args.role?.limits ?? {} };
}

export const hasPermission = (a: EffectiveAccess, key: string) => a.isAdmin || a.permissions.has(key);
