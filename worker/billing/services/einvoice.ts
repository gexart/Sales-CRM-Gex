import { newId, EInvoicePayload, EwbPayload } from '@billing/shared';
import { GstProvider } from './gst/gst-provider';
import { DevGstProvider } from './gst/dev-gst-provider';

export interface TransportDetails {
  transMode: '1' | '2' | '3' | '4'; // 1: Road, 2: Rail, 3: Air, 4: Ship
  transDistanceKm: number;
  transporterId?: string; // GSTIN of transporter
  transporterName?: string;
  transDocNo?: string;
  vehicleNo?: string;
  vehicleType?: 'REGULAR' | 'OVER_DIMENSIONAL';
}

export class EInvoiceService {
  private gstProvider: GstProvider;

  constructor(
    private sql: any,
    gstProvider?: GstProvider,
  ) {
    this.gstProvider = gstProvider || new DevGstProvider();
  }

  /**
   * Helper: Formats ISO date 'YYYY-MM-DD' into GSTN standard 'DD/MM/YYYY'
   */
  private formatDateToGstn(dateStr: string): string {
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  /**
   * Generates IRN for a sales invoice
   */
  async generateEInvoice(invoiceId: string) {
    const invCursor = this.sql.exec(`SELECT i.*,
         (SELECT COALESCE(SUM(l.line_total_paise - l.cgst_amount_paise - l.sgst_amount_paise - l.igst_amount_paise - l.cess_amount_paise), 0) FROM invoice_lines l WHERE l.invoice_id = i.id) AS taxable_amount_paise,
         (SELECT COALESCE(SUM(l.cgst_amount_paise), 0) FROM invoice_lines l WHERE l.invoice_id = i.id) AS cgst_paise,
         (SELECT COALESCE(SUM(l.sgst_amount_paise), 0) FROM invoice_lines l WHERE l.invoice_id = i.id) AS sgst_paise,
         (SELECT COALESCE(SUM(l.igst_amount_paise), 0) FROM invoice_lines l WHERE l.invoice_id = i.id) AS igst_paise
       FROM invoices i WHERE i.id = ? LIMIT 1`, invoiceId);
    const invRow = invCursor.next();
    if (invRow.done || !invRow.value) throw new Error('Invoice not found');
    const inv = invRow.value;

    const existingCursor = this.sql.exec(`SELECT * FROM e_invoices WHERE invoice_id = ? LIMIT 1`, invoiceId);
    const existingRow = existingCursor.next();
    if (!existingRow.done && existingRow.value) {
      if (existingRow.value.status === 'ACTIVE') {
        return existingRow.value;
      }
    }

    const branchCursor = this.sql.exec(`SELECT * FROM branches WHERE id = ? LIMIT 1`, inv.branch_id);
    const branchRow = branchCursor.next();
    const branch = (!branchRow.done && branchRow.value) ? branchRow.value : {};
    if (!(branch as any).gstin) throw new Error('Add your GSTIN (Settings → Company details) before generating e-invoices / e-way bills');

    const partyCursor = this.sql.exec(`SELECT * FROM parties WHERE id = ? LIMIT 1`, inv.party_id);
    const partyRow = partyCursor.next();
    const party: any = { ...((!partyRow.done && partyRow.value) ? partyRow.value : {}) };
    // The GSTIN saved on the invoice counts too (e.g. typed on the invoice for a walk-in B2B buyer)
    if (!party.gstin && inv.party_gstin) party.gstin = inv.party_gstin;

    if (!party.gstin) {
      throw new Error('E-Invoice can only be generated for GST-registered parties (B2B/SEZ)');
    }

    const linesCursor = this.sql.exec(`SELECT l.*, l.cgst_amount_paise AS cgst_paise, l.sgst_amount_paise AS sgst_paise, l.igst_amount_paise AS igst_paise,
         (l.line_total_paise - l.cgst_amount_paise - l.sgst_amount_paise - l.igst_amount_paise - l.cess_amount_paise) AS taxable_amount_paise
       FROM invoice_lines l WHERE l.invoice_id = ?`, invoiceId);
    const lines: any[] = [];
    let l = linesCursor.next();
    while (!l.done && l.value) {
      lines.push(l.value);
      l = linesCursor.next();
    }

    const itemList = lines.map((line, idx) => {
      let hsn = '9983';
      if (line.item_id) {
        const itemCursor = this.sql.exec(`SELECT hsn_sac AS hsn_code FROM items WHERE id = ? LIMIT 1`, line.item_id);
        const itemRow = itemCursor.next();
        if (!itemRow.done && itemRow.value && itemRow.value.hsn_code) {
          hsn = String(itemRow.value.hsn_code);
        }
      }

      const gstRt = (Number(line.tax_rate_basis_points || 0)) / 100;
      return {
        itemNo: String(idx + 1),
        prdDesc: `Item ${idx + 1}`,
        isServc: 'N' as const,
        hsnCd: hsn,
        qty: Number(line.quantity_thousandths || 1000) / 1000,
        unit: 'NOS',
        unitPrice: Number(line.unit_price_paise || 0) / 100,
        totAmt: (Number(line.quantity_thousandths || 1000) / 1000) * (Number(line.unit_price_paise || 0) / 100),
        assAmt: Number(line.taxable_amount_paise || 0) / 100,
        gstRt,
        cgstAmt: Number(line.cgst_paise || 0) / 100,
        sgstAmt: Number(line.sgst_paise || 0) / 100,
        igstAmt: Number(line.igst_paise || 0) / 100,
        totItemVal: Number(line.line_total_paise || 0) / 100,
      };
    });

    const payload: EInvoicePayload = {
      version: '1.03',
      tranDtls: {
        taxSch: 'GST',
        supTyp: 'B2B',
      },
      docDtls: {
        typ: 'INV',
        no: String(inv.invoice_no || inv.invoiceNo),
        dt: this.formatDateToGstn(String(inv.date)),
      },
      sellerDtls: {
        gstin: String(branch.gstin),
        lglNm: String(branch.name || 'GexGrow Merchant'),
        addr1: String(branch.address || 'Kolkata Central'),
        loc: String(branch.city || 'Kolkata'),
        pin: branch.pincode ? Number(branch.pincode) : 700001,
        stcd: String(branch.gstin).substring(0, 2),
      },
      buyerDtls: {
        gstin: String(party.gstin),
        lglNm: String(party.name),
        pos: String(party.state_code || party.stateCode || String(party.gstin).substring(0, 2)),
        addr1: String(party.billing_address || party.billingAddress || 'Customer Address'),
        loc: String(party.city || 'Kolkata'),
        pin: party.pincode ? Number(party.pincode) : 700001,
        stcd: String(party.gstin).substring(0, 2),
      },
      itemList,
      valDtls: {
        assVal: Number(inv.taxable_amount_paise || 0) / 100,
        cgstVal: Number(inv.cgst_paise || 0) / 100,
        sgstVal: Number(inv.sgst_paise || 0) / 100,
        igstVal: Number(inv.igst_paise || 0) / 100,
        rndOffAmt: Number(inv.round_off_paise || 0) / 100,
        totInvVal: Number(inv.total_paise || 0) / 100,
      },
    };

    const result = await this.gstProvider.generateIrn(payload);
    const id = `einv_${newId()}`;
    const now = new Date().toISOString();

    this.sql.exec(
      `INSERT INTO e_invoices (id, invoice_id, irn, ack_no, ack_date, signed_invoice, signed_qr_code, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
      id,
      invoiceId,
      result.irn,
      result.ackNo,
      result.ackDt,
      result.signedInvoice,
      result.signedQrCode,
      now,
    );

    return {
      id,
      invoiceId,
      irn: result.irn,
      ackNo: result.ackNo,
      ackDate: result.ackDt,
      signedInvoice: result.signedInvoice,
      signedQrCode: result.signedQrCode,
      status: 'ACTIVE',
      createdAt: now,
    };
  }

  /**
   * Cancels an IRN within 24 hours of generation
   */
  async cancelEInvoice(invoiceId: string, cancelReason: '1' | '2' | '3' | '4', cancelRemarks?: string) {
    const eInvCursor = this.sql.exec(`SELECT * FROM e_invoices WHERE invoice_id = ? LIMIT 1`, invoiceId);
    const eInvRow = eInvCursor.next();
    if (eInvRow.done || !eInvRow.value) throw new Error('No e-invoice found for this invoice');
    const eInv = eInvRow.value;

    if (eInv.status === 'CANCELLED') throw new Error('E-invoice is already cancelled');

    await this.gstProvider.cancelIrn({
      irn: String(eInv.irn),
      cancelReason,
      cancelRemarks,
      generatedAt: String(eInv.created_at || eInv.createdAt),
    });

    const now = new Date().toISOString();
    this.sql.exec(
      `UPDATE e_invoices
      SET status = 'CANCELLED',
          cancel_reason = ?,
          cancel_remarks = ?,
          cancelled_at = ?
      WHERE id = ?`,
      cancelReason,
      cancelRemarks || null,
      now,
      eInv.id,
    );

    return {
      id: eInv.id,
      invoiceId,
      irn: eInv.irn,
      status: 'CANCELLED',
      cancelReason,
      cancelRemarks: cancelRemarks || null,
      cancelledAt: now,
    };
  }

  /**
   * Bulk generates IRNs for multiple invoices
   */
  async bulkGenerateEInvoices(invoiceIds: string[]) {
    const results: { invoiceId: string; success: boolean; irn?: string; error?: string; suggestion?: string }[] = [];

    for (const invId of invoiceIds) {
      try {
        const record = await this.generateEInvoice(invId);
        results.push({ invoiceId: invId, success: true, irn: record.irn });
      } catch (err: any) {
        results.push({
          invoiceId: invId,
          success: false,
          error: err.message,
          suggestion: err.suggestion || 'Please verify invoice details',
        });
      }
    }

    return results;
  }

  /**
   * Generates E-Way Bill (Part A + Part B) for an invoice
   */
  async generateEWayBill(invoiceId: string, transport: TransportDetails) {
    const invCursor = this.sql.exec(`SELECT i.*,
         (SELECT COALESCE(SUM(l.line_total_paise - l.cgst_amount_paise - l.sgst_amount_paise - l.igst_amount_paise - l.cess_amount_paise), 0) FROM invoice_lines l WHERE l.invoice_id = i.id) AS taxable_amount_paise,
         (SELECT COALESCE(SUM(l.cgst_amount_paise), 0) FROM invoice_lines l WHERE l.invoice_id = i.id) AS cgst_paise,
         (SELECT COALESCE(SUM(l.sgst_amount_paise), 0) FROM invoice_lines l WHERE l.invoice_id = i.id) AS sgst_paise,
         (SELECT COALESCE(SUM(l.igst_amount_paise), 0) FROM invoice_lines l WHERE l.invoice_id = i.id) AS igst_paise
       FROM invoices i WHERE i.id = ? LIMIT 1`, invoiceId);
    const invRow = invCursor.next();
    if (invRow.done || !invRow.value) throw new Error('Invoice not found');
    const inv = invRow.value;

    const branchCursor = this.sql.exec(`SELECT * FROM branches WHERE id = ? LIMIT 1`, inv.branch_id);
    const branchRow = branchCursor.next();
    const branch = (!branchRow.done && branchRow.value) ? branchRow.value : {};
    if (!(branch as any).gstin) throw new Error('Add your GSTIN (Settings → Company details) before generating e-invoices / e-way bills');

    const partyCursor = this.sql.exec(`SELECT * FROM parties WHERE id = ? LIMIT 1`, inv.party_id);
    const partyRow = partyCursor.next();
    const party = (!partyRow.done && partyRow.value) ? partyRow.value : {};

    const fromGstin = String(branch.gstin);
    const toGstin = String(party.gstin || 'URP');
    const fromStateCode = Number(fromGstin.substring(0, 2));
    const toStateCode = Number((party.state_code || party.stateCode || toGstin).substring(0, 2)) || fromStateCode;

    const payload: EwbPayload = {
      supplyType: 'O',
      subSupplyType: '1',
      docType: 'INV',
      docNo: String(inv.invoice_no || inv.invoiceNo),
      docDate: this.formatDateToGstn(String(inv.date)),
      fromGstin,
      fromTrdName: String(branch.name || 'GexGrow Merchant'),
      fromAddr1: String(branch.address || 'Branch Address'),
      fromPlace: String(branch.city || 'Kolkata'),
      fromPincode: branch.pincode ? Number(branch.pincode) : 700001,
      fromStateCode,
      actualFromStateCode: fromStateCode,
      toGstin,
      toTrdName: String(party.name || 'Customer'),
      toAddr1: String(party.billing_address || party.billingAddress || 'Party Address'),
      toPlace: String(party.city || 'Kolkata'),
      toPincode: party.pincode ? Number(party.pincode) : 700001,
      toStateCode,
      actualToStateCode: toStateCode,
      totalValue: Number(inv.total_paise || 0) / 100,
      cgstValue: Number(inv.cgst_paise || 0) / 100,
      sgstValue: Number(inv.sgst_paise || 0) / 100,
      igstValue: Number(inv.igst_paise || 0) / 100,
      cessValue: 0,
      transporterId: transport.transporterId,
      transporterName: transport.transporterName,
      transDocNo: transport.transDocNo,
      transMode: transport.transMode,
      transDistance: transport.transDistanceKm,
      vehicleNo: transport.vehicleNo,
      vehicleType: transport.vehicleType === 'OVER_DIMENSIONAL' ? 'O' : 'R',
    };

    const res = await this.gstProvider.generateEwb(payload);
    const id = `ewb_${newId()}`;
    const now = new Date().toISOString();
    const mode = transport.transMode === '1' ? 'ROAD' : transport.transMode === '2' ? 'RAIL' : transport.transMode === '3' ? 'AIR' : 'SHIP';
    const vehicleType = transport.vehicleType || 'REGULAR';
    const partBStatus = transport.vehicleNo ? 'GENERATED' : 'PENDING';

    this.sql.exec(
      `INSERT INTO e_way_bills (
        id, document_type, document_id, ewb_number, ewb_date, valid_upto,
        supply_type, sub_supply_type, transporter_id, transporter_name,
        trans_doc_no, trans_mode, distance_km, vehicle_no, vehicle_type,
        from_place, from_pincode, to_place, to_pincode, total_value_paise,
        part_b_status, status, created_at
      )
      VALUES (
        ?, 'INVOICE', ?, ?, ?, ?,
        'O', '1', ?,
        ?,
        ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, 'ACTIVE', ?
      )`,
      id,
      invoiceId,
      res.ewbNo,
      res.ewbDate,
      res.validUpto,
      transport.transporterId || null,
      transport.transporterName || null,
      transport.transDocNo || null,
      mode,
      transport.transDistanceKm,
      transport.vehicleNo || null,
      vehicleType,
      branch.city || 'Kolkata',
      branch.pincode ? Number(branch.pincode) : 700001,
      party.city || 'Kolkata',
      party.pincode ? Number(party.pincode) : 700001,
      Number(inv.total_paise || 0),
      partBStatus,
      now,
    );

    return {
      id,
      documentType: 'INVOICE',
      documentId: invoiceId,
      ewbNumber: res.ewbNo,
      ewbDate: res.ewbDate,
      validUpto: res.validUpto,
      partBStatus,
      status: 'ACTIVE',
      createdAt: now,
    };
  }

  /**
   * Updates vehicle info on an existing E-Way Bill
   */
  async updateEwbVehicle(ewbId: string, vehicleNo: string, fromPlace: string, fromStateCode: number, reasonCode: '1' | '2' | '3' | '4') {
    const ewbCursor = this.sql.exec(`SELECT * FROM e_way_bills WHERE id = ? LIMIT 1`, ewbId);
    const ewbRow = ewbCursor.next();
    if (ewbRow.done || !ewbRow.value) throw new Error('E-way bill not found');
    const ewb = ewbRow.value;

    const res = await this.gstProvider.updateVehicle({
      ewbNumber: String(ewb.ewb_number || ewb.ewbNumber),
      vehicleNo,
      fromPlace,
      fromStateCode,
      reasonCode,
      transMode: '1',
    });

    this.sql.exec(
      `UPDATE e_way_bills
      SET vehicle_no = ?,
          valid_upto = ?,
          part_b_status = 'UPDATED'
      WHERE id = ?`,
      vehicleNo,
      res.validUpto,
      ewbId,
    );

    return {
      id: ewbId,
      ewbNumber: ewb.ewb_number || ewb.ewbNumber,
      vehicleNo,
      validUpto: res.validUpto,
      partBStatus: 'UPDATED',
    };
  }

  /**
   * Cancels an E-Way Bill
   */
  async cancelEWayBill(ewbId: string, cancelReason: '1' | '2' | '3' | '4', cancelRemarks?: string) {
    const ewbCursor = this.sql.exec(`SELECT * FROM e_way_bills WHERE id = ? LIMIT 1`, ewbId);
    const ewbRow = ewbCursor.next();
    if (ewbRow.done || !ewbRow.value) throw new Error('E-way bill not found');
    const ewb = ewbRow.value;

    await this.gstProvider.cancelEwb({
      ewbNumber: String(ewb.ewb_number || ewb.ewbNumber),
      cancelReason,
      cancelRemarks,
    });

    const now = new Date().toISOString();
    this.sql.exec(
      `UPDATE e_way_bills
      SET status = 'CANCELLED',
          cancel_reason = ?,
          cancel_remarks = ?,
          cancelled_at = ?
      WHERE id = ?`,
      cancelReason,
      cancelRemarks || null,
      now,
      ewbId,
    );

    return {
      id: ewbId,
      ewbNumber: ewb.ewb_number || ewb.ewbNumber,
      status: 'CANCELLED',
      cancelledAt: now,
    };
  }

  /**
   * Get E-Invoice & E-Way Bill status for an invoice
   */
  async getInvoiceGstStatus(invoiceId: string) {
    const einvCursor = this.sql.exec(`SELECT * FROM e_invoices WHERE invoice_id = ? LIMIT 1`, invoiceId);
    const einvRow = einvCursor.next();

    const ewbCursor = this.sql.exec(`SELECT * FROM e_way_bills WHERE document_id = ? LIMIT 1`, invoiceId);
    const ewbRow = ewbCursor.next();

    return {
      eInvoice: (!einvRow.done && einvRow.value) ? einvRow.value : null,
      eWayBill: (!ewbRow.done && ewbRow.value) ? ewbRow.value : null,
    };
  }
}
