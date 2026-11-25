// "Classic black" invoice, laid out to match the original Swipe invoices measure for measure: logo and company block, bill-to with
// invoice facts, black table header with banded rows, tax lines, HSN summary, UPI QR + bank, signature, notes and terms.
// Inter replaces Apple's SF UI (not licensed for embedding). One page for a normal invoice (it tightens itself if needed); a second
// page only when the items or terms really do not fit.
import { LineCapStyle, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { encode } from "uqr";

export interface ClassicDoc {
  title: string;
  copyLabel: string;
  company: { name: string; gstin?: string | null; addressLines: string[]; mobile?: string | null; email?: string | null; website?: string | null; logoDataUrl?: string | null };
  party: { name: string; company?: string | null; gstin?: string | null; addressLines: string[]; phone?: string | null };
  meta: Array<[string, string]>;
  lines: Array<{ n: number; name: string; hsn: string; rate: string; qty: string; unit: string; amount: string }>;
  totals: Array<{ label: string; value: string; strong?: boolean }>;
  itemCountLine: string;
  words?: string | null;
  payment: { balance?: string | null; paid?: string | null; fullyPaid: boolean } | null;
  hsn: { head: [string, string, string, string, string, string, string]; rows: string[][]; total: string[] } | null;
  upiLink?: string | null;
  bank?: { bank: string; account: string; ifsc: string; branch: string; beneficiary: string; type: string } | null;
  signature: { forCompany: string; dataUrl?: string | null; stampDataUrl?: string | null; name?: string | null };
  notes?: string | null;
  terms?: string | null;
  footer: string;
}

const W = 595.28;
const H = 841.89;
const L = 24; // left edge of bars and rules
const R = 571.3; // right edge of bars and rules
const TX = 29; // text left
const TR = 566.4; // text right
const INK = rgb(0.05, 0.05, 0.05);
const GRAY = rgb(0.42, 0.42, 0.42);
const BAND = rgb(0.953, 0.953, 0.953);
const HAIR = rgb(0.82, 0.82, 0.82);
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const GREEN = rgb(0.13, 0.62, 0.34);

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const dataBytes = (url: string) => bytes(url.split(",")[1] ?? "");
const clean = (s: string | null | undefined) => String(s ?? "").replace(/\r/g, "").replace(/[^\n -~ -ÿ‐-•…₹]/g, "");

async function embedDataUrl(doc: PDFDocument, url?: string | null): Promise<PDFImage | null> {
  if (!url) return null;
  try {
    return url.startsWith("data:image/png") ? await doc.embedPng(dataBytes(url)) : await doc.embedJpg(dataBytes(url));
  } catch {
    return null; // an unreadable picture must never stop an invoice from printing
  }
}

type Weight = "r" | "s" | "b";
interface Mode {
  rowPitch: number;
  hsnPitch: number;
  termSize: number;
  termPitch: number;
  gap: number;
  noteSize: number;
}
const NORMAL: Mode = { rowPitch: 17, hsnPitch: 12.8, termSize: 7.2, termPitch: 8.7, gap: 1, noteSize: 8.1 };
const TIGHT: Mode = { rowPitch: 15.4, hsnPitch: 11.4, termSize: 6.7, termPitch: 7.8, gap: 0.62, noteSize: 7.6 };

async function draw(d: ClassicDoc, mode: Mode, inter: boolean): Promise<{ pdf: Uint8Array; pages: number }> {
  const doc = await PDFDocument.create();
  let f: Record<Weight, PDFFont>;
  let rupee: PDFFont;
  if (inter) {
    // Inter, like the original invoices. Needs a lot of CPU time per PDF (Workers Paid plan).
    const fontkit = (await import("@pdf-lib/fontkit")).default;
    const { INTER_400, INTER_600, INTER_700, INTER_RUPEE } = await import("./inter-fonts");
    doc.registerFontkit(fontkit);
    f = {
      r: await doc.embedFont(bytes(INTER_400), { subset: true }),
      s: await doc.embedFont(bytes(INTER_600), { subset: true }),
      b: await doc.embedFont(bytes(INTER_700), { subset: true }),
    };
    rupee = await doc.embedFont(bytes(INTER_RUPEE), { subset: true });
  } else {
    // Built-in PDF fonts: almost no CPU, so it fits the Free plan. The rupee sign is left out (plain numbers, like the original table)
    const reg = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    f = { r: reg, s: bold, b: bold };
    rupee = bold;
  }
  const logo = await embedDataUrl(doc, d.company.logoDataUrl);
  const sig = await embedDataUrl(doc, d.signature.dataUrl);
  const stamp = await embedDataUrl(doc, d.signature.stampDataUrl);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  const newPage = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
  };
  /** Text width, with the rupee sign taken from the font that has it. */
  const rupeeWidth = (size: number) => (inter ? rupee.widthOfTextAtSize("₹", size) : size * 0.6);
  /** The built-in fonts have no rupee sign, so it is drawn as a small shape: costs almost no processing time. */
  const drawRupee = (x: number, base: number, size: number, w: Weight, color: ReturnType<typeof rgb>) => {
    const h = size * 0.72;
    page.drawSvgPath("M0.6 1.4 L9.4 1.4 M0.6 4.4 L9.4 4.4 M1.6 1.4 L4.6 1.4 C9.4 1.4 9.4 8 4.6 8 L1.6 8 L7.6 12", {
      x: x + size * 0.04,
      y: base + h,
      scale: h / 12,
      borderColor: color,
      borderWidth: w === "r" ? size * 0.075 : size * 0.105,
      borderLineCap: LineCapStyle.Round,
    });
  };
  const width = (t: string, size: number, w: Weight) => [...clean(t)].reduce((a, ch) => a + (ch === "₹" ? rupeeWidth(size) : f[w].widthOfTextAtSize(ch, size)), 0);
  const put = (t: string, x: number, top: number, size: number, w: Weight = "r", color = INK) => {
    let cx = x;
    let run = "";
    const base = H - top - size * 0.86;
    const flush = () => {
      if (!run) return;
      page.drawText(run, { x: cx, y: base, size, font: f[w], color });
      cx += f[w].widthOfTextAtSize(run, size);
      run = "";
    };
    for (const ch of clean(t)) {
      if (ch === "₹") {
        flush();
        if (inter) page.drawText(ch, { x: cx, y: base, size, font: rupee, color });
        else drawRupee(cx, base, size, w, color);
        cx += rupeeWidth(size);
      } else run += ch;
    }
    flush();
  };
  const right = (t: string, xr: number, top: number, size: number, w: Weight = "r", color = INK) => put(t, xr - width(t, size, w), top, size, w, color);
  const center = (t: string, xc: number, top: number, size: number, w: Weight = "r", color = INK) => put(t, xc - width(t, size, w) / 2, top, size, w, color);
  const spaced = (t: string, xr: number, top: number, size: number, w: Weight, gap: number, color = INK) => {
    const chars = [...clean(t)];
    const total = chars.reduce((a, ch) => a + f[w].widthOfTextAtSize(ch, size) + gap, -gap);
    let cx = xr - total;
    for (const ch of chars) {
      page.drawText(ch, { x: cx, y: H - top - size * 0.86, size, font: f[w], color });
      cx += f[w].widthOfTextAtSize(ch, size) + gap;
    }
  };
  const rect = (x: number, top: number, w: number, h: number, color = BLACK) => page.drawRectangle({ x, y: H - top - h, width: w, height: h, color });
  const wrap = (t: string, size: number, maxW: number, w: Weight = "r"): string[] => {
    const out: string[] = [];
    for (const para of clean(t).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (width(next, size, w) > maxW && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  };
  const g = (n: number) => n * mode.gap;

  newPage();
  // ── Header ─────────────────────────────────────────────────────────────────────────────────────────────
  let textX = 128;
  if (logo) {
    const box = 90;
    const k = Math.min(box / logo.width, box / logo.height);
    const lw = logo.width * k;
    const lh = logo.height * k;
    page.drawImage(logo, { x: L, y: H - 29.4 - lh, width: lw, height: lh });
    textX = Math.max(128, L + lw + 14);
  } else {
    rect(L, 29.4, 90, 90, BLACK);
    center("GX", L + 45, 57, 30, "b", WHITE);
  }
  put(d.company.name.toUpperCase(), textX, 31.9, 15.3, "b");
  let cy = 50.4;
  if (d.company.gstin) {
    put("GSTIN", textX, cy + 0.7, 9, "b");
    put(d.company.gstin, textX + width("GSTIN ", 9, "b"), cy, 9.9, "b");
    cy += 11.8;
  }
  for (const a of d.company.addressLines.slice(0, 5)) {
    put(a, textX, cy, 9);
    cy += 11.6;
  }
  const kv = (k: string, v?: string | null) => {
    if (!v) return;
    put(k, textX, cy + 0.5, 9, "b");
    put(v, textX + width(`${k} `, 9, "b") + 0.5, cy, 9.9);
    cy += 12.4;
  };
  cy += 0.6;
  kv("Mobile", d.company.mobile);
  kv("Email", d.company.email);
  kv("Website", d.company.website);
  spaced(d.title.toUpperCase(), 564.2, 30.9, 10.8, "b", 2.6);
  if (d.copyLabel) spaced(d.copyLabel, 565.5, 44.4, 8, "s", 1.5);

  // ── Bill to (left) and invoice facts (right) ───────────────────────────────────────────────────────────
  let y = Math.max(cy, 29.4 + 90) + 15 * mode.gap + 2;
  const billTop = y;
  put("Bill To:", TX, y, 9, "b");
  let by = y + 14.5;
  put(d.party.name, TX, by, 9.9, "b");
  by += 14.2;
  if (d.party.company) {
    put(d.party.company, TX, by, 9.9, "b");
    by += 13.8;
  }
  if (d.party.gstin) {
    put("GSTIN: " + d.party.gstin, TX, by, 9.9, "b");
    by += 13.6;
  }
  for (const l of d.party.addressLines.flatMap((a) => wrap(a, 9, 300)).slice(0, 5)) {
    put(l, TX, by, 9);
    by += 12.5;
  }
  if (d.party.phone) {
    put(d.party.phone, TX, by, 9);
    by += 12.5;
  }
  let my = billTop + 1;
  for (const [k, v] of d.meta) {
    right(`${k}:`, 413.3, my, 9.9, "b");
    right(v, 561.9, my, 9.9, "b");
    my += 15.7;
  }
  y = Math.max(by, my) + g(8);

  // ── Items table ────────────────────────────────────────────────────────────────────────────────────────
  const colRight = { hsn: 313, rate: 398.8, qty: 461.8, amount: 566.5 };
  const tableHead = () => {
    rect(L, y, R - L, 20.35, BLACK);
    put("#", 28.6, y + 5.7, 9, "b", WHITE);
    put("Item", 63.6, y + 5.7, 9, "b", WHITE);
    right("HSN/SAC", colRight.hsn, y + 5.7, 9, "b", WHITE);
    right("Rate / Item", colRight.rate, y + 5.7, 9, "b", WHITE);
    right("Qty", colRight.qty, y + 5.7, 9, "b", WHITE);
    right("Amount", colRight.amount, y + 5.7, 9, "b", WHITE);
    y += 20.35;
  };
  const bottomLimit = H - 44;
  tableHead();
  d.lines.forEach((l, i) => {
    const parts = clean(l.name).split("\n");
    const nameLines = wrap(parts[0] ?? "", 9.4, 195, "s");
    const descLines = parts.slice(1).flatMap((p) => wrap(p, 8.2, 195));
    const rowH = Math.max(mode.rowPitch, 4.6 + nameLines.length * 11.2 + descLines.length * 9.8 + 3);
    if (y + rowH > bottomLimit - 150) {
      newPage();
      y = 30;
      tableHead();
    }
    if (i % 2 === 1) rect(L, y, R - L, rowH, BAND);
    const ty = y + (mode.rowPitch - 9.4) / 2 + 0.5;
    put(String(l.n), TX, ty, 9.4);
    nameLines.forEach((nl, j) => put(nl, 63.5, ty + j * 11.2, 9.4, "s"));
    descLines.forEach((dl, j) => put(dl, 63.5, ty + nameLines.length * 11.2 + j * 9.8 + 0.5, 8.2, "r", GRAY));
    right(l.hsn, colRight.hsn - 0.4, ty, 9.4);
    right(l.rate, colRight.rate, ty, 9.4, "s");
    if (l.unit) {
      right(l.qty, 439.8, ty, 9.4);
      put(l.unit, 443.9, ty, 9.4);
    } else right(l.qty, 461.3, ty, 9.4);
    right(l.amount, colRight.amount - 0.3, ty, 9.4);
    y += rowH;
    rect(L + 0.6, y - 0.3, R - L - 1.2, 0.4, HAIR);
  });
  y += g(4);

  // ── Tax lines and total (kept together) ────────────────────────────────────────────────────────────────
  const normal = d.totals.filter((t) => !t.strong);
  const strong = d.totals.find((t) => t.strong);
  const need = normal.length * 13 + 38 + 28 + (d.hsn ? 28 + (d.hsn.rows.length + 1) * mode.hsnPitch : 0) + 110 + 26;
  if (y + need > bottomLimit) {
    newPage();
    y = 30;
  }
  normal.forEach((t, i) => {
    const size = i === 0 ? 8.5 : 8.1;
    right(t.label, 450.6, y, size, "b");
    right(t.value, TR, y, size, "b");
    y += 13;
  });
  if (strong) {
    y += 3;
    rect(417, y, R - 417, 1, BLACK);
    y += 5.5;
    right(strong.label, 451, y + 2.6, 12.4, "b");
    right(strong.value, TR, y, 15, "b");
    y += 24;
  }
  put(d.itemCountLine, TX, y + 1, 7.4, "r", GRAY);
  if (d.words) right(`Total amount (in words): ${d.words}`, 566.4, y, 8, "r", INK);
  y += 12.5;
  rect(L, y, R - L, 1.6, BLACK);
  y += 4.5;
  if (d.payment) {
    const p = d.payment;
    const lines: string[] = [];
    if (p.fullyPaid) lines.push("Amount Paid");
    else {
      if (p.balance) lines.push(`Amount Payable:   ${p.balance}`);
      if (p.paid) lines.push(`Amount Paid:   ${p.paid}`);
    }
    lines.forEach((t, i) => {
      right(t, TR, y + i * 12, 9, "b", i === 0 && !p.fullyPaid ? GRAY : INK);
      if (p.fullyPaid) {
        const cx = TR - width(t, 9, "b") - 9.5;
        const cyy = H - y - 5.3;
        page.drawCircle({ x: cx, y: cyy, size: 5, color: GREEN });
        page.drawLine({ start: { x: cx - 2.4, y: cyy - 0.1 }, end: { x: cx - 0.7, y: cyy - 1.9 }, thickness: 1.2, color: WHITE });
        page.drawLine({ start: { x: cx - 0.7, y: cyy - 1.9 }, end: { x: cx + 2.6, y: cyy + 1.9 }, thickness: 1.2, color: WHITE });
      }
    });
    y += Math.max(1, lines.length) * 12 + g(6);
  }

  // ── HSN / SAC summary ──────────────────────────────────────────────────────────────────────────────────
  if (d.hsn) {
    const cx = [TX, 193.6, 264.9, 330.3, 396.2, 461.8];
    const head = d.hsn.head;
    put(head[0], TX, y, 8.1, "s");
    [1, 2, 3, 4, 5].forEach((i) => center(head[i]!, cx[i]!, y, 8.1, "s"));
    right(head[6], 566.6, y, 8.1, "s");
    y += 10.5;
    rect(L - 1, y, R - L + 2, 0.9, BLACK);
    y += 5.2;
    for (const r of d.hsn.rows) {
      put(r[0]!, TX - 0.2, y, 8.1, "s");
      [1, 2, 3, 4, 5].forEach((i) => center(r[i] ?? "", cx[i]!, y, 8.1, "s"));
      right(r[6] ?? "", 566.4, y, 8.1, "s");
      y += mode.hsnPitch;
    }
    y += 1;
    rect(L - 1, y, R - L + 2, 0.9, BLACK);
    y += 5;
    put(d.hsn.total[0]!, TX - 0.2, y, 8.1, "b");
    [1, 3, 5].forEach((i) => center(d.hsn!.total[i] ?? "", cx[i]!, y, 8.1, "b"));
    right(d.hsn.total[6] ?? "", 566.4, y, 8.1, "b");
    y += 10.8;
    rect(L - 1, y, R - L + 2, 1.5, BLACK);
    y += 8 + g(6);
  }

  // ── UPI QR, bank, signature ────────────────────────────────────────────────────────────────────────────
  const blockTop = y;
  if (d.upiLink) {
    put("Pay using UPI:", 26.6, blockTop, 10, "b");
    const qr = encode(d.upiLink, { ecc: "M", border: 0 });
    const cell = 73 / qr.size;
    for (let r = 0; r < qr.size; r++) {
      for (let c = 0; c < qr.size; c++) {
        if (qr.data[r]![c]) page.drawRectangle({ x: 28 + c * cell, y: H - (blockTop + 16) - (r + 1) * cell, width: cell + 0.12, height: cell + 0.12, color: BLACK });
      }
    }
  }
  if (d.bank) {
    put("Bank Details:", 126.7, blockTop, 10, "b");
    const rows: Array<[string, string]> = [["Bank", d.bank.bank], ["Account #", d.bank.account], ["IFSC Code", d.bank.ifsc], ["Branch", d.bank.branch]];
    rows.forEach(([k, v], i) => {
      const t = blockTop + 16.2 + i * 14.1;
      put(k, 126.9, t, 8.8);
      put(":", 126.9 + width(k, 8.8, "r") + 1.4, t, 8.8);
      put(v, 199.9, t, 8.8, "s");
    });
    put(`Beneficiary Name: ${d.bank.beneficiary}`, 126.9, blockTop + 16.2 + 4 * 14.1 + 1.2, 8.4);
    put(`Account Type: ${d.bank.type}`, 126.4, blockTop + 16.2 + 4 * 14.1 + 13.6, 8.4);
  }
  const sx = 515;
  center(`For ${d.signature.forCompany}`, sx, blockTop + 8.5, 7.2, "r", INK);
  if (stamp) {
    const ss = 58;
    page.drawImage(stamp, { x: sx - 48 - ss, y: H - (blockTop + 26) - ss, width: ss, height: ss });
  }
  if (sig) {
    const k = Math.min(97 / sig.width, 54 / sig.height);
    page.drawImage(sig, { x: sx - (sig.width * k) / 2, y: H - (blockTop + 24) - sig.height * k, width: sig.width * k, height: sig.height * k });
  }
  if (d.signature.name) center(d.signature.name, sx, blockTop + 82, 7.6, "s", INK);
  center("Authorized Signatory", sx, blockTop + 82 + (d.signature.name ? 9.5 : 0), 7.2, "r", GRAY);
  y = blockTop + (d.bank ? 16.2 + 4 * 14.1 + 28 : d.upiLink ? 100 : 96) + g(8);

  // ── Notes and terms ────────────────────────────────────────────────────────────────────────────────────
  const room = (h: number) => {
    if (y + h > bottomLimit) {
      newPage();
      y = 30;
    }
  };
  if (d.notes?.trim()) {
    room(24);
    put("Notes:", 24.5, y, 8.5, "b");
    y += 13;
    for (const l of wrap(d.notes, mode.noteSize, 540)) {
      room(11);
      put(l, 24.7, y, mode.noteSize);
      y += mode.noteSize + 3.2;
    }
    y += g(5);
  }
  if (d.terms?.trim()) {
    room(30);
    put("Terms and Conditions:", 24.2, y, 8.5, "b");
    y += 13.2;
    let auto = 0;
    for (const raw of d.terms.split("\n").map((x) => x.trim()).filter(Boolean)) {
      const m = /^(\d+)[.)]\s*(.*)$/.exec(raw);
      auto = m ? Number(m[1]) : auto + 1;
      const body = m ? m[2]! : raw;
      const lines = wrap(body, mode.termSize, 530);
      room(lines.length * mode.termPitch + 2);
      put(`${auto}.`, 24.4, y, mode.termSize);
      lines.forEach((l, j) => put(l, 32.9, y + j * mode.termPitch, mode.termSize));
      y += lines.length * mode.termPitch;
    }
  }

  // ── Footer on every page ───────────────────────────────────────────────────────────────────────────────
  pages.forEach((pg, i) => {
    page = pg;
    const label = `Page ${i + 1} / ${pages.length}`;
    put(label, 24.5, 811, 8.1, "s");
    let x = 24.5 + width(label, 8.1, "s") + 5;
    for (const b of [i > 0 ? (d.meta[0]?.[1] ?? "") : "", d.footer].filter(Boolean)) {
      put("•", x, 810.4, 8.1, "s");
      x += width("•", 8.1, "s") + 5;
      put(b, x, 811, 8.1, "s");
      x += width(b, 8.1, "s") + 5;
    }
  });
  return { pdf: await doc.save(), pages: pages.length };
}

/** Set per request from the PDF_INTER variable (true only on a paid Workers plan). */
export const pdfOptions = { inter: false };

export async function renderClassicInvoicePdf(input: ClassicDoc): Promise<Uint8Array> {
  const inter = pdfOptions.inter;
  const d: ClassicDoc = input;
  const first = await draw(d, NORMAL, inter);
  if (first.pages === 1) return first.pdf;
  // Does the tighter layout keep it on one page (or fewer)? Use it; otherwise keep the roomier one.
  const second = await draw(d, TIGHT, inter);
  return second.pages < first.pages ? second.pdf : first.pdf;
}
