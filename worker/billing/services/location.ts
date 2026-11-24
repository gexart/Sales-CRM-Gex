import type { NumberingSql } from './numbering';

function rows(cur: any): any[] {
  if (!cur) return [];
  if (typeof cur.toArray === 'function') return cur.toArray();
  if (typeof cur[Symbol.iterator] === 'function') return [...cur];
  return [];
}

/**
 * Real branch + warehouse for a request: the ones asked for if they exist (warehouse must belong to the branch),
 * otherwise the business's default branch and that branch's default warehouse. Replaces the old made-up
 * fallbacks ('branch_main', 'br_main', 'wh_main') that do not exist in a real business database.
 */
export function resolveLocation(sql: NumberingSql, wanted: { branchId?: string | null; warehouseId?: string | null } = {}) {
  const branch =
    (wanted.branchId ? rows(sql.exec('SELECT id FROM branches WHERE id = ? AND deleted_at IS NULL', wanted.branchId))[0] : undefined) ??
    rows(sql.exec('SELECT id FROM branches WHERE deleted_at IS NULL ORDER BY is_default DESC, created_at ASC LIMIT 1'))[0];
  if (!branch) throw new Error('No branch set up for this business');
  const branchId = String(branch.id);
  const wh =
    (wanted.warehouseId
      ? rows(sql.exec('SELECT id FROM warehouses WHERE id = ? AND branch_id = ? AND deleted_at IS NULL', wanted.warehouseId, branchId))[0]
      : undefined) ??
    rows(sql.exec('SELECT id FROM warehouses WHERE branch_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, created_at ASC LIMIT 1', branchId))[0];
  return { branchId, warehouseId: wh ? String(wh.id) : null };
}
