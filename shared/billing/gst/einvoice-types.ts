/**
 * NIC / GSTN E-Invoice & E-Way Bill Specifications
 */

export interface EInvoicePayload {
  version: '1.03';
  tranDtls: {
    taxSch: 'GST';
    supTyp: 'B2B' | 'SEZWP' | 'SEZWOP' | 'EXPWP' | 'EXPWOP' | 'DEXP';
    regRev?: 'Y' | 'N';
    igstOnIntra?: 'Y' | 'N';
  };
  docDtls: {
    typ: 'INV' | 'CRN' | 'DBN';
    no: string;
    dt: string; // DD/MM/YYYY
  };
  sellerDtls: {
    gstin: string;
    lglNm: string;
    trdNm?: string;
    addr1: string;
    loc: string;
    pin: number;
    stcd: string;
  };
  buyerDtls: {
    gstin: string;
    lglNm: string;
    trdNm?: string;
    pos: string;
    addr1: string;
    loc: string;
    pin: number;
    stcd: string;
  };
  itemList: {
    itemNo: string;
    prdDesc: string;
    isServc: 'Y' | 'N';
    hsnCd: string;
    qty: number;
    unit: string;
    unitPrice: number;
    totAmt: number;
    discount?: number;
    assAmt: number;
    gstRt: number;
    igstAmt?: number;
    cgstAmt?: number;
    sgstAmt?: number;
    cesAmt?: number;
    totItemVal: number;
  }[];
  valDtls: {
    assVal: number;
    cgstVal?: number;
    sgstVal?: number;
    igstVal?: number;
    cesVal?: number;
    rndOffAmt?: number;
    totInvVal: number;
  };
}

export interface EInvoiceResult {
  irn: string; // 64-character SHA-256 hash
  ackNo: string;
  ackDt: string;
  signedInvoice: string;
  signedQrCode: string; // Base64 or JWT string containing compressed signed QR data
  status: 'ACT' | 'CNL';
  ewbNo?: string;
  ewbDt?: string;
  ewbValidTill?: string;
}

export interface EwbPayload {
  supplyType: 'O' | 'I'; // Outward, Inward
  subSupplyType: '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8'; // 1: Supply, 2: Export, 3: Job Work, etc.
  docType: 'INV' | 'BIL' | 'BOE' | 'CHL' | 'OTH';
  docNo: string;
  docDate: string; // DD/MM/YYYY
  fromGstin: string;
  fromTrdName: string;
  fromAddr1: string;
  fromPlace: string;
  fromPincode: number;
  fromStateCode: number;
  actualFromStateCode: number;
  toGstin: string;
  toTrdName: string;
  toAddr1: string;
  toPlace: string;
  toPincode: number;
  toStateCode: number;
  actualToStateCode: number;
  totalValue: number;
  cgstValue: number;
  sgstValue: number;
  igstValue: number;
  cessValue: number;
  transporterId?: string;
  transporterName?: string;
  transDocNo?: string;
  transMode: '1' | '2' | '3' | '4'; // 1: Road, 2: Rail, 3: Air, 4: Ship
  transDistance: number;
  transDocDate?: string;
  vehicleNo?: string;
  vehicleType?: 'R' | 'O'; // Regular, Over Dimensional Cargo
}

export interface EwbResult {
  ewbNo: string; // 12-digit numeric string
  ewbDate: string;
  validUpto: string;
  status: 'ACT' | 'CNL';
}

export interface GstErrorDetail {
  code: string;
  message: string;
  suggestion: string;
}

export const GST_ERROR_CODES: Record<string, { message: string; suggestion: string }> = {
  '100': { message: 'Invalid token or session expired', suggestion: 'Reconnect your GSP integration or refresh authentication.' },
  '2150': { message: 'Invalid PIN code for supplier state', suggestion: 'Check and update the seller branch PIN code to match the state code.' },
  '2151': { message: 'Invalid PIN code for recipient state', suggestion: 'Check buyer address and provide a valid PIN code for the state.' },
  '2174': { message: 'Duplicate IRN: Invoice already registered on IRP', suggestion: 'This invoice number already has an active IRN registered on the GST portal.' },
  '2182': { message: 'Invalid HSN / SAC code', suggestion: 'Ensure each item has an active 4, 6, or 8 digit HSN code from the official master.' },
  '2283': { message: 'Total invoice value mismatch with line items sum', suggestion: 'Recalculate invoice totals including round-off and taxes.' },
  '3012': { message: 'Cancellation window expired (24 hours exceeded)', suggestion: 'IRN cannot be cancelled after 24 hours on IRP. Issue a Credit Note instead.' },
  '4001': { message: 'Distance between source and destination PIN code cannot be zero', suggestion: 'Enter a valid transport distance in kilometers.' },
  '4002': { message: 'Invalid Vehicle Number format', suggestion: 'Provide vehicle number in standard Indian format (e.g. WB02AB1234 or DL01A1234).' },
};

export function getPlainGstError(code: string, rawMessage?: string): GstErrorDetail {
  const match = GST_ERROR_CODES[code];
  if (match) {
    return { code, ...match };
  }
  return {
    code,
    message: rawMessage || 'GST portal error occurred',
    suggestion: 'Please verify document data according to GSTN specifications or contact GSP support.',
  };
}
