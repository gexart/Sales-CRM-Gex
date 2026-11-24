import { allocateDocNumber } from './numbering';
import { moneyAccountFor } from './payment-record';
import { PostingService } from './posting';
import { newId, calculateDocumentGst, GstLineItemInput } from '@billing/shared';

export interface CreatePurchaseBillLineInput {
  itemId: string;
  quantityThousandths: number; // e.g. 50000 = 50.000 units
  unitPricePaise: number;
  taxRateBasisPoints: number; // e.g. 1800 = 18%
  discountPaise?: number;
}

export interface CreatePurchaseBillInput {
  branchId: string;
  warehouseId: string;
  partyId: string;
  vendorBillNo?: string;
  vendorInvoiceDate?: string;
  date?: string;
  dueDate?: string;
  lines: CreatePurchaseBillLineInput[];
  rcmApplicable?: boolean;
  itcEligibility?: 'ELIGIBLE' | 'INELIGIBLE' | 'BLOCKED_17_5';
  paidAmountPaise?: number;
  paymentMode?: 'CASH' | 'BANK' | 'UPI';
  paymentAccountId?: string;
  notes?: string;
  receiptFileKey?: string;
}

export interface RecordPurchasePaymentInput {
  amountPaise: number;
  paymentMode: 'CASH' | 'BANK' | 'UPI';
  paymentAccountId?: string;
  referenceNo?: string;
  date?: string;
  notes?: string;
}

export interface CreateDebitNoteInput {
  billId: string;
  reason: string;
  date?: string;
  lines: {
    itemId: string;
    quantityThousandths: number;
    unitPricePaise: number;
    taxRateBasisPoints: number;
  }[];
}

export interface CreateExpenseInput {
  branchId: string;
  categoryAccountId: string;
  paymentAccountId: string;
  amountPaise: number;
  date?: string;
  taxRateBasisPoints?: number;
  isInterState?: boolean;
  claimsItc?: boolean;
  paymentMode?: 'CASH' | 'BANK' | 'UPI';
  referenceNo?: string;
  payee?: string;
  notes?: string;
  receiptFileKey?: string;
  createdById?: string;
}

export class PurchaseService {
  private postingService: PostingService;

  constructor(private sql: any, postingService?: PostingService) {
    this.postingService = postingService || new PostingService(sql);
  }

  private query<T>(statement: string, ...bindings: any[]): T[] {
    const cursor = this.sql.exec(statement, ...bindings);
    const rows: T[] = [];
    let row = cursor.next();
    while (!row.done) {
      if (row.value) rows.push(row.value);
      row = cursor.next();
    }
    return rows;
  }

  private queryOne<T>(statement: string, ...bindings: any[]): T | null {
    const cursor = this.sql.exec(statement, ...bindings);
    const row = cursor.next();
    return !row.done && row.value ? (row.value as T) : null;
  }

  private run(statement: string, ...bindings: any[]): void {
    this.sql.exec(statement, ...bindings);
  }

  private nextDocNumber(branchId: string, docType: string, date?: string): string {
    return allocateDocNumber(this.sql, { docType: docType === 'BILL' ? 'PURCHASE_BILL' : docType, branchId, date }).docNumber;
  }

