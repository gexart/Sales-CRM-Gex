import { newId, paiseToRupees } from '@billing/shared';
import type {
  Gstr1JsonPayload,
  Gstr1B2bRecipient,
  Gstr1B2csSummary,
  Gstr1HsnItem,
  Gstr3bSummary,
  Gstr2bRecord,
  Gstr2bReconciliationMatch,
  TallyLedgerMaster,
  TallyVoucher,
} from '@billing/shared';
import { generateTallyXml } from '@billing/shared';
import { PostingService, JournalLineDraft } from './posting';

export interface ManualVoucherInput {
  voucherType: 'JOURNAL' | 'CONTRA' | 'RECEIPT' | 'PAYMENT';
  date: string; // YYYY-MM-DD
  branchId: string;
  narration: string;
  lines: JournalLineDraft[];
}

export interface BankStatementLineInput {
  date: string;
  description: string;
  referenceNo?: string;
  amountPaise: number;
  type: 'CREDIT' | 'DEBIT';
  balancePaise?: number;
}

export interface ImportBankStatementInput {
  bankAccountId: string;
  statementDate: string;
  filename: string;
  lines: BankStatementLineInput[];
}

export interface ChequeInput {
  bankAccountId: string;
  partyId?: string;
  type: 'RECEIVED' | 'ISSUED';
  chequeNo: string;
  chequeDate: string;
  amountPaise: number;
  payeePayerName: string;
  notes?: string;
}

export interface CostCentreInput {
  name: string;
  code: string;
  category?: 'BRANCH' | 'DEPARTMENT' | 'PROJECT';
  branchId?: string;
}

export interface FixedAssetInput {
  assetName: string;
  assetCode: string;
  costCentreId?: string;
  purchaseDate: string;
  purchaseCostPaise: number;
  depreciationMethod: 'WDV' | 'SLM';
  depreciationRateBasisPoints: number; // e.g. 1500 = 15.00%
  salvageValuePaise?: number;
  assetAccountId: string;
  depreciationExpenseAccountId: string;
}

export class AccountingService {
  private postingService: PostingService;

  constructor(private sql: any) {
    this.postingService = new PostingService(sql);
  }

  // ==========================================
  // 1. PERIOD LOCK & GST LOCK (Step 1.4)
  // ==========================================

  getSettings(): {
    booksLockedUntil?: string;
    gstLockedMonths: string[];
    closedFinancialYears: string[];
    inventoryValuationMethod: 'WEIGHTED_AVERAGE' | 'FIFO';
  } {
    const cursor = this.sql.exec(
      "SELECT key, value_json FROM settings WHERE key IN ('books_locked_until', 'gst_locked_months', 'closed_financial_years', 'inventory_valuation_method')",
    );
    const settingsMap: Record<string, any> = {};
    let item = cursor.next();
    while (!item.done && item.value) {
      try {
        settingsMap[item.value.key] = JSON.parse(item.value.value_json);
      } catch {
        settingsMap[item.value.key] = item.value.value_json;
      }
      item = cursor.next();
    }

    return {
      booksLockedUntil: settingsMap['books_locked_until'],
      gstLockedMonths: Array.isArray(settingsMap['gst_locked_months'])
        ? settingsMap['gst_locked_months']
        : [],
      closedFinancialYears: Array.isArray(settingsMap['closed_financial_years'])
        ? settingsMap['closed_financial_years']
        : [],
      inventoryValuationMethod:
        settingsMap['inventory_valuation_method'] === 'FIFO' ? 'FIFO' : 'WEIGHTED_AVERAGE',
    };
  }

  setPeriodLock(lockedUntilDate: string): void {
    const now = new Date().toISOString();
    const id = newId();
    const val = JSON.stringify(lockedUntilDate);
    this.sql.exec(
      `INSERT INTO settings (id, key, value_json, updated_at)
       VALUES (?, 'books_locked_until', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = ?, updated_at = ?`,
      id,
      val,
      now,
      val,
      now,
    );
  }

  lockGstMonth(month: string): void {
    const current = this.getSettings().gstLockedMonths;
    if (!current.includes(month)) {
      current.push(month);
      const now = new Date().toISOString();
      const id = newId();
      const val = JSON.stringify(current);
      this.sql.exec(
        `INSERT INTO settings (id, key, value_json, updated_at)
         VALUES (?, 'gst_locked_months', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = ?, updated_at = ?`,
        id,
        val,
        now,
        val,
        now,
      );
    }
  }

  checkPeriodLock(docDate: string): void {
    const { booksLockedUntil, gstLockedMonths, closedFinancialYears } = this.getSettings();

    if (booksLockedUntil && docDate <= booksLockedUntil) {
      throw new Error(
        `BOOKS_LOCKED_FOR_PERIOD: Financial books are locked up to ${booksLockedUntil}. Modifications or new vouchers on or prior to this date are strictly prohibited.`,
      );
    }

    const docMonth = docDate.substring(0, 7); // YYYY-MM
    if (gstLockedMonths.includes(docMonth)) {
      throw new Error(
        `GST_MONTH_LOCKED: GST return for period ${docMonth} has been filed and locked. Edit via Credit Notes or Debit Notes instead.`,
      );
    }

    // Check closed FYs
    const year = parseInt(docDate.substring(0, 4), 10);
    const month = parseInt(docDate.substring(5, 7), 10);
    const fyCode = month >= 4 ? `${year % 100}-${(year + 1) % 100}` : `${(year - 1) % 100}-${year % 100}`;
    if (closedFinancialYears.includes(fyCode)) {
      throw new Error(
        `FINANCIAL_YEAR_CLOSED: Financial Year ${fyCode} is formally closed and read-only. Owner OTP authorization is required to unlock.`,
      );
    }
  }

  // ==========================================
  // 2. VOUCHER ENGINE (Step 1.1)
  // ==========================================

  createVoucher(input: ManualVoucherInput): {
    voucherId: string;
    voucherNo: string;
    totalAmountPaise: number;
  } {
    this.checkPeriodLock(input.date);

    const totalDebits = input.lines.reduce((sum, l) => sum + (l.debitPaise || 0), 0);
    const totalCredits = input.lines.reduce((sum, l) => sum + (l.creditPaise || 0), 0);

    if (totalDebits !== totalCredits) {
      throw new Error(
        `Double-entry invariant violated for ${input.voucherType} voucher: Total Debits (₹${(
          totalDebits / 100
        ).toFixed(2)}) !== Total Credits (₹${(totalCredits / 100).toFixed(2)})`,
      );
    }

    if (totalDebits === 0) {
      throw new Error(`Cannot post zero-amount voucher`);
    }

    const prefixMap = {
      JOURNAL: 'JV',
      CONTRA: 'CV',
      RECEIPT: 'RV',
      PAYMENT: 'PV',
    };
    const voucherNo = `${prefixMap[input.voucherType] || 'VCH'}-${Date.now()}`;

    const res = this.postingService.createJournalEntry({
      entryNo: voucherNo,
      date: input.date,
      docType: input.voucherType,
      docId: `vch_${Date.now()}`,
      narration: input.narration,
      branchId: input.branchId,
      lines: input.lines,
    });

    return {
      voucherId: res.entryId,
      voucherNo,
      totalAmountPaise: res.totalDebitPaise,
    };
  }

