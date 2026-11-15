// Proposal as a PDF on the Gexart letterhead (same letterhead pages as the audit report).
import { PDFDocument, StandardFonts } from "pdf-lib";
import { LETTERHEAD, LOGO_PNG_BASE64, resolvePhone } from "../../shared/letterhead";
import { INK, M, MUTED, SEV, W, pdfSafe, type ProposalData } from "./pdf";
import { LH_GRAY, LH_INK, LH_ORANGE, LetterheadWriter, TINT, TRACK, WHITE, drawFooter, spaced, type Color } from "./letterhead-pdf";

export async function renderProposalPdf(d: ProposalData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`${d.title} - ${d.clientName}`));
  doc.setAuthor(LETTERHEAD.company);
  doc.setCreator("Sales CRM");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new LetterheadWriter(doc, font, bold);
  w.phone = resolvePhone(d.phone);
  w.logo = await doc.embedPng(Uint8Array.from(atob(LOGO_PNG_BASE64), (ch) => ch.charCodeAt(0)));
  const box = (x: number, top: number, bw: number, bh: number, color: Color) => w.page.drawRectangle({ x, y: top - bh, width: bw, height: bh, color });
  const txt = (s: string, x: number, top: number, size: number, f = font, color: Color = INK) => w.page.drawText(pdfSafe(s), { x, y: top - size, size, font: f, color });

  // ── Title block ──
  w.newPage();
  txt(spaced(d.title), M, w.y, 8.5, bold, LH_ORANGE);
  const nameLines = w.wrap(d.clientName, 26, W - 2 * M, bold).slice(0, 2);
  nameLines.forEach((l, i) => txt(l, M, w.y - 16 - i * 31, 26, bold, LH_INK));
  w.y -= 16 + nameLines.length * 31 + 2;
  if (d.clientMeta) txt(d.clientMeta, M, w.y, 10, font, MUTED);
  w.y -= 26;
  const meta: [string, string][] = [["Prepared for", d.contactLine ?? d.clientName], ["Prepared by", `${d.preparedBy}, Gexart`], ["Date", d.date], ["Valid for", `${d.validityDays} days`]];
  const colW = (W - 2 * M) / 4;
  meta.forEach(([k, v], i) => {
    txt(k.toUpperCase(), M + i * colW, w.y, 7, bold, MUTED);
    w.wrap(v, 9.5, colW - 8, bold).slice(0, 2).forEach((l, j) => txt(l, M + i * colW, w.y - 11 - j * 12, 9.5, bold, LH_INK));
  });
  w.y -= 50;
  if (d.introNote) {
    const lines = w.wrap(d.introNote, 10, W - 2 * M - 28);
    const h = lines.length * 14 + 20;
    w.ensure(h + 10);
    box(M, w.y, W - 2 * M, h, TINT);
    box(M, w.y, 4, h, LH_ORANGE);
    lines.forEach((l, i) => txt(l, M + 16, w.y - 10 - i * 14, 10, font, INK));
    w.y -= h + 14;
  }

  let n = 1;
  w.heading(n++, "Executive summary");
  w.text(d.summary, { size: 10.5, gap: 8 });

  if (d.findings.length) {
    w.heading(n++, "What we found");
    for (const f of d.findings) {
      const color = SEV[f.severity] ?? MUTED;
      const title = w.wrap(f.title, 10.5, W - 2 * M - 110, bold);
      const detail = w.wrap(f.detail, 9.3, W - 2 * M - 30);
      const ev = f.evidence ? w.wrap(`Evidence: ${f.evidence}`, 8, W - 2 * M - 30) : [];
      const h = 10 + title.length * 14 + detail.length * 12.4 + (ev.length ? 4 + ev.length * 10.5 : 0) + 10;
      w.ensure(h + 8);
      const top = w.y;
      box(M, top, W - 2 * M, h, TINT);
      box(M, top, 4, h, color);
      const sev = f.severity.toUpperCase();
      const cw = bold.widthOfTextAtSize(sev, 7) + 10;
      box(W - M - 10 - cw, top - 9, cw, 13, color);
      w.page.drawText(sev, { x: W - M - 10 - cw + 5, y: top - 18.5, size: 7, font: bold, color: WHITE });
      let y = top - 10;
      title.forEach((l) => {
        txt(l, M + 16, y, 10.5, bold, LH_INK);
        y -= 14;
      });
      detail.forEach((l) => {
        txt(l, M + 16, y, 9.3, font, INK);
        y -= 12.4;
      });
      if (ev.length) {
        y -= 4;
        ev.forEach((l) => {
          txt(l, M + 16, y, 8, font, MUTED);
          y -= 10.5;
        });
      }
      w.y -= h + 8;
    }
  }

  w.heading(n++, "Recommended solutions");
  for (const s of d.solutions) {
    const head = w.wrap(`${s.service}${s.packageName ? ` - ${s.packageName}` : ""}`, 11, W - 2 * M - 26, bold);
    const desc = s.description ? w.wrap(s.description, 9.3, W - 2 * M - 26) : [];
    const dels = s.deliverables.slice(0, 10).map((x) => w.wrap(x, 9.3, W - 2 * M - 44)[0] ?? "");
    const tl = s.timeline ? 14 : 0;
    const h = 12 + head.length * 15 + desc.length * 12.4 + (dels.length ? 4 + dels.length * 12.4 : 0) + tl + 10;
    w.ensure(h + 8);
    const top = w.y;
    box(M, top, W - 2 * M, h, TINT);
    box(M, top, 4, h, LH_ORANGE);
    let y = top - 10;
    head.forEach((l) => {
      txt(l, M + 16, y, 11, bold, LH_INK);
      y -= 15;
    });
    desc.forEach((l) => {
      txt(l, M + 16, y, 9.3, font, INK);
      y -= 12.4;
    });
    if (dels.length) {
      y -= 4;
      dels.forEach((l) => {
        w.page.drawCircle({ x: M + 20, y: y - 6, size: 1.8, color: LH_ORANGE });
        txt(l, M + 28, y, 9.3, font, INK);
        y -= 12.4;
      });
    }
    if (s.timeline) txt(`Timeline: ${s.timeline}`, M + 16, y - 2, 8.8, bold, LH_GRAY);
    w.y -= h + 8;
  }

  w.heading(n++, "Investment");
  const cols = [M, M + 215, M + 295, M + 332, M + 418];
  w.ensure(60);
  box(M, w.y, W - 2 * M, 20, LH_INK);
  ["Service / package", "Billing", "Qty", "Unit price", "Total"].forEach((h, i) => txt(h, cols[i] + 8, w.y - 6, 8.5, bold, WHITE));
  w.y -= 22;
  d.prices.forEach((r, ri) => {
    const label = w.wrap(`${r.service}${r.packageName ? ` - ${r.packageName}` : ""}`, 9, 200);
    const rowH = Math.max(1, label.length) * 12 + 10;
    w.ensure(rowH + 2);
    if (ri % 2 === 0) box(M, w.y, W - 2 * M, rowH, TINT);
    label.forEach((l, i) => txt(l, cols[0] + 8, w.y - 6 - i * 12, 9, bold, LH_INK));
    [r.billing, String(r.qty), r.unit, r.total].forEach((v, i) => txt(v, cols[i + 1] + 8, w.y - 6, 9, i === 3 ? bold : font, r.custom && i >= 2 ? MUTED : INK));
    w.y -= rowH;
  });
  w.y -= 8;
  for (const t of d.totals) {
    w.ensure(22);
    box(cols[3] - 40, w.y, W - M - (cols[3] - 40), 18, TRACK);
    txt(t.label, cols[3] - 32, w.y - 5, 9, bold, LH_GRAY);
    txt(t.value, cols[4] + 8, w.y - 5, 10, bold, LH_INK);
    w.y -= 22;
  }
  w.text(d.priceNote, { size: 8.5, color: MUTED, gap: 8 });

  w.heading(n++, "Next steps");
  ["Review this proposal and share any questions.", "A short discovery call to confirm scope, priorities and timelines.", "Written confirmation from you to begin; we then share a project plan and kick-off date."].forEach((s, i) => w.text(`${i + 1}.  ${s}`, { size: 10, gap: 3 }));
  w.text(`This proposal is valid for ${d.validityDays} days from ${d.date}.`, { size: 9, color: MUTED, gap: 4 });
  if (d.scopeNote) w.text(d.scopeNote, { size: 8.5, color: MUTED });

  w.pages.forEach((pg, i) => drawFooter(pg, font, i + 1, w.pages.length));
  return doc.save();
}
