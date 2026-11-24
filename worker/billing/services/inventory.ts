import { allocateDocNumber, sqlRunner } from './numbering';
import { PostingService } from './posting';
import { newId } from '@billing/shared';

export interface StockSummaryRow {
  itemId: string;
  itemCode: string;
  itemName: string;
  category: string;
  unit: string;
  warehouseId: string;
  warehouseName: string;
  currentQtyThousandths: number;
  minStockAlertThousandths: number;
  purchasePricePaise: number;
  sellingPricePaise: number;
  valuationPaise: number;
  isLowStock: boolean;
}

export interface TransferStockLineInput {
  itemId: string;
  variantId?: string;
  batchId?: string;
  quantityThousandths: number;
}

export interface TransferStockInput {
  branchId: string;
  sourceWarehouseId: string;
  destinationWarehouseId: string;
  date?: string;
  lines: TransferStockLineInput[];
  notes?: string;
  createdById?: string;
}

export interface AdjustStockLineInput {
  itemId: string;
  variantId?: string;
  batchId?: string;
  adjustmentType: 'INCREASE' | 'DECREASE';
  quantityThousandths: number;
  ratePaise?: number;
}

export interface AdjustStockInput {
  branchId: string;
  warehouseId: string;
  reason: 'PHYSICAL_COUNT' | 'DAMAGE' | 'THEFT' | 'EXPIRY' | 'CORRECTION';
  date?: string;
  lines: AdjustStockLineInput[];
  notes?: string;
  createdById?: string;
}

export interface CreateBatchInput {
  itemId: string;
  batchNo: string;
  mfgDate?: string;
  expiryDate?: string;
  mrpPaise?: number;
  salePricePaise?: number;
  purchasePricePaise?: number;
  quantityThousandths?: number;
}

export interface CreateRecipeItemInput {
  rawItemId: string;
  quantityThousandths: number;
  unitId?: string;
  wastagePercentBasisPoints?: number; // e.g. 500 = 5%
}

export interface CreateRecipeInput {
  menuItemId: string;
  name: string;
  instructions?: string;
  isBatch?: boolean;
  yieldQuantityThousandths?: number;
  items: CreateRecipeItemInput[];
}

export class InventoryService {
  constructor(
    private sql: any,
    private postingService?: PostingService,
  ) {}

  private query(queryStr: string, ...params: any[]): any[] {
    return sqlRunner(this.sql).all(queryStr, ...params);
  }

  private queryOne(queryStr: string, ...params: any[]): any | null {
    const results = this.query(queryStr, ...params);
    return results.length > 0 ? results[0] : null;
  }

  private run(queryStr: string, ...params: any[]): void {
    sqlRunner(this.sql).run(queryStr, ...params);
  }

  private getSetting(key: string, defaultValue: string = ''): string {
    // settings stores JSON in value_json (e.g. true, "WAC"); return it as plain text
    const row = this.queryOne('SELECT value_json FROM settings WHERE key = ?', key);
    if (!row) return defaultValue;
    try {
      return String(JSON.parse(String(row.value_json)));
    } catch {
      return String(row.value_json);
    }
  }

  private nextDocNumber(branchId: string, docType: string, _prefixDefault?: string): string {
    return allocateDocNumber(sqlRunner(this.sql).asExec(), { docType, branchId }).docNumber;
  }

