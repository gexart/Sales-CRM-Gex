import type { PostingService } from './posting';

export interface ProfitAndLossReport {
  startDate: string;
  endDate: string;
  operatingRevenuePaise: number;
  otherIncomePaise: number;
  totalIncomePaise: number;
  costOfGoodsSoldPaise: number;
  grossProfitPaise: number;
  operatingExpensesPaise: number;
  netProfitPaise: number;
  incomeLines: Array<{ accountName: string; code: string; amountPaise: number }>;
  expenseLines: Array<{ accountName: string; code: string; amountPaise: number }>;
}

export interface BalanceSheetReport {
  asOfDate: string;
  assets: {
    currentAssetsPaise: number;
    cashAndBankPaise: number;
    accountsReceivablePaise: number;
    inventoryValuationPaise: number;
    totalAssetsPaise: number;
    lines: Array<{ name: string; code: string; amountPaise: number }>;
  };
  liabilities: {
    currentLiabilitiesPaise: number;
    accountsPayablePaise: number;
    dutiesAndTaxesPaise: number;
    totalLiabilitiesPaise: number;
    lines: Array<{ name: string; code: string; amountPaise: number }>;
  };
  equity: {
    capitalPaise: number;
    retainedEarningsPaise: number;
    totalEquityPaise: number;
    lines: Array<{ name: string; code: string; amountPaise: number }>;
  };
  differencePaise: number;
  isReconciled: boolean;
}

export interface Gstr1B2bInvoice {
  gstin: string;
  partyName: string;
  invoiceNo: string;
  invoiceDate: string;
  invoiceValuePaise: number;
  placeOfSupply: string;
  reverseCharge: boolean;
  rateBasisPoints: number;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
}

export interface Gstr1HsnRow {
  hsnSac: string;
  description: string;
  uqc: string;
  totalQuantityThousandths: number;
  totalValuePaise: number;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  cessPaise: number;
}

export interface Gstr1Report {
  returnPeriod: string;
  gstin: string;
  legalName: string;
  b2b: Gstr1B2bInvoice[];
  b2cl: any[];
  b2cs: Array<{
    type: 'OE';
    placeOfSupply: string;
    rateBasisPoints: number;
    taxableValuePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
  }>;
  cdnr: any[];
  hsnSummary: Gstr1HsnRow[];
  docsIssued: Array<{
    docType: string;
    series: string;
    fromNo: string;
    toNo: string;
    totalNumber: number;
    cancelledNumber: number;
  }>;
  totals: {
    totalTaxablePaise: number;
    totalCgstPaise: number;
    totalSgstPaise: number;
    totalIgstPaise: number;
    totalValuePaise: number;
  };
}

export interface AgingBucketRow {
  partyId: string;
  partyName: string;
  phone?: string;
  totalOutstandingPaise: number;
  bucket0to30Paise: number;
  bucket31to60Paise: number;
  bucket61to90Paise: number;
  bucket90PlusPaise: number;
}

export class ReportService {
  constructor(
    private db: any,
    _postingService?: PostingService,
  ) {}

  private getSql(): any {
    return (this.db as any).session?.client || (this.db as any).sql || this.db;
  }

