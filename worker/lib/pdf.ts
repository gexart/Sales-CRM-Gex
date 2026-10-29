// Fixed-format Gexart proposal PDF. The layout is hard-coded so every proposal looks
// identical; only the data changes. Uses pdf-lib (pure JS, runs in Workers).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { GX_PATH, GX_VIEWBOX } from "../../shared/brand";

export interface ProposalData {
  title: string;
  clientName: string;
  clientMeta: string; // industry · city · website
  contactLine: string | null;
  preparedBy: string;
  date: string; // display date
  validityDays: number;
  introNote: string | null;
  summary: string;
  findings: { severity: string; title: string; detail: string; evidence: string | null; source: string }[];
  solutions: { service: string; packageName: string | null; description: string | null; deliverables: string[]; timeline: string | null }[];
  prices: { service: string; packageName: string | null; billing: string; qty: number; unit: string; total: string; custom: boolean }[];
  totals: { label: string; value: string }[];
  priceNote: string;
  scopeNote: string | null;
}

const BRAND = rgb(0.04, 0.04, 0.04);
const INK = rgb(0.04, 0.04, 0.04);
const MUTED = rgb(0.44, 0.44, 0.46);
const LINE = rgb(0.906, 0.902, 0.89);
const SEV: Record<string, ReturnType<typeof rgb>> = {
  critical: rgb(0.73, 0.11, 0.11),
  high: rgb(0.76, 0.25, 0.05),
  medium: rgb(0.71, 0.45, 0.03),
  low: rgb(0.03, 0.45, 0.6),
};
const W = 595.28;
const H = 841.89;
const M = 50;

/** Standard PDF fonts only encode WinAnsi; map common Unicode and drop the rest. */
export function pdfSafe(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/₹/g, "Rs.")
    .replace(/[•●]/g, "-")
    .replace(/ /g, " ")
    .replace(/[→]/g, "->")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

class Writer {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  constructor(
    public doc: PDFDocument,
    public font: PDFFont,
    public bold: PDFFont,
  ) {}
  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.pages.push(this.page);
    this.y = H - M;
  }
  ensure(h: number) {
    if (this.y - h < M + 30) this.newPage();
  }
  wrap(text: string, size: number, width: number, font = this.font): string[] {
    const out: string[] = [];
    for (const para of pdfSafe(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  }
  text(text: string, o: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number } = {}) {
    const size = o.size ?? 10;
    const lh = size * 1.4;
    for (const l of this.wrap(text, size, o.width ?? W - 2 * M - ((o.x ?? M) - M), o.font)) {
      this.ensure(lh);
      this.page.drawText(l, { x: o.x ?? M, y: this.y - size, size, font: o.font ?? this.font, color: o.color ?? INK });
      this.y -= lh;
    }
    this.y -= o.gap ?? 4;
  }
  heading(n: number, title: string) {
    // Keep a heading with at least its first block of content (no stranded headings).
    this.ensure(150);
    this.y -= 10;
    this.page.drawText(String(n).padStart(2, "0"), { x: M, y: this.y - 16, size: 16, font: this.bold, color: BRAND });
    this.page.drawText(pdfSafe(title), { x: M + 30, y: this.y - 16, size: 16, font: this.bold, color: INK });
    this.y -= 26;
    this.page.drawRectangle({ x: M, y: this.y, width: W - 2 * M, height: 1, color: LINE });
    this.y -= 12;
  }
}

