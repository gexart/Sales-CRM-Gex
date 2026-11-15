// Fixed-format Gexart proposal PDF. The layout is hard-coded so every proposal looks
// identical; only the data changes. Uses pdf-lib (pure JS, runs in Workers).
import { rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";

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

export const BRAND = rgb(0.078, 0.118, 0.18); // navy #141E2E
export const ACCENT = rgb(0.957, 0.478, 0.125); // orange #F47A20
export const INK = rgb(0.078, 0.118, 0.18);
export const MUTED = rgb(0.39, 0.44, 0.54);
export const LINE = rgb(0.894, 0.906, 0.933);
export const SEV: Record<string, ReturnType<typeof rgb>> = {
  critical: rgb(0.73, 0.11, 0.11),
  high: rgb(0.76, 0.25, 0.05),
  medium: rgb(0.71, 0.45, 0.03),
  low: rgb(0.03, 0.45, 0.6),
};
export const W = 595.28;
export const H = 841.89;
export const M = 50;

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

export class Writer {
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
      for (let word of para.split(/\s+/)) {
        // A single token wider than the line (a long URL, say) is broken by character so it never overflows.
        while (word.length > 1 && font.widthOfTextAtSize(word, size) > width) {
          let cut = word.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(word.slice(0, cut), size) > width) cut--;
          if (line) {
            out.push(line);
            line = "";
          }
          out.push(word.slice(0, cut));
          word = word.slice(cut);
        }
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
    this.page.drawText(String(n).padStart(2, "0"), { x: M, y: this.y - 16, size: 16, font: this.bold, color: ACCENT });
    this.page.drawText(pdfSafe(title), { x: M + 30, y: this.y - 16, size: 16, font: this.bold, color: INK });
    this.y -= 26;
    this.page.drawRectangle({ x: M, y: this.y, width: W - 2 * M, height: 1, color: LINE });
    this.y -= 12;
  }
}
