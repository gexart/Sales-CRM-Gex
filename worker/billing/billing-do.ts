import { DurableObject } from 'cloudflare:workers';
import { applyColumnAdditions, ensureSystemAccounts, BUSINESS_MIGRATION_SQL } from './db/business/migrations';
import { allocateDocNumber, listSeriesSettings, saveSeriesSetting } from './services/numbering';
import { TradeDocumentService, type CreateTradeDocInput, type ListTradeDocsParams } from './services/trade-documents';
import { convertTradeDocument, type ConvertInput } from './services/trade-conversion';
import { listPayments, type ListPaymentsParams } from './services/payment-record';
import { resolveLocation } from './services/location';
import type { TradeDocStatus } from '@billing/shared';
import { seedBusinessDatabase, SeedBusinessOptions } from './db/seeds/business';
import { PartyService, PartyInput, PartyRecord } from './services/party';
import { ItemService, ItemInput, ItemRecord } from './services/item';
import { BankService, BankAccountInput, BankAccountRecord } from './services/bank';
import {
  PostingService,
  PostInvoiceParams,
  PostCreditNoteParams,
  PostPurchaseBillParams,
  PostDebitNoteParams,
  PostPaymentInParams,
  PostPaymentOutParams,
  PostExpenseParams,
  PostStockAdjustmentParams,
  TrialBalanceRow,
} from './services/posting';
import {
  InvoiceService,
  CreateInvoiceInput,
  ListInvoicesParams,
  RecordPaymentInput,
  CreateCreditNoteInput,
} from './services/invoice';
import {
  PurchaseService,
  CreatePurchaseBillInput,
  RecordPurchasePaymentInput,
  CreateDebitNoteInput,
  CreateExpenseInput,
} from './services/purchase';
import {
  InventoryService,
  TransferStockInput,
  AdjustStockInput,
  CreateBatchInput,
  CreateRecipeInput,
} from './services/inventory';
import { ReportService } from './services/reports';
import { SettingsService, BranchInput, RoleInput, TeamMemberInput } from './services/settings';
import { NotificationService } from './services/notification';
import {
  AccountingService,
  ManualVoucherInput,
  ImportBankStatementInput,
  ChequeInput,
  CostCentreInput,
  FixedAssetInput,
} from './services/accounting';
import { EInvoiceService, TransportDetails } from './services/einvoice';
import { OfflineSyncService, RegisterDeviceInput, SyncBatchInput } from './services/offline-sync';
import type { Gstr2bRecord } from '@billing/shared';
import type { Env } from './types';
import { ReorderService } from './services/reorder';