  /**
   * 1. Create Purchase Bill:
   * - Inwards stock into selected warehouse
   * - Updates weighted average cost & purchase price on items
   * - Posts double-entry journal (with correct ITC split or capitalization)
   * - Records initial payment if provided
   */
  createPurchaseBill(input: CreatePurchaseBillInput) {
    if (!input.lines || input.lines.length === 0) {
      throw new Error('Purchase bill must have at least one line item');
    }

    const billDate = input.date || new Date().toISOString();
    const dueDate = input.dueDate || billDate;
    const itcEligibility = input.itcEligibility || 'ELIGIBLE';

    // 1. Fetch Party to determine GST and Place of Supply
    const party = this.queryOne<{ id: string; name: string; state_code: string; gstin?: string }>(
      `SELECT id, name, state_code, gstin FROM parties WHERE id = ?`,
      input.partyId,
    );
    if (!party) {
      throw new Error(`Party ${input.partyId} not found`);
    }

    const branch = this.queryOne<{ id: string; state_code: string }>(
      `SELECT id, state_code FROM branches WHERE id = ?`,
      input.branchId,
    );
    const branchState = branch?.state_code || '19';
    const isInterState = party.state_code ? party.state_code !== branchState : false;

    // 2. Compute bill lines & taxes using calculateDocumentGst
    const gstInputs: GstLineItemInput[] = input.lines.map((l) => ({
      quantity: l.quantityThousandths / 1000,
      unitPrice: l.unitPricePaise / 100,
      isTaxInclusive: false,
      taxRatePercent: l.taxRateBasisPoints / 100,
      discountAmount: (l.discountPaise || 0) / 100,
    }));

    const gstCalc = calculateDocumentGst(gstInputs, {
      sellerStateCode: branchState,
      placeOfSupplyStateCode: party.state_code || branchState,
    });

    const subtotalPaise = Math.round(gstCalc.taxableSubtotal.mul(100).toNumber());
    const cgstPaise = Math.round(gstCalc.cgstTotal.mul(100).toNumber());
    const sgstPaise = Math.round(gstCalc.sgstTotal.mul(100).toNumber());
    const igstPaise = Math.round(gstCalc.igstTotal.mul(100).toNumber());
    const taxTotalPaise = Math.round(gstCalc.taxTotal.mul(100).toNumber());
    const totalPaise = Math.round(gstCalc.grandTotal.mul(100).toNumber());
    const paidAmountPaise = Math.min(input.paidAmountPaise || 0, totalPaise);
    const status = paidAmountPaise >= totalPaise ? 'PAID' : paidAmountPaise > 0 ? 'PARTIALLY_PAID' : 'UNPAID';

    // 3. Generate sequential bill number
    const billNo = this.nextDocNumber(input.branchId, 'BILL');
    const billId = newId();
    const now = new Date().toISOString();

    // 4. Insert Purchase Bill
    this.run(
      `INSERT INTO purchase_bills (
        id, bill_no, vendor_bill_no, vendor_invoice_date, branch_id, warehouse_id, party_id,
        date, due_date, subtotal_paise, cgst_paise, sgst_paise, igst_paise, tax_total_paise,
        total_paise, paid_amount_paise, rcm_applicable, itc_eligibility, status, notes,
        receipt_file_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      billId,
      billNo,
      input.vendorBillNo || null,
      input.vendorInvoiceDate || null,
      input.branchId,
      input.warehouseId,
      input.partyId,
      billDate,
      dueDate,
      subtotalPaise,
      cgstPaise,
      sgstPaise,
      igstPaise,
      taxTotalPaise,
      totalPaise,
      paidAmountPaise,
      input.rcmApplicable ? 1 : 0,
      itcEligibility,
      status,
      input.notes || null,
      input.receiptFileKey || null,
      now,
      now,
    );

    // 5. Insert lines and update inventory + weighted-average cost
    input.lines.forEach((line, idx) => {
      const lineGst = gstCalc.lines[idx];
      const lineId = newId();
      const lineTaxablePaise = Math.round(lineGst.taxableAmount.mul(100).toNumber());
      const lineTaxPaise = Math.round((lineGst.cgstAmount.plus(lineGst.sgstAmount).plus(lineGst.igstAmount)).mul(100).toNumber());
      const lineTotalPaise = Math.round(lineGst.totalLineAmount.mul(100).toNumber());

      this.run(
        `INSERT INTO purchase_bill_lines (
          id, bill_id, item_id, quantity_thousandths, unit_price_paise,
          tax_rate_basis_points, taxable_amount_paise, tax_amount_paise,
          discount_paise, line_total_paise
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        lineId,
        billId,
        line.itemId,
        line.quantityThousandths,
        line.unitPricePaise,
        line.taxRateBasisPoints,
        lineTaxablePaise,
        lineTaxPaise,
        line.discountPaise || 0,
        lineTotalPaise,
      );

      // Inventory Inward: Append stock_ledgers
      const stockBalance = this.queryOne<{ current_qty_thousandths: number }>(
        `SELECT current_qty_thousandths FROM stock_balances WHERE branch_id = ? AND warehouse_id = ? AND item_id = ?`,
        input.branchId,
        input.warehouseId,
        line.itemId,
      );

      const currentQty = stockBalance ? stockBalance.current_qty_thousandths : 0;
      const newQty = currentQty + line.quantityThousandths;

      this.run(
        `INSERT INTO stock_ledgers (
          id, date, branch_id, warehouse_id, item_id, doc_type, doc_id, doc_no,
          qty_in_thousandths, qty_out_thousandths, rate_paise, balance_qty_thousandths, created_at
        ) VALUES (?, ?, ?, ?, ?, 'BILL', ?, ?, ?, 0, ?, ?, ?)`,
        newId(),
        billDate,
        input.branchId,
        input.warehouseId,
        line.itemId,
        billId,
        billNo,
        line.quantityThousandths,
        line.unitPricePaise,
        newQty,
        now,
      );

      // Upsert stock_balances cache
      if (stockBalance) {
        this.run(
          `UPDATE stock_balances SET current_qty_thousandths = ?, updated_at = ? WHERE branch_id = ? AND warehouse_id = ? AND item_id = ?`,
          newQty,
          now,
          input.branchId,
          input.warehouseId,
          line.itemId,
        );
      } else {
        this.run(
          `INSERT INTO stock_balances (
            id, branch_id, warehouse_id, item_id, current_qty_thousandths, reserved_qty_thousandths, updated_at
          ) VALUES (?, ?, ?, ?, ?, 0, ?)`,
          newId(),
          input.branchId,
          input.warehouseId,
          line.itemId,
          newQty,
          now,
        );
      }

      // Weighted-Average Cost & Purchase Price Calculation
      const itemRecord = this.queryOne<{
        purchase_price_paise: number;
        average_cost_paise: number;
      }>(
        `SELECT purchase_price_paise, average_cost_paise FROM items WHERE id = ?`,
        line.itemId,
      );

      if (itemRecord) {
        const prevAvg = itemRecord.average_cost_paise || itemRecord.purchase_price_paise || 0;
        let newAvg = line.unitPricePaise;

        if (currentQty > 0 && prevAvg > 0) {
          const totalPrevValue = (currentQty / 1000) * prevAvg;
          const incomingValue = (line.quantityThousandths / 1000) * line.unitPricePaise;
          const totalUnits = (currentQty + line.quantityThousandths) / 1000;
          newAvg = Math.round((totalPrevValue + incomingValue) / totalUnits);
        }

        this.run(
          `UPDATE items SET purchase_price_paise = ?, average_cost_paise = ? WHERE id = ?`,
          line.unitPricePaise,
          newAvg,
          line.itemId,
        );
      }
    });

