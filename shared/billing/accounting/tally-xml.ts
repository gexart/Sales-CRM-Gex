/**
 * Tally ERP 9 / TallyPrime XML Exporter
 * Generates XML for Masters (Ledgers) and Vouchers (Sales, Purchase, Journal, Payment, Receipt, Contra)
 */

export interface TallyLedgerMaster {
  name: string;
  groupName: string; // e.g. "Sundry Debtors", "Sundry Creditors", "Direct Incomes", "Bank Accounts"
  openingBalancePaise?: number;
  isDebit?: boolean;
}

export interface TallyVoucherEntry {
  ledgerName: string;
  isDebit: boolean;
  amountPaise: number;
}

export interface TallyVoucher {
  voucherType: 'Sales' | 'Purchase' | 'Journal' | 'Payment' | 'Receipt' | 'Contra';
  voucherNo: string;
  date: string; // YYYY-MM-DD
  narration?: string;
  entries: TallyVoucherEntry[];
}

/**
 * Converts YYYY-MM-DD to Tally format YYYYMMDD
 */
export function formatTallyDate(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

/**
 * Escapes XML entities
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates Tally XML Envelope
 */
export function generateTallyXml(params: {
  companyName: string;
  ledgers?: TallyLedgerMaster[];
  vouchers?: TallyVoucher[];
}): string {
  const parts: string[] = [];

  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push('<ENVELOPE>');
  parts.push('  <HEADER>');
  parts.push('    <TALLYREQUEST>Import Data</TALLYREQUEST>');
  parts.push('  </HEADER>');
  parts.push('  <BODY>');
  parts.push('    <IMPORTDATA>');
  parts.push('      <REQUESTDESC>');
  parts.push('        <REPORTNAME>All Masters and Vouchers</REPORTNAME>');
  parts.push('        <STATICVARIABLES>');
  parts.push(`          <SVCURRENTCOMPANY>${escapeXml(params.companyName)}</SVCURRENTCOMPANY>`);
  parts.push('        </STATICVARIABLES>');
  parts.push('      </REQUESTDESC>');
  parts.push('      <REQUESTDATA>');

  // 1. Ledgers
  if (params.ledgers && params.ledgers.length > 0) {
    for (const l of params.ledgers) {
      parts.push('        <TALLYMESSAGE xmlns:UDF="TallyUDF">');
      parts.push(`          <LEDGER NAME="${escapeXml(l.name)}" ACTION="Create">`);
      parts.push(`            <NAME.LIST><NAME>${escapeXml(l.name)}</NAME></NAME.LIST>`);
      parts.push(`            <PARENT>${escapeXml(l.groupName)}</PARENT>`);
      if (l.openingBalancePaise && l.openingBalancePaise > 0) {
        const amt = (l.openingBalancePaise / 100).toFixed(2);
        const signedAmt = l.isDebit ? `-${amt}` : amt;
        parts.push(`            <OPENINGBALANCE>${signedAmt}</OPENINGBALANCE>`);
      }
      parts.push('          </LEDGER>');
      parts.push('        </TALLYMESSAGE>');
    }
  }

  // 2. Vouchers
  if (params.vouchers && params.vouchers.length > 0) {
    for (const v of params.vouchers) {
      parts.push('        <TALLYMESSAGE xmlns:UDF="TallyUDF">');
      parts.push(`          <VOUCHER VCHTYPE="${v.voucherType}" ACTION="Create">`);
      parts.push(`            <DATE>${formatTallyDate(v.date)}</DATE>`);
      parts.push(`            <VOUCHERTYPENAME>${v.voucherType}</VOUCHERTYPENAME>`);
      parts.push(`            <VOUCHERNUMBER>${escapeXml(v.voucherNo)}</VOUCHERNUMBER>`);
      if (v.narration) {
        parts.push(`            <NARRATION>${escapeXml(v.narration)}</NARRATION>`);
      }

      for (const entry of v.entries) {
        // In Tally XML:
        // Debits are represented with ISDEEMEDPOSITIVE = Yes, and negative amount (e.g. -1180.00)
        // Credits are represented with ISDEEMEDPOSITIVE = No, and positive amount (e.g. 1180.00)
        const amt = (entry.amountPaise / 100).toFixed(2);
        parts.push('            <ALLLEDGERENTRIES.LIST>');
        parts.push(`              <LEDGERNAME>${escapeXml(entry.ledgerName)}</LEDGERNAME>`);
        parts.push(`              <ISDEEMEDPOSITIVE>${entry.isDebit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>`);
        parts.push(`              <AMOUNT>${entry.isDebit ? `-${amt}` : amt}</AMOUNT>`);
        parts.push('            </ALLLEDGERENTRIES.LIST>');
      }

      parts.push('          </VOUCHER>');
      parts.push('        </TALLYMESSAGE>');
    }
  }

  parts.push('      </REQUESTDATA>');
  parts.push('    </IMPORTDATA>');
  parts.push('  </BODY>');
  parts.push('</ENVELOPE>');

  return parts.join('\n');
}
