/**
 * Payment receipt (A5, one page): who paid, how much, how, and what is still due on the invoice.
 * Uses the PDF built-in fonts and a drawn rupee sign, so it is cheap enough for the Free plan.
 */
import { LineCapStyle, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { BRAND_LOGO } from "./brand-logo";
import { inrWords } from "./invoice-docs";

export interface ReceiptData {
  receiptNo: string;
  date: string;
  mode: string;
  referenceNo?: string | null;
  notes?: string | null;
  amountPaise: number;
  party: { name: string; gstin?: string | null; phone?: string | null; address?: string | null };
  invoice?: { no: string; date: string; totalPaise: number; paidPaise: number; balancePaise: number } | null;
  company: { name: string; gstin?: string | null; addressLines: string[]; phone?: string | null; email?: string | null };
  signature: { dataUrl?: string | null; stampDataUrl?: string | null; name?: string | null };
  footer: string;
}

const W = 419.5;
const H = 595.3;
const M = 28;
const INK = rgb(0.07, 0.07, 0.09);
const MUTED = rgb(0.42, 0.44, 0.48);
const LINE = rgb(0.86, 0.87, 0.89);

const clean = (s: string | null | undefined) => String(s ?? "").replace(/\r/g, "").replace(/[^\n -~ -ÿ‐-•…₹]/g, "");
const money = (p: number) => `₹${(Math.abs(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(iso ?? "");
};
const MODE: Record<string, string> = { CASH: "Cash", UPI: "UPI", BANK: "Bank transfer", CARD: "Card", NET_BANKING: "Net banking", CHEQUE: "Cheque" };

async function embed(doc: PDFDocument, dataUrl?: string | null): Promise<PDFImage | null> {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(dataUrl ?? "");
  if (!m) return null;
  try {
    const bytes = Uint8Array.from(atob(m[2]!), (c) => c.charCodeAt(0));
    return m[1]!.toLowerCase() === "png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

export async function renderPaymentReceipt(d: ReceiptData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Receipt ${d.receiptNo} - ${d.party.name}`.replace(/[^\x20-\x7E]/g, ""));
  doc.setCreator("Sales Gexart");
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await embed(doc, BRAND_LOGO);
  const sig = await embed(doc, d.signature.dataUrl);
  const stamp = await embed(doc, d.signature.stampDataUrl);
  const page: PDFPage = doc.addPage([W, H]);

  const rupeeW = (size: number) => size * 0.6;
  const rupee = (x: number, base: number, size: number, isBold: boolean) => {
    const h = size * 0.72;
    page.drawSvgPath("M0.6 1.4 L9.4 1.4 M0.6 4.4 L9.4 4.4 M1.6 1.4 L4.6 1.4 C9.4 1.4 9.4 8 4.6 8 L1.6 8 L7.6 12", {
      x: x + size * 0.04, y: base + h, scale: h / 12, borderColor: INK, borderWidth: isBold ? size * 0.105 : size * 0.075, borderLineCap: LineCapStyle.Round,
    });
  };
  const fontOf = (b: boolean): PDFFont => (b ? bold : reg);
  const width = (t: string, size: number, b = false) => [...clean(t)].reduce((a, ch) => a + (ch === "₹" ? rupeeW(size) : fontOf(b).widthOfTextAtSize(ch, size)), 0);
  /** `top` is measured from the top edge of the page. */
  const put = (t: string, x: number, top: number, size: number, b = false, color = INK) => {
    let cx = x;
    let run = "";
    const base = H - top - size * 0.86;
    const flush = () => {
      if (!run) return;
      page.drawText(run, { x: cx, y: base, size, font: fontOf(b), color });
      cx += fontOf(b).widthOfTextAtSize(run, size);
      run = "";
    };
    for (const ch of clean(t)) {
      if (ch === "₹") (flush(), rupee(cx, base, size, b), (cx += rupeeW(size)));
      else run += ch;
    }
    flush();
  };
  const right = (t: string, xr: number, top: number, size: number, b = false, color = INK) => put(t, xr - width(t, size, b), top, size, b, color);
  const rule = (top: number, color = LINE, thick = 0.6) => page.drawLine({ start: { x: M, y: H - top }, end: { x: W - M, y: H - top }, thickness: thick, color });
  const wrap = (t: string, size: number, max: number, b = false) => {
    const out: string[] = [];
    for (const para of clean(t).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (width(next, size, b) > max && line) (out.push(line), (line = word));
        else line = next;
      }
      out.push(line);
    }
    return out;
  };

  // Header: logo, company
  let top = 28;
  const lh = 46;
  if (logo) page.drawImage(logo, { x: M, y: H - top - lh, width: Math.min(60, (lh * logo.width) / logo.height), height: lh });
  const cx = M + (logo ? Math.min(60, (lh * logo.width) / logo.height) + 12 : 0);
  put(d.company.name, cx, top + 2, 13, true);
  let y = top + 19;
  if (d.company.gstin) (put(`GSTIN ${d.company.gstin}`, cx, y, 8, true), (y += 11));
  for (const l of d.company.addressLines.slice(0, 2)) (put(l, cx, y, 8, false, MUTED), (y += 10));
  const contact = [d.company.phone, d.company.email].filter(Boolean).join("  |  ");
  if (contact) put(contact, cx, y, 8, false, MUTED);
  top += lh + 18;
  rule(top, INK, 1.2);

  // Title
  top += 14;
  const title = "PAYMENT RECEIPT";
  let tx = M;
  for (const ch of title) (put(ch, tx, top, 11, true), (tx += bold.widthOfTextAtSize(ch, 11) + 2.4));
  right(`Receipt No  ${d.receiptNo}`, W - M, top - 1, 9.5, true);
  right(`Date  ${longDate(d.date)}`, W - M, top + 12, 9.5, false, MUTED);
  top += 34;

  // Received from
  put("Received from", M, top, 8, false, MUTED);
  put(d.party.name, M, top + 11, 12.5, true);
  let py = top + 28;
  if (d.party.gstin) (put(`GSTIN ${d.party.gstin}`, M, py, 8.5), (py += 11));
  for (const l of wrap(d.party.address ?? "", 8.5, W - 2 * M).slice(0, 2)) if (l) (put(l, M, py, 8.5, false, MUTED), (py += 10.5));
  if (d.party.phone) (put(d.party.phone, M, py, 8.5, false, MUTED), (py += 10.5));
  top = py + 10;

  // Amount box
  page.drawRectangle({ x: M, y: H - top - 62, width: W - 2 * M, height: 62, color: rgb(0.965, 0.968, 0.975), borderColor: LINE, borderWidth: 0.8 });
  put("Amount received", M + 12, top + 9, 8, false, MUTED);
  put(money(d.amountPaise), M + 12, top + 21, 22, true);
  right(MODE[d.mode] ?? d.mode, W - M - 12, top + 12, 10, true);
  if (d.referenceNo) right(`Ref ${d.referenceNo}`, W - M - 12, top + 27, 8.5, false, MUTED);
  put(`${inrWords(d.amountPaise)}`.replace(/^/, "INR "), M + 12, top + 50, 8, false, MUTED);
  top += 78;

  // Against invoice
  if (d.invoice) {
    put("Against invoice", M, top, 8, false, MUTED);
    put(d.invoice.no, M, top + 11, 11, true);
    right(longDate(d.invoice.date), W - M, top + 12, 9, false, MUTED);
    top += 32;
    const row = (label: string, v: string, strong = false) => {
      put(label, M, top, strong ? 10 : 9, strong, strong ? INK : MUTED);
      right(v, W - M, top, strong ? 10 : 9, strong);
      top += strong ? 15 : 13;
    };
    rule(top - 3);
    top += 4;
    row("Invoice total", money(d.invoice.totalPaise));
    row("Paid so far (including this payment)", money(d.invoice.paidPaise));
    rule(top - 1);
    top += 6;
    row(d.invoice.balancePaise > 0 ? "Balance still due" : "Invoice fully paid", d.invoice.balancePaise > 0 ? money(d.invoice.balancePaise) : "Nil", true);
    top += 4;
  }
  if (d.notes) {
    for (const l of wrap(`Note: ${d.notes}`, 8.5, W - 2 * M).slice(0, 3)) (put(l, M, top, 8.5, false, MUTED), (top += 11));
  }

  // Signature
  const sigTop = Math.max(top + 14, H - 150);
  put(`For ${d.company.name.toUpperCase()}`, W - M - width(`For ${d.company.name.toUpperCase()}`, 8), sigTop, 8);
  const boxW = 120;
  if (sig) {
    const sh = 34;
    const sw = Math.min(boxW, (sh * sig.width) / sig.height);
    page.drawImage(sig, { x: W - M - boxW / 2 - sw / 2, y: H - sigTop - 14 - sh, width: sw, height: sh });
    if (stamp) page.drawImage(stamp, { x: W - M - boxW / 2 + sw / 2 - 18, y: H - sigTop - 14 - sh - 4, width: 40, height: 40, opacity: 0.8 });
  }
  const sname = d.signature.name || "Authorised Signatory";
  right(sname, W - M - boxW / 2 + width(sname, 8, true) / 2, sigTop + 56, 8, true);
  right("Authorised Signatory", W - M - boxW / 2 + width("Authorised Signatory", 7.5) / 2, sigTop + 67, 7.5, false, MUTED);

  // Footer
  rule(H - 40);
  put(d.footer || "This is a computer generated receipt.", M, H - 32, 7.5, false, MUTED);
  return doc.save();
}
