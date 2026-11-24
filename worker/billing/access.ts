import type { Context } from "hono";
import type { AppEnv } from "../env";
import { buildAccess, SYSTEM_ROLES, type EffectiveAccess, type RoleLimits } from "../../shared/access";
import { newId, now } from "../lib/util";

/** Insert/refresh the built-in role templates (idempotent). Custom roles are never touched. */
let rolesSeeded = false;
export async function ensureSystemRoles(db: D1Database) {
  if (rolesSeeded) return;
  const t = now();
  await db.batch(
    SYSTEM_ROLES.map((r) =>
      db
        .prepare(
          `INSERT INTO billing_roles (id, name, description, is_system, permissions, limits, created_at, updated_at) VALUES (?,?,?,1,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, permissions=excluded.permissions, limits=excluded.limits, updated_at=excluded.updated_at`,
        )
        .bind(r.id, r.name, r.description, JSON.stringify(r.permissions), JSON.stringify(r.limits), t, t),
    ),
  );
  rolesSeeded = true;
}

const parseJson = <T>(s: unknown, fallback: T): T => {
  try {
    return s ? (JSON.parse(String(s)) as T) : fallback;
  } catch {
    return fallback;
  }
};

/** Effective billing access of the signed-in user (CRM admins: everything). */
export async function loadAccess(c: Context<AppEnv>): Promise<EffectiveAccess> {
  const user = c.get("user");
  if (user.role === "admin") return buildAccess({ isAdmin: true, role: null });
  await ensureSystemRoles(c.env.DB);
  const row = await c.env.DB.prepare(
    `SELECT u.billing_extra_permissions AS extra, u.billing_denied_permissions AS denied, r.id AS rid, r.name AS rname, r.permissions AS rperms, r.limits AS rlimits
     FROM users u LEFT JOIN billing_roles r ON r.id = u.billing_role_id WHERE u.id = ? AND u.status = 'active'`,
  )
    .bind(user.id)
    .first<{ extra: string; denied: string; rid: string | null; rname: string | null; rperms: string | null; rlimits: string | null }>();
  if (!row) return buildAccess({ isAdmin: false, role: null });
  return buildAccess({
    isAdmin: false,
    role: row.rid ? { id: row.rid, name: row.rname ?? "", permissions: parseJson<string[]>(row.rperms, []), limits: parseJson<RoleLimits>(row.rlimits, {}) } : null,
    extra: parseJson<string[]>(row.extra, []),
    denied: parseJson<string[]>(row.denied, []),
  });
}

/** What a request needs. `null` = no rule, so only administrators may call it (deny by default). */
export type Rule = { all: string[] } | { special: "invoice_create" };

const DOC_CREATE: Record<string, string> = {
  QUOTATION: "quotation.create",
  PROFORMA: "proforma.create",
  SALES_ORDER: "sales_order.create",
  DELIVERY_CHALLAN: "challan.create",
  PACKING_LIST: "challan.create",
  PURCHASE_ORDER: "purchase_order.create",
};

