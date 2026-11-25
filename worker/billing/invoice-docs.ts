// Invoices, proforma invoices and quotations as PDF and Word on the Gexart letterhead.
import { PDFDocument, StandardFonts } from "pdf-lib";
import { LETTERHEAD, LOGO_PNG_BASE64, resolvePhone } from "../../shared/letterhead";
import { INK, LINE, M, MUTED, W, pdfSafe } from "../lib/pdf";
import { LH_GRAY, LH_INK, LH_ORANGE, LetterheadWriter, TINT, WHITE, drawFooter, spaced, type Color } from "../lib/letterhead-pdf";
import { CONTENT_W, GRAY, INK as INK_HEX, MUTED as MUTED_HEX, ORANGE, TINT as TINT_HEX, label, para, run, spacer, table, text, wrapInLetterhead, type Cell } from "../lib/audit-docx";

export interface DocLine { n: number; name: string; hsn: string; qty: string; rate: string; disc: string; gst: string; amount: string }
export interface DocTotal { label: string; value: string; strong?: boolean }
export interface InvoiceDoc {
  kind: string; // "TAX INVOICE", "PROFORMA INVOICE", "QUOTATION"…
  no: string;
  date: string;
  dueLabel?: string; // "Due" or "Valid until"
  due?: string;
  status?: string;
  party: { name: string; gstin?: string | null; phone?: string | null; address?: string | null };
  seller?: { gstin?: string | null; address?: string | null } | null;
  lines: DocLine[];
  totals: DocTotal[];
  words?: string | null;
  notes?: string | null;
  terms?: string | null;
  payNote?: string | null;
  phone?: string | null;
}

