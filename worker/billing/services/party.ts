import { newId, validateGstin } from '@billing/shared';

export interface PartyInput {
  type?: 'CUSTOMER' | 'VENDOR' | 'BOTH';
  name: string;
  company?: string;
  phone: string;
  email?: string;
  gstin?: string;
  pan?: string;
  billingAddress?: string;
  shippingAddress?: string;
  stateCode: string;
  creditLimitPaise?: number;
  creditDays?: number;
  openingBalancePaise?: number;
  openingBalanceType?: 'RECEIVE' | 'PAY';
  tags?: string[];
  notes?: string;
  /** Customer-wise bill-number prefix / suffix (tokens allowed). */
  docPrefix?: string;
  docSuffix?: string;
}

export interface PartyRecord extends PartyInput {
  id: string;
  loyaltyPoints: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface PartyLedgerEntry {
  id: string;
  date: string;
  type: string;
  docNumber: string;
  debitPaise: number;
  creditPaise: number;
  balancePaise: number;
  narration?: string;
}

export class PartyService {
  constructor(private sql: any) {}

  private static likeEscape(s: string): string {
    return s.replace(/[\\%_]/g, (m) => `\\${m}`);
  }

  create(data: PartyInput): PartyRecord {
    const id = `pty_${newId()}`;
    const now = new Date().toISOString();

    const gstin = data.gstin?.trim().toUpperCase() || null;
    if (gstin) {
      const gstinVal = validateGstin(gstin);
      if (!gstinVal.isValid) throw new Error(`Invalid GSTIN: ${gstinVal.error}`);
    }
    const pan = data.pan?.trim().toUpperCase() || (gstin && gstin.length === 15 ? gstin.substring(2, 12) : null);

    this.sql.exec(
      `INSERT INTO parties (
        id, type, name, company, phone, email, gstin, pan, billing_address, shipping_address,
        state_code, credit_limit_paise, credit_days, opening_balance_paise, opening_balance_type,
        tags_json, notes, loyalty_points, doc_prefix, doc_suffix, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      id,
      data.type === 'VENDOR' || data.type === 'BOTH' ? data.type : 'CUSTOMER',
      data.name.trim(),
      data.company?.trim() || null,
      data.phone.trim(),
      data.email?.trim() || null,
      gstin,
      pan,
      data.billingAddress?.trim() || null,
      data.shippingAddress?.trim() || null,
      data.stateCode.trim(),
      Math.trunc(data.creditLimitPaise || 0),
      Math.trunc(data.creditDays || 0),
      Math.trunc(data.openingBalancePaise || 0),
      data.openingBalanceType === 'PAY' ? 'PAY' : 'RECEIVE',
      JSON.stringify(data.tags || []),
      data.notes?.trim() || null,
      data.docPrefix?.trim().toUpperCase() || null,
      data.docSuffix?.trim().toUpperCase() || null,
      now,
      now,
    );

    return this.getById(id)!;
  }

  update(id: string, data: Partial<PartyInput>): PartyRecord {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Party ${id} not found`);

    if (data.gstin && data.gstin.trim()) {
      const gstinVal = validateGstin(data.gstin.trim());
      if (!gstinVal.isValid) throw new Error(`Invalid GSTIN: ${gstinVal.error}`);
    }

    // Column names come only from this fixed list; values are always bound.
    const sets: string[] = ['updated_at = ?'];
    const args: unknown[] = [new Date().toISOString()];
    const set = (col: string, v: unknown) => {
      sets.push(`${col} = ?`);
      args.push(v);
    };
    if (data.type) set('type', data.type === 'VENDOR' || data.type === 'BOTH' ? data.type : 'CUSTOMER');
    if (data.name) set('name', data.name.trim());
    if (data.company !== undefined) set('company', data.company?.trim() || null);
    if (data.phone) set('phone', data.phone.trim());
    if (data.email !== undefined) set('email', data.email?.trim() || null);
    if (data.gstin !== undefined) set('gstin', data.gstin?.trim().toUpperCase() || null);
    if (data.billingAddress !== undefined) set('billing_address', data.billingAddress?.trim() || null);
    if (data.shippingAddress !== undefined) set('shipping_address', data.shippingAddress?.trim() || null);
    if (data.stateCode) set('state_code', data.stateCode.trim());
    if (data.creditLimitPaise !== undefined) set('credit_limit_paise', Math.trunc(data.creditLimitPaise || 0));
    if (data.creditDays !== undefined) set('credit_days', Math.trunc(data.creditDays || 0));
    if (data.notes !== undefined) set('notes', data.notes?.trim() || null);
    if (data.tags !== undefined) set('tags_json', JSON.stringify(data.tags || []));
    if (data.docPrefix !== undefined) set('doc_prefix', data.docPrefix?.trim().toUpperCase() || null);
    if (data.docSuffix !== undefined) set('doc_suffix', data.docSuffix?.trim().toUpperCase() || null);

    this.sql.exec(`UPDATE parties SET ${sets.join(', ')} WHERE id = ?`, ...args, id);
    return this.getById(id)!;
  }

  delete(id: string): boolean {
    const now = new Date().toISOString();
    this.sql.exec(`UPDATE parties SET deleted_at = ?, updated_at = ? WHERE id = ?`, now, now, id);
    return true;
  }

  getById(id: string): PartyRecord | null {
    const row = this.sql.exec(`SELECT * FROM parties WHERE id = ? AND deleted_at IS NULL LIMIT 1`, String(id)).toArray()[0];
    return row ? this.mapRow(row) : null;
  }