  setOpeningBalances(
    branchId: string,
    balances: { accountId: string; debitPaise: number; creditPaise: number }[],
    openingDate = '2026-04-01',
  ): { balanced: boolean; netDifferencePaise: number } {
    this.checkPeriodLock(openingDate);

    let totDeb = 0;
    let totCred = 0;
    const lines: JournalLineDraft[] = [];

    for (const b of balances) {
      if (b.debitPaise > 0 || b.creditPaise > 0) {
        totDeb += b.debitPaise;
        totCred += b.creditPaise;
        lines.push({
          accountId: b.accountId,
          debitPaise: b.debitPaise,
          creditPaise: b.creditPaise,
          narration: 'Opening balance',
        });
      }
    }

    const diff = totDeb - totCred;
    if (diff !== 0) {
      // Balance against 3001 Owner's Capital / Opening Balance Equity
      const capAcc = this.postingService.getAccountByCode('3001');
      if (diff > 0) {
        // Credits needed
        lines.push({
          accountId: capAcc.id,
          debitPaise: 0,
          creditPaise: diff,
          narration: 'Balancing Opening Balance Equity',
        });
      } else {
        // Debits needed
        lines.push({
          accountId: capAcc.id,
          debitPaise: -diff,
          creditPaise: 0,
          narration: 'Balancing Opening Balance Equity',
        });
      }
    }

    if (lines.length > 0) {
      this.postingService.createJournalEntry({
        entryNo: `OP-BAL-${Date.now()}`,
        date: openingDate,
        docType: 'OPENING',
        docId: `op_${Date.now()}`,
        narration: 'Initial Opening Balances',
        branchId,
        lines,
      });
    }

    return {
      balanced: true,
      netDifferencePaise: 0,
    };
  }

  // ==========================================
  // 3. BANK RECONCILIATION ENGINE (Step 1.2)
  // ==========================================

  importBankStatement(input: ImportBankStatementInput): {
    statementId: string;
    linesImported: number;
    totalDepositsPaise: number;
    totalWithdrawalsPaise: number;
  } {
    const statementId = newId();
    const now = new Date().toISOString();

    let totDep = 0;
    let totWith = 0;

    for (const l of input.lines) {
      if (l.type === 'CREDIT') totDep += l.amountPaise;
      else totWith += l.amountPaise;
    }

    this.sql.exec(
      `INSERT INTO bank_statements (id, bank_account_id, statement_date, filename, opening_balance_paise, closing_balance_paise, total_deposits_paise, total_withdrawals_paise, created_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)`,
      statementId,
      input.bankAccountId,
      input.statementDate,
      input.filename,
      totDep,
      totWith,
      now,
    );

    for (const l of input.lines) {
      const lineId = newId();
      this.sql.exec(
        `INSERT INTO bank_statement_lines (id, statement_id, bank_account_id, date, description, reference_no, amount_paise, type, reconciliation_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UNRECONCILED')`,
        lineId,
        statementId,
        input.bankAccountId,
        l.date,
        l.description,
        l.referenceNo || null,
        l.amountPaise,
        l.type,
      );
    }

    return {
      statementId,
      linesImported: input.lines.length,
      totalDepositsPaise: totDep,
      totalWithdrawalsPaise: totWith,
    };
  }

  autoMatchBankStatement(bankAccountId: string): {
    matchedCount: number;
    remainingUnreconciledCount: number;
  } {
    // 1. Fetch unreconciled lines for this bank account
    const linesCursor = this.sql.exec(
      `SELECT id, date, amount_paise, type, reference_no FROM bank_statement_lines
       WHERE bank_account_id = ? AND reconciliation_status = 'UNRECONCILED'`,
      bankAccountId,
    );

    const unreconciled: any[] = [];
    let r = linesCursor.next();
    while (!r.done && r.value) {
      unreconciled.push(r.value);
      r = linesCursor.next();
    }

    // 2. Fetch all journal lines on the bank account that are not yet matched
    // Find bank account in Chart of Accounts
    const bankAcc = this.sql.exec(
      `SELECT COALESCE(b.chart_account_id, (SELECT id FROM accounts WHERE code = '1010' LIMIT 1)) AS account_id FROM bank_accounts b WHERE b.id = ?`,
      bankAccountId,
    ).next();
    const accountId = bankAcc.value?.account_id;

    if (!accountId) {
      return { matchedCount: 0, remainingUnreconciledCount: unreconciled.length };
    }

    const jLinesCursor = this.sql.exec(
      `SELECT jl.id, je.date, jl.debit_paise, jl.credit_paise, jl.narration
       FROM journal_lines jl
       JOIN journal_entries je ON jl.entry_id = je.id
       WHERE jl.account_id = ?
         AND jl.id NOT IN (SELECT matched_journal_line_id FROM bank_statement_lines WHERE matched_journal_line_id IS NOT NULL)`,
      accountId,
    );

    const candidateJournalLines: any[] = [];
    let jr = jLinesCursor.next();
    while (!jr.done && jr.value) {
      candidateJournalLines.push(jr.value);
      jr = jLinesCursor.next();
    }

    let matchedCount = 0;
    const now = new Date().toISOString();

    for (const sLine of unreconciled) {
      // For CREDIT in statement (deposit), look for DEBIT in books
      // For DEBIT in statement (withdrawal), look for CREDIT in books
      const targetDebit = sLine.type === 'CREDIT' ? sLine.amount_paise : 0;
      const targetCredit = sLine.type === 'DEBIT' ? sLine.amount_paise : 0;

      // Find candidate by amount + (reference or date range within 3 days)
      const sDate = new Date(sLine.date).getTime();
      const matchIndex = candidateJournalLines.findIndex((j) => {
        const matchesAmount =
          (targetDebit > 0 && j.debit_paise === targetDebit) ||
          (targetCredit > 0 && j.credit_paise === targetCredit);
        if (!matchesAmount) return false;

        // Check reference or date proximity (±3 days)
        if (sLine.referenceNo && j.narration && j.narration.includes(sLine.referenceNo)) {
          return true;
        }

        const jDate = new Date(j.date).getTime();
        const diffDays = Math.abs(sDate - jDate) / (1000 * 60 * 60 * 24);
        return diffDays <= 3;
      });

      if (matchIndex !== -1) {
        const matchedJLine = candidateJournalLines[matchIndex]!;
        this.sql.exec(
          `UPDATE bank_statement_lines
           SET reconciliation_status = 'MATCHED', matched_journal_line_id = ?, matched_at = ?
           WHERE id = ?`,
          matchedJLine.id,
          now,
          sLine.id,
        );
        candidateJournalLines.splice(matchIndex, 1);
        matchedCount++;
      }
    }

    return {
      matchedCount,
      remainingUnreconciledCount: unreconciled.length - matchedCount,
    };
  }

  manualMatchStatementLine(statementLineId: string, journalLineId: string): void {
    const now = new Date().toISOString();
    this.sql.exec(
      `UPDATE bank_statement_lines
       SET reconciliation_status = 'MANUAL', matched_journal_line_id = ?, matched_at = ?
       WHERE id = ?`,
      journalLineId,
      now,
      statementLineId,
    );
  }

