/**
 * Official GST Portal JSON Schemas & Return Types for GSTR-1, GSTR-3B, GSTR-2B
 */

export interface Gstr1B2bItem {
  num: number;
  itm_det: {
    rt: number; // e.g. 18.0, 5.0, 12.0
    txval: number; // In Rupees (2 decimals)
    iamt?: number;
    camt?: number;
    samt?: number;
    csamt?: number;
  };
}

export interface Gstr1B2bInvoice {
  inum: string;
  idt: string; // DD-MM-YYYY
  val: number; // Invoice total in Rupees
  pos: string; // State code e.g. "19", "27"
  rchrg: 'Y' | 'N';
  inv_typ: 'R' | 'DE' | 'SEWP' | 'SEWOP';
  itms: Gstr1B2bItem[];
}

export interface Gstr1B2bRecipient {
  ctin: string; // Customer GSTIN
  inv: Gstr1B2bInvoice[];
}

export interface Gstr1B2csSummary {
  sply_ty: 'INTER' | 'INTRA';
  rt: number;
  pos: string;
  typ: 'OE'; // Other than e-commerce
  txval: number;
  iamt?: number;
  camt?: number;
  samt?: number;
  csamt?: number;
}

export interface Gstr1HsnItem {
  num: number;
  hsn_sc: string;
  desc?: string;
  uqc: string;
  qty: number;
  val: number;
  txval: number;
  iamt?: number;
  camt?: number;
  samt?: number;
  csamt?: number;
}

export interface Gstr1DocSummaryItem {
  num: number;
  doc_num: number;
  from: string;
  to: string;
  totnum: number;
  canc: number;
  net_issue: number;
}

export interface Gstr1DocIssue {
  doc_det: {
    doc_num: number;
    docs: Gstr1DocSummaryItem[];
  }[];
}

export interface Gstr1JsonPayload {
  gstin: string;
  fp: string; // MMYYYY e.g. "042026"
  version: string; // "GST1.0"
  hash: string;
  b2b?: Gstr1B2bRecipient[];
  b2cl?: any[];
  b2cs?: Gstr1B2csSummary[];
  cdnr?: any[];
  cdnur?: any[];
  exp?: any[];
  at?: any[];
  atadj?: any[];
  hsn?: {
    data: Gstr1HsnItem[];
  };
  doc_issue?: Gstr1DocIssue;
}

export interface Gstr3bSummary {
  returnPeriod: string;
  gstin: string;
  outwardTaxableSupplies: {
    taxableValuePaise: number;
    igstPaise: number;
    cgstPaise: number;
    sgstPaise: number;
    cessPaise: number;
  };
  outwardZeroRatedSupplies: {
    taxableValuePaise: number;
    igstPaise: number;
    cessPaise: number;
  };
  otherOutwardSuppliesNilExempt: {
    taxableValuePaise: number;
  };
  inwardRcmSupplies: {
    taxableValuePaise: number;
    igstPaise: number;
    cgstPaise: number;
    sgstPaise: number;
    cessPaise: number;
  };
  eligibleItc: {
    allOtherItc: {
      igstPaise: number;
      cgstPaise: number;
      sgstPaise: number;
      cessPaise: number;
    };
    itcReversed: {
      igstPaise: number;
      cgstPaise: number;
      sgstPaise: number;
      cessPaise: number;
    };
    netItcAvailable: {
      igstPaise: number;
      cgstPaise: number;
      sgstPaise: number;
      cessPaise: number;
    };
    ineligibleItc17_5: {
      igstPaise: number;
      cgstPaise: number;
      sgstPaise: number;
      cessPaise: number;
    };
  };
  netTaxPayable: {
    igstPaise: number;
    cgstPaise: number;
    sgstPaise: number;
    cessPaise: number;
    totalPaise: number;
  };
}

export interface Gstr2bRecord {
  supplierGstin: string;
  tradeName?: string;
  invoiceNo: string;
  invoiceDate: string; // YYYY-MM-DD
  invoiceValuePaise: number;
  taxableValuePaise: number;
  igstPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  cessPaise: number;
  itcAvailable: boolean;
}

export interface Gstr2bReconciliationMatch {
  id: string;
  supplierGstin: string;
  invoiceNo: string;
  status: 'MATCHED' | 'MISMATCHED' | 'MISSING_IN_BOOKS' | 'MISSING_IN_2B';
  gstr2b?: Gstr2bRecord;
  purchaseBill?: {
    billId: string;
    billNo: string;
    billDate: string;
    taxableAmountPaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    totalPaise: number;
  };
  diffTaxablePaise: number;
  diffTaxPaise: number;
  discrepancyReason?: string;
}