  // 1. Stock Summary & Valuation
  getStockSummary(warehouseId?: string, search?: string): StockSummaryRow[] {
    let sqlQuery = `
      SELECT 
        i.id as itemId,
        i.sku as itemCode,
        i.name as itemName,
        i.category_id as category,
        COALESCE(u.code, 'PCS') as unit,
        w.id as warehouseId,
        w.name as warehouseName,
        COALESCE(sb.current_qty_thousandths, 0) as currentQtyThousandths,
        COALESCE(i.low_stock_level_thousandths, 0) as minStockAlertThousandths,
        COALESCE(i.purchase_price_paise, 0) as purchasePricePaise,
        COALESCE(i.sale_price_paise, 0) as sellingPricePaise
      FROM items i
      CROSS JOIN warehouses w
      LEFT JOIN stock_balances sb ON sb.item_id = i.id AND sb.warehouse_id = w.id
      LEFT JOIN units u ON u.id = i.unit_id
      WHERE i.is_active = 1
    `;
    const params: any[] = [];

    if (warehouseId) {
      sqlQuery += ` AND w.id = ?`;
      params.push(warehouseId);
    }
    if (search) {
      sqlQuery += ` AND (i.name LIKE ? OR i.sku LIKE ? OR i.barcode LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    sqlQuery += ` ORDER BY i.name ASC`;
    const rows = this.query(sqlQuery, ...params);

    return rows.map((r) => {
      const currentQty = Number(r.currentQtyThousandths);
      const minStock = Number(r.minStockAlertThousandths);
      const purchasePrice = Number(r.purchasePricePaise);
      const valuation = Math.round((currentQty * purchasePrice) / 1000);
      const isLowStock = minStock > 0 && currentQty <= minStock;

      return {
        itemId: r.itemId,
        itemCode: r.itemCode || '',
        itemName: r.itemName,
        category: r.category || 'General',
        unit: r.unit,
        warehouseId: r.warehouseId,
        warehouseName: r.warehouseName,
        currentQtyThousandths: currentQty,
        minStockAlertThousandths: minStock,
        purchasePricePaise: purchasePrice,
        sellingPricePaise: Number(r.sellingPricePaise),
        valuationPaise: valuation,
        isLowStock,
      };
    });
  }

  // 2. Stock Ledger movements for a specific item
  getStockLedger(itemId: string, warehouseId?: string): any[] {
    let sqlQuery = `
      SELECT 
        sl.id,
        sl.date,
        sl.doc_type as docType,
        sl.doc_no as docNo,
        sl.qty_in_thousandths as qtyInThousandths,
        sl.qty_out_thousandths as qtyOutThousandths,
        sl.balance_qty_thousandths as balanceQtyThousandths,
        sl.rate_paise as ratePaise,
        w.name as warehouseName,
        sl.created_at as createdAt
      FROM stock_ledgers sl
      JOIN warehouses w ON w.id = sl.warehouse_id
      WHERE sl.item_id = ?
    `;
    const params: any[] = [itemId];

    if (warehouseId) {
      sqlQuery += ` AND sl.warehouse_id = ?`;
      params.push(warehouseId);
    }

    sqlQuery += ` ORDER BY sl.date DESC, sl.created_at DESC`;
    return this.query(sqlQuery, ...params);
  }

  // 3. Warehouse-to-Warehouse Transfer
  transferStock(input: TransferStockInput): { transferId: string; transferNo: string } {
    if (input.sourceWarehouseId === input.destinationWarehouseId) {
      throw new Error('Source and destination warehouses cannot be the same');
    }
    if (!input.lines || input.lines.length === 0) {
      throw new Error('At least one item is required to transfer');
    }

    const allowNegative = this.getSetting('allow_negative_stock', 'false') === 'true';
    const date = input.date || new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const transferId = newId();
    const transferNo = this.nextDocNumber(input.branchId, 'TRANSFER', 'ST');

    // 1. Insert transfer header
    this.run(
      `INSERT INTO stock_transfers (id, transfer_no, branch_id, source_warehouse_id, destination_warehouse_id, date, status, notes, created_by_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?)`,
      transferId,
      transferNo,
      input.branchId,
      input.sourceWarehouseId,
      input.destinationWarehouseId,
      date,
      input.notes || null,
      input.createdById || 'SYSTEM',
      now,
    );

    // 2. Process each line
    for (const line of input.lines) {
      const lineId = newId();
      this.run(
        `INSERT INTO stock_transfer_lines (id, transfer_id, item_id, variant_id, batch_id, quantity_thousandths)
         VALUES (?, ?, ?, ?, ?, ?)`,
        lineId,
        transferId,
        line.itemId,
        line.variantId || null,
        line.batchId || null,
        line.quantityThousandths,
      );

      // Check source stock balance
      const sourceBalance = this.queryOne(
        `SELECT current_qty_thousandths FROM stock_balances WHERE warehouse_id = ? AND item_id = ?`,
        input.sourceWarehouseId,
        line.itemId,
      );
      const currentSourceQty = sourceBalance ? Number(sourceBalance.current_qty_thousandths) : 0;

      if (!allowNegative && currentSourceQty < line.quantityThousandths) {
        throw new Error(`Insufficient stock in source warehouse for item ${line.itemId}`);
      }

      // Deduct from source warehouse
      const newSourceQty = currentSourceQty - line.quantityThousandths;
      if (sourceBalance) {
        this.run(
          `UPDATE stock_balances SET current_qty_thousandths = ?, updated_at = ? WHERE warehouse_id = ? AND item_id = ?`,
          newSourceQty,
          now,
          input.sourceWarehouseId,
          line.itemId,
        );
      } else {
        this.run(
          `INSERT INTO stock_balances (id, branch_id, warehouse_id, item_id, current_qty_thousandths, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          newId(),
          input.branchId,
          input.sourceWarehouseId,
          line.itemId,
          newSourceQty,
          now,
        );
      }

      // Record TRANSFER_OUT ledger
      this.run(
        `INSERT INTO stock_ledgers (id, date, branch_id, warehouse_id, item_id, variant_id, batch_id, doc_type, doc_id, doc_no, qty_in_thousandths, qty_out_thousandths, rate_paise, balance_qty_thousandths, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(),
        date,
        input.branchId,
        input.sourceWarehouseId,
        line.itemId,
        line.variantId || null,
        line.batchId || null,
        'TRANSFER_OUT',
        transferId,
        transferNo,
        0,
        line.quantityThousandths,
        0,
        newSourceQty,
        now,
      );

      // Add to destination warehouse
      const destBalance = this.queryOne(
        `SELECT current_qty_thousandths FROM stock_balances WHERE warehouse_id = ? AND item_id = ?`,
        input.destinationWarehouseId,
        line.itemId,
      );
      const currentDestQty = destBalance ? Number(destBalance.current_qty_thousandths) : 0;
      const newDestQty = currentDestQty + line.quantityThousandths;

      if (destBalance) {
        this.run(
          `UPDATE stock_balances SET current_qty_thousandths = ?, updated_at = ? WHERE warehouse_id = ? AND item_id = ?`,
          newDestQty,
          now,
          input.destinationWarehouseId,
          line.itemId,
        );
      } else {
        this.run(
          `INSERT INTO stock_balances (id, branch_id, warehouse_id, item_id, current_qty_thousandths, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          newId(),
          input.branchId,
          input.destinationWarehouseId,
          line.itemId,
          newDestQty,
          now,
        );
      }

      // Record TRANSFER_IN ledger
      this.run(
        `INSERT INTO stock_ledgers (id, date, branch_id, warehouse_id, item_id, variant_id, batch_id, doc_type, doc_id, doc_no, qty_in_thousandths, qty_out_thousandths, rate_paise, balance_qty_thousandths, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(),
        date,
        input.branchId,
        input.destinationWarehouseId,
        line.itemId,
        line.variantId || null,
        line.batchId || null,
        'TRANSFER_IN',
        transferId,
        transferNo,
        line.quantityThousandths,
        0,
        0,
        newDestQty,
        now,
      );
    }

    return { transferId, transferNo };
  }

  // 4. Stock Adjustments (Physical count, Damage, Theft, Expiry) with Double-Entry Posting
  adjustStock(input: AdjustStockInput): { adjustmentId: string; adjustmentNo: string; totalDifferencePaise: number } {
    if (!input.lines || input.lines.length === 0) {
      throw new Error('At least one item line is required for stock adjustment');
    }

    const allowNegative = this.getSetting('allow_negative_stock', 'false') === 'true';
    const date = input.date || new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const adjustmentId = newId();
    const adjustmentNo = this.nextDocNumber(input.branchId, 'ADJUSTMENT', 'ADJ');

    let totalDifferencePaise = 0;

    for (const line of input.lines) {
      const item = this.queryOne('SELECT purchase_price_paise FROM items WHERE id = ?', line.itemId);
      const ratePaise = line.ratePaise !== undefined ? line.ratePaise : (item ? Number(item.purchase_price_paise) : 0);
      const lineValuePaise = Math.round((line.quantityThousandths * ratePaise) / 1000);

      const balRow = this.queryOne(
        `SELECT current_qty_thousandths FROM stock_balances WHERE warehouse_id = ? AND item_id = ?`,
        input.warehouseId,
        line.itemId,
      );
      const currentQty = balRow ? Number(balRow.current_qty_thousandths) : 0;

      let newQty = currentQty;
      if (line.adjustmentType === 'INCREASE') {
        newQty += line.quantityThousandths;
        totalDifferencePaise += lineValuePaise;
      } else {
        if (!allowNegative && currentQty < line.quantityThousandths) {
          throw new Error(`Insufficient stock for item ${line.itemId} to adjust downwards`);
        }
        newQty -= line.quantityThousandths;
        totalDifferencePaise -= lineValuePaise;
      }

      // Update balance
      if (balRow) {
        this.run(
          `UPDATE stock_balances SET current_qty_thousandths = ?, updated_at = ? WHERE warehouse_id = ? AND item_id = ?`,
          newQty,
          now,
          input.warehouseId,
          line.itemId,
        );
      } else {
        this.run(
          `INSERT INTO stock_balances (id, branch_id, warehouse_id, item_id, current_qty_thousandths, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          newId(),
          input.branchId,
          input.warehouseId,
          line.itemId,
          newQty,
          now,
        );
      }

      // Record in StockLedger
      this.run(
        `INSERT INTO stock_ledgers (id, date, branch_id, warehouse_id, item_id, variant_id, batch_id, doc_type, doc_id, doc_no, qty_in_thousandths, qty_out_thousandths, rate_paise, balance_qty_thousandths, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(),
        date,
        input.branchId,
        input.warehouseId,
        line.itemId,
        line.variantId || null,
        line.batchId || null,
        'ADJUSTMENT',
        adjustmentId,
        adjustmentNo,
        line.adjustmentType === 'INCREASE' ? line.quantityThousandths : 0,
        line.adjustmentType === 'DECREASE' ? line.quantityThousandths : 0,
        ratePaise,
        newQty,
        now,
      );

      // Insert adjustment line
      this.run(
        `INSERT INTO stock_adjustment_lines (id, adjustment_id, item_id, variant_id, batch_id, adjustment_type, quantity_thousandths, rate_paise, value_paise)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(),
        adjustmentId,
        line.itemId,
        line.variantId || null,
        line.batchId || null,
        line.adjustmentType,
        line.quantityThousandths,
        ratePaise,
        lineValuePaise,
      );
    }

