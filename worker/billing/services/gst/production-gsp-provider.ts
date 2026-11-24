import {
  EInvoicePayload,
  EInvoiceResult,
  EwbPayload,
  EwbResult,
} from '@billing/shared';
import {
  CancelEwbParams,
  CancelIrnParams,
  ExtendEwbParams,
  GstProvider,
  UpdateVehicleParams,
} from './gst-provider';
import { GstPortalException } from './dev-gst-provider';

export interface GspConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  gstin: string;
  username: string;
  authKey?: string;
}

export class ProductionGspProvider implements GstProvider {
  constructor(private config: GspConfig) {}

  private async fetchGsp(endpoint: string, body: Record<string, unknown>) {
    const res = await fetch(`${this.config.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'client-id': this.config.clientId,
        'client-secret': this.config.clientSecret,
        'gstin': this.config.gstin,
        ...(this.config.authKey ? { 'auth-token': this.config.authKey } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`GSP API Error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { status_code?: string; error_codes?: string[]; message?: string; data?: any };
    if (data.status_code === '0' || (data.error_codes && data.error_codes.length > 0)) {
      const code = data.error_codes?.[0] || '100';
      throw new GstPortalException(code, data.message);
    }

    return data.data || data;
  }

  async generateIrn(payload: EInvoicePayload): Promise<EInvoiceResult> {
    const res = await this.fetchGsp('/einvoice/generate-irn', payload as unknown as Record<string, unknown>);
    return {
      irn: res.Irn,
      ackNo: String(res.AckNo),
      ackDt: res.AckDt,
      signedInvoice: res.SignedInvoice,
      signedQrCode: res.SignedQRCode,
      status: 'ACT',
      ewbNo: res.EwbNo ? String(res.EwbNo) : undefined,
      ewbDt: res.EwbDt,
      ewbValidTill: res.EwbValidTill,
    };
  }

  async cancelIrn(params: CancelIrnParams): Promise<{ irn: string; cancelDate: string }> {
    const res = await this.fetchGsp('/einvoice/cancel-irn', {
      irn: params.irn,
      cnlRsn: params.cancelReason,
      cnlRem: params.cancelRemarks || 'Cancelled',
    });
    return {
      irn: res.Irn || params.irn,
      cancelDate: res.CancelDate,
    };
  }

  async generateEwb(payload: EwbPayload): Promise<EwbResult> {
    const res = await this.fetchGsp('/ewaybill/generate', payload as unknown as Record<string, unknown>);
    return {
      ewbNo: String(res.EwbNo),
      ewbDate: res.EwbDt,
      validUpto: res.EwbValidTill,
      status: 'ACT',
    };
  }

  async updateVehicle(params: UpdateVehicleParams): Promise<{ ewbNo: string; validUpto: string; updatedAt: string }> {
    const res = await this.fetchGsp('/ewaybill/update-vehicle', {
      ewbNo: Number(params.ewbNumber),
      vehicleNo: params.vehicleNo,
      fromPlace: params.fromPlace,
      fromState: params.fromStateCode,
      reasonCode: params.reasonCode,
      reasonRem: params.reasonRemark || 'Vehicle update',
      transMode: params.transMode,
      transDocNo: params.transDocNo,
    });
    return {
      ewbNo: String(res.EwbNo),
      validUpto: res.ValidUpto,
      updatedAt: res.UpdatedDate,
    };
  }

  async extendEwb(params: ExtendEwbParams): Promise<{ ewbNo: string; validUpto: string; extendedAt: string }> {
    const res = await this.fetchGsp('/ewaybill/extend-validity', {
      ewbNo: Number(params.ewbNumber),
      vehicleNo: params.vehicleNo,
      fromPlace: params.fromPlace,
      fromPincode: params.fromPincode,
      remainingDistance: params.remainingDistance,
      extnReason: params.extensionReason,
      extnRemarks: params.remarks || 'Validity extension',
    });
    return {
      ewbNo: String(res.EwbNo),
      validUpto: res.ValidUpto,
      extendedAt: res.UpdatedDate,
    };
  }

  async cancelEwb(params: CancelEwbParams): Promise<{ ewbNo: string; cancelDate: string }> {
    const res = await this.fetchGsp('/ewaybill/cancel', {
      ewbNo: Number(params.ewbNumber),
      cancelRsnCode: Number(params.cancelReason),
      cancelRmrk: params.cancelRemarks || 'Cancelled',
    });
    return {
      ewbNo: String(res.EwbNo),
      cancelDate: res.CancelDate,
    };
  }
}