  // 1. Profit & Loss Statement
  async getProfitAndLoss(params?: {
    startDate?: string;
    endDate?: string;
    branchId?: string;
  }): Promise<ProfitAndLossReport> {
    const rawSql = this.getSql();
    const now = new Date().toISOString();
    const startDate = params?.startDate || `${now.substring(0, 4)}-04-01`;
    const endDate = params?.endDate || now.substring(0, 10);

    let operatingRevenuePaise = 0;
    let otherIncomePaise = 0;
    let costOfGoodsSoldPaise = 0;
    let operatingExpensesPaise = 0;
    const incomeLines: Array<{ accountName: string; code: string; amountPaise: number }> = [];
    const expenseLines: Array<{ accountName: string; code: string; amountPaise: number }> = [];

    if (rawSql?.exec) {
      // Query revenue & expense accounts balances
      const cursor = rawSql.exec(
        `SELECT a.code, a.name, a.type, a.subtype, a.balance_paise ` +
          `FROM accounts a ` +
          `WHERE a.type IN ('INCOME', 'EXPENSE') ` +
          `ORDER BY a.code ASC`,
      );

      for (const acc of cursor) {
        const bal = Math.abs(Number(acc.balance_paise || 0));
        if (bal === 0) continue;

        if (acc.type === 'INCOME') {
          if (acc.subtype === 'OPERATING_REVENUE' || acc.subtype === 'DIRECT_INCOME' || acc.code === '4001' || acc.code === '4000') {
            operatingRevenuePaise += bal;
          } else {
            otherIncomePaise += bal;
          }
          incomeLines.push({ accountName: acc.name, code: acc.code, amountPaise: bal });
        } else if (acc.type === 'EXPENSE') {
          if (acc.subtype === 'DIRECT_EXPENSE' || acc.code === '5001' || acc.code === '5000') {
            costOfGoodsSoldPaise += bal;
          } else {
            operatingExpensesPaise += bal;
          }
          expenseLines.push({ accountName: acc.name, code: acc.code, amountPaise: bal });
        }
      }
    }

    const totalIncomePaise = operatingRevenuePaise + otherIncomePaise;
    const grossProfitPaise = totalIncomePaise - costOfGoodsSoldPaise;
    const netProfitPaise = grossProfitPaise - operatingExpensesPaise;

    return {
      startDate,
      endDate,
      operatingRevenuePaise,
      otherIncomePaise,
      totalIncomePaise,
      costOfGoodsSoldPaise,
      grossProfitPaise,
      operatingExpensesPaise,
      netProfitPaise,
      incomeLines,
      expenseLines,
    };
  }

  // 2. Balance Sheet with Reconciliation
  async getBalanceSheet(params?: {
    asOfDate?: string;
    branchId?: string;
  }): Promise<BalanceSheetReport> {
    const rawSql = this.getSql();
    const asOfDate = params?.asOfDate || new Date().toISOString().substring(0, 10);

    const assetLines: Array<{ name: string; code: string; amountPaise: number }> = [];
    const liabilityLines: Array<{ name: string; code: string; amountPaise: number }> = [];
    const equityLines: Array<{ name: string; code: string; amountPaise: number }> = [];

    let cashAndBankPaise = 0;
    let accountsReceivablePaise = 0;
    let inventoryValuationPaise = 0;
    let currentAssetsPaise = 0;

    let accountsPayablePaise = 0;
    let dutiesAndTaxesPaise = 0;
    let currentLiabilitiesPaise = 0;

    let capitalPaise = 0;

    if (rawSql?.exec) {
      const cursor = rawSql.exec(
        `SELECT a.code, a.name, a.type, a.subtype, a.balance_paise ` +
          `FROM accounts a ` +
          `WHERE a.type IN ('ASSET', 'LIABILITY', 'EQUITY') ` +
          `ORDER BY a.code ASC`,
      );

      for (const acc of cursor) {
        const bal = Number(acc.balance_paise || 0);
        if (acc.type === 'ASSET') {
          const posBal = bal;
          if (acc.subtype === 'BANK' || acc.subtype === 'CASH' || acc.code === '1010' || acc.code === '1001' || acc.code === '1000') {
            cashAndBankPaise += posBal;
          } else if (acc.code === '1100' || acc.subtype === 'RECEIVABLE') {
            accountsReceivablePaise += posBal;
          } else if (acc.code === '1200' || acc.code === '1300' || acc.subtype === 'INVENTORY') {
            inventoryValuationPaise += posBal;
          } else {
            currentAssetsPaise += posBal;
          }
          assetLines.push({ name: acc.name, code: acc.code, amountPaise: posBal });
        } else if (acc.type === 'LIABILITY') {
          const negBal = Math.abs(bal);
          if (acc.code === '2001' || acc.code === '2100' || acc.subtype === 'PAYABLE') {
            accountsPayablePaise += negBal;
          } else if (acc.subtype === 'TAX_OUTPUT' || acc.code === '2110' || acc.code === '2120' || acc.code === '2130' || acc.code === '2200') {
            dutiesAndTaxesPaise += negBal;
          } else {
            currentLiabilitiesPaise += negBal;
          }
          liabilityLines.push({ name: acc.name, code: acc.code, amountPaise: negBal });
        } else if (acc.type === 'EQUITY') {
          const eqBal = Math.abs(bal);
          capitalPaise += eqBal;
          equityLines.push({ name: acc.name, code: acc.code, amountPaise: eqBal });
        }
      }
    }

    const totalAssetsPaise = cashAndBankPaise + accountsReceivablePaise + inventoryValuationPaise + currentAssetsPaise;
    const totalLiabilitiesPaise = accountsPayablePaise + dutiesAndTaxesPaise + currentLiabilitiesPaise;

    // Retained Earnings = Net Profit from P&L
    const pl = await this.getProfitAndLoss({ endDate: asOfDate, branchId: params?.branchId });
    const retainedEarningsPaise = pl.netProfitPaise;

    equityLines.push({
      name: 'Retained Earnings (Current Period P&L)',
      code: '3999',
      amountPaise: retainedEarningsPaise,
    });

    const totalEquityPaise = capitalPaise + retainedEarningsPaise;
    const differencePaise = totalAssetsPaise - (totalLiabilitiesPaise + totalEquityPaise);
    const isReconciled = Math.abs(differencePaise) === 0;

    return {
      asOfDate,
      assets: {
        currentAssetsPaise,
        cashAndBankPaise,
        accountsReceivablePaise,
        inventoryValuationPaise,
        totalAssetsPaise,
        lines: assetLines,
      },
      liabilities: {
        currentLiabilitiesPaise,
        accountsPayablePaise,
        dutiesAndTaxesPaise,
        totalLiabilitiesPaise,
        lines: liabilityLines,
      },
      equity: {
        capitalPaise,
        retainedEarningsPaise,
        totalEquityPaise,
        lines: equityLines,
      },
      differencePaise,
      isReconciled,
    };
  }