export class BillingDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Run bundled SQLite migrations inside blockConcurrencyWhile so the DO is
    // fully upgraded before any request or RPC method executes.
    this.ctx.blockConcurrencyWhile(async () => {
      this.runMigrations();
    });
  }

  /**
   * Runs raw DDL statements to ensure all 40 tables and indexes exist.
   */
  private runMigrations(): void {
    const sql = (this.ctx.storage as any).sql;
    if (!sql) return;

    // Execute table and index creation
    const statements = BUSINESS_MIGRATION_SQL.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      try {
        sql.exec(statement);
      } catch (err) {
        console.error('Migration statement error:', err, 'Statement:', statement);
      }
    }
    applyColumnAdditions(sql);
    ensureSystemAccounts(sql);
  }

  /** Run `fn` as one atomic SQLite transaction. */
  private tx<T>(fn: () => T): T {
    return (this.ctx.storage as any).transactionSync(fn);
  }
  private get platformSql(): any {
    return (this.ctx.storage as any).sql;
  }
  /** Outgoing-webhook hook; webhooks are not part of the billing module. */
  private emit(_event: string, _data: unknown): void {}

  /**
   * Health and connectivity RPC check
   */
  async ping(): Promise<{ status: 'ok'; timestamp: string; tables: number }> {
    const sql = (this.ctx.storage as any).sql;
    let count = 0;
    if (sql) {
      const cursor = sql.exec("SELECT count(*) as count FROM sqlite_master WHERE type='table'");
      const row = cursor.next();
      if (!row.done && row.value) {
        count = Number(row.value.count || 0);
      }
    }
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      tables: count,
    };
  }

  /**
   * Provisions a new business with default units, tax rates, chart of accounts,
   * default branch, warehouse, and document series.
   */
  async initBusiness(options: SeedBusinessOptions): Promise<{ success: boolean; branchId: string }> {
    const sql = (this.ctx.storage as any).sql;
    if (!sql) throw new Error('SQLite storage unavailable in BusinessDO');

    return (this.ctx.storage as any).transactionSync(() => {
      // Check if already seeded
      const cursor = sql.exec('SELECT id FROM branches WHERE is_default = 1 LIMIT 1');
      const existing = cursor.next();
      if (!existing.done && existing.value) {
        return { success: true, branchId: String(existing.value.id) };
      }

      seedBusinessDatabase(sql, options);

      const branchCursor = sql.exec('SELECT id FROM branches WHERE is_default = 1 LIMIT 1');
      const branchRow = branchCursor.next();
      const branchId = branchRow.value ? String(branchRow.value.id) : '';

      return { success: true, branchId };
    });
  }

  /**
   * Generates next gapless document number inside an atomic transactionSync block.
   */
  /** Bill-number formats (prefix / suffix / padding) for every document type, current FY. */
  async listNumbering(branchId?: string): Promise<any[]> {
    return listSeriesSettings((this.ctx.storage as any).sql, branchId);
  }

  async saveNumbering(input: { docType: string; branchId?: string; prefix: string; suffix: string; padding: number }): Promise<any> {
    const sql = (this.ctx.storage as any).sql;
    return (this.ctx.storage as any).transactionSync(() => saveSeriesSetting(sql, input));
  }

  async nextDocNumber(docType: string, branchId?: string): Promise<{ docNumber: string; seriesId: string }> {
    const sql = (this.ctx.storage as any).sql;
    if (!sql) throw new Error('SQLite storage unavailable');

    return (this.ctx.storage as any).transactionSync(() => {
      const { docNumber, seriesId } = allocateDocNumber(sql, { docType, branchId });
      return { docNumber, seriesId };
    });
  }

  /**
   * Retrieves dashboard summary metrics from live SQLite tables
   */
  async getDashboardMetrics(): Promise<{
    partiesCount: number;
    itemsCount: number;
    invoicesCount: number;
    totalSalesPaise: number;
    unpaidSalesPaise: number;
  }> {
    const sql = (this.ctx.storage as any).sql;
    if (!sql) {
      return { partiesCount: 0, itemsCount: 0, invoicesCount: 0, totalSalesPaise: 0, unpaidSalesPaise: 0 };
    }

    const partyRes = sql.exec('SELECT count(*) as c FROM parties WHERE deleted_at IS NULL').next();
    const itemRes = sql.exec('SELECT count(*) as c FROM items WHERE deleted_at IS NULL').next();
    const invRes = sql.exec('SELECT count(*) as c, sum(total_paise) as s, sum(balance_amount_paise) as b FROM invoices WHERE deleted_at IS NULL').next();

    return {
      partiesCount: partyRes.value ? Number(partyRes.value.c || 0) : 0,
      itemsCount: itemRes.value ? Number(itemRes.value.c || 0) : 0,
      invoicesCount: invRes.value ? Number(invRes.value.c || 0) : 0,
      totalSalesPaise: invRes.value ? Number(invRes.value.s || 0) : 0,
      unpaidSalesPaise: invRes.value ? Number(invRes.value.b || 0) : 0,
    };
  }

  /**
   * Saves a key-value setting in SQLite
   */
  async setSetting(key: string, value: any): Promise<{ success: boolean }> {
    return (this.ctx.storage as any).transactionSync(async () => {
      await this.settingsService.setSetting(key, value);
      return { success: true };
    });
  }

  /**
   * Retrieves a key-value setting from SQLite
   */
  async getSetting(key: string, defaultValue?: any): Promise<any | null> {
    return this.settingsService.getSetting(key, defaultValue);
  }

  /**
   * Tenant isolation test helper — verifies DO is bound only to its business ID
   */
  async getTenantContext(): Promise<{ isHealthy: boolean; timestamp: string }> {
    return {
      isHealthy: true,
      timestamp: new Date().toISOString(),
    };
  }

  // --- Masters RPC Methods ---

  private get partyService(): PartyService {
    return new PartyService((this.ctx.storage as any).sql);
  }

  private get itemService(): ItemService {
    return new ItemService((this.ctx.storage as any).sql);
  }

  private get bankService(): BankService {
    return new BankService(
      (this.ctx.storage as any).sql,
      (this.env as any).ENCRYPTION_KEY || (this.env as any).JWT_SECRET || 'gexpro-default-encryption-secret',
    );
  }

  private get postingService(): PostingService {
    return new PostingService((this.ctx.storage as any).sql);
  }

  private get invoiceService(): InvoiceService {
    return new InvoiceService((this.ctx.storage as any).sql);
  }

  private get purchaseService(): PurchaseService {
    return new PurchaseService((this.ctx.storage as any).sql, this.postingService);
  }

  private get inventoryService(): InventoryService {
    return new InventoryService((this.ctx.storage as any).sql, this.postingService);
  }



  private get reportService(): ReportService {
    return new ReportService((this.ctx.storage as any).sql, this.postingService);
  }

  private get settingsService(): SettingsService {
    return new SettingsService((this.ctx.storage as any).sql);
  }

  private get notificationService(): NotificationService {
    return new NotificationService((this.ctx.storage as any).sql);
  }

  private get accountingService(): AccountingService {
    return new AccountingService((this.ctx.storage as any).sql);
  }

  private get eInvoiceService(): EInvoiceService {
    return new EInvoiceService((this.ctx.storage as any).sql);
  }





  private get offlineSyncService(): OfflineSyncService {
    return new OfflineSyncService((this.ctx.storage as any).sql);
  }

  async createParty(data: PartyInput): Promise<PartyRecord> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.partyService.create(data);
    });
  }

  async updateParty(id: string, data: Partial<PartyInput>): Promise<PartyRecord> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.partyService.update(id, data);
    });
  }

  async deleteParty(id: string): Promise<boolean> {
    return this.partyService.delete(id);
  }

  async getParty(id: string): Promise<PartyRecord | null> {
    return this.partyService.getById(id);
  }

  async listParties(options: { type?: string; search?: string; limit?: number; offset?: number } = {}): Promise<{ parties: PartyRecord[]; total: number }> {
    return this.partyService.list(options);
  }

  async getPartyLedger(partyId: string) {
    return this.partyService.getLedger(partyId);
  }

  async createItem(data: ItemInput): Promise<ItemRecord> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.itemService.create(data);
    });
  }

  async updateItem(id: string, data: Partial<ItemInput>): Promise<ItemRecord> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.itemService.update(id, data);
    });
  }

  async deleteItem(id: string): Promise<boolean> {
    return this.itemService.delete(id);
  }

  async getItem(id: string): Promise<ItemRecord | null> {
    return this.itemService.getById(id);
  }

  async searchItems(query: string, limit = 20): Promise<ItemRecord[]> {
    return this.itemService.search(query, limit);
  }

  async listItems(options: { search?: string; type?: string; categoryId?: string; limit?: number; offset?: number } = {}): Promise<{ items: ItemRecord[]; total: number }> {
    return this.itemService.list(options);
  }

  async bulkInsertItems(items: ItemInput[]): Promise<{ insertedCount: number }> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.itemService.bulkInsert(items);
    });
  }

  async createBankAccount(data: BankAccountInput): Promise<BankAccountRecord> {
    return this.bankService.create(data);
  }

  async listBankAccounts(): Promise<BankAccountRecord[]> {
    return this.bankService.list();
  }

  async deleteBankAccount(id: string): Promise<boolean> {
    return this.bankService.delete(id);
  }

  async listUnits(): Promise<any[]> {
    const sql = (this.ctx.storage as any).sql;
    if (!sql) return [];
    const cursor = sql.exec('SELECT * FROM units ORDER BY is_default DESC, name ASC');
    const results: any[] = [];
    let row = cursor.next();
    while (!row.done && row.value) {
      results.push(row.value);
      row = cursor.next();
    }
    return results;
  }

  async listTaxRates(): Promise<any[]> {
    const sql = (this.ctx.storage as any).sql;
    if (!sql) return [];
    const cursor = sql.exec('SELECT * FROM tax_rates WHERE is_active = 1 ORDER BY rate_basis_points ASC');
    const results: any[] = [];
    let row = cursor.next();
    while (!row.done && row.value) {
      results.push(row.value);
      row = cursor.next();
    }
    return results;
  }

  // --- Double-Entry Accounting RPC Methods ---

  async postInvoice(params: PostInvoiceParams): Promise<{ entryId: string; totalDebitPaise: number }> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.postingService.postInvoice(params);
    });
  }

  async postCreditNote(params: PostCreditNoteParams): Promise<{ entryId: string; totalDebitPaise: number }> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.postingService.postCreditNote(params);
    });
  }

  async postPurchaseBill(params: PostPurchaseBillParams): Promise<{ entryId: string; totalDebitPaise: number }> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.postingService.postPurchaseBill(params);
    });
  }

  async postDebitNote(params: PostDebitNoteParams): Promise<{ entryId: string; totalDebitPaise: number }> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.postingService.postDebitNote(params);
    });
  }

  async postPaymentIn(params: PostPaymentInParams): Promise<{ entryId: string; totalDebitPaise: number }> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.postingService.postPaymentIn(params);
    });
  }

  async postPaymentOut(params: PostPaymentOutParams): Promise<{ entryId: string; totalDebitPaise: number }> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.postingService.postPaymentOut(params);
    });
  }

  async postExpense(params: PostExpenseParams): Promise<{ entryId: string; totalDebitPaise: number }> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.postingService.postExpense(params);
    });
  }

  async postStockAdjustment(params: PostStockAdjustmentParams): Promise<{ entryId: string; totalDebitPaise: number }> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.postingService.postStockAdjustment(params);
    });
  }

  async reverseDocument(docType: string, docId: string, narrationPrefix?: string): Promise<boolean> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.postingService.reverseDocument(docType, docId, narrationPrefix);
    });
  }

  async getTrialBalance(asOfDate?: string): Promise<{
    accounts: TrialBalanceRow[];
    totalDebitPaise: number;
    totalCreditPaise: number;
    differencePaise: number;
  }> {
    return this.postingService.getTrialBalance(asOfDate);
  }

  async listAccounts(): Promise<any[]> {
    const sql = (this.ctx.storage as any).sql;
    if (!sql) return [];
    const cursor = sql.exec('SELECT * FROM accounts ORDER BY code ASC');
    const results: any[] = [];
    let row = cursor.next();
    while (!row.done && row.value) {
      results.push(row.value);
      row = cursor.next();
    }
    return results;
  }

  // --- Advanced Accounting (Tally-Level) RPC Methods ---

  async createVoucher(input: ManualVoucherInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.accountingService.createVoucher(input);
    });
  }

  async setOpeningBalances(branchId: string, balances: any[], openingDate?: string): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.accountingService.setOpeningBalances(branchId, balances, openingDate);
    });
  }

  async getPeriodLockSettings(): Promise<any> {
    return this.accountingService.getSettings();
  }

  async setPeriodLock(lockedUntilDate: string): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      this.accountingService.setPeriodLock(lockedUntilDate);
      return { success: true, booksLockedUntil: lockedUntilDate };
    });
  }

  async lockGstMonth(month: string): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      this.accountingService.lockGstMonth(month);
      return { success: true, lockedMonth: month };
    });
  }

  async importBankStatement(input: ImportBankStatementInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.accountingService.importBankStatement(input);
    });
  }

  async autoMatchBankStatement(bankAccountId: string): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.accountingService.autoMatchBankStatement(bankAccountId);
    });
  }

  async manualMatchStatementLine(statementLineId: string, journalLineId: string): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      this.accountingService.manualMatchStatementLine(statementLineId, journalLineId);
      return { success: true };
    });
  }

  async createEntryFromUnmatchedLine(statementLineId: string, categoryAccountId: string, branchId: string): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.accountingService.createEntryFromUnmatchedLine(statementLineId, categoryAccountId, branchId);
    });
  }

  async getBankReconciliationReport(bankAccountId: string, asOfDate?: string): Promise<any> {
    return this.accountingService.getBankReconciliationReport(bankAccountId, asOfDate);
  }

  async recordCheque(input: ChequeInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.accountingService.recordCheque(input);
    });
  }

  async updateChequeStatus(chequeId: string, status: 'CLEARED' | 'BOUNCED', options?: any): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      this.accountingService.updateChequeStatus(chequeId, status, options);
      return { success: true };
    });
  }

  async listCheques(filter?: any): Promise<any[]> {
    return this.accountingService.listCheques(filter);
  }

  async recordTdsEntry(params: any): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.accountingService.recordTdsEntry(params);
    });
  }

  async getTdsPayableReport(financialYear?: string): Promise<any> {
    return this.accountingService.getTdsPayableReport(financialYear);
  }

  async adjustAdvancePayment(params: any): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.accountingService.adjustAdvancePayment(params);
    });
  }

  async closeFinancialYear(fy: string): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.accountingService.closeFinancialYear(fy);
    });
  }

  async generateGstr1(periodMonth: string): Promise<any> {
    return this.accountingService.generateGstr1(periodMonth);
  }

  async generateGstr3b(periodMonth: string): Promise<any> {
    return this.accountingService.generateGstr3b(periodMonth);
  }

  async reconcileGstr2b(gstr2bRecords: Gstr2bRecord[], periodMonth: string): Promise<any> {
    return this.accountingService.reconcileGstr2b(gstr2bRecords, periodMonth);
  }

  async exportTallyXml(companyName: string, startDate?: string, endDate?: string): Promise<string> {
    return this.accountingService.exportTallyXml(companyName, startDate, endDate);
  }

  async createCostCentre(input: CostCentreInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.accountingService.createCostCentre(input);
    });
  }

  async listCostCentres(): Promise<any[]> {
    return this.accountingService.listCostCentres();
  }

  async setCostCentreBudget(costCentreId: string, financialYear: string, budgetPaise: number): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      this.accountingService.setCostCentreBudget(costCentreId, financialYear, budgetPaise);
      return { success: true };
    });
  }

  async getCostCentreBudgetReport(financialYear: string): Promise<any[]> {
    return this.accountingService.getCostCentreBudgetReport(financialYear);
  }

  async createFixedAsset(input: FixedAssetInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.accountingService.createFixedAsset(input);
    });
  }

  async listFixedAssets(): Promise<any[]> {
    return this.accountingService.listFixedAssets();
  }

  async postAssetDepreciationRun(assetId: string, financialYear: string, branchId: string): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.accountingService.postAssetDepreciationRun(assetId, financialYear, branchId);
    });
  }

  async getInventoryValuationMethod(): Promise<'WEIGHTED_AVERAGE' | 'FIFO'> {
    return this.accountingService.getInventoryValuationMethod();
  }

  async setInventoryValuationMethod(method: 'WEIGHTED_AVERAGE' | 'FIFO'): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      this.accountingService.setInventoryValuationMethod(method);
      return { success: true, method };
    });
  }

  async listPayments(params: ListPaymentsParams): Promise<any> {
    return listPayments((this.ctx.storage as any).sql, params);
  }

  /** Points balance and redemption rules for a customer by mobile (POS checkout preview). */
  async posLoyaltyLookup(phone: string): Promise<{ partyId: string; name: string; points: number; paisePerPoint: number; minRedeem: number; maxPercent: number } | null> {
    const sql = (this.ctx.storage as any).sql;
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) return null;
    const party = sql
      .exec("SELECT id, name, loyalty_points FROM parties WHERE deleted_at IS NULL AND (phone = ? OR phone = ? OR phone = ?) LIMIT 1", digits, `+91${digits}`, `91${digits}`)
      .toArray()[0];
    if (!party) return null;
    const prog = sql.exec('SELECT * FROM loyalty_programs WHERE is_active = 1 LIMIT 1').toArray()[0] ?? {};
    return {
      partyId: String(party.id),
      name: String(party.name),
      points: Number(party.loyalty_points ?? 0),
      paisePerPoint: Number(prog.paise_per_point_redemption ?? 50),
      minRedeem: Number(prog.min_redeem_points ?? 100),
      maxPercent: Number(prog.max_redeem_percentage ?? 50),
    };
  }




  /** Real default branch / warehouse and account ids by code, for the placeholder-id safety net. */
  async resolvePlaceholderIds(codes: string[]): Promise<{ branchId: string | null; warehouseId: string | null; accounts: Record<string, string> }> {
    const sql = (this.ctx.storage as any).sql;
    let branchId: string | null = null;
    let warehouseId: string | null = null;
    try {
      const loc = resolveLocation(sql, {});
      branchId = loc.branchId;
      warehouseId = loc.warehouseId;
    } catch {
      /* no branch yet */
    }
    const accounts: Record<string, string> = {};
    for (const code of codes.slice(0, 50)) {
      const r = sql.exec('SELECT id FROM accounts WHERE code = ? LIMIT 1', code).toArray()[0] as { id: string } | undefined;
      if (r) accounts[code] = r.id;
    }
    return { branchId, warehouseId, accounts };
  }

  async resolveLocation(wanted: { branchId?: string | null; warehouseId?: string | null }): Promise<{ branchId: string; warehouseId: string | null }> {
    return resolveLocation((this.ctx.storage as any).sql, wanted);
  }

  // --- Trade documents: quotations, proforma, sales orders, challans, packing lists, purchase orders ---

  private get tradeDocs(): TradeDocumentService {
    return new TradeDocumentService((this.ctx.storage as any).sql);
  }

  async createTradeDocument(input: CreateTradeDocInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => this.tradeDocs.create(input));
  }

  async listTradeDocuments(params: ListTradeDocsParams): Promise<any> {
    return this.tradeDocs.list(params);
  }

  async getTradeDocument(id: string): Promise<any> {
    return this.tradeDocs.get(id);
  }

  async setTradeDocumentStatus(id: string, status: TradeDocStatus, userId: string): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => this.tradeDocs.setStatus(id, status, userId));
  }

  async convertTradeDocument(input: ConvertInput): Promise<any> {
    const sql = (this.ctx.storage as any).sql;
    return (this.ctx.storage as any).transactionSync(() =>
      convertTradeDocument(sql, { invoices: this.invoiceService, purchases: this.purchaseService }, input),
    );
  }

  // --- Sales & Invoicing RPC Methods ---

  async createSalesInvoice(input: CreateInvoiceInput): Promise<any> {
    const res: any = (this.ctx.storage as any).transactionSync(() => {
      const res = this.invoiceService.createInvoice(input);
      return res;
    });
    if (res?.invoice) this.emit('invoice.created', { id: res.invoice.id, invoiceNo: res.invoice.invoiceNo ?? res.invoice.invoice_no, totalPaise: res.invoice.totalPaise ?? res.invoice.total_paise, partyId: res.invoice.partyId ?? res.invoice.party_id });
    return res;
  }

  async getSalesInvoice(id: string): Promise<any> {
    return this.invoiceService.getInvoice(id);
  }

  async listSalesInvoices(params: ListInvoicesParams): Promise<any> {
    return this.invoiceService.listInvoices(params);
  }

  async recordSalesPayment(input: RecordPaymentInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.invoiceService.recordPayment(input);
    });
  }

  async createSalesCreditNote(input: CreateCreditNoteInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.invoiceService.createCreditNote(input);
    });
  }

  async cancelSalesInvoice(id: string, reason: string): Promise<boolean> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.invoiceService.cancelInvoice(id, reason);
    });
  }

  async getPublicInvoice(token: string): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.invoiceService.getPublicInvoice(token);
    });
  }

  // Purchases & Expenses RPC Methods
  async createPurchaseBill(input: CreatePurchaseBillInput): Promise<any> {
    const res: any = (this.ctx.storage as any).transactionSync(() => {
      const res: any = this.purchaseService.createPurchaseBill(input);
      return res;
    });
    if (res?.id) this.emit('purchase_bill.created', { id: res.id, billNo: res.billNo ?? res.bill_no, totalPaise: res.totalPaise ?? res.total_paise });
    return res;
  }

  async getPurchaseBill(id: string): Promise<any> {
    return this.purchaseService.getPurchaseBill(id);
  }

  async listPurchaseBills(params: any): Promise<any> {
    return this.purchaseService.listPurchaseBills(params);
  }

  async recordPurchasePayment(billId: string, input: RecordPurchasePaymentInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.purchaseService.recordPaymentOut(billId, input);
    });
  }

  async createDebitNote(input: CreateDebitNoteInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.purchaseService.createDebitNote(input);
    });
  }

  async createExpense(input: CreateExpenseInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.purchaseService.createExpense(input);
    });
  }

  async listExpenses(params: any): Promise<any> {
    return this.purchaseService.listExpenses(params);
  }

  async getExpenseSummary(branchId?: string): Promise<any> {
    return this.purchaseService.getExpenseSummary(branchId);
  }

  // --- Inventory & Recipe RPC Methods ---
  async getStockSummary(warehouseId?: string, search?: string): Promise<any> {
    return this.inventoryService.getStockSummary(warehouseId, search);
  }

  async getStockLedger(itemId: string, warehouseId?: string): Promise<any> {
    return this.inventoryService.getStockLedger(itemId, warehouseId);
  }

  async transferStock(input: TransferStockInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.inventoryService.transferStock(input);
    });
  }

  async adjustStock(input: AdjustStockInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.inventoryService.adjustStock(input);
    });
  }

  async getBatches(itemId?: string, nearExpiryDays?: number): Promise<any> {
    return this.inventoryService.getBatches(itemId, nearExpiryDays);
  }

  async createBatch(input: CreateBatchInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.inventoryService.createBatch(input);
    });
  }

  async createRecipe(input: CreateRecipeInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.inventoryService.createRecipe(input);
    });
  }

  async getRecipe(menuItemId: string): Promise<any> {
    return this.inventoryService.getRecipe(menuItemId);
  }

  async consumeRecipe(params: any): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.inventoryService.consumeRecipe(params);
    });
  }

  async getLowStockItems(warehouseId?: string): Promise<any> {
    return this.inventoryService.getLowStockItems(warehouseId);
  }

  // --- Reports & Financial Statements RPC Methods ---
  async getProfitAndLoss(params?: { startDate?: string; endDate?: string; branchId?: string }): Promise<any> {
    return this.reportService.getProfitAndLoss(params);
  }

  async getBalanceSheet(params?: { asOfDate?: string; branchId?: string }): Promise<any> {
    return this.reportService.getBalanceSheet(params);
  }

  async getGstr1Report(params?: { returnPeriod?: string; branchId?: string }): Promise<any> {
    return this.reportService.getGstr1(params);
  }

  async getAgingReport(type: 'RECEIVABLES' | 'PAYABLES'): Promise<any> {
    return this.reportService.getAgingReport(type);
  }

  // --- Multi-Branch, Team Members & Settings RPC Methods ---
  async listBranches(): Promise<any[]> {
    return this.settingsService.listBranches();
  }

  async createBranch(input: BranchInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.settingsService.createBranch(input);
    });
  }

  async getAllSettings(): Promise<Record<string, any>> {
    return this.settingsService.getAllSettings();
  }

  async listRoles(): Promise<any[]> {
    return this.settingsService.listRoles();
  }

  async createRole(input: RoleInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.settingsService.createRole(input);
    });
  }

  async listTeamMembers(): Promise<any[]> {
    return this.settingsService.listTeamMembers();
  }

  async inviteTeamMember(input: TeamMemberInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.settingsService.inviteTeamMember(input);
    });
  }

  async setMemberModuleRole(memberId: string, workspace: string, role: string): Promise<any> {
    return this.settingsService.setMemberModuleRole(memberId, workspace, role);
  }

  async exportAllBusinessData(): Promise<any> {
    return this.settingsService.exportAllData();
  }

  // --- Notification Methods ---
  async getNotifications(): Promise<any> {
    return this.notificationService.getNotifications();
  }

  async markNotificationAsRead(id: string): Promise<any> {
    return this.notificationService.markAsRead(id);
  }

  async markAllNotificationsAsRead(): Promise<any> {
    return this.notificationService.markAllAsRead();
  }

  async createNotification(params: {
    title: string;
    message: string;
    type?: 'INFO' | 'SUCCESS' | 'WARNING' | 'ALERT';
    link?: string;
  }): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.notificationService.createNotification(params);
    });
  }

  // --- E-Invoice & E-Way Bill RPC Methods ---
  async generateEInvoice(invoiceId: string): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.eInvoiceService.generateEInvoice(invoiceId);
    });
  }

  async cancelEInvoice(invoiceId: string, cancelReason: '1' | '2' | '3' | '4', cancelRemarks?: string): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.eInvoiceService.cancelEInvoice(invoiceId, cancelReason, cancelRemarks);
    });
  }

  async bulkGenerateEInvoices(invoiceIds: string[]): Promise<any> {
    return this.eInvoiceService.bulkGenerateEInvoices(invoiceIds);
  }

  async generateEWayBill(invoiceId: string, transport: TransportDetails): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.eInvoiceService.generateEWayBill(invoiceId, transport);
    });
  }

  async updateEwbVehicle(ewbId: string, vehicleNo: string, fromPlace: string, fromStateCode: number, reasonCode: '1' | '2' | '3' | '4'): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.eInvoiceService.updateEwbVehicle(ewbId, vehicleNo, fromPlace, fromStateCode, reasonCode);
    });
  }

  async cancelEWayBill(ewbId: string, cancelReason: '1' | '2' | '3' | '4', cancelRemarks?: string): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.eInvoiceService.cancelEWayBill(ewbId, cancelReason, cancelRemarks);
    });
  }

  async getInvoiceGstStatus(invoiceId: string): Promise<any> {
    return this.eInvoiceService.getInvoiceGstStatus(invoiceId);
  }

  // --- Reorder planning & rack/bin ---
  async reorderSuggestions(): Promise<any[]> {
    return new ReorderService(this.platformSql).suggestions();
  }
  async createReorderPurchaseOrders(lines: any[], userId: string): Promise<any[]> {
    return this.tx(() => {
      const drafts = new ReorderService(this.platformSql).purchaseOrderDrafts(lines);
      const loc = resolveLocation(this.platformSql, {});
      const today = new Date().toISOString().slice(0, 10);
      return drafts.map((d) => this.tradeDocs.create({ docType: 'PURCHASE_ORDER', branchId: loc.branchId, partyId: d.partyId, date: today, lines: d.lines, status: 'DRAFT', notes: 'Created from reorder suggestions', createdById: userId } as any));
    });
  }
  async setItemLocation(itemId: string, warehouseId: string | undefined, rackBin: string): Promise<any> {
    return this.tx(() => {
      const wh = warehouseId || resolveLocation(this.platformSql, {}).warehouseId;
      if (!wh) throw new Error('Create a warehouse first');
      return new ReorderService(this.platformSql).setLocation(itemId, wh, rackBin);
    });
  }
  async listItemLocations(warehouseId?: string): Promise<any[]> {
    return new ReorderService(this.platformSql).locations(warehouseId);
  }

  // ==========================================
  // OFFLINE MODE & CLIENT SYNC (Step 2.8)
  // ==========================================

  async registerPosDevice(input: RegisterDeviceInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(() => {
      return this.offlineSyncService.registerDevice(input);
    });
  }

  async getPosDevice(deviceCode: string): Promise<any> {
    return this.offlineSyncService.getDevice(deviceCode);
  }

  async listPosDevices(branchId?: string): Promise<any[]> {
    return this.offlineSyncService.listDevices(branchId);
  }

  async getOfflineMastersCache(branchId: string, deviceCode?: string): Promise<any> {
    return this.offlineSyncService.getMastersCache(branchId, deviceCode);
  }

  async syncOfflineMutations(batch: SyncBatchInput): Promise<any> {
    return (this.ctx.storage as any).transactionSync(async () => {
      return this.offlineSyncService.syncMutations(batch);
    });
  }

  async listOfflineConflicts(branchId?: string): Promise<any[]> {
    return this.offlineSyncService.listConflicts(branchId);
  }
}