export async function renderProposalPdf(d: ProposalData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`${d.title} - ${d.clientName}`));
  doc.setAuthor("Gexart");
  doc.setCreator("Gexart CRM");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold);

  // ── Cover ──
  w.newPage();
  const p = w.page;
  p.drawRectangle({ x: 0, y: H - 330, width: W, height: 330, color: BRAND });
  // GX monogram (vector) + spaced wordmark
  const markScale = 64 / GX_VIEWBOX.w;
  p.drawSvgPath(GX_PATH, { x: M - GX_VIEWBOX.x * markScale, y: H - 56 + GX_VIEWBOX.y * markScale, scale: markScale, color: rgb(1, 1, 1) });
  p.drawLine({ start: { x: M + 78, y: H - 56 }, end: { x: M + 78, y: H - 56 - GX_VIEWBOX.h * markScale }, thickness: 0.6, color: rgb(0.35, 0.35, 0.35) });
  p.drawText("G E X A R T", { x: M + 92, y: H - 72, size: 10, font: bold, color: rgb(1, 1, 1) });
  p.drawText("D I G I T A L   G R O W T H", { x: M + 92, y: H - 85, size: 6.5, font, color: rgb(0.55, 0.55, 0.53) });
  p.drawText(pdfSafe(d.title.toUpperCase()), { x: M, y: H - 200, size: 11, font: bold, color: rgb(0.62, 0.62, 0.6) });
  const nameLines = w.wrap(d.clientName, 30, W - 2 * M, bold);
  nameLines.slice(0, 2).forEach((l, i) => p.drawText(l, { x: M, y: H - 245 - i * 36, size: 30, font: bold, color: rgb(1, 1, 1) }));
  p.drawText(pdfSafe(d.clientMeta), { x: M, y: H - 305, size: 10, font, color: rgb(0.72, 0.72, 0.7) });
  w.y = H - 380;
  const meta: [string, string][] = [
    ["Prepared for", d.contactLine ?? d.clientName],
    ["Prepared by", `${d.preparedBy}, Gexart`],
    ["Date", d.date],
    ["Valid for", `${d.validityDays} days from the date above`],
  ];
  for (const [k, v] of meta) {
    p.drawText(pdfSafe(k), { x: M, y: w.y, size: 9, font: bold, color: MUTED });
    p.drawText(pdfSafe(v), { x: M + 110, y: w.y, size: 10, font, color: INK });
    w.y -= 20;
  }
  if (d.introNote) {
    w.y -= 20;
    w.text(d.introNote, { size: 10, color: INK });
  }

  // ── Body ──
  w.newPage();
  let n = 1;
  w.heading(n++, "Executive summary");
  w.text(d.summary, { size: 10.5, gap: 8 });

  if (d.findings.length) {
    w.heading(n++, "What we found");
    for (const f of d.findings) {
      w.ensure(46);
      const sev = f.severity.toUpperCase();
      w.page.drawRectangle({ x: M, y: w.y - 13, width: bold.widthOfTextAtSize(sev, 7) + 10, height: 13, color: SEV[f.severity] ?? MUTED });
      w.page.drawText(sev, { x: M + 5, y: w.y - 9.5, size: 7, font: bold, color: rgb(1, 1, 1) });
      w.page.drawText(pdfSafe(f.source), { x: W - M - font.widthOfTextAtSize(pdfSafe(f.source), 8), y: w.y - 9.5, size: 8, font, color: MUTED });
      w.y -= 18;
      w.text(f.title, { size: 10.5, font: bold, gap: 1 });
      w.text(f.detail, { size: 9.5, color: INK, gap: 1 });
      if (f.evidence) w.text(`Evidence: ${f.evidence}`, { size: 8, color: MUTED, gap: 8 });
      else w.y -= 6;
    }
  }

  w.heading(n++, "Recommended solutions");
  for (const s of d.solutions) {
    w.ensure(40);
    w.text(`${s.service}${s.packageName ? ` - ${s.packageName}` : ""}`, { size: 11, font: bold, color: BRAND, gap: 1 });
    if (s.description) w.text(s.description, { size: 9.5, gap: 2 });
    for (const del of s.deliverables.slice(0, 10)) w.text(`-  ${del}`, { size: 9.5, x: M + 10, gap: 0 });
    if (s.timeline) w.text(`Timeline: ${s.timeline}`, { size: 9, color: MUTED, gap: 2 });
    w.y -= 8;
  }

  w.heading(n++, "Investment");
  const cols = [M, M + 200, M + 285, M + 325, M + 412];
  const head = ["Service / package", "Billing", "Qty", "Unit price", "Total"];
  w.ensure(30);
  w.page.drawRectangle({ x: M, y: w.y - 18, width: W - 2 * M, height: 18, color: rgb(0.95, 0.96, 0.99) });
  head.forEach((h, i) => w.page.drawText(h, { x: cols[i] + 4, y: w.y - 12.5, size: 8.5, font: bold, color: MUTED }));
  w.y -= 22;
  for (const r of d.prices) {
    const label = w.wrap(`${r.service}${r.packageName ? ` - ${r.packageName}` : ""}`, 9, 190);
    const rowH = Math.max(1, label.length) * 12 + 6;
    w.ensure(rowH);
    label.forEach((l, i) => w.page.drawText(l, { x: cols[0] + 4, y: w.y - 10 - i * 12, size: 9, font, color: INK }));
    const cells = [r.billing, String(r.qty), r.unit, r.total];
    cells.forEach((v, i) => w.page.drawText(pdfSafe(v), { x: cols[i + 1] + 4, y: w.y - 10, size: 9, font: i === 3 ? bold : font, color: r.custom && i >= 2 ? MUTED : INK }));
    w.y -= rowH;
    w.page.drawRectangle({ x: M, y: w.y + 2, width: W - 2 * M, height: 0.5, color: LINE });
  }
  w.y -= 8;
  for (const t of d.totals) {
    w.ensure(16);
    w.page.drawText(pdfSafe(t.label), { x: cols[3] - 60, y: w.y - 10, size: 9.5, font: bold, color: MUTED });
    w.page.drawText(pdfSafe(t.value), { x: cols[4] + 4, y: w.y - 10, size: 10, font: bold, color: INK });
    w.y -= 16;
  }
  w.y -= 6;
  w.text(d.priceNote, { size: 8.5, color: MUTED, gap: 8 });

  w.heading(n++, "Next steps");
  ["Review this proposal and share any questions.", "A short discovery call to confirm scope, priorities and timelines.", "Written confirmation from you to begin; we then share a project plan and kick-off date."].forEach((s, i) =>
    w.text(`${i + 1}.  ${s}`, { size: 10, gap: 3 }),
  );
  w.text(`This proposal is valid for ${d.validityDays} days from ${d.date}.`, { size: 9, color: MUTED, gap: 4 });
  if (d.scopeNote) w.text(d.scopeNote, { size: 8, color: MUTED });

  // ── Footer on every page ──
  const total = w.pages.length;
  w.pages.forEach((pg, i) => {
    if (i === 0) return;
    pg.drawRectangle({ x: M, y: 36, width: W - 2 * M, height: 0.5, color: LINE });
    pg.drawText(pdfSafe(`GEXART  |  ${d.title} for ${d.clientName}`).slice(0, 90), { x: M, y: 24, size: 7.5, font, color: MUTED });
    const pn = `Page ${i + 1} of ${total}`;
    pg.drawText(pn, { x: W - M - font.widthOfTextAtSize(pn, 7.5), y: 24, size: 7.5, font, color: MUTED });
  });
  return doc.save();
}
