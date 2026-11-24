import {
  EInvoicePayload,
  EInvoiceResult,
  EwbPayload,
  EwbResult,
  getPlainGstError,
} from '@billing/shared';
import {
  CancelEwbParams,
  CancelIrnParams,
  ExtendEwbParams,
  GstProvider,
  UpdateVehicleParams,
} from './gst-provider';

export class GstPortalException extends Error {
  public readonly code: string;
  public readonly suggestion: string;

  constructor(code: string, rawMessage?: string) {
    const errorDetail = getPlainGstError(code, rawMessage);
    super(`GST Error [${code}]: ${errorDetail.message} — ${errorDetail.suggestion}`);
    this.name = 'GstPortalException';
    this.code = code;
    this.suggestion = errorDetail.suggestion;
  }
}

export class DevGstProvider implements GstProvider {
  /**
   * Generates a 64-character SHA-256 IRN and mock signed QR code
   */
  async generateIrn(payload: EInvoicePayload): Promise<EInvoiceResult> {
    // Validate seller PIN code
    if (!payload.sellerDtls.pin || payload.sellerDtls.pin < 100000 || payload.sellerDtls.pin > 999999) {
      throw new GstPortalException('2150');
    }
    // Validate buyer PIN code
    if (!payload.buyerDtls.pin || payload.buyerDtls.pin < 100000 || payload.buyerDtls.pin > 999999) {
      throw new GstPortalException('2151');
    }

    // Hash supplierGSTIN + FY + DocType + DocNo to produce deterministic 64-char hex IRN
    const rawString = `${payload.sellerDtls.gstin}:${payload.docDtls.typ}:${payload.docDtls.no}:${payload.docDtls.dt}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(rawString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const irn = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

    const now = new Date();
    const ackNo = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${Math.floor(100000000 + Math.random() * 900000000)}`;
    const ackDt = now.toISOString().replace('T', ' ').substring(0, 19);

    // Build JWT-like signed QR payload
    const qrPayload = {
      SellerGstin: payload.sellerDtls.gstin,
      BuyerGstin: payload.buyerDtls.gstin,
      DocNo: payload.docDtls.no,
      DocTyp: payload.docDtls.typ,
      DocDt: payload.docDtls.dt,
      TotInvVal: payload.valDtls.totInvVal,
      ItemCnt: payload.itemList.length,
      MainHsnCode: payload.itemList[0]?.hsnCd || '9983',
      Irn: irn,
    };
    const b64Payload = btoa(JSON.stringify(qrPayload));
    const signedQrCode = `eyAiYWxnIjogIkVTMjU2IiwgInR5cCI6ICJKV1QiIH0.${b64Payload}.DEV_IRP_SIGNATURE_${irn.substring(0, 16)}`;

    return {
      irn,
      ackNo,
      ackDt,
      signedInvoice: btoa(JSON.stringify(payload)),
      signedQrCode,
      status: 'ACT',
    };
  }

  /**
   * Cancels an IRN on the portal within the 24h window
   */
  async cancelIrn(params: CancelIrnParams): Promise<{ irn: string; cancelDate: string }> {
    if (params.generatedAt) {
      const generatedTime = new Date(params.generatedAt).getTime();
      const diffHours = (Date.now() - generatedTime) / (1000 * 60 * 60);
      if (diffHours > 24) {
        throw new GstPortalException('3012');
      }
    }

    const cancelDate = new Date().toISOString().replace('T', ' ').substring(0, 19);
    return {
      irn: params.irn,
      cancelDate,
    };
  }

  /**
   * Generates a 12-digit E-Way Bill Number (Part A + optional Part B)
   */
  async generateEwb(payload: EwbPayload): Promise<EwbResult> {
    if (payload.transDistance <= 0) {
      throw new GstPortalException('4001');
    }

    if (payload.vehicleNo) {
      const cleaned = payload.vehicleNo.replace(/\s+/g, '').toUpperCase();
      const validVehicle = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/.test(cleaned);
      if (!validVehicle) {
        throw new GstPortalException('4002');
      }
    }

    // 12-digit E-way bill number
    const ewbNo = `241${Math.floor(100000000 + Math.random() * 900000000)}`;
    const now = new Date();
    const ewbDate = now.toISOString().replace('T', ' ').substring(0, 19);

    // Valid for 1 day per 200 km (standard GST rule: minimum 1 day + 1 day per additional 200 km)
    const validDays = Math.max(1, Math.ceil(payload.transDistance / 200));
    const validTillDate = new Date(now.getTime() + validDays * 24 * 60 * 60 * 1000);
    const validUpto = validTillDate.toISOString().replace('T', ' ').substring(0, 19);

    return {
      ewbNo,
      ewbDate,
      validUpto,
      status: 'ACT',
    };
  }

  /**
   * Updates vehicle details for Part B
   */
  async updateVehicle(params: UpdateVehicleParams): Promise<{ ewbNo: string; validUpto: string; updatedAt: string }> {
    if (params.vehicleNo) {
      const cleaned = params.vehicleNo.replace(/\s+/g, '').toUpperCase();
      if (!/^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/.test(cleaned)) {
        throw new GstPortalException('4002');
      }
    }

    const now = new Date();
    const validTillDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
    return {
      ewbNo: params.ewbNumber,
      validUpto: validTillDate.toISOString().replace('T', ' ').substring(0, 19),
      updatedAt: now.toISOString().replace('T', ' ').substring(0, 19),
    };
  }

  /**
   * Extends validity of an E-Way Bill
   */
  async extendEwb(params: ExtendEwbParams): Promise<{ ewbNo: string; validUpto: string; extendedAt: string }> {
    const additionalDays = Math.max(1, Math.ceil(params.remainingDistance / 200));
    const now = new Date();
    const validTillDate = new Date(now.getTime() + additionalDays * 24 * 60 * 60 * 1000);
    return {
      ewbNo: params.ewbNumber,
      validUpto: validTillDate.toISOString().replace('T', ' ').substring(0, 19),
      extendedAt: now.toISOString().replace('T', ' ').substring(0, 19),
    };
  }

  /**
   * Cancels an E-Way Bill within 24 hours
   */
  async cancelEwb(params: CancelEwbParams): Promise<{ ewbNo: string; cancelDate: string }> {
    return {
      ewbNo: params.ewbNumber,
      cancelDate: new Date().toISOString().replace('T', ' ').substring(0, 19),
    };
  }
}

