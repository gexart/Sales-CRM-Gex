import { newId } from '@billing/shared';

export interface JournalLineDraft {
  accountId: string;
  partyId?: string;
  debitPaise: number;
  creditPaise: number;
  narration?: string;
}

export interface PostInvoiceParams {
  invoiceId: string;
  invoiceNo: string;
  date: string;
  branchId: string;
  partyId?: string;
  paymentMode?: 'CASH' | 'BANK' | 'CREDIT' | 'UPI' | 'CARD';
  paymentAccountId?: string;
  isInterState: boolean;
  taxableAmountPaise: number;
  cgstPaise?: number;
  sgstPaise?: number;
  igstPaise?: number;
  cessPaise?: number;
  discountPaise?: number;
  roundOffPaise?: number;
  totalAmountPaise: number;
  paidAmountPaise?: number;
  narration?: string;
}

export interface PostCreditNoteParams {
  creditNoteId: string;
  creditNoteNo: string;
  invoiceId?: string;
  date: string;
  branchId: string;
  partyId?: string;
  isInterState: boolean;
  taxableAmountPaise: number;
  cgstPaise?: number;
  sgstPaise?: number;
  igstPaise?: number;
  cessPaise?: number;
  roundOffPaise?: number;
  totalAmountPaise: number;
  narration?: string;
}

export interface PostPurchaseBillParams {
  billId: string;
  billNo: string;
  date: string;
  branchId: string;
  partyId?: string;
  paymentMode?: 'CASH' | 'BANK' | 'CREDIT' | 'UPI';
  paymentAccountId?: string;
  isInterState: boolean;
  taxableAmountPaise: number;
  cgstPaise?: number;
  sgstPaise?: number;
  igstPaise?: number;
  cessPaise?: number;
  discountReceivedPaise?: number;
  roundOffPaise?: number;
  totalAmountPaise: number;
  paidAmountPaise?: number;
  narration?: string;
}

export interface PostDebitNoteParams {
  debitNoteId: string;
  debitNoteNo: string;
  billId?: string;
  date: string;
  branchId: string;
  partyId?: string;
  isInterState: boolean;
  taxableAmountPaise: number;
  cgstPaise?: number;
  sgstPaise?: number;
  igstPaise?: number;
  cessPaise?: number;
  roundOffPaise?: number;
  totalAmountPaise: number;
  narration?: string;
}

export interface PostPaymentInParams {
  paymentId: string;
  paymentNo: string;
  date: string;
  branchId: string;
  partyId?: string;
  paymentAccountId: string; // Cash or Bank account
  amountPaise: number;
  tdsPaise?: number;
  narration?: string;
}

export interface PostPaymentOutParams {
  paymentId: string;
  paymentNo: string;
  date: string;
  branchId: string;
  partyId?: string;
  paymentAccountId: string; // Cash or Bank account
  amountPaise: number;
  narration?: string;
}

export interface PostExpenseParams {
  expenseId: string;
  expenseNo: string;
  date: string;
  branchId: string;
  categoryAccountId: string; // e.g. Rent, Salary, Misc
  paymentAccountId: string; // Cash or Bank
  taxableAmountPaise: number;
  isInterState?: boolean;
  inputCgstPaise?: number;
  inputSgstPaise?: number;
  inputIgstPaise?: number;
  totalAmountPaise: number;
  payee?: string;
  narration?: string;
}

export interface PostStockAdjustmentParams {
  adjustmentId: string;
  adjustmentNo: string;
  date: string;
  branchId: string;
  type: 'INCREASE' | 'DECREASE';
  valuePaise: number;
  reason?: string;
}

export interface TrialBalanceRow {
  code: string;
  name: string;
  type: string;
  subtype: string;
  debitPaise: number;
  creditPaise: number;
  netDebitPaise: number;
  netCreditPaise: number;
}

export class PostingService {
  constructor(private sql: any) {}

  /**
   * Helper to find an account by code (e.g. "1001", "1100", "4001")
   */
  getAccountByCode(code: string): { id: string; code: string; name: string; type: string } {
    const cursor = this.sql.exec(`SELECT id, code, name, type FROM accounts WHERE code = ?`, code);
    const row = cursor.next();
    if (row.done || !row.value) {
      throw new Error(`Account code '${code}' not found in Chart of Accounts`);
    }
    return {
      id: String(row.value.id),
      code: String(row.value.code),
      name: String(row.value.name),
      type: String(row.value.type),
    };
  }