  // 3. GSTR-1 Report (B2B, B2CS, CDNR, HSN, Docs Issued)
  async getGstr1(params?: {
    returnPeriod?: string;
    branchId?: string;
  }): Promise<Gstr1Report> {
    const rawSql = this.getSql();
    const returnPeriod = params?.returnPeriod || new Date().toISOString().substring(0, 7);

    const b2b: Gstr1B2bInvoice[] = [];
    const b2csMap: Record<string, { placeOfSupply: string; rateBasisPoints: number; taxableValuePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number }> = {};
    const hsnMap: Record<string, Gstr1HsnRow> = {};
    const docsIssued: any[] = [];

    let totalTaxablePaise = 0;
    let totalCgstPaise = 0;
    let totalSgstPaise = 0;
    let totalIgstPaise = 0;
    let totalValuePaise = 0;

    if (rawSql?.exec) {
      // Fetch Invoices
      const invCur = rawSql.exec(
        `SELECT i.*, p.gstin as party_gstin, p.name as party_name, p.state_code as party_state ` +
          `FROM invoices i ` +
          `LEFT JOIN parties p ON i.party_id = p.id ` +
          `WHERE i.deleted_at IS NULL AND i.status != 'CANCELLED'`,
      );

      for (const inv of invCur) {
        const taxable = Number(inv.taxable_amount_paise || 0);
        const cgst = Number(inv.cgst_paise || 0);
        const sgst = Number(inv.sgst_paise || 0);
        const igst = Number(inv.igst_paise || 0);
        const total = Number(inv.total_paise || 0);
        const pos = inv.place_of_supply || inv.party_state || '19';

        totalTaxablePaise += taxable;
        totalCgstPaise += cgst;
        totalSgstPaise += sgst;
        totalIgstPaise += igst;
        totalValuePaise += total;

        if (inv.party_gstin && inv.party_gstin.trim().length === 15) {
          // B2B: Registered recipient
          b2b.push({
            gstin: inv.party_gstin,
            partyName: inv.party_name || 'Registered Party',
            invoiceNo: inv.invoice_no,
            invoiceDate: inv.invoice_date || inv.created_at?.substring(0, 10),
            invoiceValuePaise: total,
            placeOfSupply: pos,
            reverseCharge: false,
            rateBasisPoints: igst > 0 ? 1800 : 500,
            taxableValuePaise: taxable,
            cgstPaise: cgst,
            sgstPaise: sgst,
            igstPaise: igst,
          });
        } else {
          // B2CS: Unregistered recipient (intra-state or small inter-state)
          const key = `${pos}_${igst > 0 ? 1800 : 500}`;
          if (!b2csMap[key]) {
            b2csMap[key] = {
              placeOfSupply: pos,
              rateBasisPoints: igst > 0 ? 1800 : 500,
              taxableValuePaise: 0,
              cgstPaise: 0,
              sgstPaise: 0,
              igstPaise: 0,
            };
          }
          b2csMap[key].taxableValuePaise += taxable;
          b2csMap[key].cgstPaise += cgst;
          b2csMap[key].sgstPaise += sgst;
          b2csMap[key].igstPaise += igst;
        }
      }

      // Fetch Invoice Lines for HSN Summary
      const linesCur = rawSql.exec(
        `SELECT il.*, i.hsn_sac, i.name as item_name, u.code as unit_code ` +
          `FROM invoice_lines il ` +
          `LEFT JOIN items i ON il.item_id = i.id ` +
          `LEFT JOIN units u ON i.unit_id = u.id`,
      );

      for (const line of linesCur) {
        const hsn = line.hsn_sac || '9983'; // default SAC
        const qty = Number(line.quantity_thousandths || 1000);
        const taxable = Number(line.taxable_amount_paise || line.total_paise || 0);
        const cgst = Number(line.cgst_paise || 0);
        const sgst = Number(line.sgst_paise || 0);
        const igst = Number(line.igst_paise || 0);
        const total = Number(line.total_paise || taxable + cgst + sgst + igst);

        if (!hsnMap[hsn]) {
          hsnMap[hsn] = {
            hsnSac: hsn,
            description: line.item_name || 'Goods/Services',
            uqc: line.unit_code || 'PCS',
            totalQuantityThousandths: 0,
            totalValuePaise: 0,
            taxableValuePaise: 0,
            cgstPaise: 0,
            sgstPaise: 0,
            igstPaise: 0,
            cessPaise: 0,
          };
        }
        hsnMap[hsn].totalQuantityThousandths += qty;
        hsnMap[hsn].totalValuePaise += total;
        hsnMap[hsn].taxableValuePaise += taxable;
        hsnMap[hsn].cgstPaise += cgst;
        hsnMap[hsn].sgstPaise += sgst;
        hsnMap[hsn].igstPaise += igst;
      }

      // Documents summary
      const docCountCur = rawSql.exec(`SELECT count(*) as cnt FROM invoices`);
      const row = docCountCur.next();
      const count = Number(row.value?.cnt || 0);
      docsIssued.push({
        docType: 'Tax Invoices',
        series: 'INV/26-27/',
        fromNo: 'INV/26-27/0001',
        toNo: `INV/26-27/${String(count).padStart(4, '0')}`,
        totalNumber: count,
        cancelledNumber: 0,
      });
    }

    const b2cs = Object.values(b2csMap).map((b) => ({
      type: 'OE' as const,
      ...b,
    }));

    return {
      returnPeriod,
      gstin: '19AABCU9603R1ZK',
      legalName: 'Gexart Technologies',
      b2b,
      b2cl: [],
      b2cs,
      cdnr: [],
      hsnSummary: Object.values(hsnMap),
      docsIssued,
      totals: {
        totalTaxablePaise,
        totalCgstPaise,
        totalSgstPaise,
        totalIgstPaise,
        totalValuePaise,
      },
    };
  }