    // 6. Double-Entry Journal Posting inside same DO transaction
    const isEligibleItc = itcEligibility === 'ELIGIBLE';
    const postingTaxable = isEligibleItc ? subtotalPaise : totalPaise;
    const postingCgst = isEligibleItc ? cgstPaise : 0;
    const postingSgst = isEligibleItc ? sgstPaise : 0;
    const postingIgst = isEligibleItc ? igstPaise : 0;

    this.postingService.postPurchaseBill({
      billId,
      billNo,
      date: billDate,
      branchId: input.branchId,
      partyId: input.partyId,
      isInterState,
      taxableAmountPaise: postingTaxable,
      cgstPaise: postingCgst,
      sgstPaise: postingSgst,
      igstPaise: postingIgst,
      totalAmountPaise: totalPaise,
      narration: `Purchase Bill ${billNo} from ${party.name} (${itcEligibility})`,
    });

    // 7. If initial payment was made at billing, post payment out
    if (paidAmountPaise > 0) {
      const paymentNo = this.nextDocNumber(input.branchId, 'PAYMENT_OUT');
      const paymentId = newId();
      const accountId = moneyAccountFor(this.sql, input.paymentMode, input.paymentAccountId);

      this.run(
        `INSERT INTO payments (
          id, payment_no, branch_id, party_id, type, mode, amount_paise, date,
          account_id, notes, created_by_id, created_at
        ) VALUES (?, ?, ?, ?, 'OUT', ?, ?, ?, ?, ?, 'system', ?)`,
        paymentId,
        paymentNo,
        input.branchId,
        input.partyId,
        input.paymentMode || 'CASH',
        paidAmountPaise,
        billDate,
        accountId,
        `Payment for bill ${billNo}`,
        now,
      );

      this.postingService.postPaymentOut({
        paymentId,
        paymentNo,
        date: billDate,
        branchId: input.branchId,
        partyId: input.partyId,
        paymentAccountId: accountId,
        amountPaise: paidAmountPaise,
        narration: `Payment made for bill ${billNo}`,
      });
    }

