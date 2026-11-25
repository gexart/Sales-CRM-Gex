import { moneyAccountFor, recordPaymentRow } from './payment-record';
import { allocateDocNumber } from './numbering';
import {
  Decimal,
  newId,
  calculateDocumentGst,
  GstLineItemInput,
  GstCalculationContext,
  amountInWords,
} from '@billing/shared';
import { PostingService } from './posting';

export interface CreateInvoiceLineInput {
  itemId: string;
  variantId?: string;
  name: string;
  hsnSac: string;
  quantityThousandths: number;
  unitId: string;
  unitPricePaise: number;
  discountPaise?: number;
  taxRatePercent: number; // e.g. 18
  isTaxInclusive?: boolean;
  cessPercent?: number;
}

export interface CreateInvoiceInput {
  invoiceType?: 'REGULAR' | 'BILL_OF_SUPPLY' | 'EXPORT' | 'SEZ';
  branchId: string;
  /** optional: defaults to the branch's default warehouse */
  warehouseId?: string;
  partyId?: string;
  partyName: string;
  partyGstin?: string;
  partyStateCode: string;
  date: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  paymentMode?: 'CASH' | 'BANK' | 'UPI' | 'CREDIT' | 'CARD';
  paymentAccountId?: string;
  items: CreateInvoiceLineInput[];
  extraDiscountPaise?: number;
  enableRoundOff?: boolean;
  paidAmountPaise?: number;
  notes?: string;
  terms?: string;
  shippingAddress?: string;
  transport?: { transporter?: string; vehicleNo?: string; lrNo?: string };
  bankAccountId?: string;
  signatoryName?: string;
  /** Use this bill number instead of the next one (a number freed by a delete, or a cancelled invoice's own number). */
  invoiceNo?: string;
  createdById: string;
}

export interface ListInvoicesParams {
  status?: string;
  partyId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  limit?: number;
  offset?: number;
  /** Only invoices created by this user (data scope "own records"). */
  createdById?: string;
}

export interface RecordPaymentInput {
  invoiceId: string;
  amountPaise: number;
  paymentMode: 'CASH' | 'BANK' | 'UPI' | 'CARD' | 'NET_BANKING' | 'CHEQUE';
  paymentAccountId?: string;
  branchId: string;
  date: string;
  notes?: string;
  createdById: string;
}

export interface CreateCreditNoteInput {
  invoiceId: string;
  branchId: string;
  date: string;
  reason: string;
  items?: { itemId: string; name: string; quantityThousandths: number; amountPaise: number }[];
  totalAmountPaise?: number;
  createdById: string;
}

export class InvoiceService {
  private postingService: PostingService;

  constructor(private sql: any) {
    this.postingService = new PostingService(sql);
  }

  /**
   * Generates a 32-character random secure share token
   */
  private generateShareToken(): string {
    // Public invoice links must be unguessable: 36 chars from a CSPRNG (~214 bits).
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.getRandomValues(new Uint8Array(36));
    let token = '';
    for (const b of bytes) token += chars.charAt(b % chars.length);
    return token;
  }

  /**
   * Helper to allocate next gapless document number inside the DO SQLite transaction
   */
  private nextDocNumber(
    docType: string,
    branchId?: string,
    opts: { date?: string; partyId?: string | null } = {},
  ): { docNumber: string; seriesId: string } {
    const { docNumber, seriesId } = allocateDocNumber(this.sql, { docType, branchId, date: opts.date, partyId: opts.partyId });
    return { docNumber, seriesId };
  }

