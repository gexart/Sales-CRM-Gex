import { EInvoicePayload, EInvoiceResult, EwbPayload, EwbResult } from '@billing/shared';

export interface CancelIrnParams {
  irn: string;
  cancelReason: '1' | '2' | '3' | '4'; // 1: Duplicate, 2: Data entry mistake, 3: Order cancelled, 4: Other
  cancelRemarks?: string;
  generatedAt?: string;
}

export interface UpdateVehicleParams {
  ewbNumber: string;
  vehicleNo: string;
  fromPlace: string;
  fromStateCode: number;
  reasonCode: '1' | '2' | '3' | '4'; // 1: Due to breakdown, 2: Due to transshipment, 3: Others, 4: First time
  reasonRemark?: string;
  transMode: '1' | '2' | '3' | '4';
  transDocNo?: string;
}

export interface ExtendEwbParams {
  ewbNumber: string;
  vehicleNo: string;
  fromPlace: string;
  fromPincode: number;
  remainingDistance: number;
  extensionReason: '1' | '2' | '3' | '4' | '5' | '6'; // 1: Natural calamity, 2: Transshipment delay, etc.
  remarks?: string;
}

export interface CancelEwbParams {
  ewbNumber: string;
  cancelReason: '1' | '2' | '3' | '4';
  cancelRemarks?: string;
}

export interface GstProvider {
  generateIrn(payload: EInvoicePayload): Promise<EInvoiceResult>;
  cancelIrn(params: CancelIrnParams): Promise<{ irn: string; cancelDate: string }>;
  generateEwb(payload: EwbPayload): Promise<EwbResult>;
  updateVehicle(params: UpdateVehicleParams): Promise<{ ewbNo: string; validUpto: string; updatedAt: string }>;
  extendEwb(params: ExtendEwbParams): Promise<{ ewbNo: string; validUpto: string; extendedAt: string }>;
  cancelEwb(params: CancelEwbParams): Promise<{ ewbNo: string; cancelDate: string }>;
}

