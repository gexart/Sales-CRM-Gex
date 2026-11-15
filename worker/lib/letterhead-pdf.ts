// Shared pieces for every PDF on the Gexart letterhead (audit reports and proposals): logo + company block +
// orange/navy rule on each page, footer "Gexart Technologies · A unit of Gexart Ventures".
import { type PDFFont, type PDFImage, type PDFPage, rgb } from "pdf-lib";
import { LETTERHEAD } from "../../shared/letterhead";
import { H, LINE, M, MUTED, W, Writer, pdfSafe } from "./pdf";

export type Color = ReturnType<typeof rgb>;
export const WHITE = rgb(1, 1, 1);
export const GREEN = rgb(0.086, 0.545, 0.29);
export const AMBER = rgb(0.85, 0.52, 0.04);
export const RED = rgb(0.78, 0.16, 0.16);
export const TINT = rgb(0.972, 0.976, 0.984);
export const TRACK = rgb(0.9, 0.915, 0.94);
export const LH_INK = rgb(0.067, 0.094, 0.153); // 111827
export const LH_ORANGE = rgb(0.918, 0.416, 0.122); // EA6A1F
export const LH_GRAY = rgb(0.294, 0.333, 0.388); // 4B5563
export const CONTENT_TOP = H - 128;

export const scoreColor = (s: number | null): Color => (s === null ? MUTED : s >= 80 ? GREEN : s >= 50 ? AMBER : RED);
export const spaced = (s: string) => s.toUpperCase().split(/\s+/).map((w) => w.split("").join(" ")).join("   ");

/** Every page starts on the letterhead. */
export class LetterheadWriter extends Writer {
  logo!: PDFImage;
  newPage() {
    super.newPage();
    drawLetterhead(this.page, this.logo, this.font, this.bold);
    this.y = CONTENT_TOP;
  }
}

export function drawLetterhead(page: PDFPage, logo: PDFImage, font: PDFFont, bold: PDFFont) {
  const lh = 44;
  page.drawImage(logo, { x: M, y: H - 30 - lh, width: lh * (logo.width / logo.height), height: lh });
  const right = W - M;
  const line = (t: string, y: number, size: number, f: PDFFont, c: Color) => page.drawText(pdfSafe(t), { x: right - f.widthOfTextAtSize(pdfSafe(t), size), y, size, font: f, color: c });
  line(LETTERHEAD.company, H - 40, 10.5, bold, LH_INK);
  line(LETTERHEAD.unit, H - 52, 9, bold, LH_ORANGE);
  line(`${LETTERHEAD.email}  ·  ${LETTERHEAD.web}`, H - 64, 8.5, font, LH_GRAY);
  line(LETTERHEAD.phones.join("  ·  "), H - 75.5, 8.5, font, LH_GRAY);
  line(LETTERHEAD.addressLines[0], H - 87, 8.5, font, LH_GRAY);
  line(LETTERHEAD.addressLines[1], H - 98.5, 8.5, font, LH_GRAY);
  page.drawRectangle({ x: M, y: H - 109, width: W - 2 * M, height: 1.6, color: LH_ORANGE });
  page.drawRectangle({ x: M, y: H - 112.5, width: W - 2 * M, height: 0.8, color: LH_INK });
}

export function drawFooter(page: PDFPage, font: PDFFont, i: number, total: number) {
  page.drawRectangle({ x: M, y: 46, width: W - 2 * M, height: 0.5, color: LINE });
  page.drawText(pdfSafe(`${LETTERHEAD.company}  ·  ${LETTERHEAD.unit}`), { x: M, y: 32, size: 7.5, font, color: MUTED });
  const r = pdfSafe(`${LETTERHEAD.web}   |   Page ${i} of ${total}`);
  page.drawText(r, { x: W - M - font.widthOfTextAtSize(r, 7.5), y: 32, size: 7.5, font, color: MUTED });
}

