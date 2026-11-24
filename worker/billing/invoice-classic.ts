// "Classic black" invoice (Swipe-style): logo and company block, bill-to with place of supply, black table header,
// tax breakdown, HSN summary, UPI QR + bank details, signature, notes and terms. One PDF, any number of pages.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { encode } from "uqr";
import { pdfSafe } from "../lib/pdf";

export interface ClassicDoc {
  title: string;
  copyLabel: string;
  company: { name: string; gstin?: string | null; addressLines: string[]; mobile?: string | null; email?: string | null; website?: string | null; logoDataUrl?: string | null };
  party: { name: string; company?: string | null; gstin?: string | null; addressLines: string[]; phone?: string | null };
  meta: Array<[string, string]>;
  lines: Array<{ n: number; name: string; hsn: string; rate: string; qty: string; amount: string }>;
  totals: Array<{ label: string; value: string; strong?: boolean }>;
  itemCountLine: string;
  words?: string | null;
  payable?: string | null;
  hsn: { head: [string, string, string, string, string, string, string]; rows: string[][]; total: string[] } | null;
  upiLink?: string | null;
  bank?: { bank: string; account: string; ifsc: string; branch: string; beneficiary: string; type: string } | null;
  signature: { forCompany: string; dataUrl?: string | null };
  notes?: string | null;
  terms?: string | null;
  footer: string;
}

const W = 595.28;
const H = 841.89;
const M = 36;
const INK = rgb(0.07, 0.07, 0.07);
const GRAY = rgb(0.4, 0.4, 0.4);
const LIGHT = rgb(0.82, 0.82, 0.82);
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);

const bytes = (dataUrl: string) => Uint8Array.from(atob(dataUrl.split(",")[1] ?? ""), (c) => c.charCodeAt(0));

async function embedDataUrl(doc: PDFDocument, url?: string | null): Promise<PDFImage | null> {
  if (!url) return null;
  try {
    return url.startsWith("data:image/png") ? await doc.embedPng(bytes(url)) : await doc.embedJpg(bytes(url));
  } catch {
    return null; // an unreadable image must never stop an invoice from printing
  }
}