const rs = (paise: number | null | undefined) => `Rs. ${((paise ?? 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const d8 = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
const num = (n: number) => String(Math.round(n * 1000) / 1000);

type L = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Turns an invoice or a trade document (as the billing engine returns it) into one printable model. */
export function buildInvoiceDoc(inv: L, kind: string, opts: { phone?: string | null } = {}): InvoiceDoc {
  const lines: L[] = inv.lines ?? [];
  const cgst = lines.reduce((a, l) => a + (l.cgst_amount_paise ?? 0), 0) || (inv.cgst_paise ?? 0);
  const sgst = lines.reduce((a, l) => a + (l.sgst_amount_paise ?? 0), 0) || (inv.sgst_paise ?? 0);
  const igst = lines.reduce((a, l) => a + (l.igst_amount_paise ?? 0), 0) || (inv.igst_paise ?? 0);
  const cess = lines.reduce((a, l) => a + (l.cess_amount_paise ?? 0), 0) || (inv.cess_paise ?? 0);
  const totals: DocTotal[] = [{ label: "Subtotal", value: rs(inv.subtotal_paise) }];
  if (inv.discount_paise) totals.push({ label: "Discount", value: `- ${rs(inv.discount_paise)}` });
  if (cgst || sgst) totals.push({ label: "CGST", value: rs(cgst) }, { label: "SGST", value: rs(sgst) });
  if (igst) totals.push({ label: "IGST", value: rs(igst) });
  if (cess) totals.push({ label: "Cess", value: rs(cess) });
  if (!cgst && !sgst && !igst && inv.tax_total_paise) totals.push({ label: "GST", value: rs(inv.tax_total_paise) });
  if (inv.round_off_paise) totals.push({ label: "Round off", value: rs(inv.round_off_paise) });
  totals.push({ label: "Total", value: rs(inv.total_paise), strong: true });
  if (inv.paid_amount_paise) totals.push({ label: "Received", value: rs(inv.paid_amount_paise) });
  if (inv.balance_amount_paise !== undefined) totals.push({ label: inv.balance_amount_paise > 0 ? "Balance due" : "Balance", value: rs(inv.balance_amount_paise), strong: true });
  return {
    kind,
    no: inv.invoice_no ?? inv.doc_no,
    date: d8(inv.date),
    dueLabel: inv.due_date ? "Due" : inv.valid_until ? "Valid until" : undefined,
    due: d8(inv.due_date ?? inv.valid_until),
    status: inv.status,
    party: { name: inv.party_name, gstin: inv.party_gstin, phone: inv.party_phone, address: inv.party_address ?? inv.shipping_address },
    seller: inv.branch ? { gstin: inv.branch.gstin, address: inv.branch.address } : null,
    lines: lines.map((l, i) => ({
      n: i + 1,
      name: l.name,
      hsn: l.hsn_sac ?? "",
      qty: num((l.quantity_thousandths ?? 0) / 1000),
      rate: rs(l.unit_price_paise),
      disc: l.discount_paise ? rs(l.discount_paise) : "-",
      gst: `${(l.tax_rate_basis_points ?? 0) / 100}%`,
      amount: rs(l.line_total_paise),
    })),
    totals,
    words: inv.amountInWords,
    notes: inv.notes,
    terms: inv.terms,
    payNote: inv.balance_amount_paise > 0 ? "Please pay by the due date. UPI, bank transfer and cash are accepted. Quote the invoice number with your payment." : null,
    phone: opts.phone,
  };
}

export async function renderInvoicePdf(d: InvoiceDoc): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`${d.kind} ${d.no} - ${d.party.name}`));
  doc.setAuthor(LETTERHEAD.company);
  doc.setCreator("Sales CRM");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new LetterheadWriter(doc, font, bold);
  w.phone = resolvePhone(d.phone);
  w.logo = await doc.embedPng(Uint8Array.from(atob(LOGO_PNG_BASE64), (ch) => ch.charCodeAt(0)));
  const box = (x: number, top: number, bw: number, bh: number, color: Color) => w.page.drawRectangle({ x, y: top - bh, width: bw, height: bh, color });
  const txt = (s: string, x: number, top: number, size: number, f = font, color: Color = INK) => w.page.drawText(pdfSafe(s), { x, y: top - size, size, font: f, color });
  const right = (s: string, xr: number, top: number, size: number, f = font, color: Color = INK) => w.page.drawText(pdfSafe(s), { x: xr - f.widthOfTextAtSize(pdfSafe(s), size), y: top - size, size, font: f, color });

  w.newPage();
  txt(spaced(d.kind), M, w.y, 8.5, bold, LH_ORANGE);
  txt(d.no, M, w.y - 14, 24, bold, LH_INK);
  right(d.date, W - M, w.y - 2, 9.5, bold, LH_INK);
  right("Date", W - M, w.y - 14, 7.5, bold, MUTED);
  if (d.due) {
    right(`${d.dueLabel}: ${d.due}`, W - M, w.y - 26, 9, font, LH_GRAY);
  }
  if (d.status) right(d.status, W - M, w.y - 38, 8.5, bold, LH_ORANGE);
  w.y -= 52;

  // Bill to
  const lines = [d.party.name, d.party.gstin ? `GSTIN: ${d.party.gstin}` : "", d.party.phone ?? "", ...(d.party.address ? w.wrap(d.party.address, 9, 250) : [])].filter(Boolean);
  const bh = 22 + lines.length * 12;
  box(M, w.y, W - 2 * M, bh, TINT);
  box(M, w.y, 4, bh, LH_ORANGE);
  txt("BILLED TO", M + 14, w.y - 8, 7, bold, MUTED);
  lines.forEach((l, i) => txt(l, M + 14, w.y - 20 - i * 12, i === 0 ? 11 : 9, i === 0 ? bold : font, i === 0 ? LH_INK : LH_GRAY));
  if (d.seller?.gstin) {
    right("OUR GSTIN", W - M - 10, w.y - 8, 7, bold, MUTED);
    right(d.seller.gstin, W - M - 10, w.y - 20, 9.5, bold, LH_INK);
  }
  w.y -= bh + 14;

  // Items table
  const cols = [{ k: "n", w: 20, r: false }, { k: "name", w: 148, r: false }, { k: "hsn", w: 50, r: false }, { k: "qty", w: 32, r: true }, { k: "rate", w: 70, r: true }, { k: "disc", w: 50, r: true }, { k: "gst", w: 34, r: true }, { k: "amount", w: 0, r: true }] as const;
  const total = W - 2 * M;
  const fixed = cols.reduce((a, c) => a + c.w, 0);
  const widths = cols.map((c) => (c.w === 0 ? total - fixed : c.w));
  const head = () => {
    w.ensure(60);
    box(M, w.y, total, 18, LH_INK);
    let x = M;
    cols.forEach((c, i) => {
      const t = { n: "#", name: "Item", hsn: "HSN/SAC", qty: "Qty", rate: "Rate", disc: "Disc.", gst: "GST", amount: "Amount" }[c.k];
      if (c.r) right(t, x + widths[i]! - 5, w.y - 5.5, 7.5, bold, WHITE);
      else txt(t, x + 5, w.y - 5.5, 7.5, bold, WHITE);
      x += widths[i]!;
    });
    w.y -= 18;
  };
  head();
  d.lines.forEach((l, idx) => {
    const nameLines = w.wrap(l.name, 9, widths[1]! - 10, bold);
    const h = Math.max(20, nameLines.length * 11.5 + 9);
    if (w.y - h < M + 70) {
      w.newPage();
      head();
    }
    if (idx % 2 === 0) box(M, w.y, total, h, TINT);
    let x = M;
    cols.forEach((c, i) => {
      if (c.k === "name") nameLines.forEach((nl, j) => txt(nl, x + 5, w.y - 5 - j * 11.5, 9, bold, LH_INK));
      else {
        const v = String(l[c.k as keyof DocLine]);
        if (c.r) right(v, x + widths[i]! - 5, w.y - 5, 8.5, font, INK);
        else txt(v, x + 5, w.y - 5, 8.5, font, INK);
      }
      x += widths[i]!;
    });
    w.y -= h;
  });
  w.page.drawRectangle({ x: M, y: w.y, width: total, height: 0.6, color: LINE });
  w.y -= 12;

  // Totals (right aligned)
  const tw = 220;
  const tx = W - M - tw;
  d.totals.forEach((t) => {
    w.ensure(22);
    if (t.strong) box(tx - 6, w.y + 2, tw + 6, 19, TINT);
    txt(t.label, tx, w.y - 3, t.strong ? 10 : 9, t.strong ? bold : font, t.strong ? LH_INK : LH_GRAY);
    right(t.value, W - M - 4, w.y - 3, t.strong ? 10.5 : 9, t.strong ? bold : font, LH_INK);
    w.y -= t.strong ? 21 : 15;
  });
  w.y -= 6;
  if (d.words) w.text(d.words, { size: 9, font: bold, color: LH_GRAY, gap: 8 });
  if (d.notes) (w.text("NOTES", { size: 7, font: bold, color: MUTED, gap: 1 }), w.text(d.notes, { size: 9, gap: 6 }));
  if (d.payNote) w.text(d.payNote, { size: 8.5, color: MUTED, gap: 6 });
  if (d.terms) (w.text("TERMS", { size: 7, font: bold, color: MUTED, gap: 1 }), w.text(d.terms, { size: 8.5, color: MUTED, gap: 6 }));
  w.ensure(50);
  w.y -= 18;
  right("For Gexart Technologies", W - M, w.y, 9, bold, LH_INK);
  right("Authorised signatory", W - M, w.y - 44, 8, font, MUTED);
  w.page.drawRectangle({ x: W - M - 140, y: w.y - 38, width: 140, height: 0.5, color: LINE });
  w.text("This is a computer-generated document.", { size: 7.5, color: MUTED });

  w.pages.forEach((pg, i) => drawFooter(pg, font, i + 1, w.pages.length));
  return doc.save();
}

export async function renderInvoiceDocx(d: InvoiceDoc): Promise<Uint8Array> {
  const W_ = CONTENT_W;
  let b = "";
  b += para(run(d.kind.toUpperCase(), { b: true, sz: 17, color: ORANGE, spacing: 40 }), { before: 120, after: 40 });
  b += para(run(d.no, { b: true, sz: 48 }), { after: 40, line: 240 });
  b += text(`${d.date}${d.due ? `   ·   ${d.dueLabel}: ${d.due}` : ""}${d.status ? `   ·   ${d.status}` : ""}`, { sz: 19, color: MUTED_HEX, after: 160 });
  let bill = para(label("Billed to"), { after: 20 }) + para(run(d.party.name, { b: true, sz: 24 }), { after: 20 });
  for (const t of [d.party.gstin ? `GSTIN: ${d.party.gstin}` : "", d.party.phone ?? "", d.party.address ?? ""].filter(Boolean)) bill += para(run(t, { sz: 19, color: GRAY }), { after: 10 });
  b += table([W_], [[{ w: W_, fill: TINT_HEX, leftBar: ORANGE, pad: 150, content: bill }]]);
  b += spacer(160);
  const cw = [450, 3300, 1100, 800, 1450, 1150, 700, W_ - 8950];
  const head = (t: string, wd: number, r = false): Cell => ({ w: wd, fill: INK_HEX, pad: 80, content: para(run(t, { b: true, sz: 16, color: "FFFFFF" }), { after: 0, jc: r ? "right" : undefined }) });
  const c = (wd: number, t: string, i: number, o: { b?: boolean; r?: boolean } = {}): Cell => ({ w: wd, fill: i % 2 === 0 ? TINT_HEX : undefined, pad: 80, content: para(run(t, { sz: 18, b: o.b }), { after: 0, jc: o.r ? "right" : undefined }) });
  b += table(cw, [
    [head("#", cw[0]!), head("Item", cw[1]!), head("HSN/SAC", cw[2]!), head("Qty", cw[3]!, true), head("Rate", cw[4]!, true), head("Disc.", cw[5]!, true), head("GST", cw[6]!, true), head("Amount", cw[7]!, true)],
    ...d.lines.map((l, i): Cell[] => [c(cw[0]!, String(l.n), i), c(cw[1]!, l.name, i, { b: true }), c(cw[2]!, l.hsn, i), c(cw[3]!, l.qty, i, { r: true }), c(cw[4]!, l.rate, i, { r: true }), c(cw[5]!, l.disc, i, { r: true }), c(cw[6]!, l.gst, i, { r: true }), c(cw[7]!, l.amount, i, { r: true, b: true })]),
  ]);
  b += spacer(100);
  const tl = W_ - 3600;
  b += table([tl, 1900, 1700], d.totals.map((t): Cell[] => [
    { w: tl, pad: 60, content: "<w:p/>" },
    { w: 1900, pad: 60, content: para(run(t.label, { b: t.strong, sz: t.strong ? 21 : 18, color: t.strong ? INK_HEX : GRAY }), { after: 0 }) },
    { w: 1700, pad: 60, fill: t.strong ? TINT_HEX : undefined, content: para(run(t.value, { b: t.strong, sz: t.strong ? 21 : 18 }), { after: 0, jc: "right" }) },
  ]));
  b += spacer(100);
  if (d.words) b += text(d.words, { b: true, sz: 18, color: GRAY });
  if (d.notes) b += text(`Notes: ${d.notes}`, { sz: 18 });
  if (d.payNote) b += text(d.payNote, { sz: 17, color: MUTED_HEX });
  if (d.terms) b += text(`Terms: ${d.terms}`, { sz: 17, color: MUTED_HEX });
  b += para(run("For Gexart Technologies", { b: true, sz: 19 }), { before: 360, after: 480, jc: "right" });
  b += para(run("Authorised signatory", { sz: 16, color: MUTED_HEX }), { after: 0, jc: "right" });
  return wrapInLetterhead(b, d.phone);
}

// ─── "Classic black" template ───────────────────────────────────────────────────────────────────────────────────────
import { getStateByCode, normalizeBillingSettings } from "@billing/shared";
import { BRAND_LOGO } from "./brand-logo";
import { renderClassicInvoicePdf, type ClassicDoc } from "./invoice-classic";

export interface ClassicContext {
  settings: ReturnType<typeof normalizeBillingSettings>;
  bank?: L | null;
  units: L[];
  party?: L | null;
}

const plain = (paise: number) => ((paise ?? 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");
const addrLines = (a?: string | null) => String(a ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);


const inrs = (paise: number) => `₹${plain(paise)}`;

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const below100 = (n: number) => (n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ""}`);
const below1000 = (n: number) => (n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` And ${below100(n % 100)}` : ""}` : below100(n));
/** Indian-style words, in the form the old invoices used: "Forty-Two Thousand, Five Hundred And Ninety-One Rupees Only." */
export function inrWords(paise: number): string {
  const rupees = Math.floor(Math.abs(paise) / 100);
  const ps = Math.abs(paise) % 100;
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1000);
  const rest = rupees % 1000;
  if (crore) parts.push(`${below100(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  const words = parts.length ? parts.join(", ") : "Zero";
  return `${words} Rupees${ps ? ` And ${below100(ps)} Paise` : ""} Only.`;
}

export function buildClassicDoc(inv: L, kind: string, ctx: ClassicContext): ClassicDoc {
  const s = ctx.settings;
  const branch: L = inv.branch ?? {};
  const lines: L[] = inv.lines ?? [];
  const unitOf = (id?: string) => {
    const u = ctx.units.find((x) => x.id === id);
    return String(u?.symbol || u?.code || u?.name || "").toUpperCase();
  };
  // Per line: taxable value and tax, from the stored amounts when present, else worked out from the rate.
  const calc = lines.map((l) => {
    const hasSplit = l.cgst_amount_paise !== undefined || l.igst_amount_paise !== undefined;
    const rate = (l.tax_rate_basis_points ?? 0) / 10000;
    let cgst = l.cgst_amount_paise ?? 0,
      sgst = l.sgst_amount_paise ?? 0,
      igst = l.igst_amount_paise ?? 0;
    const cess = l.cess_amount_paise ?? 0;
    let taxable: number;
    if (hasSplit) {
      // Exclusive pricing: show the exact quantity x rate (no stray paisa from tax rounding); otherwise back it out of the line total.
      const gross = Math.round(((l.quantity_thousandths ?? 0) * (l.unit_price_paise ?? 0)) / 1000) - (l.discount_paise ?? 0);
      const derived = (l.line_total_paise ?? 0) - cgst - sgst - igst - cess;
      taxable = Math.abs(gross - derived) <= 2 ? gross : derived;
    }
    else {
      const gross = Math.round(((l.quantity_thousandths ?? 0) * (l.unit_price_paise ?? 0)) / 1000) - (l.discount_paise ?? 0);
      const incl = Math.abs((l.line_total_paise ?? 0) - gross) > 1;
      taxable = incl ? Math.round((l.line_total_paise ?? 0) / (1 + rate)) : gross;
      const tax = incl ? (l.line_total_paise ?? 0) - taxable : Math.round(gross * rate);
      if ((inv.igst_paise ?? 0) > 0) igst = tax;
      else {
        cgst = Math.floor(tax / 2);
        sgst = tax - cgst;
      }
    }
    return { l, taxable, cgst, sgst, igst, cess, rate: l.tax_rate_basis_points ?? 0 };
  });
  const sum = (k: "taxable" | "cgst" | "sgst" | "igst" | "cess") => calc.reduce((a, c) => a + c[k], 0);
  const interstate = sum("igst") > 0;
  const rates = [...new Set(calc.map((c) => c.rate))];
  const pctLabel = (half: boolean) => (rates.length === 1 ? ` ${(rates[0]! / 100 / (half ? 2 : 1)).toFixed(1)}%` : "");

  const totals: ClassicDoc["totals"] = [{ label: "Taxable Amount", value: inrs(sum("taxable")) }];
  if (inv.discount_paise) totals.unshift({ label: "Discount", value: `- ${inrs(inv.discount_paise)}` });
  if (interstate) totals.push({ label: `IGST${pctLabel(false)}`, value: inrs(sum("igst")) });
  else totals.push({ label: `CGST${pctLabel(true)}`, value: inrs(sum("cgst")) }, { label: `SGST${pctLabel(true)}`, value: inrs(sum("sgst")) });
  if (sum("cess")) totals.push({ label: "Cess", value: inrs(sum("cess")) });
  if (inv.round_off_paise) totals.push({ label: "Round Off", value: plain(inv.round_off_paise) });
  totals.push({ label: "Total", value: inrs(inv.total_paise), strong: true });

  // HSN / SAC summary grouped by code and rate
  const groups = new Map<string, { hsn: string; rate: number; taxable: number; cgst: number; sgst: number; igst: number }>();
  for (const c of calc) {
    const key = `${c.l.hsn_sac ?? ""}|${c.rate}`;
    const g = groups.get(key) ?? { hsn: c.l.hsn_sac || "-", rate: c.rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    g.taxable += c.taxable;
    g.cgst += c.cgst;
    g.sgst += c.sgst;
    g.igst += c.igst;
    groups.set(key, g);
  }
  const g = [...groups.values()];
  const pc = (r: number, half: boolean) => `${r / 100 / (half ? 2 : 1)}%`;
  let hsn: ClassicDoc["hsn"] = null;
  if (s.preferences.showHsnSummary && g.length) {
    hsn = interstate
      ? { head: ["HSN/SAC", "Taxable Value", "Integrated Tax", "Amount", "", "", "Total Tax"], rows: g.map((x) => [x.hsn, plain(x.taxable), pc(x.rate, false), plain(x.igst), "", "", plain(x.igst)]), total: ["TOTAL", plain(sum("taxable")), "", plain(sum("igst")), "", "", plain(sum("igst"))] }
      : { head: ["HSN/SAC", "Taxable Value", "Central Tax", "Amount", "State Tax", "Amount", "Total Tax"], rows: g.map((x) => [x.hsn, plain(x.taxable), pc(x.rate, true), plain(x.cgst), pc(x.rate, true), plain(x.sgst), plain(x.cgst + x.sgst)]), total: ["TOTAL", plain(sum("taxable")), "", plain(sum("cgst")), "", plain(sum("sgst")), plain(sum("cgst") + sum("sgst"))] };
  }

  const qtyTotal = lines.reduce((a, l) => a + (l.quantity_thousandths ?? 0) / 1000, 0);
  const st = getStateByCode(String(inv.party_state_code ?? branch.state_code ?? ""));
  const company = {
    name: s.company.legalName || branch.name || "Gexart",
    gstin: branch.gstin ?? null,
    addressLines: addrLines(branch.address),
    mobile: s.company.mobile || branch.phone || null,
    email: s.company.email || null,
    website: s.company.website || null,
    logoDataUrl: BRAND_LOGO,
  };
  const bank = ctx.bank
    ? { bank: String(ctx.bank.name ?? ""), account: String(ctx.bank.accountNumber ?? ctx.bank.account_number ?? ""), ifsc: String(ctx.bank.ifsc ?? ""), branch: String(ctx.bank.branch ?? ""), beneficiary: company.name, type: "Current" }
    : null;
  const upi = ctx.bank?.upiId ?? ctx.bank?.upi_id;
  const balance = inv.balance_amount_paise ?? 0;
  const pickedSig = s.branding.signatures.find((x) => x.name === inv.signatory_name) ?? s.branding.signatures[0];
  const dueMeta: Array<[string, string]> = s.preferences.showDueDate && (inv.due_date || inv.valid_until) ? [[inv.due_date ? "Due Date" : "Valid Until", longDate(inv.due_date ?? inv.valid_until)]] : [];
  const numLabel = kind.toUpperCase().includes("QUOTATION") ? "Quotation #" : kind.toUpperCase().includes("PROFORMA") ? "Proforma #" : "Invoice #";
  return {
    title: kind,
    copyLabel: s.preferences.copyLabel === "NONE" ? "" : s.preferences.copyLabel,
    company,
    party: { name: inv.party_name, company: ctx.party?.company ?? null, gstin: inv.party_gstin, addressLines: addrLines(inv.party_address ?? ctx.party?.billingAddress), phone: inv.party_phone },
    meta: [[numLabel, String(inv.invoice_no ?? inv.doc_no)], ["Invoice Date", longDate(inv.date)], ...dueMeta, ["Place of Supply", st ? `${st.code}-${st.name.toUpperCase()}` : String(inv.party_state_code ?? "")]],
    lines: lines.map((l, i) => ({ n: i + 1, name: l.name, hsn: l.hsn_sac ?? "", rate: plain(l.unit_price_paise), qty: num((l.quantity_thousandths ?? 0) / 1000), unit: unitOf(l.unit_id), amount: plain(calc[i]!.taxable) })),
    totals,
    itemCountLine: `Total Items / Qty : ${lines.length} / ${num(qtyTotal)}`,
    words: s.preferences.showAmountInWords ? `INR ${inrWords(inv.total_paise ?? 0)}` : null,
    payment: inv.status === "CANCELLED" || inv.balance_amount_paise === undefined ? null : { fullyPaid: balance <= 0, balance: balance > 0 ? inrs(balance) : null, paid: balance > 0 && (inv.paid_amount_paise ?? 0) > 0 ? inrs(inv.paid_amount_paise) : null },
    hsn,
    upiLink: upi && s.preferences.showUpiOnInvoice && balance > 0 ? `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(company.name)}&am=${(balance / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(String(inv.invoice_no ?? ""))}` : null,
    bank: s.preferences.showBankOnInvoice ? bank : null,
    signature: { forCompany: company.name.toUpperCase(), dataUrl: pickedSig?.signature || s.branding.signature || null, stampDataUrl: pickedSig?.stamp || null, name: pickedSig?.name || inv.signatory_name || s.branding.signatoryName || null },
    notes: inv.notes || s.notesTerms.INVOICE?.notes || null,
    terms: inv.terms || s.notesTerms.INVOICE?.terms || null,
    footer: s.preferences.footerText || "This is a digitally signed document.",
  };
}

/** One entry point for both routes: picks the template (?template=classic or letterhead, else the saved setting). */
export async function renderDocumentFile(stub: any, inv: L, kind: string, fmt: "pdf" | "docx", template?: string | null): Promise<Uint8Array> {
  const settings = normalizeBillingSettings((await stub.getAllSettings())?.billing_settings);
  const chosen = template || (settings.template.id === "letterhead" ? "letterhead" : "classic");
  if (fmt === "docx" || chosen === "letterhead") {
    const doc = buildInvoiceDoc(inv, kind);
    return fmt === "docx" ? renderInvoiceDocx(doc) : renderInvoicePdf(doc);
  }
  const [bank0, units, party] = await Promise.all([stub.bankForInvoice(inv.bank_account_id || settings.preferences.defaultBankAccountId || undefined), stub.listUnits(), inv.party_id ? stub.getParty(inv.party_id) : null]);
  const bank = bank0;
  return renderClassicInvoicePdf(buildClassicDoc(inv, kind, { settings, bank, units, party }));
}
