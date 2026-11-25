/**
 * Month-wise GST figures worked out from the invoice lines themselves (taxable value = line total minus its taxes), so they always agree with the
 * invoices that were printed. Covers what GSTR-1 asks for (B2B, B2C, HSN, credit notes, documents issued) and an estimate of the GSTR-3B tax to pay.
 */
interface Sql {
  exec(query: string, ...bindings: unknown[]): { toArray(): any[] };
}

type Tax = { taxable: number; cgst: number; sgst: number; igst: number; cess: number };
const zero = (): Tax => ({ taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 });
const add = (a: Tax, b: Tax) => ((a.taxable += b.taxable), (a.cgst += b.cgst), (a.sgst += b.sgst), (a.igst += b.igst), (a.cess += b.cess), a);

export function buildGstSummary(sql: Sql, month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Month must look like 2026-11');
  const rows = sql
    .exec(
      `SELECT i.id AS inv_id, i.invoice_no, i.date, i.total_paise AS inv_total, i.party_name, i.party_gstin, i.party_state_code,
              l.hsn_sac, l.quantity_thousandths, l.tax_rate_basis_points, l.cgst_amount_paise AS cgst, l.sgst_amount_paise AS sgst,
              l.igst_amount_paise AS igst, l.cess_amount_paise AS cess, l.line_total_paise AS line_total
         FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
        WHERE i.deleted_at IS NULL AND i.status != 'CANCELLED' AND substr(i.date, 1, 7) = ? ORDER BY i.date, i.invoice_no`,
      month,
    )
    .toArray();

  const b2b = new Map<string, any>();
  const b2c = new Map<string, any>();
  const hsn = new Map<string, any>();
  const outward = zero();
  const invoicesSeen = new Set<string>();
  for (const r of rows) {
    const cgst = Number(r.cgst), sgst = Number(r.sgst), igst = Number(r.igst), cess = Number(r.cess);
    const taxable = Number(r.line_total) - cgst - sgst - igst - cess;
    const t: Tax = { taxable, cgst, sgst, igst, cess };
    const rate = Number(r.tax_rate_basis_points) / 100;
    add(outward, t);
    invoicesSeen.add(String(r.inv_id));
    const gstin = String(r.party_gstin ?? '').trim();
    if (gstin.length === 15) {
      const k = `${r.invoice_no}|${rate}`;
      const row = b2b.get(k) ?? { gstin, partyName: r.party_name, invoiceNo: r.invoice_no, date: r.date, invoiceValue: Number(r.inv_total), placeOfSupply: r.party_state_code, rate, ...zero() };
      add(row, t);
      b2b.set(k, row);
    } else {
      const k = `${r.party_state_code}|${rate}`;
      const row = b2c.get(k) ?? { placeOfSupply: r.party_state_code, rate, ...zero() };
      add(row, t);
      b2c.set(k, row);
    }
    const hk = `${r.hsn_sac || '-'}|${rate}`;
    const h = hsn.get(hk) ?? { hsn: r.hsn_sac || '-', rate, quantity: 0, value: 0, ...zero() };
    h.quantity += Number(r.quantity_thousandths) / 1000;
    h.value += Number(r.line_total);
    add(h, t);
    hsn.set(hk, h);
  }

  // Credit notes: the tax in a note is the invoice's share of tax, in proportion to the amount credited.
  const notes = sql
    .exec(
      `SELECT n.note_no, n.date, n.total_paise, i.invoice_no, i.party_name, i.party_gstin, i.total_paise AS inv_total, i.tax_total_paise AS inv_tax
         FROM credit_notes n LEFT JOIN invoices i ON i.id = n.invoice_id WHERE n.status = 'ACTIVE' AND substr(n.date, 1, 7) = ? ORDER BY n.date`,
      month,
    )
    .toArray()
    .map((n) => {
      const value = Number(n.total_paise);
      const tax = Number(n.inv_total) > 0 ? Math.round((value * Number(n.inv_tax || 0)) / Number(n.inv_total)) : 0;
      return { noteNo: n.note_no, date: n.date, invoiceNo: n.invoice_no, partyName: n.party_name, gstin: n.party_gstin || '', value, tax, taxable: value - tax };
    });
  const creditTax = notes.reduce((a, n) => a + n.tax, 0);

  // Tax paid on purchases that you can claim back (input tax credit), less debit notes.
  let itc = { cgst: 0, sgst: 0, igst: 0 };
  try {
    const p = sql
      .exec(`SELECT COALESCE(SUM(cgst_paise),0) AS cgst, COALESCE(SUM(sgst_paise),0) AS sgst, COALESCE(SUM(igst_paise),0) AS igst FROM purchase_bills WHERE status != 'CANCELLED' AND substr(date, 1, 7) = ?`, month)
      .toArray()[0];
    itc = { cgst: Number(p?.cgst ?? 0), sgst: Number(p?.sgst ?? 0), igst: Number(p?.igst ?? 0) };
    const d = sql
      .exec(`SELECT COALESCE(SUM(cgst_paise),0) AS cgst, COALESCE(SUM(sgst_paise),0) AS sgst, COALESCE(SUM(igst_paise),0) AS igst FROM debit_notes WHERE substr(date, 1, 7) = ?`, month)
      .toArray()[0];
    itc = { cgst: itc.cgst - Number(d?.cgst ?? 0), sgst: itc.sgst - Number(d?.sgst ?? 0), igst: itc.igst - Number(d?.igst ?? 0) };
  } catch {
    /* no purchase tables yet: no credit to claim */
  }

  const docs = sql
    .exec(`SELECT COUNT(*) AS n, SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled, MIN(invoice_no) AS first_no, MAX(invoice_no) AS last_no FROM invoices WHERE deleted_at IS NULL AND substr(date, 1, 7) = ?`, month)
    .toArray()[0];
  const gstin = String(sql.exec('SELECT gstin FROM branches ORDER BY is_default DESC, created_at LIMIT 1').toArray()[0]?.gstin ?? '');

  const payable = {
    cgst: outward.cgst - itc.cgst,
    sgst: outward.sgst - itc.sgst,
    igst: outward.igst - itc.igst,
  };
  return {
    month,
    gstin,
    invoiceCount: invoicesSeen.size,
    totals: { ...outward, value: [...b2b.values(), ...b2c.values()].reduce((a, r) => a + r.taxable + r.cgst + r.sgst + r.igst + r.cess, 0) },
    b2b: [...b2b.values()],
    b2c: [...b2c.values()],
    hsn: [...hsn.values()].sort((a, b) => String(a.hsn).localeCompare(String(b.hsn))),
    creditNotes: notes,
    documents: { count: Number(docs?.n ?? 0), cancelled: Number(docs?.cancelled ?? 0), from: docs?.first_no ?? '', to: docs?.last_no ?? '' },
    gstr3b: {
      outward,
      creditNoteTax: creditTax,
      itc,
      payable: { ...payable, total: payable.cgst + payable.sgst + payable.igst - creditTax },
    },
    note: 'Worked out from your invoices and purchase bills. Check it with your accountant before filing.',
  };
}
