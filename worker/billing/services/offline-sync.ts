import { newId } from '@billing/shared';

export interface RegisterDeviceInput {
  branchId: string;
  deviceCode: string; // e.g. 'POS1'
  deviceName: string; // e.g. 'Main Counter Terminal'
}

export interface SyncMutationItem {
  mutationId: string; // Client UUID
  entityType: 'INVOICE' | 'KOT' | 'PAYMENT';
  payload: any;
}

export interface SyncBatchInput {
  deviceId: string;
  mutations: SyncMutationItem[];
}

export class OfflineSyncService {
  constructor(private sql: any) {}

  // ==========================================
  // 1. DEVICE REGISTRATION & SERIES (8.2)
  // ==========================================

  registerDevice(input: RegisterDeviceInput) {
    const id = `dev_${newId()}`;
    const now = new Date().toISOString();
    const code = input.deviceCode.toUpperCase().trim();
    const prefix = `GX/${code}/`;

    this.sql.exec(
      `INSERT INTO pos_devices (
        id, device_code, device_name, branch_id,
        offline_series_prefix, last_synced_at, is_active,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      id,
      code,
      input.deviceName,
      input.branchId,
      prefix,
      now,
      now,
      now,
    );

    // Also register offline document series in document_series
    const seriesId = `ser_off_${newId()}`;
    this.sql.exec(
      `INSERT INTO document_series (
        id, branch_id, doc_type, series_name, prefix,
        current_seq, padding, is_default, created_at, updated_at
      )
      VALUES (?, ?, 'INVOICE', ?, ?, 0, 4, 0, ?, ?)`,
      seriesId,
      input.branchId,
      `Offline Series ${code}`,
      prefix,
      now,
      now,
    );

    return {
      id,
      deviceCode: code,
      deviceName: input.deviceName,
      branchId: input.branchId,
      offlineSeriesPrefix: prefix,
      isActive: true,
      registeredAt: now,
    };
  }

  getDevice(deviceCode: string) {
    const cursor = this.sql.exec(
      `SELECT * FROM pos_devices WHERE device_code = ? LIMIT 1`,
      deviceCode.toUpperCase(),
    );
    const row = cursor.next();
    if (row.done || !row.value) return null;
    return {
      ...row.value,
      isActive: Boolean(row.value.is_active),
    };
  }

  listDevices(branchId?: string) {
    let q = `SELECT * FROM pos_devices`;
    const params: any[] = [];
    if (branchId) {
      q += ` WHERE branch_id = ?`;
      params.push(branchId);
    }
    q += ` ORDER BY created_at ASC`;

    const cursor = this.sql.exec(q, ...params);
    const list: any[] = [];
    let r = cursor.next();
    while (!r.done && r.value) {
      list.push({ ...r.value, is_active: Boolean(r.value.is_active) });
      r = cursor.next();
    }
    return list;
  }

  // ==========================================
  // 2. MASTER DATA CACHE FOR CLIENT DB (8.1)
  // ==========================================

  getMastersCache(branchId: string, deviceCode?: string) {
    // 1. Items
    const itemsCursor = this.sql.exec(
      `SELECT id, name, barcode, selling_price_paise, purchase_price_paise, tax_rate_id, unit_id, is_active FROM items WHERE is_active = 1`,
    );
    const items: any[] = [];
    let it = itemsCursor.next();
    while (!it.done && it.value) {
      items.push(it.value);
      it = itemsCursor.next();
    }

    // 2. Customers / Parties
    const partiesCursor = this.sql.exec(
      `SELECT id, name, phone, gstin, type FROM parties WHERE is_active = 1 LIMIT 500`,
    );
    const parties: any[] = [];
    let p = partiesCursor.next();
    while (!p.done && p.value) {
      parties.push(p.value);
      p = partiesCursor.next();
    }

    // 3. Restaurant Tables
    const tablesCursor = this.sql.exec(
      `SELECT t.*, f.name as floor_name FROM restaurant_tables t LEFT JOIN restaurant_floors f ON t.floor_id = f.id WHERE t.branch_id = ?`,
      branchId,
    );
    const tables: any[] = [];
    let tb = tablesCursor.next();
    while (!tb.done && tb.value) {
      tables.push(tb.value);
      tb = tablesCursor.next();
    }

    // 4. Device info
    let device: any = null;
    if (deviceCode) {
      device = this.getDevice(deviceCode);
    }

    return {
      branchId,
      device,
      items,
      parties,
      tables,
      cachedAt: new Date().toISOString(),
    };
  }

  // ==========================================
  // 3. BATCH SYNC ENGINE WITH IDEMPOTENCY (8.3)
  // ==========================================

  private branchExists(id: string): boolean {
    return [...this.sql.exec('SELECT id FROM branches WHERE id = ?', id)].length > 0;
  }
  /** The business's real default branch (never a made-up id). */
  private defaultBranch(): string {
    const b = [...this.sql.exec('SELECT id FROM branches WHERE deleted_at IS NULL ORDER BY is_default DESC, created_at ASC LIMIT 1')][0] as { id: string } | undefined;
    if (!b) throw new Error('No branch set up for this business');
    return b.id;
  }

  syncMutations(batch: SyncBatchInput) {
    const now = new Date().toISOString();
    let syncedCount = 0;
    let duplicateCount = 0;
    const conflicts: any[] = [];

    for (const mutation of batch.mutations) {
      // 1. Check idempotency: Has this UUID already been synced?
      const checkCursor = this.sql.exec(
        `SELECT id, sync_status FROM offline_sync_mutations WHERE mutation_id = ? LIMIT 1`,
        mutation.mutationId,
      );
      const existing = checkCursor.next();
      if (!existing.done && existing.value) {
        duplicateCount++;
        continue; // Idempotently skip duplicate mutation
      }

      const mutId = `osm_${newId()}`;
      const payload = mutation.payload;
      let syncStatus: 'SYNCED' | 'CONFLICT' | 'REJECTED' = 'SYNCED';
      let conflictReason: string | null = null;

      try {
        if (mutation.entityType === 'INVOICE') {
          // Offline invoice replay is not supported yet: the old code wrote columns that do not exist.
          throw new Error('Offline bills cannot be uploaded yet. Please re-enter this bill at the POS while online.');
        }
        if (false as boolean) {
          // Sync offline invoice
          const invId = payload.id || `inv_off_${newId()}`;
          const invNo = payload.invoiceNumber;
          const total = Number(payload.totalPaise || 0);
          const subtotal = Number(payload.subtotalPaise || total);
          const tax = Number(payload.taxPaise || 0);

          this.sql.exec(
            `INSERT INTO invoices (
              id, invoice_number, branch_id, customer_party_id, date, status,
              subtotal_paise, tax_total_paise, total_paise, amount_paid_paise,
              balance_due_paise, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, 'PAID', ?, ?, ?, ?, 0, ?, ?)`,
            invId,
            invNo,
            (payload.branchId && this.branchExists(payload.branchId) ? payload.branchId : this.defaultBranch()),
            payload.customerPartyId || 'party_walk_in',
            payload.date || now.substring(0, 10),
            subtotal,
            tax,
            total,
            total,
            now,
            now,
          );

          // Stock deductions
          if (Array.isArray(payload.items)) {
            for (const itm of payload.items) {
              const ledgerId = `stk_${newId()}`;
              const qtyThousandths = Math.round(Number(itm.quantity || 1) * 1000);
              const ratePaise = Number(itm.ratePaise || 0);

              // Check current stock balance
              const balCursor = this.sql.exec(
                `SELECT current_qty_thousandths FROM stock_balances WHERE item_id = ? LIMIT 1`,
                itm.itemId,
              );
              const balRow = balCursor.next().value;
              const currentStock = balRow ? Number(balRow.current_qty_thousandths || 0) : 0;

              if (currentStock < qtyThousandths) {
                syncStatus = 'CONFLICT';
                conflictReason = `NEGATIVE_STOCK: Item ${itm.itemId} balance below zero (${(currentStock - qtyThousandths) / 1000})`;
                conflicts.push({
                  mutationId: mutation.mutationId,
                  invoiceNumber: invNo,
                  itemId: itm.itemId,
                  conflictReason,
                });
              }

              this.sql.exec(
                `INSERT INTO stock_ledgers (
                  id, date, branch_id, warehouse_id, item_id, doc_type, doc_id, doc_no,
                  qty_in_thousandths, qty_out_thousandths, rate_paise, balance_qty_thousandths, created_at
                )
                VALUES (?, ?, ?, 'wh_default', ?, 'OFFLINE_SALE', ?, ?, 0, ?, ?, 0, ?)`,
                ledgerId,
                now.substring(0, 10),
                (payload.branchId && this.branchExists(payload.branchId) ? payload.branchId : this.defaultBranch()),
                itm.itemId,
                invId,
                invNo,
                qtyThousandths,
                ratePaise,
                now,
              );
            }
          }
        } else if (mutation.entityType === 'KOT') {
          const kotId = payload.id || `kot_off_${newId()}`;
          this.sql.exec(
            `INSERT INTO kots (id, kot_no, order_id, branch_id, table_id, token_no, kitchen_notes, status, printed_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'PRINTED', ?, ?)`,
            kotId,
            payload.kotNo,
            payload.orderId || kotId,
            (payload.branchId && this.branchExists(payload.branchId) ? payload.branchId : this.defaultBranch()),
            payload.tableId || 'OFFLINE',
            payload.tokenNo || 1,
            payload.notes || 'Offline KOT',
            now,
            now,
          );
        }

        syncedCount++;
      } catch (err: any) {
        syncStatus = 'REJECTED';
        conflictReason = err?.message || 'Processing error';
      }

      // Record in audit mutation log
      const payloadJson = JSON.stringify(payload);
      this.sql.exec(
        `INSERT INTO offline_sync_mutations (
          id, device_id, mutation_id, entity_type, payload_json,
          sync_status, conflict_reason, synced_at, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        mutId,
        batch.deviceId,
        mutation.mutationId,
        mutation.entityType,
        payloadJson,
        syncStatus,
        conflictReason,
        now,
        now,
      );
    }

    // Update device last synced at
    this.sql.exec(
      `UPDATE pos_devices SET last_synced_at = ?, updated_at = ? WHERE id = ?`,
      now,
      now,
      batch.deviceId,
    );

    return {
      deviceId: batch.deviceId,
      totalMutations: batch.mutations.length,
      syncedCount,
      duplicateCount,
      conflictsCount: conflicts.length,
      conflicts,
      syncedAt: now,
    };
  }

  listConflicts(branchId?: string) {
    let q = `
      SELECT m.*, d.device_code, d.device_name
      FROM offline_sync_mutations m
      JOIN pos_devices d ON m.device_id = d.id
      WHERE m.sync_status = 'CONFLICT'
    `;
    const params: any[] = [];
    if (branchId) {
      q += ` AND d.branch_id = ?`;
      params.push(branchId);
    }
    q += ` ORDER BY m.synced_at DESC`;

    const cursor = this.sql.exec(q, ...params);
    const list: any[] = [];
    let r = cursor.next();
    while (!r.done && r.value) {
      list.push(r.value);
      r = cursor.next();
    }
    return list;
  }
}