  // 4. Receivables & Payables Aging Buckets
  async getAgingReport(type: 'RECEIVABLES' | 'PAYABLES'): Promise<AgingBucketRow[]> {
    const rawSql = this.getSql();
    const rows: AgingBucketRow[] = [];
    if (!rawSql?.exec) return rows;

    const todayMs = Date.now();

    if (type === 'RECEIVABLES') {
      // Receivables: group unpaid/partial invoices by customer party
      const cur = rawSql.exec(
        `SELECT i.party_id, i.party_name, p.phone, i.due_date, i.date as invoice_date, i.balance_amount_paise ` +
          `FROM invoices i ` +
          `JOIN parties p ON p.id = i.party_id ` +
          `WHERE i.status IN ('UNPAID', 'PARTIALLY_PAID', 'OVERDUE') AND i.balance_amount_paise > 0 AND i.deleted_at IS NULL`,
      );

      const partyMap = new Map<string, {
        partyId: string;
        partyName: string;
        phone: string;
        totalOutstandingPaise: number;
        bucket0to30Paise: number;
        bucket31to60Paise: number;
        bucket61to90Paise: number;
        bucket90PlusPaise: number;
      }>();

      for (const row of cur) {
        const bal = Number(row.balance_amount_paise || 0);
        if (bal <= 0) continue;

        const effectiveDate = new Date(row.due_date || row.invoice_date).getTime();
        const daysPast = Math.max(0, Math.floor((todayMs - effectiveDate) / (1000 * 60 * 60 * 24)));

        let entry = partyMap.get(row.party_id);
        if (!entry) {
          entry = {
            partyId: row.party_id,
            partyName: row.party_name,
            phone: row.phone || '',
            totalOutstandingPaise: 0,
            bucket0to30Paise: 0,
            bucket31to60Paise: 0,
            bucket61to90Paise: 0,
            bucket90PlusPaise: 0,
          };
          partyMap.set(row.party_id, entry);
        }

        entry.totalOutstandingPaise += bal;
        if (daysPast <= 30) {
          entry.bucket0to30Paise += bal;
        } else if (daysPast <= 60) {
          entry.bucket31to60Paise += bal;
        } else if (daysPast <= 90) {
          entry.bucket61to90Paise += bal;
        } else {
          entry.bucket90PlusPaise += bal;
        }
      }

      return Array.from(partyMap.values());
    } else {
      // Payables: group unpaid/partial purchase bills by vendor party
      const cur = rawSql.exec(
        `SELECT pb.party_id, p.name as party_name, p.phone, pb.due_date, pb.date as bill_date, (pb.total_paise - pb.paid_amount_paise) as balance_amount_paise ` +
          `FROM purchase_bills pb ` +
          `JOIN parties p ON p.id = pb.party_id ` +
          `WHERE pb.status IN ('UNPAID', 'PARTIALLY_PAID', 'OVERDUE') AND (pb.total_paise - pb.paid_amount_paise) > 0`,
      );

      const partyMap = new Map<string, {
        partyId: string;
        partyName: string;
        phone: string;
        totalOutstandingPaise: number;
        bucket0to30Paise: number;
        bucket31to60Paise: number;
        bucket61to90Paise: number;
        bucket90PlusPaise: number;
      }>();

      for (const row of cur) {
        const bal = Number(row.balance_amount_paise || 0);
        if (bal <= 0) continue;

        const effectiveDate = new Date(row.due_date || row.bill_date).getTime();
        const daysPast = Math.max(0, Math.floor((todayMs - effectiveDate) / (1000 * 60 * 60 * 24)));

        let entry = partyMap.get(row.party_id);
        if (!entry) {
          entry = {
            partyId: row.party_id,
            partyName: row.party_name,
            phone: row.phone || '',
            totalOutstandingPaise: 0,
            bucket0to30Paise: 0,
            bucket31to60Paise: 0,
            bucket61to90Paise: 0,
            bucket90PlusPaise: 0,
          };
          partyMap.set(row.party_id, entry);
        }

        entry.totalOutstandingPaise += bal;
        if (daysPast <= 30) {
          entry.bucket0to30Paise += bal;
        } else if (daysPast <= 60) {
          entry.bucket31to60Paise += bal;
        } else if (daysPast <= 90) {
          entry.bucket61to90Paise += bal;
        } else {
          entry.bucket90PlusPaise += bal;
        }
      }

      return Array.from(partyMap.values());
    }
  }
}
