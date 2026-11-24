/**
 * Trade documents that are not tax invoices: quotations, proforma invoices, sales orders, delivery challans,
 * packing lists and purchase orders. One definition drives the API, the list/create/view screens and the
 * allowed conversions (Quotation → Sales Order → Challan → Invoice, Proforma → Invoice, PO → Purchase Bill).
 */

export const TRADE_DOC_TYPES = [
  'QUOTATION',
  'PROFORMA',
  'SALES_ORDER',
  'DELIVERY_CHALLAN',
  'PACKING_LIST',
  'PURCHASE_ORDER',
] as const;
export type TradeDocType = (typeof TRADE_DOC_TYPES)[number];

/** Targets a document can be converted into. INVOICE and PURCHASE_BILL are the posted (accounting) documents. */
export type ConversionTarget = TradeDocType | 'INVOICE' | 'PURCHASE_BILL';

export type TradeDocStatus = 'DRAFT' | 'OPEN' | 'ACCEPTED' | 'DECLINED' | 'PARTIAL' | 'CONVERTED' | 'CANCELLED' | 'EXPIRED';

export interface TradeDocDef {
  type: TradeDocType;
  label: string;
  plural: string;
  short: string;
  side: 'sales' | 'purchase';
  /** App list route; create = `${route}/new`, view = `${route}/:id` */
  route: string;
  /** Label of the date that ends validity / expected delivery */
  validLabel: string;
  converts: ConversionTarget[];
  /** Statuses a user may set by hand (others come from conversions) */
  manualStatuses: TradeDocStatus[];
}

export const TRADE_DOCS: Record<TradeDocType, TradeDocDef> = {
  QUOTATION: {
    type: 'QUOTATION', label: 'Quotation', plural: 'Quotations', short: 'QT', side: 'sales', route: '/sales/quotations',
    validLabel: 'Valid until', converts: ['SALES_ORDER', 'PROFORMA', 'INVOICE'], manualStatuses: ['OPEN', 'ACCEPTED', 'DECLINED', 'CANCELLED'],
  },
  PROFORMA: {
    type: 'PROFORMA', label: 'Proforma Invoice', plural: 'Proforma Invoices', short: 'PI', side: 'sales', route: '/sales/proforma',
    validLabel: 'Valid until', converts: ['INVOICE', 'SALES_ORDER'], manualStatuses: ['OPEN', 'ACCEPTED', 'CANCELLED'],
  },
  SALES_ORDER: {
    type: 'SALES_ORDER', label: 'Sales Order', plural: 'Sales Orders', short: 'SO', side: 'sales', route: '/sales/sales-orders',
    validLabel: 'Expected delivery', converts: ['DELIVERY_CHALLAN', 'PACKING_LIST', 'INVOICE'], manualStatuses: ['OPEN', 'CANCELLED'],
  },
  DELIVERY_CHALLAN: {
    type: 'DELIVERY_CHALLAN', label: 'Delivery Challan', plural: 'Delivery Challans', short: 'DC', side: 'sales', route: '/sales/delivery-challans',
    validLabel: 'Delivery date', converts: ['INVOICE'], manualStatuses: ['OPEN', 'CANCELLED'],
  },
  PACKING_LIST: {
    type: 'PACKING_LIST', label: 'Packing List', plural: 'Packing Lists', short: 'PL', side: 'sales', route: '/sales/packing-lists',
    validLabel: 'Dispatch date', converts: ['INVOICE'], manualStatuses: ['OPEN', 'CANCELLED'],
  },
  PURCHASE_ORDER: {
    type: 'PURCHASE_ORDER', label: 'Purchase Order', plural: 'Purchase Orders', short: 'PO', side: 'purchase', route: '/purchases/orders',
    validLabel: 'Expected delivery', converts: ['PURCHASE_BILL'], manualStatuses: ['OPEN', 'ACCEPTED', 'CANCELLED'],
  },
};

export function isTradeDocType(v: string): v is TradeDocType {
  return (TRADE_DOC_TYPES as readonly string[]).includes(v);
}

export function canConvert(from: TradeDocType, to: string): to is ConversionTarget {
  return (TRADE_DOCS[from].converts as string[]).includes(to);
}

/** Trade document for an app route like `/sales/quotations/new` → QUOTATION. */
export function tradeDocForRoute(path: string): TradeDocType | null {
  for (const d of Object.values(TRADE_DOCS)) {
    if (path === d.route || path.startsWith(`${d.route}/`)) return d.type;
  }
  return null;
}

export const TRADE_STATUS_LABEL: Record<TradeDocStatus, string> = {
  DRAFT: 'Draft',
  OPEN: 'Open',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  PARTIAL: 'Partly converted',
  CONVERTED: 'Converted',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

export const CONVERSION_LABEL: Record<ConversionTarget, string> = {
  QUOTATION: 'Quotation',
  PROFORMA: 'Proforma Invoice',
  SALES_ORDER: 'Sales Order',
  DELIVERY_CHALLAN: 'Delivery Challan',
  PACKING_LIST: 'Packing List',
  PURCHASE_ORDER: 'Purchase Order',
  INVOICE: 'Invoice',
  PURCHASE_BILL: 'Purchase Bill',
};