  createEntryFromUnmatchedLine(
    statementLineId: string,
    categoryAccountId: string,
    branchId: string,
  ): { entryId: string } {
    const lineRes = this.sql.exec(
      `SELECT * FROM bank_statement_lines WHERE id = ?`,
      statementLineId,
    ).next();
    if (!lineRes.value) {
      throw new Error(`Statement line ${statementLineId} not found`);
    }

    const sLine = lineRes.value;
    const bankAcc = this.sql.exec(
      `SELECT COALESCE(b.chart_account_id, (SELECT id FROM accounts WHERE code = '1010' LIMIT 1)) AS account_id FROM bank_accounts b WHERE b.id = ?`,
      sLine.bank_account_id,
    ).next();
    const bankChartAccountId = bankAcc.value?.account_id;

    if (!bankChartAccountId) {
      throw new Error(`Bank account not linked to Chart of Accounts`);
    }

    const lines: JournalLineDraft[] = [];
    if (sLine.type === 'DEBIT') {
      // Withdrawal / Expense (e.g. Bank charges)
      // Debit Category, Credit Bank
      lines.push({
        accountId: categoryAccountId,
        debitPaise: sLine.amount_paise,
        creditPaise: 0,
        narration: sLine.description,
      });
      lines.push({
        accountId: bankChartAccountId,
        debitPaise: 0,
        creditPaise: sLine.amount_paise,
        narration: sLine.description,
      });
    } else {
      // Deposit / Income (e.g. Interest)
      // Debit Bank, Credit Income Category
      lines.push({
        accountId: bankChartAccountId,
        debitPaise: sLine.amount_paise,
        creditPaise: 0,
        narration: sLine.description,
      });
      lines.push({
        accountId: categoryAccountId,
        debitPaise: 0,
        creditPaise: sLine.amount_paise,
        narration: sLine.description,
      });
    }

    const res = this.postingService.createJournalEntry({
      entryNo: `BANK-AUTO-${Date.now()}`,
      date: sLine.date,
      docType: 'BANK_ADJUSTMENT',
      docId: sLine.id,
      narration: `Bank Recon Adjustment: ${sLine.description}`,
      branchId,
      lines,
    });

    const now = new Date().toISOString();
    // Link statement line to new journal entry
    const jLine = this.sql.exec(
      `SELECT id FROM journal_lines WHERE entry_id = ? AND account_id = ?`,
      res.entryId,
      bankChartAccountId,
    ).next();

    this.sql.exec(
      `UPDATE bank_statement_lines
       SET reconciliation_status = 'MATCHED', matched_journal_line_id = ?, matched_at = ?
       WHERE id = ?`,
      jLine.value?.id || null,
      now,
      statementLineId,
    );

    return { entryId: res.entryId };
  }

  getBankReconciliationReport(bankAccountId: string, _asOfDate?: string): {
    bankAccountName: string;
    statementBalancePaise: number;
    unclearedDepositsPaise: number;
    unclearedPaymentsPaise: number;
    reconciledBankBalancePaise: number;
    bookBalancePaise: number;
    differencePaise: number;
  } {
    const bankRes = this.sql.exec(
      `SELECT b.name, COALESCE(b.chart_account_id, (SELECT id FROM accounts WHERE code = '1010' LIMIT 1)) AS account_id, a.balance_paise
       FROM bank_accounts b
       LEFT JOIN accounts a ON a.id = COALESCE(b.chart_account_id, (SELECT id FROM accounts WHERE code = '1010' LIMIT 1))
       WHERE b.id = ?`,
      bankAccountId,
    ).next();

    const bankName = bankRes.value?.name || 'Bank Account';
    const bookBalancePaise = bankRes.value?.balance_paise || 0;
    const accountId = bankRes.value?.account_id;

    // Fetch unmatched deposits in books (Debits to bank)
    const unclearedDepRes = this.sql.exec(
      `SELECT coalesce(sum(jl.debit_paise), 0) as tot
       FROM journal_lines jl
       JOIN journal_entries je ON jl.entry_id = je.id
       WHERE jl.account_id = ?
         AND jl.id NOT IN (SELECT matched_journal_line_id FROM bank_statement_lines WHERE matched_journal_line_id IS NOT NULL)`,
      accountId,
    ).next();
    const unclearedDepositsPaise = Number(unclearedDepRes.value?.tot || 0);

    // Fetch unmatched withdrawals in books (Credits to bank)
    const unclearedWithRes = this.sql.exec(
      `SELECT coalesce(sum(jl.credit_paise), 0) as tot
       FROM journal_lines jl
       JOIN journal_entries je ON jl.entry_id = je.id
       WHERE jl.account_id = ?
         AND jl.id NOT IN (SELECT matched_journal_line_id FROM bank_statement_lines WHERE matched_journal_line_id IS NOT NULL)`,
      accountId,
    ).next();
    const unclearedPaymentsPaise = Number(unclearedWithRes.value?.tot || 0);

    // Reconciled Statement Balance = Book Balance + Uncleared Payments - Uncleared Deposits
    const statementBalancePaise = bookBalancePaise + unclearedPaymentsPaise - unclearedDepositsPaise;
    const reconciledBankBalancePaise = statementBalancePaise + unclearedDepositsPaise - unclearedPaymentsPaise;

    return {
      bankAccountName: bankName,
      statementBalancePaise,
      unclearedDepositsPaise,
      unclearedPaymentsPaise,
      reconciledBankBalancePaise,
      bookBalancePaise,
      differencePaise: reconciledBankBalancePaise - bookBalancePaise,
    };
  }

  // ==========================================
  // 4. CHEQUE REGISTER & TDS/TCS (Step 1.3)
  // ==========================================