  list(options: {
    type?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {}): { parties: PartyRecord[]; total: number } {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50) || 50, 1), 500);
    const offset = Math.max(Math.trunc(options.offset ?? 0) || 0, 0);
    const conditions = ['deleted_at IS NULL'];
    const args: unknown[] = [];

    if (options.type && options.type !== 'ALL') {
      conditions.push(`(type = ? OR type = 'BOTH')`);
      args.push(String(options.type));
    }
    if (options.search && options.search.trim()) {
      const q = `%${PartyService.likeEscape(options.search.trim().toLowerCase())}%`;
      conditions.push(
        `(lower(name) LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR lower(company) LIKE ? ESCAPE '\\' OR lower(gstin) LIKE ? ESCAPE '\\')`,
      );
      args.push(q, q, q, q);
    }

    const whereClause = conditions.join(' AND ');
    const countRow = this.sql.exec(`SELECT count(*) as total FROM parties WHERE ${whereClause}`, ...args).toArray()[0];
    const total = countRow ? Number(countRow.total) : 0;
    const rows = this.sql
      .exec(`SELECT * FROM parties WHERE ${whereClause} ORDER BY name ASC LIMIT ? OFFSET ?`, ...args, limit, offset)
      .toArray();
    return { parties: rows.map((r: any) => this.mapRow(r)), total };
  }

  /**
   * Party statement with running balance (positive = party owes us, negative = we owe the party).
   * Sales invoices and payments made raise it; credit notes, purchase bills, debit notes reverse, payments received lower it.
   */
  getLedger(partyId: string): {
    party: PartyRecord;
    openingBalancePaise: number;
    entries: PartyLedgerEntry[];
    currentOutstandingPaise: number;
  } {
    const party = this.getById(partyId);
    if (!party) throw new Error(`Party ${partyId} not found`);

    const opening = party.openingBalanceType === 'PAY' ? -(party.openingBalancePaise || 0) : party.openingBalancePaise || 0;
    const rows = this.sql
      .exec(
        `SELECT id, date, 'INVOICE' AS type, invoice_no AS doc_no, total_paise AS debit, 0 AS credit, 'Sales invoice ' || invoice_no AS narration, created_at
           FROM invoices WHERE party_id = ? AND deleted_at IS NULL AND status != 'CANCELLED'
         UNION ALL
         SELECT id, date, 'CREDIT_NOTE', note_no, 0, total_paise, 'Credit note ' || note_no, created_at
           FROM credit_notes WHERE party_id = ? AND status != 'CANCELLED'
         UNION ALL
         SELECT id, date, 'PURCHASE_BILL', bill_no, 0, total_paise, 'Purchase bill ' || bill_no, created_at
           FROM purchase_bills WHERE party_id = ? AND status != 'CANCELLED'
         UNION ALL
         SELECT id, date, 'DEBIT_NOTE', note_no, total_paise, 0, 'Debit note ' || note_no, created_at
           FROM debit_notes WHERE party_id = ?
         UNION ALL
         SELECT id, date, CASE type WHEN 'IN' THEN 'PAYMENT_RECEIVED' ELSE 'PAYMENT_MADE' END, payment_no,
                CASE type WHEN 'IN' THEN 0 ELSE amount_paise END, CASE type WHEN 'IN' THEN amount_paise ELSE 0 END,
                'Payment ' || CASE type WHEN 'IN' THEN 'received' ELSE 'made' END || ' via ' || mode, created_at
           FROM payments WHERE party_id = ?
         ORDER BY date ASC, created_at ASC`,
        partyId, partyId, partyId, partyId, partyId,
      )
      .toArray() as { id: string; date: string; type: string; doc_no: string; debit: number; credit: number; narration: string }[];

    let running = opening;
    const entries: PartyLedgerEntry[] = rows.map((r) => {
      running += Number(r.debit) - Number(r.credit);
      return {
        id: String(r.id),
        date: String(r.date),
        type: r.type,
        docNumber: String(r.doc_no),
        debitPaise: Number(r.debit),
        creditPaise: Number(r.credit),
        balancePaise: running,
        narration: r.narration,
      };
    });

    return { party, openingBalancePaise: party.openingBalancePaise || 0, entries, currentOutstandingPaise: running };
  }

  private mapRow(row: any): PartyRecord {
    let tags: string[];
    try {
      tags = JSON.parse(String(row.tags_json || '[]'));
    } catch {
      tags = [];
    }

    return {
      id: String(row.id),
      type: row.type,
      name: String(row.name),
      company: row.company ? String(row.company) : undefined,
      phone: String(row.phone),
      email: row.email ? String(row.email) : undefined,
      gstin: row.gstin ? String(row.gstin) : undefined,
      pan: row.pan ? String(row.pan) : undefined,
      billingAddress: row.billing_address ? String(row.billing_address) : undefined,
      shippingAddress: row.shipping_address ? String(row.shipping_address) : undefined,
      stateCode: String(row.state_code),
      creditLimitPaise: Number(row.credit_limit_paise || 0),
      creditDays: Number(row.credit_days || 0),
      openingBalancePaise: Number(row.opening_balance_paise || 0),
      openingBalanceType: row.opening_balance_type,
      tags,
      notes: row.notes ? String(row.notes) : undefined,
      docPrefix: row.doc_prefix ? String(row.doc_prefix) : undefined,
      docSuffix: row.doc_suffix ? String(row.doc_suffix) : undefined,
      loyaltyPoints: Number(row.loyalty_points || 0),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    };
  }
}
