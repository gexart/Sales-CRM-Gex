import {
  calculateDocumentGst,
  canConvert,
  Decimal,
  newId,
  TRADE_DOCS,
  type ConversionTarget,
  type GstCalculationContext,
  type GstLineItemInput,
  type TradeDocStatus,
  type TradeDocType,
} from '@billing/shared';
import { allocateDocNumber } from './numbering';

/**
 * Quotations, proforma invoices, sales orders, delivery challans, packing lists and purchase orders.
 * None of these post to the books; converting to an INVOICE / PURCHASE_BILL does (through the invoice /
 * purchase services). Every write runs inside the BusinessDO transaction.
 */

export interface TradeLineInput {
  itemId?: string | null;
  name: string;
  hsnSac?: string;
  unitId?: string | null;
  quantityThousandths: number;
  unitPricePaise: number;
  discountPaise?: number;
  taxRateBasisPoints: number;
  isTaxInclusive?: boolean;
}

export interface CreateTradeDocInput {
  docType: TradeDocType;
  branchId: string;
  partyId: string;
  date: string;
  validUntil?: string;
  lines: TradeLineInput[];
  extraDiscountPaise?: number;
  shippingAddress?: string;
  transport?: { mode?: string; vehicleNo?: string; lrNo?: string; transporter?: string };
  notes?: string;
  terms?: string;
  status?: 'DRAFT' | 'OPEN';
  createdById: string;
  /** set by conversions */
  source?: { type: string; id: string; no: string };
}

export interface ListTradeDocsParams {
  docType: TradeDocType;
  status?: string;
  partyId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

interface Sql {
  exec(query: string, ...bindings: unknown[]): { toArray(): any[] };
}

const toPaise = (d: Decimal) => d.mul(100).round().toNumber();
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export class TradeDocumentService {
  constructor(private sql: Sql) {}

  private one<T = any>(q: string, ...b: unknown[]): T | undefined {
    return this.sql.exec(q, ...b).toArray()[0] as T | undefined;
  }

  private audit(userId: string, action: string, id: string, before: unknown, after: unknown) {
    this.sql.exec(
      `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, before_json, after_json, created_at) VALUES (?, ?, ?, 'trade_document', ?, ?, ?, ?)`,
      newId(), userId, action, id, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), new Date().toISOString(),
    );
  }