  /**
   * Helper to find an account by ID
   */
  getAccountById(id: string): { id: string; code: string; name: string; type: string } {
    const cursor = this.sql.exec(`SELECT id, code, name, type FROM accounts WHERE id = ?`, id);
    const row = cursor.next();
    if (row.done || !row.value) {
      throw new Error(`Account ID '${id}' not found in Chart of Accounts`);
    }
    return {
      id: String(row.value.id),
      code: String(row.value.code),
      name: String(row.value.name),
      type: String(row.value.type),
    };
  }

  /**
   * Core posting executor. Enforces strict double-entry invariant: Sum(Debits) === Sum(Credits).
   * Throws error and aborts if Debits !== Credits.
   */
  createJournalEntry(params: {
    entryNo: string;
    date: string;
    docType: string;
    docId: string;
    narration: string;
    branchId: string;
    lines: JournalLineDraft[];
  }): { entryId: string; totalDebitPaise: number; totalCreditPaise: number } {
    const totalDebits = params.lines.reduce((sum, l) => sum + (l.debitPaise || 0), 0);
    const totalCredits = params.lines.reduce((sum, l) => sum + (l.creditPaise || 0), 0);

    // INVARIANT CHECK
    if (totalDebits !== totalCredits) {
      throw new Error(
        `Double-entry invariant violated for ${params.entryNo}: Total Debits (₹${(
          totalDebits / 100
        ).toFixed(2)}) !== Total Credits (₹${(totalCredits / 100).toFixed(2)})`,
      );
    }

    if (totalDebits === 0) {
      throw new Error(`Cannot post zero-amount journal entry for ${params.entryNo}`);
    }

    const entryId = newId();
    const now = new Date().toISOString();

    // 1. Insert Journal Entry Header
    this.sql.exec(
      `INSERT INTO journal_entries (id, entry_no, date, doc_type, doc_id, narration, branch_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      entryId,
      params.entryNo,
      params.date,
      params.docType,
      params.docId,
      params.narration,
      params.branchId,
      now,
    );

    // 2. Insert Journal Lines & Update Account Balances
    for (const line of params.lines) {
      if (line.debitPaise === 0 && line.creditPaise === 0) continue;
      const lineId = newId();

      this.sql.exec(
        `INSERT INTO journal_lines (id, entry_id, account_id, party_id, branch_id, debit_paise, credit_paise, narration)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        lineId,
        entryId,
        line.accountId,
        line.partyId || null,
        params.branchId,
        line.debitPaise,
        line.creditPaise,
        line.narration || null,
      );

      // Update account cached balance:
      // For ASSET and EXPENSE: Balance = Debit - Credit
      // For LIABILITY, EQUITY, INCOME: Balance = Credit - Debit
      const acc = this.getAccountById(line.accountId);
      const isDebitNormal = acc.type === 'ASSET' || acc.type === 'EXPENSE';
      const netDelta = isDebitNormal
        ? line.debitPaise - line.creditPaise
        : line.creditPaise - line.debitPaise;

      this.sql.exec(
        `UPDATE accounts SET balance_paise = balance_paise + ?, updated_at = ? WHERE id = ?`,
        netDelta,
        now,
        line.accountId,
      );
    }

