import { rupeesToPaise } from '../money/conversion';

export interface ParsedBankStatementLine {
  date: string; // ISO YYYY-MM-DD
  description: string;
  referenceNo?: string;
  amountPaise: number;
  type: 'DEBIT' | 'CREDIT';
  balancePaise?: number;
}

export interface BankStatementParseResult {
  bankName?: string;
  accountNumber?: string;
  lines: ParsedBankStatementLine[];
  totalDepositsPaise: number;
  totalWithdrawalsPaise: number;
  openingBalancePaise?: number;
  closingBalancePaise?: number;
}

/**
 * Normalizes Indian date string to YYYY-MM-DD
 */
export function normalizeIndianDate(dateStr: string): string {
  const clean = dateStr.trim().replace(/\//g, '-');
  const parts = clean.split('-');
  if (parts.length === 3) {
    let day = parts[0]!;
    let month = parts[1]!;
    let year = parts[2]!;

    // If year is 2-digit (e.g. 26), expand to 2026
    if (year.length === 2) year = `20${year}`;
    if (day.length === 1) day = `0${day}`;
    if (month.length === 1) month = `0${month}`;

    // If already YYYY-MM-DD
    if (parts[0]!.length === 4) {
      return `${parts[0]}-${parts[1]?.padStart(2, '0')}-${parts[2]?.padStart(2, '0')}`;
    }

    return `${year}-${month}-${day}`;
  }
  return new Date(dateStr).toISOString().split('T')[0] || dateStr;
}

/**
 * Parses numeric currency string (handles commas e.g. "1,50,000.50", "Dr", "Cr", "-")
 */
export function parseCurrencyToPaise(str: string): number {
  if (!str) return 0;
  const clean = str.replace(/₹/g, '').replace(/,/g, '').replace(/[a-zA-Z]/g, '').trim();
  if (!clean || clean === '-' || isNaN(Number(clean))) return 0;
  return rupeesToPaise(clean);
}

/**
 * Universal Indian Bank CSV statement parser (SBI, HDFC, ICICI, Axis, Kotak)
 */
export function parseBankStatementCsv(csvContent: string): BankStatementParseResult {
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { lines: [], totalDepositsPaise: 0, totalWithdrawalsPaise: 0 };
  }

  // Detect bank header
  let headerIndex = -1;
  let detectedBank = 'Unknown Bank';

  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const row = lines[i]!.toLowerCase();
    if (row.includes('hdfc')) detectedBank = 'HDFC Bank';
    else if (row.includes('state bank') || row.includes('sbi')) detectedBank = 'SBI';
    else if (row.includes('icici')) detectedBank = 'ICICI Bank';
    else if (row.includes('axis')) detectedBank = 'Axis Bank';
    else if (row.includes('kotak')) detectedBank = 'Kotak Mahindra Bank';

    if (
      (row.includes('date') || row.includes('txn date') || row.includes('transaction date')) &&
      (row.includes('narration') || row.includes('description') || row.includes('particulars'))
    ) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    // Default to line 0 if no specific header matched
    headerIndex = 0;
  }

  // Split headers
  const headerCols = splitCsvRow(lines[headerIndex]!).map((h) => h.toLowerCase().trim());

  let dateCol = -1;
  let descCol = -1;
  let refCol = -1;
  let debitCol = -1;
  let creditCol = -1;
  let balanceCol = -1;

  headerCols.forEach((col, idx) => {
    if (col.includes('date') && dateCol === -1) dateCol = idx;
    else if (
      (col.includes('narration') || col.includes('description') || col.includes('particulars')) &&
      descCol === -1
    )
      descCol = idx;
    else if (
      (col.includes('chq') ||
        col.includes('cheque') ||
        col.includes('ref') ||
        col.includes('utr') ||
        col.includes('reference')) &&
      refCol === -1
    )
      refCol = idx;
    else if (
      (col.includes('withdrawal') || col.includes('debit') || col.includes('dr')) &&
      debitCol === -1
    )
      debitCol = idx;
    else if (
      (col.includes('deposit') || col.includes('credit') || col.includes('cr')) &&
      creditCol === -1
    )
      creditCol = idx;
    else if (
      (col.includes('balance') || col.includes('closing')) &&
      balanceCol === -1
    )
      balanceCol = idx;
  });

  const parsedLines: ParsedBankStatementLine[] = [];
  let totalDeposits = 0;
  let totalWithdrawals = 0;

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const rawRow = lines[i]!;
    if (!rawRow || rawRow.startsWith('***') || rawRow.toLowerCase().includes('total')) continue;
    const cols = splitCsvRow(rawRow);
    if (cols.length <= Math.max(dateCol, descCol)) continue;

    const rawDate = cols[dateCol]?.trim() || '';
    if (!rawDate || !/\d/.test(rawDate)) continue;

    const date = normalizeIndianDate(rawDate);
    const description = cols[descCol]?.trim() || 'Bank Transaction';
    const referenceNo = refCol !== -1 ? cols[refCol]?.trim() : undefined;

    const debitPaise = debitCol !== -1 ? parseCurrencyToPaise(cols[debitCol] || '') : 0;
    const creditPaise = creditCol !== -1 ? parseCurrencyToPaise(cols[creditCol] || '') : 0;
    const balancePaise = balanceCol !== -1 ? parseCurrencyToPaise(cols[balanceCol] || '') : undefined;

    if (debitPaise > 0) {
      parsedLines.push({
        date,
        description,
        referenceNo,
        amountPaise: debitPaise,
        type: 'DEBIT',
        balancePaise,
      });
      totalWithdrawals += debitPaise;
    } else if (creditPaise > 0) {
      parsedLines.push({
        date,
        description,
        referenceNo,
        amountPaise: creditPaise,
        type: 'CREDIT',
        balancePaise,
      });
      totalDeposits += creditPaise;
    }
  }

  const openingBalancePaise = parsedLines.length > 0 && parsedLines[0]?.balancePaise !== undefined
    ? parsedLines[0].type === 'CREDIT'
      ? parsedLines[0].balancePaise - parsedLines[0].amountPaise
      : parsedLines[0].balancePaise + parsedLines[0].amountPaise
    : undefined;

  const closingBalancePaise = parsedLines.length > 0 ? parsedLines[parsedLines.length - 1]?.balancePaise : undefined;

  return {
    bankName: detectedBank,
    lines: parsedLines,
    totalDepositsPaise: totalDeposits,
    totalWithdrawalsPaise: totalWithdrawals,
    openingBalancePaise,
    closingBalancePaise,
  };
}

function splitCsvRow(row: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    if (char === '"' || char === "'") {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}