  create(input: CreateTradeDocInput): any {
    if (!TRADE_DOCS[input.docType]) throw new Error('UNKNOWN_DOC_TYPE');
    if (!input.lines?.length) throw new Error('Add at least one item');
    if (!isoDate.test(input.date)) throw new Error('Date must be YYYY-MM-DD');
    if (input.validUntil && (!isoDate.test(input.validUntil) || input.validUntil < input.date)) throw new Error('Valid-until date must be on or after the document date');
    for (const l of input.lines) {
      if (!l.name?.trim()) throw new Error('Every line needs an item name');
      if (!Number.isInteger(l.quantityThousandths) || l.quantityThousandths <= 0) throw new Error(`Quantity must be more than zero for ${l.name}`);
      if (!Number.isInteger(l.unitPricePaise) || l.unitPricePaise < 0) throw new Error(`Price cannot be negative for ${l.name}`);
    }

    const branch = this.one<{ id: string; state_code: string }>('SELECT id, state_code FROM branches WHERE id = ?', input.branchId);
    if (!branch) throw new Error('Branch not found');
    const party = this.one<{ id: string; name: string; gstin: string | null; state_code: string; shipping_address: string | null; billing_address: string | null }>(
      'SELECT id, name, gstin, state_code, shipping_address, billing_address FROM parties WHERE id = ? AND deleted_at IS NULL', input.partyId,
    );
    if (!party) throw new Error('Customer / vendor not found');

    // For a purchase order the vendor is the supplier: place of supply is OUR state.
    const isPurchase = TRADE_DOCS[input.docType].side === 'purchase';
    const ctx: GstCalculationContext = {
      sellerStateCode: isPurchase ? party.state_code : branch.state_code,
      placeOfSupplyStateCode: isPurchase ? branch.state_code : party.state_code,
      isExportOrSez: false,
      isZeroRated: false,
    };
    const gstLines: GstLineItemInput[] = input.lines.map((l) => ({
      quantity: new Decimal(l.quantityThousandths).div(1000),
      unitPrice: new Decimal(l.unitPricePaise).div(100),
      isTaxInclusive: Boolean(l.isTaxInclusive),
      taxRatePercent: l.taxRateBasisPoints / 100,
      discountAmount: l.discountPaise ? new Decimal(l.discountPaise).div(100) : 0,
      cessPercent: 0,
    }));
    const calc = calculateDocumentGst(gstLines, ctx, new Decimal(input.extraDiscountPaise ?? 0).div(100), true);

    const { docNumber, seriesId } = allocateDocNumber(this.sql, {
      docType: input.docType, branchId: input.branchId, date: input.date, partyId: input.partyId,
    });
    const id = newId();
    const now = new Date().toISOString();
    const discountPaise = (input.extraDiscountPaise ?? 0) + input.lines.reduce((s, l) => s + (l.discountPaise ?? 0), 0);
    this.sql.exec(
      `INSERT INTO trade_documents (
        id, doc_type, doc_no, series_id, branch_id, party_id, party_name, party_gstin, party_state_code, date, valid_until, status,
        subtotal_paise, discount_paise, cgst_paise, sgst_paise, igst_paise, cess_paise, tax_total_paise, round_off_paise, total_paise,
        shipping_address, transport_json, notes, terms, source_doc_type, source_doc_id, source_doc_no, converted_json, created_by_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
      id, input.docType, docNumber, seriesId, input.branchId, party.id, party.name, party.gstin, party.state_code, input.date,
      input.validUntil ?? null, input.status ?? 'OPEN',
      toPaise(calc.taxableSubtotal), discountPaise, toPaise(calc.cgstTotal), toPaise(calc.sgstTotal), toPaise(calc.igstTotal),
      toPaise(calc.cessTotal), toPaise(calc.taxTotal), toPaise(calc.roundOffAmount), toPaise(calc.grandTotal),
      input.shippingAddress?.trim() || party.shipping_address || party.billing_address || null,
      input.transport ? JSON.stringify(input.transport) : null,
      input.notes?.trim() || null, input.terms?.trim() || null,
      input.source?.type ?? null, input.source?.id ?? null, input.source?.no ?? null,
      input.createdById, now, now,
    );
    input.lines.forEach((l, i) => {
      const r = calc.lines[i]!;
      this.sql.exec(
        `INSERT INTO trade_document_lines (id, document_id, line_no, item_id, name, hsn_sac, unit_id, quantity_thousandths, unit_price_paise,
          discount_paise, tax_rate_basis_points, is_tax_inclusive, taxable_paise, tax_paise, line_total_paise)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newId(), id, i + 1, l.itemId ?? null, l.name.trim(), l.hsnSac?.trim() || null, l.unitId ?? null, l.quantityThousandths,
        l.unitPricePaise, l.discountPaise ?? 0, l.taxRateBasisPoints, l.isTaxInclusive ? 1 : 0,
        toPaise(r.taxableAmount), toPaise(r.totalTaxAmount), toPaise(r.totalLineAmount),
      );
    });
    const doc = this.get(id);
    this.audit(input.createdById, 'CREATE', id, null, { docType: input.docType, docNo: docNumber, total: doc.total_paise });
    return doc;
  }

  get(id: string): any {
    const doc = this.one('SELECT * FROM trade_documents WHERE id = ? AND deleted_at IS NULL', id);
    if (!doc) throw new Error('NOT_FOUND');
    const lines = this.sql.exec('SELECT * FROM trade_document_lines WHERE document_id = ? ORDER BY line_no', id).toArray();
    const converted = ((): unknown[] => {
      try {
        return JSON.parse(String(doc.converted_json || '[]'));
      } catch {
        return [];
      }
    })();
    return { ...doc, transport: doc.transport_json ? JSON.parse(String(doc.transport_json)) : null, converted, lines };
  }

  list(p: ListTradeDocsParams): { documents: any[]; totalCount: number; counts: Record<string, number>; totalPaise: number } {
    let base = 'WHERE deleted_at IS NULL AND doc_type = ?';
    const args: unknown[] = [p.docType];
    if (p.partyId) {
      base += ' AND party_id = ?';
      args.push(p.partyId);
    }
    if (p.startDate) {
      base += ' AND date >= ?';
      args.push(p.startDate);
    }
    if (p.endDate) {
      base += ' AND date <= ?';
      args.push(p.endDate);
    }
    if (p.search) {
      const q = `%${p.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      base += " AND (doc_no LIKE ? ESCAPE '\\' OR party_name LIKE ? ESCAPE '\\')";
      args.push(q, q);
    }
    const countRows = this.sql.exec(`SELECT status, COUNT(*) AS n FROM trade_documents ${base} GROUP BY status`, ...args).toArray();
    const counts: Record<string, number> = { ALL: 0 };
    for (const r of countRows) {
      counts[String(r.status)] = Number(r.n);
      counts.ALL! += Number(r.n);
    }
    let where = base;
    const wargs = [...args];
    if (p.status && p.status !== 'ALL') {
      where += ' AND status = ?';
      wargs.push(p.status);
    }
    const t = this.one<{ c: number; s: number }>(`SELECT COUNT(*) AS c, COALESCE(SUM(total_paise), 0) AS s FROM trade_documents ${where}`, ...wargs);
    const limit = Math.min(Math.max(Math.trunc(p.limit ?? 50) || 50, 1), 500);
    const offset = Math.max(Math.trunc(p.offset ?? 0) || 0, 0);
    const documents = this.sql
      .exec(`SELECT * FROM trade_documents ${where} ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?`, ...wargs, limit, offset)
      .toArray();
    return { documents, totalCount: Number(t?.c ?? 0), counts, totalPaise: Number(t?.s ?? 0) };
  }

  setStatus(id: string, status: TradeDocStatus, userId: string): any {
    const doc = this.get(id);
    const def = TRADE_DOCS[doc.doc_type as TradeDocType];
    if (!def.manualStatuses.includes(status)) throw new Error(`Status ${status} cannot be set by hand`);
    if (doc.status === 'CONVERTED' || doc.status === 'CANCELLED') throw new Error(`A ${doc.status.toLowerCase()} document cannot be changed`);
    this.sql.exec('UPDATE trade_documents SET status = ?, updated_at = ? WHERE id = ?', status, new Date().toISOString(), id);
    this.audit(userId, 'STATUS', id, { status: doc.status }, { status });
    return this.get(id);
  }

  /**
   * Lines still open for conversion (quantity minus what earlier conversions already took). Used to build the
   * next document and to support partial deliveries (Sales Order → several challans).
   */
  remainingLines(id: string): (TradeLineInput & { lineId: string; remainingThousandths: number })[] {
    const doc = this.get(id);
    return doc.lines
      .map((l: any) => ({
        lineId: String(l.id),
        itemId: l.item_id ?? null,
        name: String(l.name),
        hsnSac: l.hsn_sac ?? undefined,
        unitId: l.unit_id ?? null,
        quantityThousandths: Number(l.quantity_thousandths) - Number(l.converted_thousandths),
        remainingThousandths: Number(l.quantity_thousandths) - Number(l.converted_thousandths),
        unitPricePaise: Number(l.unit_price_paise),
        discountPaise: Number(l.discount_paise),
        taxRateBasisPoints: Number(l.tax_rate_basis_points),
        isTaxInclusive: Boolean(l.is_tax_inclusive),
      }))
      .filter((l: { remainingThousandths: number }) => l.remainingThousandths > 0);
  }

  /**
   * Record that (part of) a document became another document. `taken` = quantities per source line.
   * Marks the source CONVERTED when nothing is left, otherwise PARTIAL. Keeps a link list on the source.
   */
  markConverted(id: string, target: { type: ConversionTarget; id: string; no: string }, taken: Record<string, number>, userId: string) {
    const doc = this.get(id);
    if (!canConvert(doc.doc_type, target.type)) throw new Error(`${doc.doc_type} cannot be converted to ${target.type}`);
    for (const [lineId, qty] of Object.entries(taken)) {
      this.sql.exec(
        'UPDATE trade_document_lines SET converted_thousandths = MIN(quantity_thousandths, converted_thousandths + ?) WHERE id = ? AND document_id = ?',
        Math.trunc(qty), lineId, id,
      );
    }
    const left = this.one<{ n: number }>('SELECT COUNT(*) AS n FROM trade_document_lines WHERE document_id = ? AND converted_thousandths < quantity_thousandths', id);
    const status = Number(left?.n ?? 0) === 0 ? 'CONVERTED' : 'PARTIAL';
    const links = [...(doc.converted as unknown[]), { ...target, at: new Date().toISOString() }];
    this.sql.exec('UPDATE trade_documents SET status = ?, converted_json = ?, updated_at = ? WHERE id = ?', status, JSON.stringify(links), new Date().toISOString(), id);
    this.audit(userId, 'CONVERT', id, { status: doc.status }, { status, target });
    return this.get(id);
  }

  /** Validate a conversion request and return the lines to carry over (all remaining, or the chosen quantities). */
  prepareConversion(id: string, targetType: string, quantities?: Record<string, number>) {
    const doc = this.get(id);
    if (doc.status === 'CANCELLED' || doc.status === 'DECLINED') throw new Error(`A ${String(doc.status).toLowerCase()} document cannot be converted`);
    if (doc.status === 'CONVERTED') throw new Error('This document is already fully converted');
    if (!canConvert(doc.doc_type, targetType)) throw new Error(`${TRADE_DOCS[doc.doc_type as TradeDocType].label} cannot be converted to ${targetType}`);
    const remaining = this.remainingLines(id);
    const lines = remaining
      .map((l) => {
        const want = quantities?.[l.lineId];
        const qty = want === undefined ? l.remainingThousandths : Math.min(Math.trunc(want), l.remainingThousandths);
        return { ...l, quantityThousandths: qty };
      })
      .filter((l) => l.quantityThousandths > 0);
    if (!lines.length) throw new Error('Nothing left to convert');
    const taken = Object.fromEntries(lines.map((l) => [l.lineId, l.quantityThousandths]));
    return { doc, lines, taken };
  }
}
