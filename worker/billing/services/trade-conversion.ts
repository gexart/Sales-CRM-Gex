import { isTradeDocType, type ConversionTarget } from '@billing/shared';
import type { InvoiceService } from './invoice';
import type { PurchaseService } from './purchase';
import { TradeDocumentService } from './trade-documents';

export interface ConvertInput {
  documentId: string;
  target: ConversionTarget;
  /** quantities (thousandths) per source line id; omitted = everything still open */
  quantities?: Record<string, number>;
  date?: string;
  dueDate?: string;
  warehouseId?: string;
  createdById: string;
}

export interface ConvertResult {
  target: ConversionTarget;
  id: string;
  no: string;
  source: any;
}

interface Sql {
  exec(query: string, ...bindings: unknown[]): { toArray(): any[] };
}

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Quotation → Sales Order / Proforma / Invoice, Proforma → Invoice, Sales Order → Challan / Packing List / Invoice,
 * Challan / Packing List → Invoice, Purchase Order → Purchase Bill. Runs inside one BusinessDO transaction so the
 * new document, its journal (for invoices / bills) and the source's "converted" mark succeed or fail together.
 */
export function convertTradeDocument(
  sql: Sql,
  deps: { invoices: InvoiceService; purchases: PurchaseService },
  input: ConvertInput,
): ConvertResult {
  const docs = new TradeDocumentService(sql);
  const { doc, lines, taken } = docs.prepareConversion(input.documentId, input.target, input.quantities);
  const date = input.date ?? today();
  const source = { type: String(doc.doc_type), id: String(doc.id), no: String(doc.doc_no) };

  const warehouseFor = () => {
    if (input.warehouseId) return input.warehouseId;
    const w = sql.exec('SELECT id FROM warehouses WHERE branch_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, created_at ASC LIMIT 1', doc.branch_id).toArray()[0];
    if (!w) throw new Error('No warehouse for this branch');
    return String(w.id);
  };
  const requireItems = () => {
    const missing = lines.filter((l) => !l.itemId).map((l) => l.name);
    if (missing.length) throw new Error(`Pick these from your product list first: ${missing.join(', ')}`);
  };
  const unitOf = (itemId: string, unitId?: string | null) => {
    if (unitId) return unitId;
    const it = sql.exec('SELECT unit_id FROM items WHERE id = ?', itemId).toArray()[0];
    if (!it) throw new Error('Product not found');
    return String(it.unit_id);
  };

  let created: { id: string; no: string };
  if (isTradeDocType(input.target)) {
    const next = docs.create({
      docType: input.target,
      branchId: String(doc.branch_id),
      partyId: String(doc.party_id),
      date,
      validUntil: input.dueDate,
      lines,
      shippingAddress: doc.shipping_address ?? undefined,
      notes: doc.notes ?? undefined,
      terms: doc.terms ?? undefined,
      createdById: input.createdById,
      source,
    });
    created = { id: String(next.id), no: String(next.doc_no) };
  } else if (input.target === 'INVOICE') {
    requireItems();
    const res = deps.invoices.createInvoice({
      branchId: String(doc.branch_id),
      warehouseId: warehouseFor(),
      partyId: String(doc.party_id),
      partyName: String(doc.party_name),
      partyGstin: doc.party_gstin ?? undefined,
      partyStateCode: String(doc.party_state_code),
      date,
      dueDate: input.dueDate ?? date,
      items: lines.map((l) => ({
        itemId: String(l.itemId),
        name: l.name,
        hsnSac: l.hsnSac ?? '',
        quantityThousandths: l.quantityThousandths,
        unitId: unitOf(String(l.itemId), l.unitId),
        unitPricePaise: l.unitPricePaise,
        discountPaise: l.discountPaise,
        taxRatePercent: l.taxRateBasisPoints / 100,
        isTaxInclusive: l.isTaxInclusive,
      })),
      notes: `Converted from ${source.no}${doc.notes ? `\n${doc.notes}` : ''}`,
      terms: doc.terms ?? undefined,
      createdById: input.createdById,
    });
    sql.exec(
      'UPDATE invoices SET source_doc_type = ?, source_doc_id = ?, source_doc_no = ? WHERE id = ?',
      source.type, source.id, source.no, res.invoice.id,
    );
    created = { id: String(res.invoice.id), no: String(res.invoice.invoiceNo) };
  } else {
    requireItems();
    const bill = deps.purchases.createPurchaseBill({
      branchId: String(doc.branch_id),
      warehouseId: warehouseFor(),
      partyId: String(doc.party_id),
      date,
      dueDate: input.dueDate,
      lines: lines.map((l) => ({
        itemId: String(l.itemId),
        quantityThousandths: l.quantityThousandths,
        unitPricePaise: l.unitPricePaise,
        taxRateBasisPoints: l.taxRateBasisPoints,
        discountPaise: l.discountPaise,
      })),
      notes: `Against ${source.no}`,
    }) as { id: string; bill_no: string };
    sql.exec('UPDATE purchase_bills SET source_doc_no = ? WHERE id = ?', source.no, bill.id);
    created = { id: String(bill.id), no: String(bill.bill_no) };
  }

  const updated = docs.markConverted(String(doc.id), { type: input.target, ...created }, taken, input.createdById);
  return { target: input.target, ...created, source: updated };
}