  /** Id of the shared walk-in customer party, created on first use. */
  private walkInPartyId(stateCode: string): string {
    const row = this.sql.exec(`SELECT id FROM parties WHERE name = 'Walk-in Customer' AND type = 'CUSTOMER' LIMIT 1`).toArray()[0] as
      | { id: string }
      | undefined;
    if (row) return row.id;
    const id = `pty_walkin_${newId()}`;
    const now = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO parties (id, type, name, phone, state_code, created_at, updated_at) VALUES (?, 'CUSTOMER', 'Walk-in Customer', '', ?, ?, ?)`,
      id, stateCode, now, now,
    );
    return id;
  }

  /**
   * Get Branch details (state code, GSTIN, name)
   */
  private getBranch(branchId: string): any {
    const row = this.sql.exec(`SELECT * FROM branches WHERE id = ?`, String(branchId)).toArray()[0];
    if (!row) throw new Error('Branch not found');
    return row;
  }

  /**
   * Core create invoice method.
   * Performs line-by-line GST calculation with Decimal, persists header and lines,
   * creates public share token, and posts balancing double-entry journal lines.
   */
  createInvoice(input: CreateInvoiceInput, reuse?: { id: string; invoiceNo: string; seriesId: string; createdAt: string; createdById: string }): {
    invoice: any;
    lines: any[];
    shareToken: string;
    journalEntryId: string;
  } {
    if (!input.items || input.items.length === 0) {
      throw new Error('Invoice must contain at least one line item');
    }

    const branch = this.getBranch(input.branchId);
    if (!input.warehouseId) {
      const wh = this.sql
        .exec('SELECT id FROM warehouses WHERE branch_id = ? AND deleted_at IS NULL ORDER BY is_default DESC, created_at ASC LIMIT 1', input.branchId)
        .toArray()[0] as { id: string } | undefined;
      if (!wh) throw new Error('No warehouse for this branch');
      input = { ...input, warehouseId: wh.id };
    }
    const sellerStateCode = String(branch.state_code || '19');
    const buyerStateCode = String(input.partyStateCode || sellerStateCode);

    const gstContext: GstCalculationContext = {
      sellerStateCode,
      placeOfSupplyStateCode: buyerStateCode,
      isExportOrSez: input.invoiceType === 'EXPORT' || input.invoiceType === 'SEZ',
      isZeroRated: input.invoiceType === 'EXPORT' || input.invoiceType === 'BILL_OF_SUPPLY',
    };

    // Prepare inputs for GST calculation engine
    const gstInputs: GstLineItemInput[] = input.items.map((it) => ({
      quantity: new Decimal(it.quantityThousandths).div(1000),
      unitPrice: new Decimal(it.unitPricePaise).div(100),
      isTaxInclusive: Boolean(it.isTaxInclusive),
      taxRatePercent: it.taxRatePercent,
      discountAmount: it.discountPaise ? new Decimal(it.discountPaise).div(100) : 0,
      cessPercent: it.cessPercent || 0,
    }));

    const extraDiscRupees = input.extraDiscountPaise
      ? new Decimal(input.extraDiscountPaise).div(100)
      : new Decimal(0);

    const calcResult = calculateDocumentGst(
      gstInputs,
      gstContext,
      extraDiscRupees,
      input.enableRoundOff ?? true,
    );

    // Convert decimal results to integer paise
    const subtotalPaise = calcResult.taxableSubtotal.mul(100).round().toNumber();
    const cgstTotalPaise = calcResult.cgstTotal.mul(100).round().toNumber();
    const sgstTotalPaise = calcResult.sgstTotal.mul(100).round().toNumber();
    const igstTotalPaise = calcResult.igstTotal.mul(100).round().toNumber();
    const cessTotalPaise = calcResult.cessTotal.mul(100).round().toNumber();
    // Every figure is rounded to paise on its own, so they can disagree by a paisa. The total is the truth; the round-off is whatever makes
    // subtotal + tax + round-off equal it exactly, which keeps the ledger entry (debit = credit) balanced.
    const taxTotalPaise = cgstTotalPaise + sgstTotalPaise + igstTotalPaise + cessTotalPaise;
    const totalPaise = calcResult.grandTotal.mul(100).round().toNumber();
    const roundOffPaise = totalPaise - (subtotalPaise + taxTotalPaise);
    const discountPaise = (input.extraDiscountPaise || 0) +
      input.items.reduce((s, it) => s + (it.discountPaise || 0), 0);

    const paidPaise = input.paidAmountPaise || 0;
    const balancePaise = Math.max(0, totalPaise - paidPaise);

    let status = 'UNPAID';
    if (paidPaise >= totalPaise) {
      status = 'PAID';
    } else if (paidPaise > 0) {
      status = 'PARTIALLY_PAID';
    }

    // Counter / cash sales without a customer are booked to a shared "Walk-in Customer" party.
    const partyId = input.partyId || this.walkInPartyId(buyerStateCode);
    input = { ...input, partyId };

    // Allocate gapless sequential number
    // B2B: the customer's GSTIN comes from the customer record when the form does not send it (needed for GSTR-1 / e-invoice)
    const partyGstin =
      (input.partyGstin && input.partyGstin.trim()) ||
      (input.partyId ? ([...this.sql.exec('SELECT gstin FROM parties WHERE id = ?', input.partyId)][0] as { gstin: string | null } | undefined)?.gstin || null : null);
    let invoiceNo: string;
    let seriesId: string;
    if (reuse) {
      invoiceNo = reuse.invoiceNo;
      seriesId = reuse.seriesId;
    } else if (input.invoiceNo && input.invoiceNo.trim()) {
      invoiceNo = input.invoiceNo.trim();
      if (this.sql.exec('SELECT 1 FROM invoices WHERE invoice_no = ? LIMIT 1', invoiceNo).toArray().length > 0) throw new Error(`Bill number ${invoiceNo} is already used by another invoice`);
      const ser = this.sql.exec("SELECT id FROM document_series WHERE doc_type = 'INVOICE' AND branch_id = ? ORDER BY is_default DESC, financial_year DESC LIMIT 1", input.branchId).toArray()[0] as { id: string } | undefined;
      seriesId = ser ? String(ser.id) : this.nextDocNumber('INVOICE', input.branchId, { date: input.date, partyId: input.partyId }).seriesId;
    } else {
      const alloc = this.nextDocNumber('INVOICE', input.branchId, { date: input.date, partyId: input.partyId });
      invoiceNo = alloc.docNumber;
      seriesId = alloc.seriesId;
    }

    const invoiceId = reuse ? reuse.id : newId();
    const now = new Date().toISOString();

    // 1. Insert Invoice Header (all values bound). An edit rewrites the same row, so its id, link and attachments stay.
    if (reuse) {
      this.sql.exec(
        `UPDATE invoices SET party_id = ?, party_name = ?, party_gstin = ?, party_state_code = ?, invoice_type = ?, date = ?, due_date = ?,
          subtotal_paise = ?, discount_paise = ?, tax_total_paise = ?, round_off_paise = ?, total_paise = ?, paid_amount_paise = ?, balance_amount_paise = ?,
          status = ?, notes = ?, terms = ?, warehouse_id = ?, updated_at = ? WHERE id = ?`,
        input.partyId ?? null, input.partyName, partyGstin, buyerStateCode, input.invoiceType || 'REGULAR', input.date, input.dueDate,
        subtotalPaise, discountPaise, taxTotalPaise, roundOffPaise, totalPaise, paidPaise, balancePaise, status,
        input.notes ?? null, input.terms ?? null, input.warehouseId, now, invoiceId,
      );
    } else this.sql.exec(
      `INSERT INTO invoices (
        id, series_id, invoice_no, branch_id, warehouse_id, party_id,
        party_name, party_gstin, party_state_code, invoice_type, date, due_date,
        subtotal_paise, discount_paise, tax_total_paise, round_off_paise,
        total_paise, paid_amount_paise, balance_amount_paise, status,
        notes, terms, created_by_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      invoiceId, seriesId, invoiceNo, input.branchId, input.warehouseId, input.partyId ?? null,
      input.partyName, partyGstin, buyerStateCode, input.invoiceType || 'REGULAR', input.date, input.dueDate,
      subtotalPaise, discountPaise, taxTotalPaise, roundOffPaise, totalPaise, paidPaise, balancePaise, status,
      input.notes ?? null, input.terms ?? null, input.createdById, now, now,
    );

    // Print details: dispatch address (defaults to the customer's shipping address), transport, bank, signatory
    const partyRow = this.sql.exec('SELECT shipping_address, billing_address FROM parties WHERE id = ?', input.partyId).toArray()[0] as
      | { shipping_address: string | null; billing_address: string | null }
      | undefined;
    const shipTo = input.shippingAddress?.trim() || partyRow?.shipping_address || null;
    const hasTransport = input.transport && (input.transport.transporter || input.transport.vehicleNo || input.transport.lrNo);
    this.sql.exec(
      'UPDATE invoices SET shipping_address = ?, transport_json = ?, bank_account_id = ?, signatory_name = ? WHERE id = ?',
      shipTo, hasTransport ? JSON.stringify(input.transport) : null, input.bankAccountId ?? null, input.signatoryName?.trim() || null, invoiceId,
    );

    // 2. Insert Invoice Lines
    const savedLines: any[] = [];
    for (let i = 0; i < input.items.length; i++) {
      const it = input.items[i]!;
      const lineRes = calcResult.lines[i]!;
      const lineId = newId();

      const lineTaxRateBps = Math.round(Number(it.taxRatePercent) * 100);
      const lineCgstPaise = lineRes.cgstAmount.mul(100).round().toNumber();
      const lineSgstPaise = lineRes.sgstAmount.mul(100).round().toNumber();
      const lineIgstPaise = lineRes.igstAmount.mul(100).round().toNumber();
      const lineCessPaise = lineRes.cessAmount.mul(100).round().toNumber();
      const lineTotalPaise = lineRes.totalLineAmount.mul(100).round().toNumber();

      this.sql.exec(
        `INSERT INTO invoice_lines (
          id, invoice_id, item_id, variant_id, name, hsn_sac,
          quantity_thousandths, unit_id, unit_price_paise, discount_paise,
          tax_rate_basis_points, cgst_amount_paise, sgst_amount_paise,
          igst_amount_paise, cess_amount_paise, line_total_paise
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        lineId, invoiceId, it.itemId, it.variantId ?? null, it.name, it.hsnSac || '',
        Math.trunc(it.quantityThousandths), it.unitId, Math.trunc(it.unitPricePaise), Math.trunc(it.discountPaise || 0),
        lineTaxRateBps, lineCgstPaise, lineSgstPaise, lineIgstPaise, lineCessPaise, lineTotalPaise,
      );

      savedLines.push({
        id: lineId,
        invoiceId,
        itemId: it.itemId,
        name: it.name,
        hsnSac: it.hsnSac,
        quantityThousandths: it.quantityThousandths,
        unitPricePaise: it.unitPricePaise,
        taxRateBasisPoints: lineTaxRateBps,
        cgstAmountPaise: lineCgstPaise,
        sgstAmountPaise: lineSgstPaise,
        igstAmountPaise: lineIgstPaise,
        cessAmountPaise: lineCessPaise,
        lineTotalPaise,
      });
    }

    // 3. Post Double-Entry Journal Entry
    const isInterState = !gstContext.isExportOrSez && sellerStateCode !== buyerStateCode;
    const postRes = this.postingService.postInvoice({
      invoiceId,
      invoiceNo,
      date: input.date,
      branchId: input.branchId,
      partyId: input.partyId,
      paymentMode: input.paymentMode,
      paymentAccountId: input.paymentAccountId,
      isInterState,
      taxableAmountPaise: subtotalPaise,
      cgstPaise: cgstTotalPaise,
      sgstPaise: sgstTotalPaise,
      igstPaise: igstTotalPaise,
      cessPaise: cessTotalPaise,
      discountPaise: input.extraDiscountPaise || 0,
      roundOffPaise,
      totalAmountPaise: totalPaise,
      paidAmountPaise: paidPaise,
      narration: `Sales Invoice ${invoiceNo} to ${input.partyName}`,
    });

    // Money received at billing time also gets a payments row (Payments Received, mode totals, receipts).
    // The journal above already booked it; the account matches PostingService (UPI/BANK → bank, else cash).
    if (paidPaise > 0) {
      const mode = !input.paymentMode || input.paymentMode === 'CREDIT' ? 'CASH' : input.paymentMode;
      recordPaymentRow(this.sql, {
        branchId: input.branchId,
        partyId: String(input.partyId),
        type: 'IN',
        mode,
        amountPaise: paidPaise,
        date: input.date,
        invoiceId,
        accountId: moneyAccountFor(this.sql, mode === 'BANK' || mode === 'UPI' ? 'BANK' : 'CASH', input.paymentAccountId),
        notes: `Received with ${invoiceNo}`,
        createdById: input.createdById,
      });
    }

    // 4. Generate Public Share Token (an edit keeps the link the customer already has)
    const oldToken = reuse ? (this.sql.exec('SELECT token FROM invoice_share_tokens WHERE invoice_id = ? LIMIT 1', invoiceId).toArray()[0] as { token: string } | undefined) : undefined;
    const shareToken = oldToken ? String(oldToken.token) : this.generateShareToken();
    if (!oldToken) {
      const tokenId = newId();
      this.sql.exec(
        `INSERT INTO invoice_share_tokens (id, invoice_id, token, view_count, created_at) VALUES (?, ?, ?, 0, ?)`,
        tokenId, invoiceId, shareToken, now,
      );
    }

    // Party outstanding is derived from the ledger (opening balance + documents − payments);
    // the opening balance itself is never modified by transactions.

    const invoiceRecord = {
      id: invoiceId,
      invoiceNo,
      branchId: input.branchId,
      warehouseId: input.warehouseId,
      partyId: input.partyId,
      partyName: input.partyName,
      partyGstin: input.partyGstin,
      partyStateCode: buyerStateCode,
      date: input.date,
      dueDate: input.dueDate,
      subtotalPaise,
      discountPaise,
      taxTotalPaise,
      roundOffPaise,
      totalPaise,
      paidAmountPaise: paidPaise,
      balanceAmountPaise: balancePaise,
      status,
      shareToken,
      amountInWords: amountInWords(new Decimal(totalPaise).div(100)),
      createdAt: now,
    };

    return {
      invoice: invoiceRecord,
      lines: savedLines,
      shareToken,
      journalEntryId: postRes.entryId,
    };
  }

  /**
   * Fetch invoice by ID with line items, payments, and share token
   */
  getInvoice(id: string): any {
    const inv = this.sql.exec(`SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL`, String(id)).toArray()[0];
    if (!inv) return null;

    const lines = this.sql.exec(`SELECT * FROM invoice_lines WHERE invoice_id = ?`, String(id)).toArray();
    const tRow = this.sql.exec(`SELECT token, view_count FROM invoice_share_tokens WHERE invoice_id = ? LIMIT 1`, String(id)).toArray()[0];
    const shareToken = tRow ? String(tRow.token) : null;

    // Printed seller branch (address / GSTIN / state) and the bank chosen on the invoice — never placeholders.
    const branch = this.sql
      .exec('SELECT name, code, gstin, state_code, address, phone FROM branches WHERE id = ?', String(inv.branch_id))
      .toArray()[0] ?? null;
    const bankRow = inv.bank_account_id
      ? (this.sql
          .exec('SELECT name, last_4, ifsc, branch, upi_id FROM bank_accounts WHERE id = ? AND deleted_at IS NULL', String(inv.bank_account_id))
          .toArray()[0] as Record<string, unknown> | undefined)
      : undefined;
    const bank = bankRow
      ? {
          bankName: String(bankRow.name),
          accountNumber: bankRow.last_4 ? `•••• ${String(bankRow.last_4)}` : '',
          ifsc: bankRow.ifsc ? String(bankRow.ifsc) : '',
          branch: bankRow.branch ? String(bankRow.branch) : undefined,
          upiId: bankRow.upi_id ? String(bankRow.upi_id) : undefined,
        }
      : null;
    const transport = (() => {
      try {
        return inv.transport_json ? JSON.parse(String(inv.transport_json)) : null;
      } catch {
        return null;
      }
    })();

    const partyInfo = this.sql
      .exec('SELECT billing_address, phone, email FROM parties WHERE id = ?', String(inv.party_id))
      .toArray()[0] as { billing_address: string | null; phone: string | null; email: string | null } | undefined;

    return {
      ...inv,
      lines,
      branch,
      bank,
      party_address: partyInfo?.billing_address ?? null,
      party_phone: partyInfo?.phone ?? null,
      party_email: partyInfo?.email ?? null,
      transport,
      shareToken,
      payments: this.sql.exec("SELECT id, payment_no, mode, amount_paise, date FROM payments WHERE invoice_id = ? AND type = 'IN' ORDER BY created_at", String(id)).toArray(),
      amountInWords: amountInWords(new Decimal(inv.total_paise || 0).div(100)),
    };
  }

  /**
   * List invoices with filters and sticky totals bar
   */
  listInvoices(params: ListInvoicesParams): {
    invoices: any[];
    totalCount: number;
    counts: Record<'ALL' | 'PENDING' | 'OVERDUE' | 'PAID' | 'CANCELLED' | 'DRAFT', number>;
    totals: { totalSalesPaise: number; totalPaidPaise: number; totalPendingPaise: number };
  } {
    // Filters other than status (also used for the per-status counts on the tabs)
    let base = 'WHERE deleted_at IS NULL';
    const baseArgs: unknown[] = [];
    if (params.createdById) {
      base += ' AND created_by_id = ?';
      baseArgs.push(String(params.createdById));
    }
    if (params.partyId) {
      base += ' AND party_id = ?';
      baseArgs.push(String(params.partyId));
    }
    if (params.startDate) {
      base += ' AND date >= ?';
      baseArgs.push(String(params.startDate));
    }
    if (params.endDate) {
      base += ' AND date <= ?';
      baseArgs.push(String(params.endDate));
    }
    if (params.search) {
      const q = `%${String(params.search).replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      base += " AND (invoice_no LIKE ? ESCAPE '\\' OR party_name LIKE ? ESCAPE '\\')";
      baseArgs.push(q, q);
    }
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

    let where = base;
    const args: unknown[] = [...baseArgs];
    if (params.status && params.status !== 'ALL') {
      if (params.status === 'PENDING') {
        where += " AND status IN ('UNPAID', 'PARTIALLY_PAID')";
      } else if (params.status === 'OVERDUE') {
        where += " AND status IN ('UNPAID', 'PARTIALLY_PAID') AND due_date IS NOT NULL AND due_date < ?";
        args.push(today);
      } else {
        where += ' AND status = ?';
        args.push(String(params.status));
      }
    }

    const cRow = this.sql.exec(
      `SELECT COUNT(*) AS all_count,
        SUM(CASE WHEN status IN ('UNPAID', 'PARTIALLY_PAID') THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status IN ('UNPAID', 'PARTIALLY_PAID') AND due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) AS paid,
        SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) AS draft
       FROM invoices ${base}`,
      today, ...baseArgs,
    ).toArray()[0] as Record<string, unknown> | undefined;
    const counts = {
      ALL: Number(cRow?.all_count || 0),
      PENDING: Number(cRow?.pending || 0),
      OVERDUE: Number(cRow?.overdue || 0),
      PAID: Number(cRow?.paid || 0),
      CANCELLED: Number(cRow?.cancelled || 0),
      DRAFT: Number(cRow?.draft || 0),
    };

    // Calculate totals across filtered set
    const totalsCursor = this.sql.exec(`
      SELECT
        COALESCE(SUM(total_paise), 0) as total_sales,
        COALESCE(SUM(paid_amount_paise), 0) as total_paid,
        COALESCE(SUM(balance_amount_paise), 0) as total_pending,
        COUNT(*) as count
      FROM invoices ${where}
    `, ...args);
    const tRow = totalsCursor.next();
    const totalSalesPaise = Number(tRow.value?.total_sales || 0);
    const totalPaidPaise = Number(tRow.value?.total_paid || 0);
    const totalPendingPaise = Number(tRow.value?.total_pending || 0);
    const totalCount = Number(tRow.value?.count || 0);

    const limit = Math.min(Math.max(Math.trunc(params.limit ?? 50) || 50, 1), 500);
    const offset = Math.max(Math.trunc(params.offset ?? 0) || 0, 0);

    const listCursor = this.sql.exec(
      `SELECT invoices.*,
        (SELECT phone FROM parties WHERE parties.id = invoices.party_id) AS party_phone,
        (SELECT token FROM invoice_share_tokens t WHERE t.invoice_id = invoices.id LIMIT 1) AS share_token
       FROM invoices ${where} ORDER BY date DESC, invoice_no DESC LIMIT ? OFFSET ?`,
      ...args, limit, offset,
    );

    const invoices: any[] = [];
    let row = listCursor.next();
    while (!row.done && row.value) {
      invoices.push(row.value);
      row = listCursor.next();
    }

    return {
      invoices,
      totalCount,
      counts,
      totals: {
        totalSalesPaise,
        totalPaidPaise,
        totalPendingPaise,
      },
    };
  }

  /**
   * Record customer payment against an invoice
   */
  recordPayment(input: RecordPaymentInput): { paymentId: string; newBalancePaise: number; newStatus: string } {
    const inv = this.getInvoice(input.invoiceId);
    if (!inv) throw new Error('Invoice not found');
    if (inv.status === 'CANCELLED') throw new Error('Cannot record payment on a cancelled invoice');

    const amount = Math.trunc(Number(input.amountPaise));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be greater than zero');
    if (amount > Number(inv.balance_amount_paise || 0)) throw new Error('Payment is more than the balance due');

    const paymentId = newId();
    const now = new Date().toISOString();
    const { docNumber: paymentNo } = this.nextDocNumber('PAYMENT_IN', input.branchId);

    const newPaidPaise = Number(inv.paid_amount_paise || 0) + amount;
    const newBalancePaise = Math.max(0, Number(inv.total_paise || 0) - newPaidPaise);

    const newStatus = newBalancePaise === 0 ? 'PAID' : 'PARTIALLY_PAID';

    // 1. Insert payment record
    // Money account: the one given, else Cash (1001) for cash and Bank (1010) for everything else.
    const payAccId =
      input.paymentAccountId ||
      String(
        (this.sql
          .exec(`SELECT id FROM accounts WHERE code = ? LIMIT 1`, input.paymentMode === 'CASH' ? '1001' : '1010')
          .toArray()[0] as { id: string } | undefined)?.id ?? '',
      );
    if (!payAccId) throw new Error('No cash/bank account configured');
    this.sql.exec(
      `INSERT INTO payments (
        id, payment_no, branch_id, party_id, type, mode, amount_paise, date, invoice_id, account_id, notes, created_by_id, created_at
      ) VALUES (?, ?, ?, ?, 'IN', ?, ?, ?, ?, ?, ?, ?, ?)`,
      paymentId, paymentNo, input.branchId, inv.party_id, input.paymentMode, amount, input.date, input.invoiceId,
      payAccId, input.notes ?? null, input.createdById, now,
    );

    // 2. Update invoice status & balances
    this.sql.exec(
      `UPDATE invoices SET paid_amount_paise = ?, balance_amount_paise = ?, status = ?, updated_at = ? WHERE id = ?`,
      newPaidPaise, newBalancePaise, newStatus, now, input.invoiceId,
    );

    // 3. Post Double-Entry Journal Entry
    this.postingService.postPaymentIn({
      paymentId,
      paymentNo,
      date: input.date,
      branchId: input.branchId,
      partyId: inv.party_id,
      paymentAccountId: payAccId,
      amountPaise: amount,
      narration: `Payment received for ${inv.invoice_no}`,
    });

    return {
      paymentId,
      newBalancePaise,
      newStatus,
    };
  }

  /**
   * Create Credit Note against an invoice
   */
  createCreditNote(input: CreateCreditNoteInput): { creditNoteId: string; noteNo: string } {
    const inv = this.getInvoice(input.invoiceId);
    if (!inv) throw new Error('Invoice not found');

    const noteId = newId();
    const now = new Date().toISOString();
    const { docNumber: noteNo } = this.nextDocNumber('CREDIT_NOTE', input.branchId);

    const returnTotalPaise = input.totalAmountPaise || Number(inv.total_paise || 0);

    // 1. Insert Credit Note
    if (!(returnTotalPaise > 0) || returnTotalPaise > Number(inv.total_paise || 0)) {
      throw new Error('Credit note amount must be between zero and the invoice total');
    }
    this.sql.exec(
      `INSERT INTO credit_notes (id, note_no, invoice_id, branch_id, party_id, date, reason, total_paise, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
      noteId, noteNo, input.invoiceId, input.branchId, inv.party_id, input.date, input.reason, Math.trunc(returnTotalPaise), now,
    );

    // 2. Adjust invoice balance
    const updatedBalance = Math.max(0, Number(inv.balance_amount_paise || 0) - returnTotalPaise);
    this.sql.exec(`UPDATE invoices SET balance_amount_paise = ?, updated_at = ? WHERE id = ?`, updatedBalance, now, input.invoiceId);

    // 3. Post Double-Entry Journal Lines
    const branch = this.getBranch(input.branchId);
    const isInterState = String(branch.state_code) !== String(inv.party_state_code);

    // Approximate GST split proportional to original invoice
    // (value after discount, before tax) / total, so discounts and round-off do not skew the split.
    const taxableRatio = Math.max(0, Number(inv.total_paise || 1) - Number(inv.tax_total_paise || 0)) / Number(inv.total_paise || 1);
    const returnTaxable = Math.round(returnTotalPaise * taxableRatio);
    const returnTax = returnTotalPaise - returnTaxable;
    // Halves must add back to the tax exactly, or the journal would not balance by a paisa.
    const halfTax = Math.floor(returnTax / 2);

    this.postingService.postCreditNote({
      creditNoteId: noteId,
      creditNoteNo: noteNo,
      invoiceId: input.invoiceId,
      date: input.date,
      branchId: input.branchId,
      partyId: inv.party_id,
      isInterState,
      taxableAmountPaise: returnTaxable,
      cgstPaise: isInterState ? 0 : halfTax,
      sgstPaise: isInterState ? 0 : returnTax - halfTax,
      igstPaise: isInterState ? returnTax : 0,
      totalAmountPaise: returnTotalPaise,
      narration: `Credit Note ${noteNo} against ${inv.invoice_no}: ${input.reason}`,
    });

    return { creditNoteId: noteId, noteNo };
  }

  /** Payments on an invoice, newest first. */
  private invoicePayments(invoiceId: string): any[] {
    return this.sql.exec("SELECT * FROM payments WHERE invoice_id = ? AND type = 'IN' ORDER BY created_at DESC", invoiceId).toArray();
  }

  private creditNotesTotal(invoiceId: string): number {
    const r = this.sql.exec("SELECT COALESCE(SUM(total_paise), 0) AS t FROM credit_notes WHERE invoice_id = ? AND status = 'ACTIVE'", invoiceId).toArray()[0] as { t: number } | undefined;
    return Number(r?.t ?? 0);
  }

  private hasLiveEInvoice(invoiceId: string): boolean {
    try {
      const r = this.sql.exec("SELECT 1 FROM e_invoices WHERE invoice_id = ? AND irn IS NOT NULL AND COALESCE(status, '') != 'CANCELLED' LIMIT 1", invoiceId).toArray();
      return r.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Remove a payment record (a wrong entry, a bounced cheque): the money is taken back out of cash or bank, the customer owes it again,
   * and the invoice goes back to unpaid or partly paid. The journal keeps the original entry and the reversal.
   */
  removePayment(paymentId: string, reason: string): { invoiceId: string | null; balancePaise: number; status: string | null } {
    const pay = this.sql.exec("SELECT * FROM payments WHERE id = ? AND type = 'IN'", paymentId).toArray()[0] as any;
    if (!pay) throw new Error('Payment not found');
    const note = `Payment ${pay.payment_no} (${pay.mode}, ${(Number(pay.amount_paise) / 100).toFixed(2)}, ${pay.date}) removed: ${reason}`;
    const debtors = this.postingService.getAccountByCode('1100');
    const amount = Number(pay.amount_paise);
    this.postingService.createJournalEntry({
      entryNo: `REV-PAY-${String(pay.payment_no).replace(/[^A-Za-z0-9_-]/g, '_')}-${Date.now().toString().slice(-5)}`,
      date: new Date().toISOString().split('T')[0]!,
      docType: 'REV_PAYMENT_IN',
      docId: paymentId,
      narration: note,
      branchId: String(pay.branch_id),
      lines: [
        { accountId: String(debtors.id), partyId: String(pay.party_id), debitPaise: amount, creditPaise: 0, narration: note },
        { accountId: String(pay.account_id), partyId: String(pay.party_id), debitPaise: 0, creditPaise: amount, narration: note },
      ],
    });
    this.sql.exec('DELETE FROM payments WHERE id = ?', paymentId);
    const invoiceId = pay.invoice_id ? String(pay.invoice_id) : null;
    if (!invoiceId) return { invoiceId: null, balancePaise: 0, status: null };
    const inv = this.sql.exec('SELECT total_paise, status FROM invoices WHERE id = ?', invoiceId).toArray()[0] as any;
    const paid = this.invoicePayments(invoiceId).reduce((s: number, p: any) => s + Number(p.amount_paise), 0);
    const balance = Math.max(0, Number(inv.total_paise) - paid - this.creditNotesTotal(invoiceId));
    const status = inv.status === 'CANCELLED' ? 'CANCELLED' : balance === 0 ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
    this.sql.exec('UPDATE invoices SET paid_amount_paise = ?, balance_amount_paise = ?, status = ?, updated_at = ? WHERE id = ?', paid, balance, status, new Date().toISOString(), invoiceId);
    return { invoiceId, balancePaise: balance, status };
  }

  /**
   * Change an invoice (customer, lines, dates, notes) and keep its number. Works on unpaid invoices and on cancelled ones:
   * a cancelled invoice that is edited comes back to life, so its number can go to another client.
   */
  editInvoice(id: string, input: CreateInvoiceInput): any {
    const inv = this.getInvoice(id);
    if (!inv) throw new Error('Invoice not found');
    if (this.invoicePayments(id).length > 0) throw new Error('This invoice has payments. Remove the payment records first, then edit it.');
    if (this.creditNotesTotal(id) > 0) throw new Error('This invoice has a credit note, so it cannot be edited.');
    if (this.hasLiveEInvoice(id)) throw new Error('An e-invoice (IRN) was generated for this invoice, so it cannot be edited. Cancel the IRN first.');
    if (inv.status !== 'CANCELLED') this.postingService.reverseDocument('INVOICE', id, 'Edited');
    this.sql.exec('DELETE FROM invoice_lines WHERE invoice_id = ?', id);
    return this.createInvoice(
      { ...input, paidAmountPaise: 0 },
      { id, invoiceNo: String(inv.invoice_no), seriesId: String(inv.series_id), createdAt: String(inv.created_at), createdById: String(inv.created_by_id) },
    );
  }

  /**
   * Delete an invoice completely. Its figures are taken out of the books (a reversal entry stays in the journal), the record is hidden
   * and its bill number is free again for a new invoice. Payments must be removed first.
   */
  deleteInvoice(id: string, reason: string): { invoiceNo: string } {
    const inv = this.getInvoice(id);
    if (!inv) throw new Error('Invoice not found');
    if (this.invoicePayments(id).length > 0) throw new Error('This invoice has payments. Remove the payment records first, then delete it.');
    if (this.creditNotesTotal(id) > 0) throw new Error('This invoice has a credit note, so it cannot be deleted. Cancel it instead.');
    if (this.hasLiveEInvoice(id)) throw new Error('An e-invoice (IRN) was generated for this invoice, so it cannot be deleted. Cancel the IRN first.');
    const now = new Date().toISOString();
    if (inv.status !== 'CANCELLED') this.postingService.reverseDocument('INVOICE', id, `Deleted: ${reason}`);
    const original = String(inv.invoice_no);
    this.sql.exec('DELETE FROM invoice_share_tokens WHERE invoice_id = ?', id);
    this.sql.exec(
      `UPDATE invoices SET deleted_at = ?, invoice_no = ?, status = 'CANCELLED',
         notes = CASE WHEN notes IS NULL THEN ? ELSE notes || ' | ' || ? END, updated_at = ? WHERE id = ?`,
      now, `${original}~deleted-${id.slice(0, 6)}`, `Deleted: ${reason}`, `Deleted: ${reason}`, now, id,
    );
    return { invoiceNo: original };
  }

  /** Bill numbers of deleted invoices that no live invoice uses, so the form can offer them again. */
  freeInvoiceNumbers(): string[] {
    const rows = this.sql.exec("SELECT invoice_no FROM invoices WHERE deleted_at IS NOT NULL AND invoice_no LIKE '%~deleted-%' ORDER BY deleted_at DESC LIMIT 100").toArray() as { invoice_no: string }[];
    const out: string[] = [];
    for (const r of rows) {
      const original = String(r.invoice_no).split('~deleted-')[0]!;
      if (this.sql.exec('SELECT 1 FROM invoices WHERE invoice_no = ? LIMIT 1', original).toArray().length === 0 && !out.includes(original)) out.push(original);
    }
    return out;
  }

  /**
   * Cancel Invoice and reverse all posted journal lines
   */
  cancelInvoice(id: string, reason: string): boolean {
    const inv = this.getInvoice(id);
    if (!inv) throw new Error('Invoice not found');
    if (inv.status === 'CANCELLED') throw new Error('Invoice is already cancelled');

    const now = new Date().toISOString();

    // 1. Reverse all accounting lines
    this.postingService.reverseDocument('INVOICE', id, `Cancellation: ${reason}`);

    // 2. Mark cancelled
    this.sql.exec(
      `UPDATE invoices SET status = 'CANCELLED',
         notes = CASE WHEN notes IS NULL THEN ? ELSE notes || ' | ' || ? END, updated_at = ? WHERE id = ?`,
      `Cancelled: ${reason}`, `Cancelled: ${reason}`, now, id,
    );

    return true;
  }

  /**
   * Resolve public share token: increments view count and marks viewed_at
   */
  getPublicInvoice(token: string): any {
    if (!/^[A-Za-z0-9]{20,64}$/.test(String(token))) return null;
    const tokenRecord = this.sql.exec(`SELECT * FROM invoice_share_tokens WHERE token = ?`, String(token)).toArray()[0];
    if (!tokenRecord) return null;
    const invoiceId = String(tokenRecord.invoice_id);

    // Increment view count
    const now = new Date().toISOString();
    const newViewCount = Number(tokenRecord.view_count || 0) + 1;
    this.sql.exec(`UPDATE invoice_share_tokens SET view_count = ?, viewed_at = ? WHERE id = ?`, newViewCount, now, String(tokenRecord.id));

    const inv = this.getInvoice(invoiceId);
    if (!inv) return null;

    // Get default bank/UPI for payment QR code
    const bnkCursor = this.sql.exec("SELECT * FROM bank_accounts WHERE is_default = 1 AND deleted_at IS NULL LIMIT 1");
    const bnkRow = bnkCursor.next();
    const upiId = !bnkRow.done && bnkRow.value?.upi_id ? String(bnkRow.value.upi_id) : null;
    const payee = this.sql.exec(`SELECT name FROM branches WHERE id = ? LIMIT 1`, String(inv.branch_id)).toArray()[0] as { name: string } | undefined;

    const cleanAmount = (Number(inv.balance_amount_paise || inv.total_paise) / 100).toFixed(2);
    // Pay the BUSINESS (payee), never the customer; no UPI link when the business has not set a UPI ID.
    const upiDeepLink = upiId
      ? `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payee?.name ?? '')}&am=${cleanAmount}&cu=INR&tn=${encodeURIComponent(inv.invoice_no)}`
      : null;

    return {
      invoice: inv,
      token: tokenRecord.token,
      viewCount: newViewCount,
      viewedAt: now,
      upiId,
      upiDeepLink,
    };
  }
}