  recordCheque(input: ChequeInput): { chequeId: string } {
    this.checkPeriodLock(input.chequeDate);
    const chequeId = newId();
    const now = new Date().toISOString();

    const today = new Date().toISOString().split('T')[0]!;
    const status = input.chequeDate > today ? 'PDC' : 'PENDING';

    this.sql.exec(
      `INSERT INTO cheques (id, bank_account_id, party_id, type, cheque_no, cheque_date, amount_paise, payee_payer_name, status, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      chequeId,
      input.bankAccountId,
      input.partyId || null,
      input.type,
      input.chequeNo,
      input.chequeDate,
      input.amountPaise,
      input.payeePayerName,
      status,
      input.notes || null,
      now,
    );

    return { chequeId };
  }

  updateChequeStatus(
    chequeId: string,
    status: 'CLEARED' | 'BOUNCED',
    options?: { clearingDate?: string; bounceChargesPaise?: number; branchId?: string },
  ): void {
    const chequeRes = this.sql.exec(`SELECT * FROM cheques WHERE id = ?`, chequeId).next();
    if (!chequeRes.value) throw new Error(`Cheque ${chequeId} not found`);
    const chq = chequeRes.value;

    const now = new Date().toISOString();
    if (status === 'CLEARED') {
      const cDate = options?.clearingDate || now.split('T')[0]!;
      this.sql.exec(
        `UPDATE cheques SET status = 'CLEARED', clearing_date = ? WHERE id = ?`,
        cDate,
        chequeId,
      );
    } else if (status === 'BOUNCED') {
      const bDate = now.split('T')[0]!;
      const charges = options?.bounceChargesPaise || 0;
      this.sql.exec(
        `UPDATE cheques SET status = 'BOUNCED', bounce_date = ?, bounce_charges_paise = ? WHERE id = ?`,
        bDate,
        charges,
        chequeId,
      );

      // If bounce charges applied and cheque is linked to a party, post bank charge entry
      if (charges > 0 && chq.party_id && options?.branchId) {
        const bankAcc = this.sql.exec(
          `SELECT COALESCE(b.chart_account_id, (SELECT id FROM accounts WHERE code = '1010' LIMIT 1)) AS account_id FROM bank_accounts b WHERE b.id = ?`,
          chq.bank_account_id,
        ).next();
        const bankChartAccountId = bankAcc.value?.account_id;
        const debtorsAcc = this.postingService.getAccountByCode('1100');

        if (bankChartAccountId) {
          this.postingService.createJournalEntry({
            entryNo: `CHQ-BOUNCE-${Date.now()}`,
            date: bDate,
            docType: 'BOUNCE_CHARGES',
            docId: chequeId,
            narration: `Cheque bounce charges for cheque #${chq.cheque_no}`,
            branchId: options.branchId,
            lines: [
              {
                accountId: debtorsAcc.id,
                partyId: chq.party_id,
                debitPaise: charges,
                creditPaise: 0,
                narration: 'Cheque bounce charges debit to customer',
              },
              {
                accountId: bankChartAccountId,
                debitPaise: 0,
                creditPaise: charges,
                narration: 'Cheque bounce charges paid from bank',
              },
            ],
          });
        }
      }
    }
  }

  listCheques(filter?: { status?: string; type?: string; bankAccountId?: string }): any[] {
    let sql = 'SELECT * FROM cheques WHERE 1=1';
    const params: any[] = [];
    if (filter?.status) {
      sql += ` AND status = ?`;
      params.push(filter.status);
    }
    if (filter?.type) {
      sql += ` AND type = ?`;
      params.push(filter.type);
    }
    if (filter?.bankAccountId) {
      sql += ` AND bank_account_id = ?`;
      params.push(filter.bankAccountId);
    }
    sql += ' ORDER BY cheque_date DESC';

    const cursor = this.sql.exec(sql, ...params);
    const results: any[] = [];
    let r = cursor.next();
    while (!r.done && r.value) {
      results.push(r.value);
      r = cursor.next();
    }
    return results;
  }

  // TDS Engine
  calculateTds(section: string, taxableAmountPaise: number): {
    rateBasisPoints: number;
    tdsAmountPaise: number;
  } {
    const rateMap: Record<string, number> = {
      '194C': 200, // 2%
      '194J': 1000, // 10%
      '194I': 1000, // 10% Rent
      '194Q': 10, // 0.1% Goods
      '194H': 500, // 5% Commission
    };
    const rateBps = rateMap[section] || 200;
    const tdsPaise = Math.round((taxableAmountPaise * rateBps) / 10000);
    return { rateBasisPoints: rateBps, tdsAmountPaise: tdsPaise };
  }

  recordTdsEntry(params: {
    voucherType: string;
    voucherId: string;
    partyId?: string;
    pan?: string;
    section: string;
    taxableAmountPaise: number;
    date: string;
  }): { tdsId: string; tdsAmountPaise: number } {
    this.checkPeriodLock(params.date);
    const { rateBasisPoints, tdsAmountPaise } = this.calculateTds(
      params.section,
      params.taxableAmountPaise,
    );

    const tdsId = newId();
    const now = new Date().toISOString();

    this.sql.exec(
      `INSERT INTO tds_entries (id, voucher_type, voucher_id, party_id, pan, section, rate_basis_points, taxable_amount_paise, tds_amount_paise, date, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DEDUCTED', ?)`,
      tdsId,
      params.voucherType,
      params.voucherId,
      params.partyId || null,
      params.pan || null,
      params.section,
      rateBasisPoints,
      params.taxableAmountPaise,
      tdsAmountPaise,
      params.date,
      now,
    );

    return { tdsId, tdsAmountPaise };
  }

  getTdsPayableReport(_financialYear?: string): {
    sections: {
      section: string;
      totalTaxablePaise: number;
      totalTdsPaise: number;
      count: number;
    }[];
    totalPayablePaise: number;
  } {
    const cursor = this.sql.exec(
      `SELECT section, sum(taxable_amount_paise) as tot_taxable, sum(tds_amount_paise) as tot_tds, count(*) as cnt
       FROM tds_entries
       WHERE status = 'DEDUCTED'
       GROUP BY section`,
    );

    const sections: any[] = [];
    let totPayable = 0;
    let r = cursor.next();
    while (!r.done && r.value) {
      const tds = Number(r.value.tot_tds || 0);
      sections.push({
        section: r.value.section,
        totalTaxablePaise: Number(r.value.tot_taxable || 0),
        totalTdsPaise: tds,
        count: Number(r.value.cnt || 0),
      });
      totPayable += tds;
      r = cursor.next();
    }

    return {
      sections,
      totalPayablePaise: totPayable,
    };
  }

  // Advance Adjustments
  adjustAdvancePayment(params: {
    paymentId: string;
    invoiceId?: string;
    purchaseBillId?: string;
    adjustedAmountPaise: number;
    adjustedDate: string;
  }): { adjustmentId: string } {
    this.checkPeriodLock(params.adjustedDate);
    const adjustmentId = newId();
    const now = new Date().toISOString();

    this.sql.exec(
      `INSERT INTO advance_adjustments (id, payment_id, invoice_id, purchase_bill_id, adjusted_amount_paise, adjusted_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      adjustmentId,
      params.paymentId,
      params.invoiceId || null,
      params.purchaseBillId || null,
      params.adjustedAmountPaise,
      params.adjustedDate,
      now,
    );

    // Update Invoice / Purchase Bill paid amount
    if (params.invoiceId) {
      this.sql.exec(
        `UPDATE invoices
         SET paid_amount_paise = paid_amount_paise + ?,
             status = CASE WHEN paid_amount_paise + ? >= total_paise THEN 'PAID' ELSE 'PARTIAL' END,
             updated_at = ?
         WHERE id = ?`,
        params.adjustedAmountPaise,
        params.adjustedAmountPaise,
        now,
        params.invoiceId,
      );
    } else if (params.purchaseBillId) {
      this.sql.exec(
        `UPDATE purchase_bills
         SET paid_amount_paise = paid_amount_paise + ?,
             status = CASE WHEN paid_amount_paise + ? >= total_paise THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
             updated_at = ?
         WHERE id = ?`,
        params.adjustedAmountPaise,
        params.adjustedAmountPaise,
        now,
        params.purchaseBillId,
      );
    }

    return { adjustmentId };
  }

  // ==========================================
  // 5. YEAR-END CLOSING & AUTO FY SERIES (Step 1.5)
  // ==========================================

  closeFinancialYear(fy: string): {
    closedFy: string;
    nextFy: string;
    netProfitCarriedForwardPaise: number;
    newSeriesCreated: number;
  } {
    // 1. Calculate P&L net profit for the FY
    // Income (4000-4999) - Expense (5000-5999)
    const incRes = this.sql.exec(
      `SELECT coalesce(sum(balance_paise), 0) as tot FROM accounts WHERE type = 'INCOME'`,
    ).next();
    const expRes = this.sql.exec(
      `SELECT coalesce(sum(balance_paise), 0) as tot FROM accounts WHERE type = 'EXPENSE'`,
    ).next();

    const totalIncomePaise = Number(incRes.value?.tot || 0);
    const totalExpensePaise = Number(expRes.value?.tot || 0);
    const netProfitPaise = totalIncomePaise - totalExpensePaise;

    // 2. Transfer Net Profit to 3001 Owner's Capital / Retained Earnings
    const now = new Date().toISOString();
    this.sql.exec(
      `UPDATE accounts
       SET balance_paise = balance_paise + ?, updated_at = ?
       WHERE code = '3001'`,
      netProfitPaise,
      now,
    );

    // Reset Income and Expense account balances for the new FY
    this.sql.exec(
      `UPDATE accounts SET balance_paise = 0, updated_at = ? WHERE type IN ('INCOME', 'EXPENSE')`,
      now,
    );

    // 3. Mark FY closed in settings
    const settings = this.getSettings();
    if (!settings.closedFinancialYears.includes(fy)) {
      settings.closedFinancialYears.push(fy);
      const confId = newId();
      const val = JSON.stringify(settings.closedFinancialYears);
      this.sql.exec(
        `INSERT INTO settings (id, key, value_json, updated_at)
         VALUES (?, 'closed_financial_years', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = ?, updated_at = ?`,
        confId,
        val,
        now,
        val,
        now,
      );
    }

    // 4. Auto-provision document series for next FY
    // Example: "26-27" -> "27-28"
    const parts = fy.split('-');
    const nextStart = parseInt(parts[0] || '26', 10) + 1;
    const nextEnd = parseInt(parts[1] || '27', 10) + 1;
    const nextFy = `${nextStart}-${nextEnd}`;

    const seriesCursor = this.sql.exec(
      `SELECT branch_id, doc_type, prefix, padding FROM document_series WHERE financial_year = ?`,
      fy,
    );

    let newSeriesCount = 0;
    let s = seriesCursor.next();
    while (!s.done && s.value) {
      const item = s.value;
      const seriesId = newId();
      this.sql.exec(
        `INSERT INTO document_series (id, branch_id, doc_type, prefix, next_number, fy_suffix_enabled, financial_year, padding, is_default, updated_at)
         VALUES (?, ?, ?, ?, 1, 1, ?, ?, 1, ?)`,
        seriesId,
        item.branch_id,
        item.doc_type,
        item.prefix,
        nextFy,
        item.padding,
        now,
      );
      newSeriesCount++;
      s = seriesCursor.next();
    }

    return {
      closedFy: fy,
      nextFy,
      netProfitCarriedForwardPaise: netProfitPaise,
      newSeriesCreated: newSeriesCount,
    };
  }

  // ==========================================
  // 6. GST RETURNS (GSTR-1, 3B, 2B RECON) (Step 1.6)
  // ==========================================

  generateGstr1(periodMonth: string): Gstr1JsonPayload {
    // Read business details
    const branchRes = this.sql.exec(`SELECT gstin, state_code FROM branches WHERE is_default = 1`).next();
    const gstin = branchRes.value?.gstin as string | undefined;
    if (!gstin) throw new Error('Add your GSTIN (Settings → Company details) before preparing GST returns');

    // Format period: YYYY-MM -> MMYYYY e.g. "2026-04" -> "042026"
    const [y, m] = periodMonth.split('-');
    const fp = `${m}${y}`;

    // 1. Fetch Invoices for this month
    const invCursor = this.sql.exec(
      `SELECT i.*, COALESCE(NULLIF(i.party_gstin, ''), p.gstin) as customer_gstin, COALESCE(i.party_state_code, p.state_code) as customer_state_code,
              CASE WHEN COALESCE(i.party_state_code, p.state_code) != br.state_code THEN 1 ELSE 0 END as is_inter_state,
              (SELECT COALESCE(SUM(l.line_total_paise - l.cgst_amount_paise - l.sgst_amount_paise - l.igst_amount_paise - l.cess_amount_paise), 0) FROM invoice_lines l WHERE l.invoice_id = i.id) as taxable_amount_paise,
              (SELECT COALESCE(MAX(l.tax_rate_basis_points), 0) FROM invoice_lines l WHERE l.invoice_id = i.id) as tax_rate_basis_points
       FROM invoices i
       LEFT JOIN parties p ON i.party_id = p.id
       LEFT JOIN branches br ON br.id = i.branch_id
       WHERE substr(i.date, 1, 7) = ? AND i.status NOT IN ('CANCELLED', 'DRAFT') AND i.deleted_at IS NULL`,
      periodMonth,
    );

    const b2bMap: Record<string, Gstr1B2bRecipient> = {};
    const b2csMap: Record<string, Gstr1B2csSummary> = {};
    const hsnMap: Record<string, Gstr1HsnItem> = {};

    let inv = invCursor.next();
    while (!inv.done && inv.value) {
      const row = inv.value;
      const isB2B = !!row.customer_gstin;

      // Lines for this invoice
      const linesCursor = this.sql.exec(
        `SELECT il.*, COALESCE(NULLIF(il.hsn_sac, ''), it.hsn_sac) as hsn_sac, it.name as item_name,
                (il.line_total_paise - il.cgst_amount_paise - il.sgst_amount_paise - il.igst_amount_paise - il.cess_amount_paise) as taxable_amount_paise,
                (il.cgst_amount_paise + il.sgst_amount_paise + il.igst_amount_paise) as tax_amount_paise
         FROM invoice_lines il
         JOIN items it ON il.item_id = it.id
         WHERE il.invoice_id = ?`,
        row.id,
      );

      const items: any[] = [];
      let lineIdx = 1;
      let line = linesCursor.next();
      while (!line.done && line.value) {
        const l = line.value;
        const rate = (l.tax_rate_basis_points || 0) / 100;
        const txval = Number(paiseToRupees(l.taxable_amount_paise));
        const taxAmt = Number(paiseToRupees(l.tax_amount_paise));

        items.push({
          num: lineIdx++,
          itm_det: {
            rt: rate,
            txval,
            iamt: row.is_inter_state ? taxAmt : 0,
            camt: !row.is_inter_state ? taxAmt / 2 : 0,
            samt: !row.is_inter_state ? taxAmt / 2 : 0,
            csamt: 0,
          },
        });

        // Accumulate HSN summary
        const hsn = l.hsn_sac || '999999';
        if (!hsnMap[hsn]) {
          hsnMap[hsn] = {
            num: Object.keys(hsnMap).length + 1,
            hsn_sc: hsn,
            desc: l.item_name,
            uqc: 'NOS',
            qty: 0,
            val: 0,
            txval: 0,
            iamt: 0,
            camt: 0,
            samt: 0,
          };
        }
        hsnMap[hsn]!.qty += (l.quantity_thousandths || 0) / 1000;
        hsnMap[hsn]!.txval += txval;
        hsnMap[hsn]!.val += Number(paiseToRupees(l.line_total_paise));
        if (row.is_inter_state) {
          hsnMap[hsn]!.iamt = (hsnMap[hsn]!.iamt || 0) + taxAmt;
        } else {
          hsnMap[hsn]!.camt = (hsnMap[hsn]!.camt || 0) + taxAmt / 2;
          hsnMap[hsn]!.samt = (hsnMap[hsn]!.samt || 0) + taxAmt / 2;
        }

        line = linesCursor.next();
      }

      if (isB2B) {
        const ctin = row.customer_gstin;
        if (!b2bMap[ctin]) {
          b2bMap[ctin] = { ctin, inv: [] };
        }
        b2bMap[ctin]!.inv.push({
          inum: row.invoice_no,
          idt: String(row.date).split('-').reverse().join('-'), // DD-MM-YYYY
          val: Number(paiseToRupees(row.total_paise)),
          pos: row.customer_state_code || '19',
          rchrg: 'N',
          inv_typ: 'R',
          itms: items,
        });
      } else {
        // B2CS
        const sply_ty = row.is_inter_state ? 'INTER' : 'INTRA';
        const rate = (row.tax_rate_basis_points || 1800) / 100;
        const key = `${sply_ty}_${rate}_${row.customer_state_code || '19'}`;
        const txval = Number(paiseToRupees(row.taxable_amount_paise));
        const taxAmt = Number(paiseToRupees(row.tax_total_paise));

        if (!b2csMap[key]) {
          b2csMap[key] = {
            sply_ty,
            rt: rate,
            pos: row.customer_state_code || '19',
            typ: 'OE',
            txval: 0,
            iamt: 0,
            camt: 0,
            samt: 0,
          };
        }
        b2csMap[key]!.txval += txval;
        if (row.is_inter_state) {
          b2csMap[key]!.iamt = (b2csMap[key]!.iamt || 0) + taxAmt;
        } else {
          b2csMap[key]!.camt = (b2csMap[key]!.camt || 0) + taxAmt / 2;
          b2csMap[key]!.samt = (b2csMap[key]!.samt || 0) + taxAmt / 2;
        }
      }

      inv = invCursor.next();
    }

    return {
      gstin,
      fp,
      version: 'GST1.0',
      hash: 'hash',
      b2b: Object.values(b2bMap),
      b2cs: Object.values(b2csMap),
      hsn: { data: Object.values(hsnMap) },
    };
  }

  generateGstr3b(periodMonth: string): Gstr3bSummary {
    const branchRes = this.sql.exec(`SELECT gstin FROM branches WHERE is_default = 1`).next();
    const gstin = branchRes.value?.gstin as string | undefined;
    if (!gstin) throw new Error('Add your GSTIN (Settings → Company details) before preparing GST returns');

    // 1. Outward taxable supplies
    const salesRes = this.sql.exec(
      `SELECT
         coalesce(sum(l.line_total_paise - l.cgst_amount_paise - l.sgst_amount_paise - l.igst_amount_paise - l.cess_amount_paise), 0) as tot_txval,
         coalesce(sum(l.cgst_amount_paise), 0) as tot_cgst,
         coalesce(sum(l.sgst_amount_paise), 0) as tot_sgst,
         coalesce(sum(l.igst_amount_paise), 0) as tot_igst
       FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
       WHERE substr(i.date, 1, 7) = ? AND i.status NOT IN ('CANCELLED', 'DRAFT') AND i.deleted_at IS NULL`,
      periodMonth,
    ).next();

    const outwardTaxable = {
      taxableValuePaise: Number(salesRes.value?.tot_txval || 0),
      cgstPaise: Number(salesRes.value?.tot_cgst || 0),
      sgstPaise: Number(salesRes.value?.tot_sgst || 0),
      igstPaise: Number(salesRes.value?.tot_igst || 0),
      cessPaise: 0,
    };

    // 2. Eligible ITC from Purchase Bills
    const itcRes = this.sql.exec(
      `SELECT
         coalesce(sum(subtotal_paise), 0) as tot_txval,
         coalesce(sum(cgst_paise), 0) as tot_cgst,
         coalesce(sum(sgst_paise), 0) as tot_sgst,
         coalesce(sum(igst_paise), 0) as tot_igst
       FROM purchase_bills
       WHERE substr(date, 1, 7) = ?
         AND itc_eligibility = 'ELIGIBLE'
         AND status != 'CANCELLED'`,
      periodMonth,
    ).next();

    const itcAvailable = {
      cgstPaise: Number(itcRes.value?.tot_cgst || 0),
      sgstPaise: Number(itcRes.value?.tot_sgst || 0),
      igstPaise: Number(itcRes.value?.tot_igst || 0),
      cessPaise: 0,
    };

    // 3. Ineligible ITC u/s 17(5)
    const blockedRes = this.sql.exec(
      `SELECT
         coalesce(sum(cgst_paise), 0) as tot_cgst,
         coalesce(sum(sgst_paise), 0) as tot_sgst,
         coalesce(sum(igst_paise), 0) as tot_igst
       FROM purchase_bills
       WHERE substr(date, 1, 7) = ?
         AND itc_eligibility = 'BLOCKED_17_5'`,
      periodMonth,
    ).next();

    const blockedItc = {
      cgstPaise: Number(blockedRes.value?.tot_cgst || 0),
      sgstPaise: Number(blockedRes.value?.tot_sgst || 0),
      igstPaise: Number(blockedRes.value?.tot_igst || 0),
      cessPaise: 0,
    };

    // Net tax payable = Outward Tax - Net ITC
    const netCgst = Math.max(0, outwardTaxable.cgstPaise - itcAvailable.cgstPaise);
    const netSgst = Math.max(0, outwardTaxable.sgstPaise - itcAvailable.sgstPaise);
    const netIgst = Math.max(0, outwardTaxable.igstPaise - itcAvailable.igstPaise);

    return {
      returnPeriod: periodMonth,
      gstin,
      outwardTaxableSupplies: outwardTaxable,
      outwardZeroRatedSupplies: { taxableValuePaise: 0, igstPaise: 0, cessPaise: 0 },
      otherOutwardSuppliesNilExempt: { taxableValuePaise: 0 },
      inwardRcmSupplies: { taxableValuePaise: 0, igstPaise: 0, cgstPaise: 0, sgstPaise: 0, cessPaise: 0 },
      eligibleItc: {
        allOtherItc: itcAvailable,
        itcReversed: { igstPaise: 0, cgstPaise: 0, sgstPaise: 0, cessPaise: 0 },
        netItcAvailable: itcAvailable,
        ineligibleItc17_5: blockedItc,
      },
      netTaxPayable: {
        cgstPaise: netCgst,
        sgstPaise: netSgst,
        igstPaise: netIgst,
        cessPaise: 0,
        totalPaise: netCgst + netSgst + netIgst,
      },
    };
  }

  reconcileGstr2b(
    gstr2bRecords: Gstr2bRecord[],
    periodMonth: string,
  ): {
    matches: Gstr2bReconciliationMatch[];
    summary: {
      matchedCount: number;
      mismatchedCount: number;
      missingInBooksCount: number;
      missingIn2bCount: number;
      total2bTaxPaise: number;
      totalBooksTaxPaise: number;
    };
  } {
    // 1. Fetch purchase bills for this period
    const billsCursor = this.sql.exec(
      `SELECT pb.*, p.gstin as supplier_gstin, p.name as supplier_name
       FROM purchase_bills pb
       JOIN parties p ON pb.party_id = p.id
       WHERE substr(pb.date, 1, 7) = ? AND pb.status != 'CANCELLED'`,
      periodMonth,
    );

    const purchaseBills: any[] = [];
    let b = billsCursor.next();
    while (!b.done && b.value) {
      purchaseBills.push(b.value);
      b = billsCursor.next();
    }

    const matches: Gstr2bReconciliationMatch[] = [];
    const matchedBillIds = new Set<string>();

    let total2bTax = 0;
    let matchedCount = 0;
    let mismatchedCount = 0;
    let missingInBooksCount = 0;

    // Check GSTR-2B against Purchase Bills
    for (const rec of gstr2bRecords) {
      const gstrTax = rec.cgstPaise + rec.sgstPaise + rec.igstPaise;
      total2bTax += gstrTax;

      const foundBill = purchaseBills.find((pb) => {
        if (matchedBillIds.has(pb.id)) return false;
        const gstinMatch = pb.supplier_gstin?.toUpperCase() === rec.supplierGstin.toUpperCase();
        const invoiceMatch =
          pb.bill_no.toLowerCase().replace(/[^a-z0-9]/g, '') ===
          rec.invoiceNo.toLowerCase().replace(/[^a-z0-9]/g, '');
        return gstinMatch && invoiceMatch;
      });

      if (foundBill) {
        matchedBillIds.add(foundBill.id);
        const bookTax = foundBill.cgst_paise + foundBill.sgst_paise + foundBill.igst_paise;
        const diffTax = Math.abs(gstrTax - bookTax);
        const diffTaxable = Math.abs(rec.taxableValuePaise - foundBill.taxable_amount_paise);

        // Within ₹1 tolerance (100 paise)
        if (diffTax <= 100 && diffTaxable <= 100) {
          matchedCount++;
          matches.push({
            id: newId(),
            supplierGstin: rec.supplierGstin,
            invoiceNo: rec.invoiceNo,
            status: 'MATCHED',
            gstr2b: rec,
            purchaseBill: {
              billId: foundBill.id,
              billNo: foundBill.bill_no,
              billDate: foundBill.bill_date,
              taxableAmountPaise: foundBill.taxable_amount_paise,
              cgstPaise: foundBill.cgst_paise,
              sgstPaise: foundBill.sgst_paise,
              igstPaise: foundBill.igst_paise,
              totalPaise: foundBill.total_paise,
            },
            diffTaxablePaise: 0,
            diffTaxPaise: 0,
          });
        } else {
          mismatchedCount++;
          matches.push({
            id: newId(),
            supplierGstin: rec.supplierGstin,
            invoiceNo: rec.invoiceNo,
            status: 'MISMATCHED',
            gstr2b: rec,
            purchaseBill: {
              billId: foundBill.id,
              billNo: foundBill.bill_no,
              billDate: foundBill.bill_date,
              taxableAmountPaise: foundBill.taxable_amount_paise,
              cgstPaise: foundBill.cgst_paise,
              sgstPaise: foundBill.sgst_paise,
              igstPaise: foundBill.igst_paise,
              totalPaise: foundBill.total_paise,
            },
            diffTaxablePaise: diffTaxable,
            diffTaxPaise: diffTax,
            discrepancyReason: `Tax difference of ₹${(diffTax / 100).toFixed(2)} between Books and 2B`,
          });
        }
      } else {
        missingInBooksCount++;
        matches.push({
          id: newId(),
          supplierGstin: rec.supplierGstin,
          invoiceNo: rec.invoiceNo,
          status: 'MISSING_IN_BOOKS',
          gstr2b: rec,
          diffTaxablePaise: rec.taxableValuePaise,
          diffTaxPaise: gstrTax,
          discrepancyReason: 'Invoice reported in GSTR-2B by supplier but missing in Purchase Bills',
        });
      }
    }

    // Any bills in purchase bills that were NOT found in 2B
    let missingIn2bCount = 0;
    let totalBooksTax = 0;

    for (const pb of purchaseBills) {
      const bookTax = pb.cgst_paise + pb.sgst_paise + pb.igst_paise;
      totalBooksTax += bookTax;

      if (!matchedBillIds.has(pb.id)) {
        missingIn2bCount++;
        matches.push({
          id: newId(),
          supplierGstin: pb.supplier_gstin || 'N/A',
          invoiceNo: pb.bill_no,
          status: 'MISSING_IN_2B',
          purchaseBill: {
            billId: pb.id,
            billNo: pb.bill_no,
            billDate: pb.bill_date,
            taxableAmountPaise: pb.taxable_amount_paise,
            cgstPaise: pb.cgst_paise,
            sgstPaise: pb.sgst_paise,
            igstPaise: pb.igst_paise,
            totalPaise: pb.total_paise,
          },
          diffTaxablePaise: pb.taxable_amount_paise,
          diffTaxPaise: bookTax,
          discrepancyReason: 'Recorded in Purchase Bills but supplier has not yet filed GSTR-1',
        });
      }
    }

    return {
      matches,
      summary: {
        matchedCount,
        mismatchedCount,
        missingInBooksCount,
        missingIn2bCount,
        total2bTaxPaise: total2bTax,
        totalBooksTaxPaise: totalBooksTax,
      },
    };
  }

  // ==========================================
  // 7. TALLY XML EXPORT (Step 1.7)
  // ==========================================

  exportTallyXml(companyName: string, startDate?: string, endDate?: string): string {
    // 1. Fetch all accounts for Masters
    const accCursor = this.sql.exec(`SELECT code, name, type, subtype, balance_paise FROM accounts`);
    const tallyLedgers: TallyLedgerMaster[] = [];

    const groupMap: Record<string, string> = {
      CASH: 'Cash-in-Hand',
      BANK: 'Bank Accounts',
      RECEIVABLE: 'Sundry Debtors',
      PAYABLE: 'Sundry Creditors',
      TAX_INPUT: 'Duties & Taxes',
      TAX_OUTPUT: 'Duties & Taxes',
      INVENTORY: 'Stock-in-Hand',
      FIXED_ASSET: 'Fixed Assets',
      EQUITY: 'Capital Account',
      DIRECT_INCOME: 'Sales Accounts',
      INDIRECT_INCOME: 'Direct Incomes',
      DIRECT_EXPENSE: 'Purchase Accounts',
      INDIRECT_EXPENSE: 'Indirect Expenses',
    };

    let a = accCursor.next();
    while (!a.done && a.value) {
      const row = a.value;
      const groupName = groupMap[row.subtype] || (row.type === 'ASSET' ? 'Current Assets' : 'Current Liabilities');
      tallyLedgers.push({
        name: row.name,
        groupName,
        openingBalancePaise: Math.abs(row.balance_paise),
        isDebit: row.type === 'ASSET' || row.type === 'EXPENSE',
      });
      a = accCursor.next();
    }

    // 2. Fetch Journal Entries & Lines
    let jSql = `SELECT je.id, je.entry_no, je.date, je.doc_type, je.narration
                FROM journal_entries je WHERE 1=1`;
    const jParams: any[] = [];
    if (startDate) {
      jSql += ` AND je.date >= ?`;
      jParams.push(startDate);
    }
    if (endDate) {
      jSql += ` AND je.date <= ?`;
      jParams.push(endDate);
    }
    jSql += ` ORDER BY je.date ASC`;

    const jCursor = this.sql.exec(jSql, ...jParams);
    const tallyVouchers: TallyVoucher[] = [];

    const vchTypeMap: Record<string, 'Sales' | 'Purchase' | 'Journal' | 'Payment' | 'Receipt' | 'Contra'> = {
      INVOICE: 'Sales',
      PURCHASE: 'Purchase',
      CONTRA: 'Contra',
      RECEIPT: 'Receipt',
      PAYMENT: 'Payment',
      JOURNAL: 'Journal',
      MANUAL: 'Journal',
    };

    let j = jCursor.next();
    while (!j.done && j.value) {
      const entry = j.value;
      const linesCursor = this.sql.exec(
        `SELECT jl.debit_paise, jl.credit_paise, a.name as account_name
         FROM journal_lines jl
         JOIN accounts a ON jl.account_id = a.id
         WHERE jl.entry_id = ?`,
        entry.id,
      );

      const entries: any[] = [];
      let l = linesCursor.next();
      while (!l.done && l.value) {
        const line = l.value;
        const isDebit = line.debit_paise > 0;
        entries.push({
          ledgerName: line.account_name,
          isDebit,
          amountPaise: isDebit ? line.debit_paise : line.credit_paise,
        });
        l = linesCursor.next();
      }

      tallyVouchers.push({
        voucherType: vchTypeMap[entry.doc_type] || 'Journal',
        voucherNo: entry.entry_no,
        date: entry.date,
        narration: entry.narration,
        entries,
      });

      j = jCursor.next();
    }

    return generateTallyXml({
      companyName,
      ledgers: tallyLedgers,
      vouchers: tallyVouchers,
    });
  }

  // ==========================================
  // 8. COST CENTRES & FIXED ASSETS (Step 1.8)
  // ==========================================

  createCostCentre(input: CostCentreInput): { costCentreId: string } {
    const id = newId();
    const now = new Date().toISOString();

    this.sql.exec(
      `INSERT INTO cost_centres (id, name, code, category, branch_id, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      id,
      input.name,
      input.code,
      input.category || 'DEPARTMENT',
      input.branchId || null,
      now,
    );

    return { costCentreId: id };
  }

  listCostCentres(): any[] {
    const cursor = this.sql.exec(`SELECT * FROM cost_centres ORDER BY name ASC`);
    const results: any[] = [];
    let r = cursor.next();
    while (!r.done && r.value) {
      results.push(r.value);
      r = cursor.next();
    }
    return results;
  }

  setCostCentreBudget(costCentreId: string, financialYear: string, budgetPaise: number): void {
    const id = newId();
    const now = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO cost_centre_budgets (id, cost_centre_id, financial_year, budget_paise, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      costCentreId,
      financialYear,
      budgetPaise,
      now,
    );
  }

  getCostCentreBudgetReport(financialYear: string): any[] {
    const cursor = this.sql.exec(
      `SELECT cc.id, cc.name, cc.code, cc.category, coalesce(b.budget_paise, 0) as budget_paise
       FROM cost_centres cc
       LEFT JOIN cost_centre_budgets b ON cc.id = b.cost_centre_id AND b.financial_year = ?
       WHERE cc.is_active = 1`,
      financialYear,
    );

    const results: any[] = [];
    let r = cursor.next();
    while (!r.done && r.value) {
      const budget = Number(r.value.budget_paise || 0);
      results.push({
        id: r.value.id,
        name: r.value.name,
        code: r.value.code,
        category: r.value.category,
        budgetPaise: budget,
        actualPaise: 0,
        variancePaise: budget,
      });
      r = cursor.next();
    }
    return results;
  }

  createFixedAsset(input: FixedAssetInput): { assetId: string } {
    this.checkPeriodLock(input.purchaseDate);
    const assetId = newId();
    const now = new Date().toISOString();
    const salvagePaise = input.salvageValuePaise || 0;

    this.sql.exec(
      `INSERT INTO fixed_assets (id, asset_name, asset_code, cost_centre_id, purchase_date, purchase_cost_paise, depreciation_method, depreciation_rate_basis_points, salvage_value_paise, accumulated_depreciation_paise, net_book_value_paise, asset_account_id, depreciation_expense_account_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'ACTIVE', ?)`,
      assetId,
      input.assetName,
      input.assetCode,
      input.costCentreId || null,
      input.purchaseDate,
      input.purchaseCostPaise,
      input.depreciationMethod,
      input.depreciationRateBasisPoints,
      salvagePaise,
      input.purchaseCostPaise,
      input.assetAccountId,
      input.depreciationExpenseAccountId,
      now,
    );

    return { assetId };
  }

  listFixedAssets(): any[] {
    const cursor = this.sql.exec(`SELECT * FROM fixed_assets ORDER BY purchase_date DESC`);
    const results: any[] = [];
    let r = cursor.next();
    while (!r.done && r.value) {
      results.push(r.value);
      r = cursor.next();
    }
    return results;
  }

  calculateAssetDepreciation(assetId: string): { depreciationPaise: number } {
    const assetRes = this.sql.exec(`SELECT * FROM fixed_assets WHERE id = ?`, assetId).next();
    if (!assetRes.value) throw new Error(`Asset ${assetId} not found`);
    const a = assetRes.value;

    const calculated =
      a.depreciation_method === 'SLM'
        ? Math.round(
            (Math.max(0, a.purchase_cost_paise - a.salvage_value_paise) *
              a.depreciation_rate_basis_points) /
              10000,
          )
        : Math.round((a.net_book_value_paise * a.depreciation_rate_basis_points) / 10000);

    const maxDep = Math.max(0, a.net_book_value_paise - a.salvage_value_paise);
    const depPaise = Math.min(calculated, maxDep);

    return { depreciationPaise: depPaise };
  }

  postAssetDepreciationRun(assetId: string, financialYear: string, branchId: string): {
    depreciationPaise: number;
    journalEntryId: string;
  } {
    const assetRes = this.sql.exec(`SELECT * FROM fixed_assets WHERE id = ?`, assetId).next();
    if (!assetRes.value) throw new Error(`Asset ${assetId} not found`);
    const a = assetRes.value;

    const { depreciationPaise } = this.calculateAssetDepreciation(assetId);
    if (depreciationPaise <= 0) {
      throw new Error(`Asset ${a.asset_name} is already fully depreciated to salvage value`);
    }

    const today = new Date().toISOString().split('T')[0]!;
    this.checkPeriodLock(today);

    // Post journal entry: Debit Depreciation Expense, Credit Accumulated Depreciation
    const postRes = this.postingService.createJournalEntry({
      entryNo: `DEP-${a.asset_code}-${financialYear}`,
      date: today,
      docType: 'DEPRECIATION',
      docId: assetId,
      narration: `Depreciation for ${a.asset_name} (${a.depreciation_method}) for FY ${financialYear}`,
      branchId,
      lines: [
        {
          accountId: a.depreciation_expense_account_id,
          debitPaise: depreciationPaise,
          creditPaise: 0,
          narration: `Depreciation expense on ${a.asset_name}`,
        },
        {
          accountId: a.asset_account_id,
          debitPaise: 0,
          creditPaise: depreciationPaise,
          narration: `Accumulated depreciation on ${a.asset_name}`,
        },
      ],
    });

    const now = new Date().toISOString();
    // Update Fixed Asset accumulated & net book value
    this.sql.exec(
      `UPDATE fixed_assets
       SET accumulated_depreciation_paise = accumulated_depreciation_paise + ?,
           net_book_value_paise = net_book_value_paise - ?
       WHERE id = ?`,
      depreciationPaise,
      depreciationPaise,
      assetId,
    );

    // Record depreciation row
    const depRecordId = newId();
    this.sql.exec(
      `INSERT INTO fixed_asset_depreciations (id, fixed_asset_id, financial_year, depreciation_amount_paise, date, journal_entry_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      depRecordId,
      assetId,
      financialYear,
      depreciationPaise,
      today,
      postRes.entryId,
      now,
    );

    return {
      depreciationPaise,
      journalEntryId: postRes.entryId,
    };
  }

  // ==========================================
  // 9. INVENTORY VALUATION CHOICE (Step 1.9)
  // ==========================================

  getInventoryValuationMethod(): 'WEIGHTED_AVERAGE' | 'FIFO' {
    return this.getSettings().inventoryValuationMethod;
  }

  setInventoryValuationMethod(method: 'WEIGHTED_AVERAGE' | 'FIFO'): void {
    const now = new Date().toISOString();
    const id = newId();
    const val = JSON.stringify(method);
    this.sql.exec(
      `INSERT INTO settings (id, key, value_json, updated_at)
       VALUES (?, 'inventory_valuation_method', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = ?, updated_at = ?`,
      id,
      val,
      now,
      val,
      now,
    );
  }
}
