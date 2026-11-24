import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { pdfSafe } from "../lib/pdf";
import { code128Clean, code128Widths } from "../../shared/code128";

type L = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const MM = 72 / 25.4;
const rs = (paise: number) => `Rs. ${((paise ?? 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const BLACK = rgb(0, 0, 0);

/** Receipt for a 58 mm or 80 mm thermal printer: one tall page, as long as the content needs. */
export async function renderThermalReceipt(inv: L, s: { thermal: L; company: L; preferences: L }, companyName: string): Promise<Uint8Array> {
  const widthMm = s.thermal.paperWidth === "58" ? 58 : 80;
  const W = widthMm * MM;
  const M = 6;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  const bold = await doc.embedFont(StandardFonts.CourierBold);
  type Row = { text?: string; right?: string; size: number; bold?: boolean; center?: boolean; gap?: number; rule?: boolean };
  const rows: Row[] = [];
  const size = widthMm === 58 ? 7.5 : 8.5;
  const cw = (f: PDFFont, sz: number) => f.widthOfTextAtSize("0", sz);
  const maxChars = Math.floor((W - 2 * M) / cw(font, size));
  const wrap = (t: string, n = maxChars) => {
    const out: string[] = [];
    let line = "";
    for (const w of pdfSafe(t).split(/\s+/)) {
      const next = line ? `${line} ${w}` : w;
      if (next.length > n && line) (out.push(line), (line = w.slice(0, n)));
      else line = next.slice(0, Math.max(next.length, n));
    }
    if (line) out.push(line);
    return out;
  };
  const center = (t: string, o: Partial<Row> = {}) => wrap(t).forEach((l) => rows.push({ text: l, size, center: true, ...o }));
  const lr = (l: string, r: string, o: Partial<Row> = {}) => rows.push({ text: pdfSafe(l), right: pdfSafe(r), size, ...o });
  const rule = () => rows.push({ size: 3, rule: true, gap: 3 });

  center(companyName.toUpperCase(), { bold: true, size: size + 2 });
  if (s.thermal.showGstin && inv.branch?.gstin) center(`GSTIN ${inv.branch.gstin}`);
  String(inv.branch?.address ?? "").split(/\r?\n/).filter(Boolean).forEach((a) => center(a));
  if (inv.branch?.phone) center(`Ph ${inv.branch.phone}`);
  rule();
  center("TAX INVOICE", { bold: true });
  lr(`No ${inv.invoice_no}`, new Date(inv.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }));
  wrap(`To ${inv.party_name}`).forEach((l) => rows.push({ text: l, size }));
  rule();
  for (const l of inv.lines ?? []) {
    wrap(`${l.name}${s.thermal.showItemHsn && l.hsn_sac ? ` (${l.hsn_sac})` : ""}`).forEach((t) => rows.push({ text: t, size, bold: true }));
    lr(`${l.quantity_thousandths / 1000} x ${((l.unit_price_paise ?? 0) / 100).toFixed(2)}`, ((l.line_total_paise ?? 0) / 100).toFixed(2));
  }
  rule();
  lr("Subtotal", ((inv.subtotal_paise ?? 0) / 100).toFixed(2));
  if (inv.discount_paise) lr("Discount", `-${(inv.discount_paise / 100).toFixed(2)}`);
  lr("GST", ((inv.tax_total_paise ?? 0) / 100).toFixed(2));
  if (inv.round_off_paise) lr("Round off", (inv.round_off_paise / 100).toFixed(2));
  lr("TOTAL", rs(inv.total_paise), { bold: true, size: size + 1.5 });
  if (inv.paid_amount_paise) lr("Paid", rs(inv.paid_amount_paise));
  if (inv.balance_amount_paise > 0) lr("Balance due", rs(inv.balance_amount_paise), { bold: true });
  rule();
  center(s.thermal.footerNote || "Thank you!");

  const lh = (r: Row) => r.size * 1.3 + (r.gap ?? 0);
  const H = rows.reduce((a, r) => a + lh(r), 0) + 2 * M + 6;
  const page = doc.addPage([W, H]);
  let y = H - M;
  for (const r of rows) {
    y -= lh(r);
    if (r.rule) {
      page.drawLine({ start: { x: M, y: y + r.size }, end: { x: W - M, y: y + r.size }, thickness: 0.5, color: BLACK, dashArray: [2, 2] });
      continue;
    }
    const f = r.bold ? bold : font;
    const t = r.text ?? "";
    const x = r.center ? (W - f.widthOfTextAtSize(t, r.size)) / 2 : M;
    page.drawText(t, { x, y, size: r.size, font: f, color: BLACK });
    if (r.right) page.drawText(r.right, { x: W - M - f.widthOfTextAtSize(r.right, r.size), y, size: r.size, font: f, color: BLACK });
  }
  return doc.save();
}

function drawBarcode(page: PDFPage, text: string, x: number, y: number, maxW: number, h: number) {
  const widths = code128Widths(text);
  const modules = widths.reduce((a, b) => a + b, 0);
  const mw = Math.max(0.35, maxW / (modules + 20)); // quiet zones
  let cx = x + (maxW - mw * modules) / 2;
  widths.forEach((w, i) => {
    if (i % 2 === 0) page.drawRectangle({ x: cx, y, width: w * mw, height: h, color: BLACK });
    cx += w * mw;
  });
}

/** One label per page, each page exactly the label size (what label printers expect). `copies` repeats every item. */
export async function renderBarcodeLabels(items: L[], s: { barcode: L; company: L }, businessName: string, copies: number): Promise<Uint8Array> {
  const [wmm, hmm] = String(s.barcode.labelSize || "50x25").split("x").map(Number) as [number, number];
  const W = wmm * MM;
  const H = hmm * MM;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const m = 3;
  for (const it of items) {
    const code = code128Clean(it.barcode || it.sku || String(it.id ?? "").slice(-10));
    for (let c = 0; c < copies; c++) {
      const page = doc.addPage([W, H]);
      let top = H - m;
      const line = (t: string, sz: number, f = font) => {
        page.drawText(pdfSafe(t), { x: m, y: top - sz, size: sz, font: f, color: BLACK });
        top -= sz * 1.2;
      };
      if (s.barcode.showBusinessName && businessName) line(businessName.slice(0, 32), Math.min(6, H / 6), bold);
      if (s.barcode.showName) {
        const nameSz = Math.min(7.5, H / 5);
        let t = pdfSafe(it.name ?? "");
        while (t.length > 3 && bold.widthOfTextAtSize(t, nameSz) > W - 2 * m) t = t.slice(0, -2);
        line(t, nameSz, bold);
      }
      const bh = Math.max(10, Math.min(H * 0.38, top - m - 18));
      drawBarcode(page, code, m, top - bh - 2, W - 2 * m, bh);
      top -= bh + 4;
      line(code, Math.min(6.5, H / 6));
      const price = [s.barcode.showPrice && it.salePricePaise != null ? `Price ${rs(it.salePricePaise)}` : "", s.barcode.showMrp && it.mrpPaise ? `MRP ${rs(it.mrpPaise)}` : ""].filter(Boolean).join("   ");
      if (price) line(price, Math.min(7.5, H / 5), bold);
    }
  }
  if (doc.getPageCount() === 0) doc.addPage([W, H]);
  return doc.save();
}