    // Insert adjustment header
    this.run(
      `INSERT INTO stock_adjustments (id, adjustment_no, branch_id, warehouse_id, date, reason, total_difference_paise, notes, created_by_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      adjustmentId,
      adjustmentNo,
      input.branchId,
      input.warehouseId,
      date,
      input.reason,
      totalDifferencePaise,
      input.notes || null,
      input.createdById || 'SYSTEM',
      now,
    );

    // Double-entry accounting posting if postingService is provided
    if (this.postingService && totalDifferencePaise !== 0) {
      const netType = totalDifferencePaise >= 0 ? 'INCREASE' : 'DECREASE';
      this.postingService.postStockAdjustment({
        adjustmentId,
        adjustmentNo,
        date,
        branchId: input.branchId,
        type: netType,
        valuePaise: Math.abs(totalDifferencePaise),
        reason: `${input.reason} - ${adjustmentNo}`,
      });
    }

    return { adjustmentId, adjustmentNo, totalDifferencePaise };
  }

  // 5. Batches & Expiry Management
  getBatches(itemId?: string, nearExpiryDays?: number): any[] {
    let sqlQuery = `
      SELECT 
        b.id,
        b.item_id as itemId,
        i.name as itemName,
        b.batch_no as batchNo,
        b.mfg_date as mfgDate,
        b.expiry_date as expiryDate,
        b.mrp_paise as mrpPaise,
        b.sale_price_paise as salePricePaise,
        b.purchase_price_paise as purchasePricePaise,
        b.quantity_thousandths as quantityThousandths,
        b.created_at as createdAt
      FROM batches b
      JOIN items i ON i.id = b.item_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (itemId) {
      sqlQuery += ` AND b.item_id = ?`;
      params.push(itemId);
    }

    sqlQuery += ` ORDER BY b.expiry_date ASC`;
    const batches = this.query(sqlQuery, ...params);

    const now = new Date();
    return batches.map((b) => {
      let daysUntilExpiry: number | null = null;
      let isNearExpiry = false;
      let isExpired = false;

      if (b.expiryDate) {
        const exp = new Date(b.expiryDate);
        const diffMs = exp.getTime() - now.getTime();
        daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        if (daysUntilExpiry <= 0) {
          isExpired = true;
        } else if (nearExpiryDays && daysUntilExpiry <= nearExpiryDays) {
          isNearExpiry = true;
        }
      }

      return {
        ...b,
        daysUntilExpiry,
        isNearExpiry,
        isExpired,
      };
    }).filter((b) => {
      if (nearExpiryDays !== undefined) {
        return b.daysUntilExpiry !== null && b.daysUntilExpiry <= nearExpiryDays;
      }
      return true;
    });
  }