export function ruleFor(method: string, path: string, hints: { docType?: string; target?: string }): Rule | null {
  const m = method.toUpperCase();
  const read = m === "GET" || m === "HEAD";
  const all = (...k: string[]): Rule => ({ all: k });
  const is = (re: RegExp) => re.test(path);

  // Sales
  if (is(/^\/sales\/invoices$/)) return read ? all("invoice.view") : m === "POST" ? { special: "invoice_create" } : null;
  if (is(/^\/sales\/invoices\/[^/]+(\/(pdf|docx))?$/) && read) return all("invoice.view");
  if (is(/^\/sales\/invoices\/[^/]+\/payments$/) && m === "POST") return all("payment.receive");
  if (is(/^\/sales\/invoices\/[^/]+\/credit-note$/) && m === "POST") return all("invoice.credit_note");
  if (is(/^\/sales\/credit-notes$/) && read) return all("invoice.view");
  if (is(/^\/sales\/invoices\/[^/]+\/cancel$/) && m === "POST") return all("invoice.cancel");

  // Quotation / proforma / order / challan / purchase order
  if (is(/^\/documents$/)) {
    if (read) return all("documents.view");
    if (m === "POST") {
      const need = hints.docType ? DOC_CREATE[hints.docType] : undefined;
      return need ? all(need) : null;
    }
  }
  if (is(/^\/documents\/[^/]+(\/(pdf|docx))?$/) && read) return all("documents.view");
  if (is(/^\/documents\/[^/]+\/status$/) && m === "PUT") return all("documents.edit");
  if (is(/^\/documents\/[^/]+\/convert$/) && m === "POST") {
    // Converting into a sales invoice is creating one: it follows the invoice rules, not the document rules.
    if (hints.target === "INVOICE") return null;
    if (hints.target === "PURCHASE_BILL") return all("documents.convert", "purchases.create");
    const need = hints.target ? DOC_CREATE[hints.target] : undefined;
    return need ? all("documents.convert", need) : null;
  }

  // Masters
  if (is(/^\/masters\/(parties|gstin)(\/|$)/)) return read ? all("parties.view") : all("parties.manage");
  if (is(/^\/masters\/items(\/|$)/)) return read ? all("items.view") : all("items.manage");
  if (is(/^\/masters\/(units|taxes)$/) && read) return all("billing.access");
  if (is(/^\/masters\/banks(\/|$)/)) return read ? all("parties.view") : all("banks.manage");

  // Purchases, expenses, payments
  if (is(/^\/purchases\/bills\/[^/]+\/payments$/) && m === "POST") return all("payment.pay");
  if (is(/^\/purchases(\/|$)/)) return read ? all("purchases.view") : all("purchases.create");
  if (is(/^\/expenses(\/|$)/)) return read ? all("expenses.view") : all("expenses.create");
  if (is(/^\/payments(\/|$)/) && read) return all("collections.view");

  // Inventory
  if (is(/^\/inventory(\/|$)/)) return read ? all("inventory.view") : all("inventory.manage");

  // Reports
  if (is(/^\/reports(\/|$)/) && read) return all("reports.view");

  // Accounting
  if (is(/^\/accounting\/(opening-balances|period-lock|lock-gst-month|year-end-close)$/)) return read ? all("accounting.view") : all("accounting.close");
  if (is(/^\/accounting\/tally-xml$/)) return all("accounting.export");
  if (is(/^\/accounting\/gst\//) && read) return all("reports.view");
  if (is(/^\/accounting(\/|$)/)) return read ? all("accounting.view") : all("accounting.post");

  // E-invoice
  if (is(/^\/einvoice(\/|$)/)) return all("einvoice.manage");

  // Settings that matter for day-to-day work; roles/members/data-sharing/export stay admin-only.
  if (is(/^\/settings\/(branches(\/[^/]+)?|locations|config|numbering|billing)$/)) return read ? all("settings.view") : all("settings.manage");

  // Shared utilities every billing user needs
  if (is(/^\/notifications(\/|$)/) || is(/^\/offline(\/|$)/)) return all("billing.access");

  return null;
}

export function recordAudit(
  db: D1Database,
  e: { companyId?: string | null; actorId: string | null; actorName?: string | null; action: string; entityType?: string | null; entityId?: string | null; status?: number; detail?: unknown; ip?: string | null },
) {
  return db
    .prepare("INSERT INTO billing_audit (id, company_id, actor_id, actor_name, action, entity_type, entity_id, status, detail, ip, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(newId(), e.companyId ?? null, e.actorId, e.actorName ?? null, e.action, e.entityType ?? null, e.entityId ?? null, e.status ?? null, e.detail === undefined ? null : JSON.stringify(e.detail).slice(0, 4000), e.ip ?? null, now())
    .run();
}