    return this.getPurchaseBill(billId);
  }

  /**
   * 2. Get Purchase Bill with lines and party details
   */
  getPurchaseBill(id: string) {
    const bill = this.queryOne<any>(
      `SELECT pb.*, p.name AS party_name, p.gstin AS party_gstin, p.phone AS party_phone,
              p.billing_address AS party_address, p.state_code AS party_state_code,
              w.name AS warehouse_name
       FROM purchase_bills pb
       JOIN parties p ON p.id = pb.party_id
       JOIN warehouses w ON w.id = pb.warehouse_id
       WHERE pb.id = ?`,
      id,
    );

    if (!bill) return null;

    const lines = this.query<any>(
      `SELECT pbl.*, i.name AS item_name, i.sku, i.barcode, u.code AS unit
       FROM purchase_bill_lines pbl
       JOIN items i ON i.id = pbl.item_id
       LEFT JOIN units u ON u.id = i.unit_id
       WHERE pbl.bill_id = ?`,
      id,
    );

    return {
      ...bill,
      lines,
    };
  }

  /**
   * 3. List Purchase Bills
   */
  listPurchaseBills(params: { branchId?: string; partyId?: string; status?: string; search?: string; limit?: number }) {
    let query = `
      SELECT pb.*, p.name AS party_name, p.gstin AS party_gstin, w.name AS warehouse_name
      FROM purchase_bills pb
      JOIN parties p ON p.id = pb.party_id
      JOIN warehouses w ON w.id = pb.warehouse_id
      WHERE 1=1
    `;
    const bindings: any[] = [];

    if (params.branchId) {
      query += ` AND pb.branch_id = ?`;
      bindings.push(params.branchId);
    }
    if (params.partyId) {
      query += ` AND pb.party_id = ?`;
      bindings.push(params.partyId);
    }
    if (params.status && params.status !== 'ALL') {
      query += ` AND pb.status = ?`;
      bindings.push(params.status);
    }
    if (params.search) {
      query += ` AND (pb.bill_no LIKE ? OR pb.vendor_bill_no LIKE ? OR p.name LIKE ?)`;
      const s = `%${params.search}%`;
      bindings.push(s, s, s);
    }

    const limit = params.limit || 50;
    query += ` ORDER BY pb.created_at DESC LIMIT ?`;
    bindings.push(limit);

    return this.query<any>(query, ...bindings);
  }

  /**
   * 4. Record Payment Out against a Purchase Bill
   */
  recordPaymentOut(billId: string, input: RecordPurchasePaymentInput) {
    const bill = this.queryOne<any>(`SELECT * FROM purchase_bills WHERE id = ?`, billId);
    if (!bill) throw new Error(`Purchase bill ${billId} not found`);

    const balancePaise = bill.total_paise - bill.paid_amount_paise;
    if (balancePaise <= 0) {
      throw new Error('This purchase bill is already fully paid');
    }

    const payAmountPaise = Math.min(input.amountPaise, balancePaise);
    const newPaidPaise = bill.paid_amount_paise + payAmountPaise;
    const newStatus = newPaidPaise >= bill.total_paise ? 'PAID' : 'PARTIALLY_PAID';
    const now = new Date().toISOString();
    const payDate = input.date || now;

    // 1. Update purchase_bills
    this.run(
      `UPDATE purchase_bills SET paid_amount_paise = ?, status = ?, updated_at = ? WHERE id = ?`,
      newPaidPaise,
      newStatus,
      now,
      billId,
    );

    // 2. Insert Payment Record
    const paymentNo = this.nextDocNumber(bill.branch_id, 'PAYMENT_OUT');
    const paymentId = newId();
    const accountId = moneyAccountFor(this.sql, input.paymentMode, input.paymentAccountId);

    this.run(
      `INSERT INTO payments (
        id, payment_no, branch_id, party_id, type, mode, amount_paise, date,
        account_id, notes, created_by_id, created_at
      ) VALUES (?, ?, ?, ?, 'OUT', ?, ?, ?, ?, ?, 'system', ?)`,
      paymentId,
      paymentNo,
      bill.branch_id,
      bill.party_id,
      input.paymentMode,
      payAmountPaise,
      payDate,
      accountId,
      input.notes || `Payment for bill ${bill.bill_no}`,
      new Date().toISOString(),
    );

    // 3. Post Double-Entry Journal: Dr. Sundry Creditors, Cr. Payment Account
    this.postingService.postPaymentOut({
      paymentId,
      paymentNo,
      date: payDate,
      branchId: bill.branch_id,
      partyId: bill.party_id,
      paymentAccountId: accountId,
      amountPaise: payAmountPaise,
      narration: `Payment out against Bill ${bill.bill_no}: Ref ${input.referenceNo || '-'}`,
    });

    return this.getPurchaseBill(billId);
  }

  /**
   * 5. Issue Debit Note (Purchase Return):
   * - Reduces warehouse inventory
   * - Reverses input tax credit and accounts payable
   */
  createDebitNote(input: CreateDebitNoteInput) {
    const bill = this.queryOne<any>(
      `SELECT pb.*, p.state_code AS party_state_code
       FROM purchase_bills pb
       JOIN parties p ON p.id = pb.party_id
       WHERE pb.id = ?`,
      input.billId,
    );
    if (!bill) throw new Error(`Purchase bill ${input.billId} not found`);

    const branch = this.queryOne<{ state_code: string }>(
      `SELECT state_code FROM branches WHERE id = ?`,
      bill.branch_id,
    );
    const branchState = branch?.state_code || '19';
    const isInterState = bill.party_state_code ? bill.party_state_code !== branchState : false;

    // Calculate return totals
    const gstInputs: GstLineItemInput[] = input.lines.map((l) => ({
      quantity: l.quantityThousandths / 1000,
      unitPrice: l.unitPricePaise / 100,
      isTaxInclusive: false,
      taxRatePercent: l.taxRateBasisPoints / 100,
      discountAmount: 0,
    }));

    const gstCalc = calculateDocumentGst(gstInputs, {
      sellerStateCode: branchState,
      placeOfSupplyStateCode: bill.party_state_code || branchState,
    });

    const taxableSubtotalPaise = Math.round(gstCalc.taxableSubtotal.mul(100).toNumber());
    const cgstPaise = Math.round(gstCalc.cgstTotal.mul(100).toNumber());
    const sgstPaise = Math.round(gstCalc.sgstTotal.mul(100).toNumber());
    const igstPaise = Math.round(gstCalc.igstTotal.mul(100).toNumber());
    const grandTotalPaise = Math.round(gstCalc.grandTotal.mul(100).toNumber());

    const noteNo = this.nextDocNumber(bill.branch_id, 'DEBIT_NOTE');
    const noteId = newId();
    const now = new Date().toISOString();
    const noteDate = input.date || now;

    // 1. Insert debit_notes
    this.run(
      `INSERT INTO debit_notes (
        id, note_no, bill_id, branch_id, warehouse_id, party_id, date,
        taxable_amount_paise, cgst_paise, sgst_paise, igst_paise, total_paise, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      noteId,
      noteNo,
      input.billId,
      bill.branch_id,
      bill.warehouse_id,
      bill.party_id,
      noteDate,
      taxableSubtotalPaise,
      cgstPaise,
      sgstPaise,
      igstPaise,
      grandTotalPaise,
      input.reason,
      now,
    );

    // 2. Outward inventory reduction in warehouse
    input.lines.forEach((line) => {
      const stockBalance = this.queryOne<{ current_qty_thousandths: number }>(
        `SELECT current_qty_thousandths FROM stock_balances WHERE branch_id = ? AND warehouse_id = ? AND item_id = ?`,
        bill.branch_id,
        bill.warehouse_id,
        line.itemId,
      );

      const currentQty = stockBalance ? stockBalance.current_qty_thousandths : 0;
      const newQty = Math.max(0, currentQty - line.quantityThousandths);

      this.run(
        `INSERT INTO stock_ledgers (
          id, date, branch_id, warehouse_id, item_id, doc_type, doc_id, doc_no,
          qty_in_thousandths, qty_out_thousandths, rate_paise, balance_qty_thousandths, created_at
        ) VALUES (?, ?, ?, ?, ?, 'DEBIT_NOTE', ?, ?, 0, ?, ?, ?, ?)`,
        newId(),
        noteDate,
        bill.branch_id,
        bill.warehouse_id,
        line.itemId,
        noteId,
        noteNo,
        line.quantityThousandths,
        line.unitPricePaise,
        newQty,
        now,
      );

      this.run(
        `UPDATE stock_balances SET current_qty_thousandths = ? WHERE branch_id = ? AND warehouse_id = ? AND item_id = ?`,
        newQty,
        bill.branch_id,
        bill.warehouse_id,
        line.itemId,
      );
    });

    // 3. Post Journal: Dr. Sundry Creditors, Cr. Purchase Returns, Cr. Input GST
    this.postingService.postDebitNote({
      debitNoteId: noteId,
      debitNoteNo: noteNo,
      billId: input.billId,
      date: noteDate,
      branchId: bill.branch_id,
      partyId: bill.party_id,
      isInterState,
      taxableAmountPaise: taxableSubtotalPaise,
      cgstPaise: cgstPaise,
      sgstPaise: sgstPaise,
      igstPaise: igstPaise,
      totalAmountPaise: grandTotalPaise,
      narration: `Debit Note ${noteNo} on Bill ${bill.bill_no}: ${input.reason}`,
    });

    return {
      id: noteId,
      noteNo,
      billId: input.billId,
      totalPaise: grandTotalPaise,
      taxableAmountPaise: taxableSubtotalPaise,
      cgstPaise: cgstPaise,
      sgstPaise: sgstPaise,
      igstPaise: igstPaise,
    };
  }

  /**
   * 6. Create Business Expense:
   * - Validates category account (EXPENSE type) and payment account (ASSET type: Cash/Bank)
   * - Optional GST computation with ITC eligibility
   * - Posts journal Dr. Expense, Dr. Input GST, Cr. Payment Account
   */
  createExpense(input: CreateExpenseInput) {
    if (!input.amountPaise || input.amountPaise <= 0) {
      throw new Error('Expense amount must be greater than zero');
    }

    const expenseNo = this.nextDocNumber(input.branchId, 'EXPENSE');
    const expenseId = newId();
    const now = new Date().toISOString();
    const expenseDate = input.date || now;

    const taxRate = input.taxRateBasisPoints || 0;
    let taxableAmountPaise = input.amountPaise;
    let taxAmountPaise = 0;
    let cgstPaise = 0;
    let sgstPaise = 0;
    let igstPaise = 0;

    if (taxRate > 0 && input.claimsItc) {
      // Backwards calculation: amountPaise is inclusive of tax
      const factor = 1 + taxRate / 10000;
      taxableAmountPaise = Math.round(input.amountPaise / factor);
      taxAmountPaise = input.amountPaise - taxableAmountPaise;

      if (input.isInterState) {
        igstPaise = taxAmountPaise;
      } else {
        cgstPaise = Math.floor(taxAmountPaise / 2);
        sgstPaise = taxAmountPaise - cgstPaise;
      }
    }

    // 1. Insert expenses table
    this.run(
      `INSERT INTO expenses (
        id, expense_no, branch_id, category_account_id, payment_account_id,
        amount_paise, tax_rate_basis_points, tax_amount_paise, date,
        payment_mode, reference_no, payee, notes, receipt_file_key, created_by_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      expenseId,
      expenseNo,
      input.branchId,
      input.categoryAccountId,
      input.paymentAccountId,
      input.amountPaise,
      taxRate,
      taxAmountPaise,
      expenseDate,
      input.paymentMode || 'CASH',
      input.referenceNo || null,
      input.payee || null,
      input.notes || null,
      input.receiptFileKey || null,
      input.createdById || 'system',
      now,
    );

    // 2. Post Journal: Dr. Expense, Dr. Input GST, Cr. Payment Account
    this.postingService.postExpense({
      expenseId,
      expenseNo,
      date: expenseDate,
      branchId: input.branchId,
      categoryAccountId: input.categoryAccountId,
      paymentAccountId: input.paymentAccountId,
      taxableAmountPaise,
      isInterState: input.isInterState,
      inputCgstPaise: cgstPaise,
      inputSgstPaise: sgstPaise,
      inputIgstPaise: igstPaise,
      totalAmountPaise: input.amountPaise,
      payee: input.payee,
      narration: `Expense ${expenseNo}: ${input.payee || 'Direct Expense'} - ${input.notes || ''}`,
    });

    return {
      id: expenseId,
      expenseNo,
      date: expenseDate,
      amountPaise: input.amountPaise,
      taxAmountPaise,
      categoryAccountId: input.categoryAccountId,
      paymentAccountId: input.paymentAccountId,
      payee: input.payee,
    };
  }

  /**
   * 7. List Expenses with category name and payment account name
   */
  listExpenses(params: { branchId?: string; categoryAccountId?: string; search?: string; limit?: number }) {
    let query = `
      SELECT e.*, c.name AS category_name, p.name AS payment_account_name
      FROM expenses e
      JOIN accounts c ON c.id = e.category_account_id
      JOIN accounts p ON p.id = e.payment_account_id
      WHERE 1=1
    `;
    const bindings: any[] = [];

    if (params.branchId) {
      query += ` AND e.branch_id = ?`;
      bindings.push(params.branchId);
    }
    if (params.categoryAccountId) {
      query += ` AND e.category_account_id = ?`;
      bindings.push(params.categoryAccountId);
    }
    if (params.search) {
      query += ` AND (e.expense_no LIKE ? OR e.payee LIKE ? OR e.notes LIKE ?)`;
      const s = `%${params.search}%`;
      bindings.push(s, s, s);
    }

    const limit = params.limit || 100;
    query += ` ORDER BY e.date DESC, e.created_at DESC LIMIT ?`;
    bindings.push(limit);

    return this.query<any>(query, ...bindings);
  }

  /**
   * 8. Expense Summary by Category
   */
  getExpenseSummary(branchId?: string) {
    let query = `
      SELECT c.name AS category_name, SUM(e.amount_paise) AS total_paise, COUNT(e.id) AS count
      FROM expenses e
      JOIN accounts c ON c.id = e.category_account_id
      WHERE 1=1
    `;
    const bindings: any[] = [];
    if (branchId) {
      query += ` AND e.branch_id = ?`;
      bindings.push(branchId);
    }
    query += ` GROUP BY c.id, c.name ORDER BY total_paise DESC`;

    return this.query<any>(query, ...bindings);
  }
}