  createBatch(input: CreateBatchInput): { id: string } {
    const id = newId();
    this.run(
      `INSERT INTO batches (id, item_id, batch_no, mfg_date, expiry_date, mrp_paise, sale_price_paise, purchase_price_paise, quantity_thousandths, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.itemId,
      input.batchNo,
      input.mfgDate || null,
      input.expiryDate || null,
      input.mrpPaise || 0,
      input.salePricePaise || 0,
      input.purchasePricePaise || 0,
      input.quantityThousandths || 0,
      new Date().toISOString(),
    );
    return { id };
  }

  // 6. Restaurant Recipe / Bill of Materials (BOM)
  createRecipe(input: CreateRecipeInput): { id: string } {
    const id = newId();
    this.run(
      `INSERT INTO recipes (id, menu_item_id, name, instructions, is_batch, yield_quantity_thousandths, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.menuItemId,
      input.name,
      input.instructions || null,
      input.isBatch ? 1 : 0,
      input.yieldQuantityThousandths || 1000,
      new Date().toISOString(),
    );

    for (const item of input.items) {
      this.run(
        `INSERT INTO recipe_items (id, recipe_id, raw_item_id, quantity_thousandths, unit_id)
         VALUES (?, ?, ?, ?, ?)`,
        newId(),
        id,
        item.rawItemId,
        item.quantityThousandths,
        item.unitId || null,
      );
    }

    return { id };
  }

  getRecipe(menuItemId: string): any | null {
    const recipe = this.queryOne(
      `SELECT id, menu_item_id as menuItemId, name, instructions, is_batch as isBatch, yield_quantity_thousandths as yieldQuantityThousandths
       FROM recipes WHERE menu_item_id = ? OR menu_item_id IN (SELECT id FROM menu_items WHERE item_id = ?) LIMIT 1`,
      menuItemId,
      menuItemId,
    );
    if (!recipe) return null;

    const items = this.query(
      `SELECT 
        ri.id,
        ri.raw_item_id as rawItemId,
        i.name as rawItemName,
        ri.quantity_thousandths as quantityThousandths,
        i.purchase_price_paise as purchasePricePaise,
        u.code as unit
       FROM recipe_items ri
       JOIN items i ON i.id = ri.raw_item_id
       LEFT JOIN units u ON u.id = ri.unit_id
       WHERE ri.recipe_id = ?`,
      recipe.id,
    );

    let totalRawCostPaise = 0;
    for (const it of items) {
      const lineCost = Math.round((Number(it.quantityThousandths) * Number(it.purchasePricePaise)) / 1000);
      totalRawCostPaise += lineCost;
    }

    // Check menu item selling price to calculate food cost %
    const menuItem = this.queryOne('SELECT sale_price_paise FROM items WHERE id = ?', menuItemId);
    const salePricePaise = menuItem ? Number(menuItem.sale_price_paise) : 0;
    const foodCostPercent = salePricePaise > 0 ? ((totalRawCostPaise / salePricePaise) * 100).toFixed(1) : '0.0';

    return {
      ...recipe,
      items,
      totalRawCostPaise,
      salePricePaise,
      foodCostPercent: Number(foodCostPercent),
    };
  }

  // 7. Auto-deplete raw materials when a recipe dish is sold (e.g. KOT or POS invoice)
  consumeRecipe(params: {
    menuItemId: string;
    quantityThousandths: number; // e.g. 2000 = 2 portions
    warehouseId: string;
    branchId: string;
    docNo: string;
    docId: string;
  }): { consumedItems: { rawItemId: string; consumedQtyThousandths: number }[] } {
    const recipe = this.getRecipe(params.menuItemId);
    if (!recipe) {
      return { consumedItems: [] };
    }

    const allowNegative = this.getSetting('allow_negative_stock', 'false') === 'true';
    const now = new Date().toISOString();
    const date = now.slice(0, 10);
    const multiplier = params.quantityThousandths / Number(recipe.yieldQuantityThousandths || 1000);
    const consumedItems: { rawItemId: string; consumedQtyThousandths: number }[] = [];

    for (const item of recipe.items) {
      const requiredQty = Math.round(Number(item.quantityThousandths) * multiplier);

      // Check current stock
      const bal = this.queryOne(
        `SELECT current_qty_thousandths FROM stock_balances WHERE warehouse_id = ? AND item_id = ?`,
        params.warehouseId,
        item.rawItemId,
      );
      const currentQty = bal ? Number(bal.current_qty_thousandths) : 0;

      if (!allowNegative && currentQty < requiredQty) {
        throw new Error(`Insufficient stock for recipe ingredient ${item.rawItemName} (${item.rawItemId})`);
      }

      const newQty = currentQty - requiredQty;
      if (bal) {
        this.run(
          `UPDATE stock_balances SET current_qty_thousandths = ?, updated_at = ? WHERE warehouse_id = ? AND item_id = ?`,
          newQty,
          now,
          params.warehouseId,
          item.rawItemId,
        );
      } else {
        this.run(
          `INSERT INTO stock_balances (id, branch_id, warehouse_id, item_id, current_qty_thousandths, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          newId(),
          params.branchId,
          params.warehouseId,
          item.rawItemId,
          newQty,
          now,
        );
      }

      // Record in StockLedger with doc_type 'KOT'
      this.run(
        `INSERT INTO stock_ledgers (id, date, branch_id, warehouse_id, item_id, variant_id, batch_id, doc_type, doc_id, doc_no, qty_in_thousandths, qty_out_thousandths, rate_paise, balance_qty_thousandths, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(),
        date,
        params.branchId,
        params.warehouseId,
        item.rawItemId,
        null,
        null,
        'KOT',
        params.docId,
        params.docNo,
        0,
        requiredQty,
        0,
        newQty,
        now,
      );

      consumedItems.push({
        rawItemId: item.rawItemId,
        consumedQtyThousandths: requiredQty,
      });
    }

    return { consumedItems };
  }

  // 8. Low-Stock items count and Purchase Order generation
  getLowStockItems(warehouseId?: string): StockSummaryRow[] {
    const summary = this.getStockSummary(warehouseId);
    return summary.filter((s) => s.isLowStock);
  }
}