export async function renderClassicInvoicePdf(d: ClassicDoc): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`${d.title} ${d.meta[0]?.[1] ?? ""} - ${d.party.name}`));
  doc.setAuthor(pdfSafe(d.company.name));
  doc.setCreator("Gexart Sales & Billing");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedDataUrl(doc, d.company.logoDataUrl);
  const sig = await embedDataUrl(doc, d.signature.dataUrl);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0; // distance from the top of the page
  const newPage = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
    y = M;
  };
  const txt = (s: string, x: number, top: number, size: number, f: PDFFont = font, color = INK) => page.drawText(pdfSafe(s), { x, y: H - top - size, size, font: f, color });
  const right = (s: string, xr: number, top: number, size: number, f: PDFFont = font, color = INK) => txt(s, xr - f.widthOfTextAtSize(pdfSafe(s), size), top, size, f, color);
  const rule = (top: number, h = 0.6, color = BLACK, x = M, w = W - 2 * M) => page.drawRectangle({ x, y: H - top - h, width: w, height: h, color });
  const wrap = (s: string, size: number, width: number, f: PDFFont = font): string[] => {
    const out: string[] = [];
    for (const para of pdfSafe(s).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) > width && line) (out.push(line), (line = word));
        else line = next;
      }
      out.push(line);
    }
    return out;
  };
  const ensure = (h: number) => {
    if (y + h > H - M - 24) newPage();
  };

  newPage();

  // ── Header: logo, company, document title ──
  const logoSize = 56;
  if (logo) page.drawImage(logo, { x: M, y: H - y - logoSize, width: logoSize, height: logoSize });
  else {
    page.drawRectangle({ x: M, y: H - y - logoSize, width: logoSize, height: logoSize, color: BLACK });
    txt("GX", M + 12, y + 17, 22, bold, WHITE);
  }
  const cx = M + logoSize + 16;
  let cy = y;
  txt(d.company.name.toUpperCase(), cx, cy, 15, bold);
  cy += 19;
  if (d.company.gstin) (txt(`GSTIN ${d.company.gstin}`, cx, cy, 8.5, bold), (cy += 11.5));
  for (const l of d.company.addressLines) (txt(l, cx, cy, 8.5), (cy += 11));
  const labelled = (k: string, v?: string | null) => {
    if (!v) return;
    txt(k, cx, cy, 8.5, bold);
    txt(v, cx + bold.widthOfTextAtSize(pdfSafe(`${k} `), 8.5), cy, 8.5);
    cy += 11;
  };
  labelled("Mobile", d.company.mobile);
  labelled("Email", d.company.email);
  labelled("Website", d.company.website);
  // spaced title, top right
  const spaced = d.title.toUpperCase().split("").join(" ");
  right(spaced, W - M, y + 2, 12, bold);
  if (d.copyLabel) right(d.copyLabel, W - M, y + 19, 7.5, font, GRAY);
  y = Math.max(cy, y + logoSize) + 18;

  // ── Bill to (left) and invoice facts (right) ──
  const billTop = y;
  txt("Bill To:", M, y, 8.5, bold);
  let by = y + 14;
  txt(d.party.name, M, by, 10.5, bold);
  by += 14;
  if (d.party.company) (txt(d.party.company, M, by, 10, bold), (by += 13));
  if (d.party.gstin) (txt(`GSTIN: ${d.party.gstin}`, M, by, 10, bold), (by += 13));
  for (const l of d.party.addressLines.flatMap((a) => wrap(a, 9, 270))) (txt(l, M, by, 9), (by += 12));
  if (d.party.phone) (txt(d.party.phone, M, by, 9), (by += 12));
  let my = billTop + 2;
  for (const [k, v] of d.meta) {
    right(`${k}:`, W - M - 118, my, 9.5, bold);
    right(v, W - M, my, 9.5, bold);
    my += 16;
  }
  y = Math.max(by, my) + 14;

  // ── Items table ──
  const cols = [{ w: 24 }, { w: 0 }, { w: 62 }, { w: 74 }, { w: 54 }, { w: 82 }];
  const total = W - 2 * M;
  const widths = cols.map((c) => (c.w === 0 ? total - cols.reduce((a, b) => a + b.w, 0) : c.w));
  const heads = ["#", "Item", "HSN/SAC", "Rate / Item", "Qty", "Amount"];
  const tableHead = () => {
    ensure(40);
    page.drawRectangle({ x: M, y: H - y - 18, width: total, height: 18, color: BLACK });
    let x = M;
    heads.forEach((h, i) => {
      if (i >= 2) right(h, x + widths[i]! - 6, y + 4.5, 8.5, bold, WHITE);
      else txt(h, x + 5, y + 4.5, 8.5, bold, WHITE);
      x += widths[i]!;
    });
    y += 18;
  };
  tableHead();
  for (const l of d.lines) {
    const nameLines = wrap(l.name, 9.5, widths[1]! - 12, bold);
    const h = Math.max(24, nameLines.length * 12 + 12);
    if (y + h > H - M - 70) (newPage(), tableHead());
    let x = M;
    txt(String(l.n), x + 5, y + 8, 9);
    x += widths[0]!;
    nameLines.forEach((nl, j) => txt(nl, x + 5, y + 8 + j * 12, 9.5, bold));
    x += widths[1]!;
    right(l.hsn, x + widths[2]! - 6, y + 8, 9.5);
    x += widths[2]!;
    right(l.rate, x + widths[3]! - 6, y + 8, 9.5, bold);
    x += widths[3]!;
    right(l.qty, x + widths[4]! - 6, y + 8, 9.5);
    x += widths[4]!;
    right(l.amount, x + widths[5]! - 6, y + 8, 9.5);
    y += h;
    rule(y, 0.4, LIGHT);
  }
  y += 8;

  // ── Totals ──
  const tx = W - M - 230;
  for (const t of d.totals) {
    ensure(t.strong ? 30 : 16);
    if (t.strong) {
      rule(y, 0.6, INK, tx - 10, 240);
      y += 6;
      right(t.label, tx + 130, y + 1, 12, bold);
      right(t.value, W - M, y - 1, 15, bold);
      y += 24;
    } else {
      right(t.label, tx + 130, y, 8.5, bold);
      right(t.value, W - M, y, 8.5, bold);
      y += 14;
    }
  }
  ensure(60);
  txt(d.itemCountLine, M, y + 3, 7.5, font, GRAY);
  if (d.words) right(`Total amount (in words): ${d.words}`, W - M, y + 3, 7.5, font, GRAY);
  y += 15;
  rule(y, 1.4);
  y += 4;
  if (d.payable) right(`Amount Payable:   ${d.payable}`, W - M, y + 2, 9, bold, GRAY);
  y += 22;

  // ── HSN / tax summary ──
  if (d.hsn) {
    const hw = [78, 82, 58, 68, 58, 68, total - 412];
    ensure(24 + (d.hsn.rows.length + 2) * 17);
    const row = (cells: string[], f: PDFFont) => {
      let x = M;
      cells.forEach((c, i) => {
        if (i === 0) txt(c, x + 4, y + 3, 8.5, f);
        else right(c, x + hw[i]! - 6, y + 3, 8.5, f);
        x += hw[i]!;
      });
      y += 17;
    };
    row([...d.hsn.head], bold);
    rule(y - 3, 0.5, LIGHT);
    for (const r of d.hsn.rows) row(r, bold);
    rule(y - 3, 0.5, LIGHT);
    row(d.hsn.total, bold);
    rule(y - 1, 0.8);
    y += 12;
  }

  // ── Pay using UPI · Bank details · Signature ──
  ensure(110);
  const blockTop = y;
  if (d.upiLink) {
    txt("Pay using UPI:", M, blockTop, 9, bold);
    const qr = encode(d.upiLink, { ecc: "M", border: 0 });
    const grid = qr.data;
    const cell = 84 / qr.size;
    for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) if (grid[r]![c]) page.drawRectangle({ x: M + c * cell, y: H - blockTop - 14 - (r + 1) * cell, width: cell + 0.15, height: cell + 0.15, color: BLACK });
  }
  const bx = M + 140;
  if (d.bank) {
    txt("Bank Details:", bx, blockTop, 9, bold);
    const rows: Array<[string, string]> = [["Bank:", d.bank.bank], ["Account #:", d.bank.account], ["IFSC Code:", d.bank.ifsc], ["Branch:", d.bank.branch]];
    rows.forEach(([k, v], i) => {
      txt(k, bx, blockTop + 16 + i * 14, 8.5);
      txt(v, bx + 60, blockTop + 16 + i * 14, 8.5, bold);
    });
    txt(`Beneficiary Name: ${d.bank.beneficiary}   Account Type: ${d.bank.type}`, bx, blockTop + 16 + rows.length * 14 + 2, 7.5);
  }
  const sx = W - M - 150;
  txt(`For ${d.signature.forCompany}`, sx, blockTop + 2, 7.5, font, GRAY);
  if (sig) {
    const sw = Math.min(110, sig.width * (50 / sig.height));
    page.drawImage(sig, { x: sx + 4, y: H - blockTop - 16 - 50, width: sw, height: sw * (sig.height / sig.width) > 50 ? 50 : sw * (sig.height / sig.width) });
  }
  right("Authorized Signatory", W - M, blockTop + 74, 7.5, font, GRAY);
  y = blockTop + 112;

  // ── Notes and terms ──
  if (d.notes) {
    ensure(30);
    txt("Notes:", M, y, 8.5, bold);
    y += 12;
    for (const l of wrap(d.notes, 8.5, total)) (ensure(12), txt(l, M, y, 8.5), (y += 11));
    y += 6;
  }
  if (d.terms) {
    ensure(30);
    txt("Terms and Conditions:", M, y, 8.5, bold);
    y += 12;
    for (const l of wrap(d.terms, 7.5, total)) (ensure(10), txt(l, M, y, 7.5), (y += 9.5));
  }

  pages.forEach((pg, i) => {
    page = pg;
    txt(`Page ${i + 1} / ${pages.length}`, M, H - 40, 8, bold);
    txt(`•  ${d.footer}`, M + 56, H - 40, 8, bold);
  });
  return doc.save();
}
