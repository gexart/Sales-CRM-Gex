import { newId } from '@billing/shared';

/**
 * Reorder planning: items at or below their low-stock level, a suggested quantity (to twice the level), the vendor
 * they were last bought from, and rack / bin locations per warehouse.
 */
type Sql = { exec(q: string, ...b: unknown[]): { toArray(): any[] } };
const all = (sql: Sql, q: string, ...b: unknown[]) => sql.exec(q, ...b).toArray();
const one = (sql: Sql, q: string, ...b: unknown[]) => sql.exec(q, ...b).toArray()[0];

export class ReorderService {
  constructor(private sql: Sql) {}

  suggestions() {
    const rows = all(
      this.sql,
      `SELECT i.id, i.name, i.hsn_sac, i.unit_id, i.purchase_price_paise, i.low_stock_level_thousandths AS level,
              COALESCE(t.rate_basis_points, 0) AS tax_bp,
              COALESCE((SELECT SUM(b.current_qty_thousandths) FROM stock_balances b WHERE b.item_id = i.id), 0) AS stock,
              (SELECT pb.party_id FROM purchase_bill_lines l JOIN purchase_bills pb ON pb.id = l.bill_id WHERE l.item_id = i.id ORDER BY pb.date DESC LIMIT 1) AS vendor_id,
              (SELECT l.unit_price_paise FROM purchase_bill_lines l JOIN purchase_bills pb ON pb.id = l.bill_id WHERE l.item_id = i.id ORDER BY pb.date DESC LIMIT 1) AS last_price
       FROM items i LEFT JOIN tax_rates t ON t.id = i.tax_rate_id
       WHERE i.is_active = 1 AND i.type = 'GOODS' AND i.low_stock_level_thousandths > 0
       GROUP BY i.id HAVING stock <= level ORDER BY (stock * 1.0 / level) ASC LIMIT 300`,
    );
    return rows.map((r: any) => {
      const vendor = r.vendor_id ? one(this.sql, 'SELECT id, name FROM parties WHERE id = ?', r.vendor_id) : null;
      return {
        itemId: r.id,
        name: r.name,
        hsnSac: r.hsn_sac,
        unitId: r.unit_id,
        stockThousandths: Number(r.stock),
        levelThousandths: Number(r.level),
        suggestedThousandths: Math.max(Number(r.level) * 2 - Number(r.stock), 1000),
        unitPricePaise: Number(r.last_price ?? r.purchase_price_paise ?? 0),
        taxRateBasisPoints: Number(r.tax_bp),
        vendorId: vendor?.id ?? null,
        vendorName: vendor?.name ?? null,
      };
    });
  }

  /** Groups chosen lines by vendor; returns one draft purchase-order input per vendor. */
  purchaseOrderDrafts(lines: { itemId: string; quantityThousandths: number; vendorId: string; unitPricePaise?: number }[]) {
    const byVendor = new Map<string, any[]>();
    for (const l of lines) {
      if (!one(this.sql, "SELECT id FROM parties WHERE id = ? AND deleted_at IS NULL", l.vendorId)) throw new Error('Vendor not found');
      const it = one(this.sql, `SELECT i.id, i.name, i.hsn_sac, i.unit_id, i.purchase_price_paise, COALESCE(t.rate_basis_points, 0) AS bp FROM items i LEFT JOIN tax_rates t ON t.id = i.tax_rate_id WHERE i.id = ?`, l.itemId);
      if (!it) throw new Error('Item not found');
      const list = byVendor.get(l.vendorId) ?? [];
      list.push({ itemId: it.id, name: it.name, hsnSac: it.hsn_sac, unitId: it.unit_id, quantityThousandths: Math.round(l.quantityThousandths), unitPricePaise: Math.round(l.unitPricePaise ?? it.purchase_price_paise ?? 0), taxRateBasisPoints: Number(it.bp) });
      byVendor.set(l.vendorId, list);
    }
    return [...byVendor.entries()].map(([partyId, items]) => ({ partyId, lines: items }));
  }

  setLocation(itemId: string, warehouseId: string, rackBin: string) {
    if (!one(this.sql, 'SELECT id FROM items WHERE id = ?', itemId)) throw new Error('Item not found');
    if (!one(this.sql, 'SELECT id FROM warehouses WHERE id = ?', warehouseId)) throw new Error('Warehouse not found');
    const now = new Date().toISOString();
    const cur = one(this.sql, 'SELECT id FROM item_locations WHERE item_id = ? AND warehouse_id = ?', itemId, warehouseId);
    if (cur) this.sql.exec('UPDATE item_locations SET rack_bin = ?, updated_at = ? WHERE id = ?', rackBin.trim(), now, cur.id);
    else this.sql.exec('INSERT INTO item_locations (id, item_id, warehouse_id, rack_bin, updated_at) VALUES (?, ?, ?, ?, ?)', `loc_${newId()}`, itemId, warehouseId, rackBin.trim(), now);
    return { itemId, warehouseId, rackBin: rackBin.trim() };
  }

  locations(warehouseId?: string) {
    return all(
      this.sql,
      `SELECT l.item_id, l.warehouse_id, l.rack_bin, i.name AS item_name, w.name AS warehouse_name
       FROM item_locations l JOIN items i ON i.id = l.item_id JOIN warehouses w ON w.id = l.warehouse_id
       ${warehouseId ? 'WHERE l.warehouse_id = ?' : ''} ORDER BY l.rack_bin`,
      ...(warehouseId ? [warehouseId] : []),
    );
  }
}
