// Audit report as a PDF on the Gexart letterhead (logo + company block + orange/navy rule on every page,
// footer "Gexart Technologies · A unit of Gexart Ventures"). pdf-lib only, so it runs inside the Worker.
import { LineCapStyle, PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { LETTERHEAD, LOGO_PNG_BASE64 } from "../../shared/letterhead";
import { H, INK, LINE, M, MUTED, SEV, W, Writer, pdfSafe } from "./pdf";
import {
  EFFORT_LABEL,
  SEVERITIES,
  SEV_LABEL,
  countBySeverity,
  gradeOf,
  isIssue,
  passedOf,
  prioritised,
  quickWins,
  serviceRollup,
  summaryParagraph,
  unavailableOf,
  type AuditReportData,
  type ReportFinding,
} from "../../shared/audit-report";

type Color = ReturnType<typeof rgb>;
const WHITE = rgb(1, 1, 1);
const GREEN = rgb(0.086, 0.545, 0.29);
const AMBER = rgb(0.85, 0.52, 0.04);
const RED = rgb(0.78, 0.16, 0.16);
const TINT = rgb(0.972, 0.976, 0.984);
const TRACK = rgb(0.9, 0.915, 0.94);
const LH_INK = rgb(0.067, 0.094, 0.153); // 111827
const LH_ORANGE = rgb(0.918, 0.416, 0.122); // EA6A1F
const LH_GRAY = rgb(0.294, 0.333, 0.388); // 4B5563
const CONTENT_TOP = H - 128;

const scoreColor = (s: number | null): Color => (s === null ? MUTED : s >= 80 ? GREEN : s >= 50 ? AMBER : RED);
const spaced = (s: string) => s.toUpperCase().split(/\s+/).map((w) => w.split("").join(" ")).join("   ");

/** Every page starts on the letterhead. */
class LetterheadWriter extends Writer {
  logo!: PDFImage;
  newPage() {
    super.newPage();
    drawLetterhead(this.page, this.logo, this.font, this.bold);
    this.y = CONTENT_TOP;
  }
}

function drawLetterhead(page: PDFPage, logo: PDFImage, font: PDFFont, bold: PDFFont) {
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

function drawFooter(page: PDFPage, font: PDFFont, i: number, total: number) {
  page.drawRectangle({ x: M, y: 46, width: W - 2 * M, height: 0.5, color: LINE });
  page.drawText(pdfSafe(`${LETTERHEAD.company}  ·  ${LETTERHEAD.unit}`), { x: M, y: 32, size: 7.5, font, color: MUTED });
  const r = pdfSafe(`${LETTERHEAD.web}   |   Page ${i} of ${total}`);
  page.drawText(r, { x: W - M - font.widthOfTextAtSize(r, 7.5), y: 32, size: 7.5, font, color: MUTED });
}

/** Score ring: a light track plus a rounded progress arc starting at 12 o'clock, clockwise. */
function drawRing(page: PDFPage, cx: number, cy: number, r: number, thick: number, score: number | null, font: PDFFont, bold: PDFFont) {
  page.drawCircle({ x: cx, y: cy, size: r, borderColor: TRACK, borderWidth: thick });
  if (score !== null && score > 0) {
    const total = (Math.min(100, score) / 100) * 2 * Math.PI;
    const steps = Math.max(2, Math.ceil(total / 0.05));
    for (let i = 0; i < steps; i++) {
      const a0 = Math.PI / 2 - (total * i) / steps;
      const a1 = Math.PI / 2 - (total * (i + 1)) / steps;
      page.drawLine({
        start: { x: cx + r * Math.cos(a0), y: cy + r * Math.sin(a0) },
        end: { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) },
        thickness: thick,
        color: scoreColor(score),
        lineCap: LineCapStyle.Round,
      });
    }
  }
  const t = score === null ? "N/A" : String(score);
  const size = score === null ? 20 : 30;
  page.drawText(t, { x: cx - bold.widthOfTextAtSize(t, size) / 2, y: cy - size * 0.22, size, font: bold, color: LH_INK });
  if (score !== null) page.drawText("out of 100", { x: cx - font.widthOfTextAtSize("out of 100", 7.5) / 2, y: cy - size * 0.22 - 13, size: 7.5, font, color: MUTED });
}

export async function renderAuditPdf(d: AuditReportData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`${d.typeLabel} report - ${d.accountName}`));
  doc.setAuthor(LETTERHEAD.company);
  doc.setCreator("Gexart CRM");
  doc.setSubject(pdfSafe(`${d.typeLabel} of ${d.host}`));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const w = new LetterheadWriter(doc, font, bold);
  w.logo = await doc.embedPng(Uint8Array.from(atob(LOGO_PNG_BASE64), (ch) => ch.charCodeAt(0)));

  const issues = d.findings.filter(isIssue);
  const passed = passedOf(d);
  const unavailable = unavailableOf(d);
  const sev = countBySeverity(d);
  const wins = quickWins(d);
  const box = (x: number, top: number, bw: number, bh: number, color: Color) => w.page.drawRectangle({ x, y: top - bh, width: bw, height: bh, color });
  const txt = (s: string, x: number, top: number, size: number, f: PDFFont = font, color: Color = INK) => w.page.drawText(pdfSafe(s), { x, y: top - size, size, font: f, color });
  const chip = (label: string, x: number, top: number, color: Color) => {
    const cw = bold.widthOfTextAtSize(pdfSafe(label), 7) + 10;
    box(x, top, cw, 13, color);
    w.page.drawText(pdfSafe(label), { x: x + 5, y: top - 9.5, size: 7, font: bold, color: WHITE });
    return cw;
  };
  const tile = (x: number, top: number, tw: number, value: string, label: string, color: Color) => {
    box(x, top, tw, 52, TINT);
    box(x, top, 3, 52, color);
    txt(value, x + 13, top - 8, 20, bold, color);
    txt(label, x + 13, top - 34, 8, font, MUTED);
  };

  // ── Page 1: title block + score panel ──
  w.newPage();
  txt(spaced("Audit report"), M, w.y, 8.5, bold, LH_ORANGE);
  const nameLines = w.wrap(d.accountName, 26, W - 2 * M, bold).slice(0, 2);
  nameLines.forEach((l, i) => txt(l, M, w.y - 16 - i * 31, 26, bold, LH_INK));
  w.y -= 16 + nameLines.length * 31 + 2;
  txt(`${d.typeLabel}  ·  ${d.target}`, M, w.y, 10, font, MUTED);
  w.y -= 26;
  const metaCols: [string, string][] = [["Audited on", d.auditedOn], ["Prepared by", d.preparedBy || d.startedBy], ["Rubric", d.auditVersion]];
  metaCols.forEach(([k, v], i) => {
    txt(k.toUpperCase(), M + i * 175, w.y, 7, bold, MUTED);
    txt(v, M + i * 175, w.y - 11, 10, bold, LH_INK);
  });
  w.y -= 40;

  // score panel
  const panelH = 142;
  box(M, w.y, W - 2 * M, panelH, TINT);
  box(M, w.y, W - 2 * M, 2.5, scoreColor(d.score));
  drawRing(w.page, M + 70, w.y - panelH / 2 - 1, 42, 10, d.score, font, bold);
  const tx = M + 140;
  txt("OVERALL DIGITAL HEALTH", tx, w.y - 16, 7.5, bold, MUTED);
  txt(gradeOf(d.score), tx, w.y - 28, 19, bold, scoreColor(d.score));
  w.wrap(summaryParagraph(d), 9.3, W - M - 14 - tx).slice(0, 6).forEach((l, i) => txt(l, tx, w.y - 56 - i * 12.2, 9.3, font, INK));
  w.y -= panelH + 12;

  // severity tiles
  const tw = (W - 2 * M - 30) / 4;
  SEVERITIES.forEach((s, i) => tile(M + i * (tw + 10), w.y, tw, String(sev[s]), SEV_LABEL[s], SEV[s] ?? MUTED));
  w.y -= 52 + 8;
  const sub = [`${passed.length} checks passed`, `${issues.length} need attention`, wins.length ? `${wins.length} quick wins` : null, unavailable.length ? `${unavailable.length} could not be checked` : null].filter(Boolean).join("   ·   ");
  txt(sub, M, w.y, 8.5, font, MUTED);
  w.y -= 22;

  let n = 1;
  // ── Score by category ──
  w.heading(n++, "Score by category");
  for (const c of d.categories) {
    w.ensure(36);
    const top = w.y;
    txt(c.label, M, top, 10, bold, LH_INK);
    txt(`Weight ${c.weight}%   ·   ${c.passed} passed   ·   ${c.failed} issues${c.unavailable ? `   ·   ${c.unavailable} n/a` : ""}`, M, top - 14, 7.8, font, MUTED);
    const bx = M + 250;
    const bw = W - M - 50 - bx;
    w.page.drawLine({ start: { x: bx + 3.5, y: top - 9 }, end: { x: bx + bw - 3.5, y: top - 9 }, thickness: 7, color: TRACK, lineCap: LineCapStyle.Round });
    if (c.score !== null && c.score > 0) w.page.drawLine({ start: { x: bx + 3.5, y: top - 9 }, end: { x: bx + 3.5 + ((bw - 7) * c.score) / 100, y: top - 9 }, thickness: 7, color: scoreColor(c.score), lineCap: LineCapStyle.Round });
    const st = c.score === null ? "N/A" : String(c.score);
    txt(st, W - M - bold.widthOfTextAtSize(st, 13), top - 2, 13, bold, scoreColor(c.score));
    w.y -= 36;
  }

  // ── Priority actions ──
  const top5 = prioritised(d).slice(0, 5);
  if (top5.length) {
    w.heading(n++, "Priority actions");
    w.text("The issues most worth fixing first, ordered by severity and then by how little effort they take.", { size: 9, color: MUTED, gap: 8 });
    top5.forEach((f, i) => {
      const rec = w.wrap(f.recommendation ?? f.detail, 9, W - 2 * M - 34).slice(0, 2);
      const titleL = w.wrap(f.title, 10.5, W - 2 * M - 34 - 90, bold).slice(0, 2);
      const h = titleL.length * 14 + rec.length * 12 + 14;
      w.ensure(h + 6);
      const top = w.y;
      w.page.drawCircle({ x: M + 10, y: top - 11, size: 10, color: LH_ORANGE });
      const num = String(i + 1);
      w.page.drawText(num, { x: M + 10 - bold.widthOfTextAtSize(num, 10) / 2, y: top - 14.5, size: 10, font: bold, color: WHITE });
      titleL.forEach((l, k) => txt(l, M + 30, top - 2 - k * 14, 10.5, bold, LH_INK));
      chip(SEV_LABEL[f.severity as keyof typeof SEV_LABEL] ?? f.severity, W - M - 80, top - 1, SEV[f.severity] ?? MUTED);
      rec.forEach((l, k) => txt(l, M + 30, top - 4 - titleL.length * 14 - k * 12, 9, font, INK));
      w.y -= h + 6;
    });
  }
  if (wins.length) {
    w.ensure(60);
    w.y -= 4;
    txt("QUICK WINS: HIGH IMPACT, LOW EFFORT", M, w.y, 7.5, bold, GREEN);
    w.y -= 16;
    wins.forEach((f) => {
      const l = w.wrap(f.title, 9.5, W - 2 * M - 22)[0];
      w.ensure(16);
      w.page.drawCircle({ x: M + 4, y: w.y - 6, size: 2.6, color: GREEN });
      txt(l, M + 16, w.y, 9.5, font, INK);
      w.y -= 16;
    });
  }

  // ── Progress since previous audit ──
  if (d.compare) {
    w.heading(n++, "Progress since the previous audit");
    w.ensure(70);
    const c = d.compare;
    const cw3 = (W - 2 * M - 20) / 3;
    const chg = c.scoreChange === null ? "N/A" : `${c.scoreChange > 0 ? "+" : ""}${c.scoreChange} pts`;
    tile(M, w.y, cw3, chg, `Score change since ${c.previousOn}`, c.scoreChange === null ? MUTED : c.scoreChange >= 0 ? GREEN : RED);
    tile(M + cw3 + 10, w.y, cw3, String(c.resolved.length), "Issues resolved", GREEN);
    tile(M + 2 * (cw3 + 10), w.y, cw3, String(c.newIssues.length), "New issues", c.newIssues.length ? RED : MUTED);
    w.y -= 52 + 12;
    if (!c.sameRubric) w.text("Note: the previous audit used a different rubric version, so compare with care.", { size: 8.5, color: AMBER });
    for (const [label, items, color] of [["Resolved", c.resolved, GREEN], ["New issues", c.newIssues, RED]] as [string, string[], Color][]) {
      if (!items.length) continue;
      w.ensure(30);
      txt(label.toUpperCase(), M, w.y, 7.5, bold, color);
      w.y -= 15;
      items.slice(0, 8).forEach((t) => {
        w.ensure(14);
        w.page.drawCircle({ x: M + 4, y: w.y - 5.5, size: 2.4, color });
        txt(w.wrap(t, 9, W - 2 * M - 20)[0], M + 14, w.y, 9, font, INK);
        w.y -= 14;
      });
      w.y -= 6;
    }
  }

  // ── Detailed findings ──
  const card = (f: ReportFinding) => {
    const color = SEV[f.severity] ?? MUTED;
    const cw = W - 2 * M;
    const ix = M + 16;
    const iw = cw - 30;
    const eff = f.effort ? EFFORT_LABEL[f.effort] ?? f.effort : "";
    const chipW = eff ? bold.widthOfTextAtSize(pdfSafe(eff), 7) + 10 : 0;
    const title = w.wrap(f.title, 10.5, iw - (chipW ? chipW + 10 : 0), bold);
    const detail = f.detail ? w.wrap(f.detail, 9.2, iw) : [];
    const rec = f.recommendation ? w.wrap(f.recommendation, 9.2, iw) : [];
    const ev = f.evidence.slice(0, 3).map((e) => w.wrap(`${e.path}  ${e.observation}`, 7.6, iw - 10, mono).slice(0, 3));
    const svc = f.services.length ? w.wrap(`Related Gexart services: ${f.services.join(", ")}`, 8, iw).slice(0, 2) : [];
    let h = 10 + title.length * 14 + 3 + detail.length * 12.5 + 10;
    if (rec.length) h += 7 + 12 + rec.length * 12.5;
    if (ev.length) h += 7 + 11 + ev.reduce((a, l) => a + l.length * 10.2, 0);
    if (svc.length) h += 5 + svc.length * 11;
    w.ensure(h + 8);
    const top = w.y;
    box(M, top, cw, h, TINT);
    box(M, top, 4, h, color);
    if (chipW) {
      box(M + cw - 10 - chipW, top - 9, chipW, 13, TRACK);
      w.page.drawText(pdfSafe(eff), { x: M + cw - 10 - chipW + 5, y: top - 18.5, size: 7, font: bold, color: LH_GRAY });
    }
    let y = top - 10;
    title.forEach((l) => {
      txt(l, ix, y, 10.5, bold, LH_INK);
      y -= 14;
    });
    y -= 3;
    detail.forEach((l) => {
      txt(l, ix, y, 9.2, font, INK);
      y -= 12.5;
    });
    if (rec.length) {
      y -= 7;
      txt("RECOMMENDED ACTION", ix, y, 7, bold, LH_ORANGE);
      y -= 12;
      rec.forEach((l) => {
        txt(l, ix, y, 9.2, font, INK);
        y -= 12.5;
      });
    }
    if (ev.length) {
      y -= 7;
      txt("EVIDENCE", ix, y, 7, bold, MUTED);
      y -= 11;
      ev.forEach((lines) =>
        lines.forEach((l) => {
          txt(l, ix + 4, y, 7.6, mono, LH_GRAY);
          y -= 10.2;
        }),
      );
    }
    if (svc.length) {
      y -= 5;
      svc.forEach((l) => {
        txt(l, ix, y, 8, bold, LH_GRAY);
        y -= 11;
      });
    }
    w.y -= h + 8;
  };
  if (issues.length) {
    w.heading(n++, "Detailed findings");
    for (const s of SEVERITIES) {
      const group = issues.filter((f) => f.severity === s);
      if (!group.length) continue;
      w.ensure(210); // keep the band with at least its first finding
      box(M, w.y, W - 2 * M, 20, SEV[s] ?? MUTED);
      txt(`${SEV_LABEL[s].toUpperCase()}   |   ${group.length} ${group.length === 1 ? "finding" : "findings"}`, M + 10, w.y - 5.5, 9, bold, WHITE);
      w.y -= 28;
      group.forEach(card);
    }
  }

  // ── What is working well ──
  if (passed.length) {
    w.heading(n++, "What is working well");
    const colW = (W - 2 * M - 20) / 2;
    for (let i = 0; i < passed.length; i += 2) {
      const pair = passed.slice(i, i + 2).map((f) => w.wrap(f.title, 9, colW - 20).slice(0, 2));
      const h = Math.max(...pair.map((l) => l.length)) * 11.5 + 6;
      w.ensure(h);
      pair.forEach((lines, k) => {
        const x = M + k * (colW + 20);
        const top = w.y;
        w.page.drawLine({ start: { x: x + 1, y: top - 8 }, end: { x: x + 4.5, y: top - 11.5 }, thickness: 1.5, color: GREEN, lineCap: LineCapStyle.Round });
        w.page.drawLine({ start: { x: x + 4.5, y: top - 11.5 }, end: { x: x + 11, y: top - 3.5 }, thickness: 1.5, color: GREEN, lineCap: LineCapStyle.Round });
        lines.forEach((l, j) => txt(l, x + 18, top - j * 11.5, 9, font, INK));
      });
      w.y -= h;
    }
  }

  // ── Could not be checked ──
  if (unavailable.length) {
    w.heading(n++, "Could not be checked");
    w.text("These checks need access or data that was not available to the audit. They are excluded from the score.", { size: 9, color: MUTED, gap: 6 });
    unavailable.forEach((f) => {
      const t = w.wrap(f.title, 9.2, W - 2 * M - 16, bold);
      const dl = w.wrap(f.detail, 8.5, W - 2 * M - 16).slice(0, 2);
      const h = t.length * 12 + dl.length * 11 + 7;
      w.ensure(h);
      const top = w.y;
      w.page.drawCircle({ x: M + 3.5, y: top - 6, size: 2.3, color: MUTED });
      t.forEach((l, i) => txt(l, M + 14, top - i * 12, 9.2, bold, INK));
      dl.forEach((l, i) => txt(l, M + 14, top - t.length * 12 - i * 11, 8.5, font, MUTED));
      w.y -= h;
    });
  }

  // ── Recommended Gexart services ──
  const services = serviceRollup(d);
  if (services.length) {
    w.heading(n++, "How Gexart can help");
    for (const s of services) {
      const l = w.wrap(`Addresses ${s.findings.length} ${s.findings.length === 1 ? "finding" : "findings"}: ${s.findings.slice(0, 4).join("; ")}${s.findings.length > 4 ? "; ..." : ""}`, 8.8, W - 2 * M - 26);
      const h = 18 + l.length * 11.5 + 10;
      w.ensure(h + 6);
      const top = w.y;
      box(M, top, W - 2 * M, h, TINT);
      box(M, top, 4, h, LH_ORANGE);
      txt(s.name, M + 16, top - 9, 10.5, bold, LH_INK);
      l.forEach((t, i) => txt(t, M + 16, top - 25 - i * 11.5 + 2, 8.8, font, LH_GRAY));
      w.y -= h + 6;
    }
    w.y -= 4;
    w.text("Suggested next steps", { size: 10.5, font: bold, color: LH_INK, gap: 4 });
    ["Review this report and share any questions with your Gexart contact.", "Agree the priority actions and the order they should be done in.", "Gexart prepares a fixed-scope plan and quote, then schedules the work."].forEach((s, i) => w.text(`${i + 1}.  ${s}`, { size: 9.5, gap: 3 }));
  }

  // ── Scope and method ──
  w.heading(n++, "Scope and method");
  w.text(`Pages inspected (${d.scope.pages.length}): ${d.scope.pages.join(", ") || "none recorded"}.`, { size: 9, gap: 4 });
  if (d.scope.linksDiscovered) w.text(`${d.scope.linksChecked} internal links were checked out of ${d.scope.linksDiscovered} discovered.`, { size: 9, gap: 4 });
  if (d.scope.note) w.text(d.scope.note, { size: 9, gap: 4 });
  w.text("The score is the weighted share of passed checks in each category (partial results count half; checks that could not be run are excluded). It reflects publicly observable evidence on the pages inspected and is not a full-site crawl. It does not measure search rankings, traffic or AI visibility, and is not a guarantee of results.", { size: 9, color: MUTED, gap: 4 });
  d.warnings.forEach((x) => w.text(`Warning: ${x}`, { size: 9, color: AMBER, gap: 3 }));

  w.pages.forEach((pg, i) => drawFooter(pg, font, i + 1, w.pages.length));
  return doc.save();
}