    return {
      entryId,
      totalDebitPaise: totalDebits,
      totalCreditPaise: totalCredits,
    };
  }

  /**
   * Reverse an existing document's journal entries (used when editing or cancelling)
   */
  reverseDocument(docType: string, docId: string, narrationPrefix = 'Reversal of'): boolean {
    const cursor = this.sql.exec(
      `SELECT * FROM journal_entries WHERE doc_type = ? AND doc_id = ?`,
      docType,
      docId,
    );

    const entries: any[] = [];
    let row = cursor.next();
    while (!row.done && row.value) {
      entries.push(row.value);
      row = cursor.next();
    }

    if (entries.length === 0) return false;

    for (const ent of entries) {
      // Find lines
      const lineCursor = this.sql.exec(
        `SELECT * FROM journal_lines WHERE entry_id = ?`,
        ent.id,
      );
      const reverseLines: JournalLineDraft[] = [];
      let lRow = lineCursor.next();
      while (!lRow.done && lRow.value) {
        // Swap debits and credits
        reverseLines.push({
          accountId: String(lRow.value.account_id),
          partyId: lRow.value.party_id ? String(lRow.value.party_id) : undefined,
          debitPaise: Number(lRow.value.credit_paise || 0),
          creditPaise: Number(lRow.value.debit_paise || 0),
          narration: `Reversal of line in ${ent.entry_no}`,
        });
        lRow = lineCursor.next();
      }

      const reversalNo = `REV-${ent.entry_no}-${Date.now().toString().slice(-4)}`;
      this.createJournalEntry({
        entryNo: reversalNo,
        date: new Date().toISOString().split('T')[0]!,
        docType: `REV_${docType}`,
        docId: String(ent.doc_id),
        narration: `${narrationPrefix} ${ent.entry_no}: ${ent.narration}`,
        branchId: String(ent.branch_id),
        lines: reverseLines,
      });
    }

    return true;
  }

  /**
   * Post Sales Invoice
   */
  postInvoice(params: PostInvoiceParams): { entryId: string; totalDebitPaise: number } {
    const lines: JournalLineDraft[] = [];

    // Account lookups
    const accDebtors = this.getAccountByCode('1100'); // Sundry Debtors
    const accCash = this.getAccountByCode('1001'); // Cash in Hand
    const accBank = this.getAccountByCode('1010'); // Bank Accounts
    const accSales = this.getAccountByCode('4001'); // Sales Revenue
    const accOutCgst = this.getAccountByCode('2110'); // Output CGST
    const accOutSgst = this.getAccountByCode('2120'); // Output SGST
    const accOutIgst = this.getAccountByCode('2130'); // Output IGST
    const accOutCess = this.getAccountByCode('2140'); // Output Cess
    const accDiscount = this.getAccountByCode('5020'); // Discount Allowed
    const accRoundOff = this.getAccountByCode('5030'); // Round Off

    const paidPaise = params.paidAmountPaise || 0;
    const creditDuePaise = params.totalAmountPaise - paidPaise;

    // 1. DEBITS (Customer Receivable or Cash/Bank received)
    if (creditDuePaise > 0) {
      lines.push({
        accountId: accDebtors.id,
        partyId: params.partyId,
        debitPaise: creditDuePaise,
        creditPaise: 0,
        narration: `Receivable from customer for ${params.invoiceNo}`,
      });
    }

    if (paidPaise > 0) {
      let debitAccId = accCash.id;
      if (params.paymentAccountId) {
        debitAccId = params.paymentAccountId;
      } else if (params.paymentMode === 'BANK' || params.paymentMode === 'UPI') {
        debitAccId = accBank.id;
      }
      lines.push({
        accountId: debitAccId,
        partyId: params.partyId,
        debitPaise: paidPaise,
        creditPaise: 0,
        narration: `Payment received for ${params.invoiceNo} via ${params.paymentMode || 'CASH'}`,
      });
    }

    // 2. DISCOUNT ALLOWED (Debit Expense)
    if (params.discountPaise && params.discountPaise > 0) {
      lines.push({
        accountId: accDiscount.id,
        debitPaise: params.discountPaise,
        creditPaise: 0,
        narration: `Discount allowed on ${params.invoiceNo}`,
      });
    }

    // 3. ROUND OFF
    if (params.roundOffPaise) {
      if (params.roundOffPaise < 0) {
        // Bill rounded down: Expense (Debit)
        lines.push({
          accountId: accRoundOff.id,
          debitPaise: Math.abs(params.roundOffPaise),
          creditPaise: 0,
          narration: `Round-off discount on ${params.invoiceNo}`,
        });
      } else if (params.roundOffPaise > 0) {
        // Bill rounded up: Income/Credit
        lines.push({
          accountId: accRoundOff.id,
          debitPaise: 0,
          creditPaise: params.roundOffPaise,
          narration: `Round-off adjustment on ${params.invoiceNo}`,
        });
      }
    }

    // 4. CREDITS: Sales Revenue
    lines.push({
      accountId: accSales.id,
      partyId: params.partyId,
      debitPaise: 0,
      creditPaise: params.taxableAmountPaise,
      narration: `Sales revenue for ${params.invoiceNo}`,
    });

    // 5. CREDITS: GST Output Liabilities
    if (params.isInterState) {
      if (params.igstPaise && params.igstPaise > 0) {
        lines.push({
          accountId: accOutIgst.id,
          debitPaise: 0,
          creditPaise: params.igstPaise,
          narration: `IGST output for ${params.invoiceNo}`,
        });
      }
    } else {
      if (params.cgstPaise && params.cgstPaise > 0) {
        lines.push({
          accountId: accOutCgst.id,
          debitPaise: 0,
          creditPaise: params.cgstPaise,
          narration: `CGST output for ${params.invoiceNo}`,
        });
      }
      if (params.sgstPaise && params.sgstPaise > 0) {
        lines.push({
          accountId: accOutSgst.id,
          debitPaise: 0,
          creditPaise: params.sgstPaise,
          narration: `SGST output for ${params.invoiceNo}`,
        });
      }
    }

    if (params.cessPaise && params.cessPaise > 0) {
      lines.push({
        accountId: accOutCess.id,
        debitPaise: 0,
        creditPaise: params.cessPaise,
        narration: `Cess output for ${params.invoiceNo}`,
      });
    }

    const res = this.createJournalEntry({
      entryNo: `JV-INV-${params.invoiceNo.replace(/[^A-Za-z0-9_-]/g, '_')}`,
      date: params.date,
      docType: 'INVOICE',
      docId: params.invoiceId,
      narration: params.narration || `Sales Invoice ${params.invoiceNo}`,
      branchId: params.branchId,
      lines,
    });

    return {
      entryId: res.entryId,
      totalDebitPaise: res.totalDebitPaise,
    };
  }

  /**
   * Post Sales Credit Note
   */
  postCreditNote(params: PostCreditNoteParams): { entryId: string; totalDebitPaise: number } {
    const lines: JournalLineDraft[] = [];

    const accDebtors = this.getAccountByCode('1100');
    const accSalesReturn = this.getAccountByCode('4010');
    const accOutCgst = this.getAccountByCode('2110');
    const accOutSgst = this.getAccountByCode('2120');
    const accOutIgst = this.getAccountByCode('2130');
    const accOutCess = this.getAccountByCode('2140');
    const accRoundOff = this.getAccountByCode('5030');

    // DEBITS: Sales Returns
    lines.push({
      accountId: accSalesReturn.id,
      partyId: params.partyId,
      debitPaise: params.taxableAmountPaise,
      creditPaise: 0,
      narration: `Sales Return on Credit Note ${params.creditNoteNo}`,
    });

    // DEBITS: Reverse GST Output
    if (params.isInterState) {
      if (params.igstPaise && params.igstPaise > 0) {
        lines.push({
          accountId: accOutIgst.id,
          debitPaise: params.igstPaise,
          creditPaise: 0,
          narration: `IGST reversal on Credit Note ${params.creditNoteNo}`,
        });
      }
    } else {
      if (params.cgstPaise && params.cgstPaise > 0) {
        lines.push({
          accountId: accOutCgst.id,
          debitPaise: params.cgstPaise,
          creditPaise: 0,
          narration: `CGST reversal on Credit Note ${params.creditNoteNo}`,
        });
      }
      if (params.sgstPaise && params.sgstPaise > 0) {
        lines.push({
          accountId: accOutSgst.id,
          debitPaise: params.sgstPaise,
          creditPaise: 0,
          narration: `SGST reversal on Credit Note ${params.creditNoteNo}`,
        });
      }
    }

    if (params.cessPaise && params.cessPaise > 0) {
      lines.push({
        accountId: accOutCess.id,
        debitPaise: params.cessPaise,
        creditPaise: 0,
        narration: `Cess reversal on Credit Note ${params.creditNoteNo}`,
      });
    }

    if (params.roundOffPaise) {
      if (params.roundOffPaise < 0) {
        lines.push({
          accountId: accRoundOff.id,
          debitPaise: Math.abs(params.roundOffPaise),
          creditPaise: 0,
        });
      } else {
        lines.push({
          accountId: accRoundOff.id,
          debitPaise: 0,
          creditPaise: params.roundOffPaise,
        });
      }
    }

    // CREDIT: Reduce Sundry Debtors
    lines.push({
      accountId: accDebtors.id,
      partyId: params.partyId,
      debitPaise: 0,
      creditPaise: params.totalAmountPaise,
      narration: `Credit issued to customer on ${params.creditNoteNo}`,
    });

    const res = this.createJournalEntry({
      entryNo: `JV-CN-${params.creditNoteNo.replace(/[^A-Za-z0-9_-]/g, '_')}`,
      date: params.date,
      docType: 'CREDIT_NOTE',
      docId: params.creditNoteId,
      narration: params.narration || `Credit Note ${params.creditNoteNo}`,
      branchId: params.branchId,
      lines,
    });

    return {
      entryId: res.entryId,
      totalDebitPaise: res.totalDebitPaise,
    };
  }

  /**
   * Post Purchase Bill
   */
  postPurchaseBill(params: PostPurchaseBillParams): { entryId: string; totalDebitPaise: number } {
    const lines: JournalLineDraft[] = [];

    const accPurchases = this.getAccountByCode('5001'); // Cost of Goods
    const accCreditors = this.getAccountByCode('2001'); // Sundry Creditors
    const accCash = this.getAccountByCode('1001');
    const accBank = this.getAccountByCode('1010');
    const accInpCgst = this.getAccountByCode('1310'); // Input CGST
    const accInpSgst = this.getAccountByCode('1320'); // Input SGST
    const accInpIgst = this.getAccountByCode('1330'); // Input IGST
    const accInpCess = this.getAccountByCode('1340'); // Input Cess
    const accDiscRecv = this.getAccountByCode('4030'); // Discount Received
    const accRoundOff = this.getAccountByCode('5030');

    // 1. DEBITS: Purchases
    lines.push({
      accountId: accPurchases.id,
      partyId: params.partyId,
      debitPaise: params.taxableAmountPaise + (params.discountReceivedPaise || 0),
      creditPaise: 0,
      narration: `Purchases on Bill ${params.billNo}`,
    });

    // 2. DEBITS: Input GST
    if (params.isInterState) {
      if (params.igstPaise && params.igstPaise > 0) {
        lines.push({
          accountId: accInpIgst.id,
          debitPaise: params.igstPaise,
          creditPaise: 0,
          narration: `Input IGST on ${params.billNo}`,
        });
      }
    } else {
      if (params.cgstPaise && params.cgstPaise > 0) {
        lines.push({
          accountId: accInpCgst.id,
          debitPaise: params.cgstPaise,
          creditPaise: 0,
          narration: `Input CGST on ${params.billNo}`,
        });
      }
      if (params.sgstPaise && params.sgstPaise > 0) {
        lines.push({
          accountId: accInpSgst.id,
          debitPaise: params.sgstPaise,
          creditPaise: 0,
          narration: `Input SGST on ${params.billNo}`,
        });
      }
    }

    if (params.cessPaise && params.cessPaise > 0) {
      lines.push({
        accountId: accInpCess.id,
        debitPaise: params.cessPaise,
        creditPaise: 0,
        narration: `Input Cess on ${params.billNo}`,
      });
    }

    // 3. CREDITS: Discount Received
    if (params.discountReceivedPaise && params.discountReceivedPaise > 0) {
      lines.push({
        accountId: accDiscRecv.id,
        debitPaise: 0,
        creditPaise: params.discountReceivedPaise,
        narration: `Discount received on ${params.billNo}`,
      });
    }

    // Round Off
    if (params.roundOffPaise) {
      if (params.roundOffPaise < 0) {
        // Reduced payable: Credit roundoff
        lines.push({
          accountId: accRoundOff.id,
          debitPaise: 0,
          creditPaise: Math.abs(params.roundOffPaise),
        });
      } else if (params.roundOffPaise > 0) {
        lines.push({
          accountId: accRoundOff.id,
          debitPaise: params.roundOffPaise,
          creditPaise: 0,
        });
      }
    }

    // 4. CREDITS: Payable to Vendor or Paid via Cash/Bank
    const paidPaise = params.paidAmountPaise || 0;
    const creditDuePaise = params.totalAmountPaise - paidPaise;

    if (creditDuePaise > 0) {
      lines.push({
        accountId: accCreditors.id,
        partyId: params.partyId,
        debitPaise: 0,
        creditPaise: creditDuePaise,
        narration: `Payable to vendor for ${params.billNo}`,
      });
    }

    if (paidPaise > 0) {
      let creditAccId = accCash.id;
      if (params.paymentAccountId) {
        creditAccId = params.paymentAccountId;
      } else if (params.paymentMode === 'BANK' || params.paymentMode === 'UPI') {
        creditAccId = accBank.id;
      }
      lines.push({
        accountId: creditAccId,
        partyId: params.partyId,
        debitPaise: 0,
        creditPaise: paidPaise,
        narration: `Payment made for ${params.billNo} via ${params.paymentMode || 'CASH'}`,
      });
    }

    const res = this.createJournalEntry({
      entryNo: `JV-BILL-${params.billNo.replace(/[^A-Za-z0-9_-]/g, '_')}`,
      date: params.date,
      docType: 'BILL',
      docId: params.billId,
      narration: params.narration || `Purchase Bill ${params.billNo}`,
      branchId: params.branchId,
      lines,
    });

    return {
      entryId: res.entryId,
      totalDebitPaise: res.totalDebitPaise,
    };
  }

  /**
   * Post Debit Note (Purchase Return)
   */
  postDebitNote(params: PostDebitNoteParams): { entryId: string; totalDebitPaise: number } {
    const lines: JournalLineDraft[] = [];

    const accCreditors = this.getAccountByCode('2001'); // Sundry Creditors
    const accPurchReturn = this.getAccountByCode('5010'); // Purchase Returns
    const accInpCgst = this.getAccountByCode('1310');
    const accInpSgst = this.getAccountByCode('1320');
    const accInpIgst = this.getAccountByCode('1330');
    const accInpCess = this.getAccountByCode('1340');
    const accRoundOff = this.getAccountByCode('5030');

    // DEBIT: Reduce Sundry Creditors
    lines.push({
      accountId: accCreditors.id,
      partyId: params.partyId,
      debitPaise: params.totalAmountPaise,
      creditPaise: 0,
      narration: `Debit Note issued to vendor on ${params.debitNoteNo}`,
    });

    // CREDIT: Purchase Returns
    lines.push({
      accountId: accPurchReturn.id,
      partyId: params.partyId,
      debitPaise: 0,
      creditPaise: params.taxableAmountPaise,
      narration: `Purchase return on ${params.debitNoteNo}`,
    });

    // CREDIT: Reverse Input GST
    if (params.isInterState) {
      if (params.igstPaise && params.igstPaise > 0) {
        lines.push({
          accountId: accInpIgst.id,
          debitPaise: 0,
          creditPaise: params.igstPaise,
          narration: `Input IGST reversal on ${params.debitNoteNo}`,
        });
      }
    } else {
      if (params.cgstPaise && params.cgstPaise > 0) {
        lines.push({
          accountId: accInpCgst.id,
          debitPaise: 0,
          creditPaise: params.cgstPaise,
          narration: `Input CGST reversal on ${params.debitNoteNo}`,
        });
      }
      if (params.sgstPaise && params.sgstPaise > 0) {
        lines.push({
          accountId: accInpSgst.id,
          debitPaise: 0,
          creditPaise: params.sgstPaise,
          narration: `Input SGST reversal on ${params.debitNoteNo}`,
        });
      }
    }

    if (params.cessPaise && params.cessPaise > 0) {
      lines.push({
        accountId: accInpCess.id,
        debitPaise: 0,
        creditPaise: params.cessPaise,
        narration: `Input Cess reversal on ${params.debitNoteNo}`,
      });
    }

    if (params.roundOffPaise) {
      if (params.roundOffPaise < 0) {
        lines.push({
          accountId: accRoundOff.id,
          debitPaise: 0,
          creditPaise: Math.abs(params.roundOffPaise),
        });
      } else {
        lines.push({
          accountId: accRoundOff.id,
          debitPaise: params.roundOffPaise,
          creditPaise: 0,
        });
      }
    }

    const res = this.createJournalEntry({
      entryNo: `JV-DN-${params.debitNoteNo.replace(/[^A-Za-z0-9_-]/g, '_')}`,
      date: params.date,
      docType: 'DEBIT_NOTE',
      docId: params.debitNoteId,
      narration: params.narration || `Debit Note ${params.debitNoteNo}`,
      branchId: params.branchId,
      lines,
    });

    return {
      entryId: res.entryId,
      totalDebitPaise: res.totalDebitPaise,
    };
  }

  /**
   * Post Payment In (Customer Payment Received)
   */
  postPaymentIn(params: PostPaymentInParams): { entryId: string; totalDebitPaise: number } {
    const lines: JournalLineDraft[] = [];

    const accDebtors = this.getAccountByCode('1100'); // Sundry Debtors
    const totalReceivedPaise = params.amountPaise + (params.tdsPaise || 0);

    // DEBIT: Bank or Cash Account
    lines.push({
      accountId: params.paymentAccountId,
      partyId: params.partyId,
      debitPaise: params.amountPaise,
      creditPaise: 0,
      narration: `Payment received ${params.paymentNo}`,
    });

    // CREDIT: Reduce Sundry Debtors
    lines.push({
      accountId: accDebtors.id,
      partyId: params.partyId,
      debitPaise: 0,
      creditPaise: totalReceivedPaise,
      narration: `Customer balance cleared by ${params.paymentNo}`,
    });

    const res = this.createJournalEntry({
      entryNo: `JV-PAYIN-${params.paymentNo.replace(/[^A-Za-z0-9_-]/g, '_')}`,
      date: params.date,
      docType: 'PAYMENT_IN',
      docId: params.paymentId,
      narration: params.narration || `Payment In ${params.paymentNo}`,
      branchId: params.branchId,
      lines,
    });

    return {
      entryId: res.entryId,
      totalDebitPaise: res.totalDebitPaise,
    };
  }

  /**
   * Post Payment Out (Vendor Payment Made)
   */
  postPaymentOut(params: PostPaymentOutParams): { entryId: string; totalDebitPaise: number } {
    const lines: JournalLineDraft[] = [];

    const accCreditors = this.getAccountByCode('2001'); // Sundry Creditors

    // DEBIT: Reduce Sundry Creditors
    lines.push({
      accountId: accCreditors.id,
      partyId: params.partyId,
      debitPaise: params.amountPaise,
      creditPaise: 0,
      narration: `Vendor balance cleared by ${params.paymentNo}`,
    });

    // CREDIT: Bank or Cash Account
    lines.push({
      accountId: params.paymentAccountId,
      partyId: params.partyId,
      debitPaise: 0,
      creditPaise: params.amountPaise,
      narration: `Payment made ${params.paymentNo}`,
    });

    const res = this.createJournalEntry({
      entryNo: `JV-PAYOUT-${params.paymentNo.replace(/[^A-Za-z0-9_-]/g, '_')}`,
      date: params.date,
      docType: 'PAYMENT_OUT',
      docId: params.paymentId,
      narration: params.narration || `Payment Out ${params.paymentNo}`,
      branchId: params.branchId,
      lines,
    });

    return {
      entryId: res.entryId,
      totalDebitPaise: res.totalDebitPaise,
    };
  }

  /**
   * Post Expense (Rent, Salary, Utilities, etc.)
   */
  postExpense(params: PostExpenseParams): { entryId: string; totalDebitPaise: number } {
    const lines: JournalLineDraft[] = [];

    const accInpCgst = this.getAccountByCode('1310');
    const accInpSgst = this.getAccountByCode('1320');
    const accInpIgst = this.getAccountByCode('1330');

    // 1. DEBIT: Category Expense Account
    lines.push({
      accountId: params.categoryAccountId,
      debitPaise: params.taxableAmountPaise,
      creditPaise: 0,
      narration: `Expense ${params.expenseNo}: ${params.payee || ''}`,
    });

    // 2. DEBIT: Input GST (if tax applied on expense)
    if (params.isInterState) {
      if (params.inputIgstPaise && params.inputIgstPaise > 0) {
        lines.push({
          accountId: accInpIgst.id,
          debitPaise: params.inputIgstPaise,
          creditPaise: 0,
          narration: `Input IGST on expense ${params.expenseNo}`,
        });
      }
    } else {
      if (params.inputCgstPaise && params.inputCgstPaise > 0) {
        lines.push({
          accountId: accInpCgst.id,
          debitPaise: params.inputCgstPaise,
          creditPaise: 0,
          narration: `Input CGST on expense ${params.expenseNo}`,
        });
      }
      if (params.inputSgstPaise && params.inputSgstPaise > 0) {
        lines.push({
          accountId: accInpSgst.id,
          debitPaise: params.inputSgstPaise,
          creditPaise: 0,
          narration: `Input SGST on expense ${params.expenseNo}`,
        });
      }
    }

    // 3. CREDIT: Cash or Bank account
    lines.push({
      accountId: params.paymentAccountId,
      debitPaise: 0,
      creditPaise: params.totalAmountPaise,
      narration: `Payment for expense ${params.expenseNo}`,
    });

    const res = this.createJournalEntry({
      entryNo: `JV-EXP-${params.expenseNo.replace(/[^A-Za-z0-9_-]/g, '_')}`,
      date: params.date,
      docType: 'EXPENSE',
      docId: params.expenseId,
      narration: params.narration || `Expense ${params.expenseNo}`,
      branchId: params.branchId,
      lines,
    });

    return {
      entryId: res.entryId,
      totalDebitPaise: res.totalDebitPaise,
    };
  }

  /**
   * Post Stock Adjustment (Physical audit increase or decrease)
   */
  postStockAdjustment(params: PostStockAdjustmentParams): {
    entryId: string;
    totalDebitPaise: number;
  } {
    const lines: JournalLineDraft[] = [];

    const accStock = this.getAccountByCode('1200'); // Stock in Hand
    const accCogs = this.getAccountByCode('5001'); // Purchases / COGS
    const accEquity = this.getAccountByCode('3999'); // Opening Balance Equity / Adjustment

    if (params.type === 'INCREASE') {
      // Stock Increase: Found stock
      // DEBIT Stock in Hand, CREDIT Opening Balance Equity / Inventory Adjustment
      lines.push({
        accountId: accStock.id,
        debitPaise: params.valuePaise,
        creditPaise: 0,
        narration: `Inventory increase: ${params.reason || params.adjustmentNo}`,
      });
      lines.push({
        accountId: accEquity.id,
        debitPaise: 0,
        creditPaise: params.valuePaise,
        narration: `Inventory adjustment credit`,
      });
    } else {
      // Stock Decrease: Damaged / expired / shrinkage
      // DEBIT COGS / Shrinkage, CREDIT Stock in Hand
      lines.push({
        accountId: accCogs.id,
        debitPaise: params.valuePaise,
        creditPaise: 0,
        narration: `Inventory shrinkage / damage: ${params.reason || params.adjustmentNo}`,
      });
      lines.push({
        accountId: accStock.id,
        debitPaise: 0,
        creditPaise: params.valuePaise,
        narration: `Stock written off`,
      });
    }

    const res = this.createJournalEntry({
      entryNo: `JV-STK-${params.adjustmentNo.replace(/[^A-Za-z0-9_-]/g, '_')}`,
      date: params.date,
      docType: 'STOCK_ADJUSTMENT',
      docId: params.adjustmentId,
      narration: `Stock Adjustment ${params.adjustmentNo}`,
      branchId: params.branchId,
      lines,
    });

    return {
      entryId: res.entryId,
      totalDebitPaise: res.totalDebitPaise,
    };
  }

  /**
   * Calculate Trial Balance across all accounts
   * Computes Debit totals and Credit totals. Difference MUST be 0.
   */
  getTrialBalance(asOfDate?: string): {
    accounts: TrialBalanceRow[];
    totalDebitPaise: number;
    totalCreditPaise: number;
    differencePaise: number;
  } {
    const query = `
      SELECT 
        a.id,
        a.code,
        a.name,
        a.type,
        a.subtype,
        COALESCE(SUM(jl.debit_paise), 0) as total_debit,
        COALESCE(SUM(jl.credit_paise), 0) as total_credit
      FROM accounts a
      LEFT JOIN journal_lines jl ON jl.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jl.entry_id ${asOfDate ? 'AND je.date <= ?' : ''}
      GROUP BY a.id, a.code, a.name, a.type, a.subtype
      ORDER BY a.code ASC
    `;

    const cursor = asOfDate ? this.sql.exec(query, asOfDate) : this.sql.exec(query);
    const rows: TrialBalanceRow[] = [];
    let grandTotalDebit = 0;
    let grandTotalCredit = 0;

    let r = cursor.next();
    while (!r.done && r.value) {
      const d = Number(r.value.total_debit || 0);
      const c = Number(r.value.total_credit || 0);

      if (d > 0 || c > 0) {
        let netDebit = 0;
        let netCredit = 0;

        if (d >= c) {
          netDebit = d - c;
        } else {
          netCredit = c - d;
        }

        grandTotalDebit += netDebit;
        grandTotalCredit += netCredit;

        rows.push({
          code: String(r.value.code),
          name: String(r.value.name),
          type: String(r.value.type),
          subtype: String(r.value.subtype),
          debitPaise: d,
          creditPaise: c,
          netDebitPaise: netDebit,
          netCreditPaise: netCredit,
        });
      }
      r = cursor.next();
    }

    return {
      accounts: rows,
      totalDebitPaise: grandTotalDebit,
      totalCreditPaise: grandTotalCredit,
      differencePaise: grandTotalDebit - grandTotalCredit,
    };
  }
}
