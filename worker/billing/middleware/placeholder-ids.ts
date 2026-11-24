import type { MiddlewareHandler } from 'hono';

/**
 * Safety net for screens that send placeholder ids instead of this business's real records
 * ("branch_main", "wh_main", "acc_5101", "unit_pcs", "tax_1800"…). Those ids do not exist in a real business,
 * so saving failed with "FOREIGN KEY constraint failed". This rewrites them — in the JSON body and the query
 * string — to the business's real default branch / warehouse and the real account for that code, before the
 * route runs. Real ids pass through untouched.
 */
const BRANCH_PLACEHOLDERS = new Set(['branch_main', 'br_main', 'branch_default', 'br_default', 'main']);
const WAREHOUSE_PLACEHOLDERS = new Set(['wh_main', 'wh_default', 'warehouse_main', 'warehouse_default']);
const ACCOUNT_RE = /^acc_(\d{4})$/;

function collect(v: unknown, found: { branch: boolean; warehouse: boolean; codes: Set<string> }) {
  if (Array.isArray(v)) v.forEach((x) => collect(x, found));
  else if (v && typeof v === 'object') for (const x of Object.values(v)) collect(x, found);
  else if (typeof v === 'string') {
    if (BRANCH_PLACEHOLDERS.has(v)) found.branch = true;
    else if (WAREHOUSE_PLACEHOLDERS.has(v)) found.warehouse = true;
    else {
      const m = ACCOUNT_RE.exec(v);
      if (m) found.codes.add(m[1]!);
    }
  }
}

function rewrite(v: unknown, map: Map<string, string>): unknown {
  if (Array.isArray(v)) return v.map((x) => rewrite(x, map));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x, map)]));
  if (typeof v === 'string' && map.has(v)) return map.get(v);
  return v;
}

export const placeholderIds: MiddlewareHandler = async (c, next) => {
  const stub = c.get('businessStub' as never) as any;
  if (!stub?.resolvePlaceholderIds) return next();
  const url = new URL(c.req.url);
  const isJson = ['POST', 'PUT', 'PATCH'].includes(c.req.method) && (c.req.header('content-type') ?? '').includes('application/json');
  let body: unknown;
  if (isJson) {
    try {
      body = await c.req.raw.clone().json();
    } catch {
      body = undefined;
    }
  }
  const found = { branch: false, warehouse: false, codes: new Set<string>() };
  collect(body, found);
  collect(Object.fromEntries(url.searchParams), found);
  if (!found.branch && !found.warehouse && found.codes.size === 0) return next();

  const real: { branchId: string | null; warehouseId: string | null; accounts: Record<string, string> } = await stub.resolvePlaceholderIds([...found.codes]);
  const map = new Map<string, string>();
  if (real.branchId) BRANCH_PLACEHOLDERS.forEach((p) => map.set(p, real.branchId!));
  if (real.warehouseId) WAREHOUSE_PLACEHOLDERS.forEach((p) => map.set(p, real.warehouseId!));
  for (const [code, id] of Object.entries(real.accounts)) map.set(`acc_${code}`, id);
  if (map.size === 0) return next();

  let changedUrl = false;
  for (const [k, v] of url.searchParams) {
    if (map.has(v)) {
      url.searchParams.set(k, map.get(v)!);
      changedUrl = true;
    }
  }
  const headers = new Headers(c.req.raw.headers);
  const init: RequestInit = { method: c.req.method, headers };
  if (body !== undefined) {
    const text = JSON.stringify(rewrite(body, map));
    init.body = text;
    headers.delete('content-length');
  } else if (!['GET', 'HEAD'].includes(c.req.method)) {
    init.body = await c.req.raw.clone().arrayBuffer();
  }
  if (body !== undefined || changedUrl) {
    (c.req as any).raw = new Request(url.toString(), init);
    // Hono caches parsed bodies; clear so routes read the rewritten one
    if ((c.req as any).bodyCache) (c.req as any).bodyCache = {};
  }
  return next();
};
