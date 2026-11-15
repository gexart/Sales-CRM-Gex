// Audit report as a Word document. The body is written into Gexart_Letterhead.docx, so the header
// (logo + company block), footer and page setup are the letterhead exactly as designed.
import JSZip from "jszip";
import { LETTERHEAD_DOCX_BASE64 } from "./letterhead-docx";
import { resolvePhone } from "../../shared/letterhead";
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

export const FONT = "Lato";
export const INK = "111827";
export const ORANGE = "EA6A1F";
export const GRAY = "4B5563";
export const MUTED = "6B7280";
export const TINT = "F8F9FB";
export const GREEN = "168B4A";
export const AMBER = "D98509";
export const RED = "C72929";
export const SEV_HEX: Record<string, string> = { critical: "BA1C1C", high: "C2400D", medium: "B57308", low: "087399" };
export const CONTENT_W = 10178; // A4 minus the letterhead's 864 twip side margins

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
export const esc = (s: string) => s.replace(CONTROL, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const scoreHex = (s: number | null) => (s === null ? MUTED : s >= 80 ? GREEN : s >= 50 ? AMBER : RED);

export interface RunOpts {
  b?: boolean;
  i?: boolean;
  color?: string;
  sz?: number;
  font?: string;
  spacing?: number;
}
export const run = (t: string, o: RunOpts = {}) => {
  const f = o.font ?? FONT;
  return `<w:r><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}" w:eastAsia="${f}"/>${o.b ? "<w:b/><w:bCs/>" : ""}${o.i ? "<w:i/>" : ""}<w:color w:val="${o.color ?? INK}"/>${o.spacing ? `<w:spacing w:val="${o.spacing}"/>` : ""}<w:sz w:val="${o.sz ?? 20}"/><w:szCs w:val="${o.sz ?? 20}"/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
};

export interface ParaOpts {
  before?: number;
  after?: number;
  jc?: "left" | "right" | "center";
  keepNext?: boolean;
  borderBottom?: string;
  fill?: string;
  indent?: number;
  hanging?: number;
  line?: number;
}
export const para = (runs: string, o: ParaOpts = {}) => {
  const ind = o.indent ? `<w:ind w:left="${o.indent}"${o.hanging ? ` w:hanging="${o.hanging}"` : ""}/>` : "";
  const bdr = o.borderBottom ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="${o.borderBottom}"/></w:pBdr>` : "";
  const shd = o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : "";
  return `<w:p><w:pPr>${o.keepNext ? "<w:keepNext/>" : ""}<w:keepLines/>${bdr}${shd}<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 80}" w:line="${o.line ?? 276}" w:lineRule="auto"/>${ind}${o.jc ? `<w:jc w:val="${o.jc}"/>` : ""}</w:pPr>${runs}</w:p>`;
};
export const text = (t: string, o: RunOpts & ParaOpts = {}) => para(run(t, o), o);
export const spacer = (after = 100) => `<w:p><w:pPr><w:spacing w:before="0" w:after="${after}" w:line="120" w:lineRule="exact"/></w:pPr></w:p>`;
export const bullet = (t: string, color = INK, dot = GRAY) => para(run("•  ", { color: dot, b: true }) + run(t, { color, sz: 19 }), { indent: 300, hanging: 300, after: 50 });

export interface Cell {
  w: number;
  content: string;
  fill?: string;
  leftBar?: string;
  vAlign?: "top" | "center";
  pad?: number;
}
export const cell = (c: Cell) => {
  const pad = c.pad ?? 100;
  const padX = c.pad ?? 160;
  return `<w:tc><w:tcPr><w:tcW w:w="${c.w}" w:type="dxa"/>${c.leftBar ? `<w:tcBorders><w:left w:val="single" w:sz="36" w:space="0" w:color="${c.leftBar}"/></w:tcBorders>` : ""}${c.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${c.fill}"/>` : ""}<w:tcMar><w:top w:w="${pad}" w:type="dxa"/><w:left w:w="${padX}" w:type="dxa"/><w:bottom w:w="${pad}" w:type="dxa"/><w:right w:w="${padX}" w:type="dxa"/></w:tcMar><w:vAlign w:val="${c.vAlign ?? "top"}"/></w:tcPr>${c.content || "<w:p/>"}</w:tc>`;
};
export const table = (widths: number[], rows: Cell[][]) =>
  `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${rows.map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${r.map(cell).join("")}</w:tr>`).join("")}</w:tbl>`;

export const heading = (n: number, title: string) =>
  para(run(String(n).padStart(2, "0") + "   ", { b: true, color: ORANGE, sz: 32 }) + run(title, { b: true, sz: 32 }), { before: 320, after: 140, keepNext: true, borderBottom: "E5E7EB" });
export const label = (t: string, color = MUTED) => run(t.toUpperCase(), { b: true, sz: 14, color, spacing: 20 });
export const gap = (w: number): Cell => ({ w, content: '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>', pad: 0 });

export function statTile(w: number, value: string, caption: string, color: string): Cell {
  return { w, fill: TINT, leftBar: color, pad: 120, content: para(run(value, { b: true, sz: 40, color }), { after: 0, line: 240 }) + para(run(caption, { sz: 16, color: MUTED }), { after: 0 }) };
}

function findingBlock(f: ReportFinding): string {
  const color = SEV_HEX[f.severity] ?? MUTED;
  let c = para(run(f.title, { b: true, sz: 22 }) + (f.effort ? run(`     ${EFFORT_LABEL[f.effort] ?? f.effort}`, { sz: 16, color: MUTED, b: true }) : ""), { after: 40, keepNext: true });
  if (f.detail) c += para(run(f.detail, { sz: 19 }), { after: 60 });
  if (f.recommendation) c += para(label("Recommended action", ORANGE), { before: 60, after: 20, keepNext: true }) + para(run(f.recommendation, { sz: 19 }), { after: 60 });
  if (f.evidence.length) {
    c += para(label("Evidence"), { before: 60, after: 20, keepNext: true });
    for (const e of f.evidence.slice(0, 3)) c += para(run(`${e.path}  ${e.observation}`, { font: "Consolas", sz: 16, color: GRAY }), { after: 20, line: 240 });
  }
  if (f.services.length) c += para(run(`Related Gexart services: ${f.services.join(", ")}`, { b: true, sz: 16, color: GRAY }), { before: 60, after: 0 });
  return table([CONTENT_W], [[{ w: CONTENT_W, fill: TINT, leftBar: color, pad: 140, content: c }]]) + spacer(120);
}

export async function renderAuditDocx(d: AuditReportData): Promise<Uint8Array> {
  const issues = d.findings.filter(isIssue);
  const passed = passedOf(d);
  const unavailable = unavailableOf(d);
  const sev = countBySeverity(d);
  const wins = quickWins(d);
  let n = 1;
  let b = "";

  // Title block
  b += para(run("A U D I T   R E P O R T", { b: true, sz: 17, color: ORANGE, spacing: 30 }), { before: 120, after: 60 });
  b += para(run(d.accountName, { b: true, sz: 52 }), { after: 40, line: 240 });
  b += para(run(`${d.typeLabel}  ·  ${d.target}`, { sz: 20, color: MUTED }), { after: 200 });
  const t3 = Math.floor(CONTENT_W / 3);
  const metaCell = (w: number, k: string, v: string): Cell => ({ w, pad: 0, content: para(label(k), { after: 20 }) + para(run(v, { b: true }), { after: 0 }) });
  b += table([t3, t3, CONTENT_W - 2 * t3], [[metaCell(t3, "Audited on", d.auditedOn), metaCell(t3, "Prepared by", d.preparedBy || d.startedBy), metaCell(CONTENT_W - 2 * t3, "Rubric", d.auditVersion)]]);
  b += spacer(160);

  // Score panel
  const sc = scoreHex(d.score);
  b += table(
    [2900, CONTENT_W - 2900],
    [
      [
        { w: 2900, fill: TINT, leftBar: sc, vAlign: "center", pad: 180, content: para(run(d.score === null ? "N/A" : String(d.score), { b: true, sz: 100, color: sc }) + run(d.score === null ? "" : " /100", { sz: 24, color: MUTED }), { after: 20, line: 240 }) + para(run(gradeOf(d.score), { b: true, sz: 24, color: sc }), { after: 0 }) },
        { w: CONTENT_W - 2900, fill: TINT, vAlign: "center", pad: 180, content: para(label("Overall digital health"), { after: 60 }) + para(run(summaryParagraph(d), { sz: 20 }), { after: 0 }) },
      ],
    ],
  );
  b += spacer(140);
  const q = Math.floor((CONTENT_W - 3 * 120) / 4);
  const qLast = CONTENT_W - 3 * q - 360;
  b += table(
    [q, 120, q, 120, q, 120, qLast],
    [[statTile(q, String(sev.critical), "Critical", SEV_HEX.critical), gap(120), statTile(q, String(sev.high), "High priority", SEV_HEX.high), gap(120), statTile(q, String(sev.medium), "Medium priority", SEV_HEX.medium), gap(120), statTile(qLast, String(sev.low), "Low priority", SEV_HEX.low)]],
  );
  const sub = [`${passed.length} checks passed`, `${issues.length} need attention`, wins.length ? `${wins.length} quick wins` : "", unavailable.length ? `${unavailable.length} could not be checked` : ""].filter(Boolean).join("   ·   ");
  b += para(run(sub, { sz: 17, color: MUTED }), { before: 100, after: 60 });

  // Scorecard
  b += heading(n++, "Score by category");
  const cw = [3300, 1000, 1000, 1000, 3878];
  const head = (t: string, w: number): Cell => ({ w, pad: 80, content: para(label(t), { after: 0 }) });
  b += table(cw, [
    [head("Category", cw[0]), head("Weight", cw[1]), head("Passed", cw[2]), head("Issues", cw[3]), head("Score", cw[4])],
    ...d.categories.map((c): Cell[] => {
      const filled = c.score === null ? 0 : Math.round(c.score / 5);
      const bar = run("█".repeat(filled), { color: scoreHex(c.score), sz: 18 }) + run("█".repeat(20 - filled), { color: "E5E7EB", sz: 18 }) + run(`  ${c.score === null ? "N/A" : c.score}`, { b: true, color: scoreHex(c.score), sz: 24 });
      return [
        { w: cw[0], pad: 90, content: para(run(c.label, { b: true }), { after: 0 }) },
        { w: cw[1], pad: 90, content: para(run(`${c.weight}%`, { color: MUTED }), { after: 0 }) },
        { w: cw[2], pad: 90, content: para(run(String(c.passed), { color: MUTED }), { after: 0 }) },
        { w: cw[3], pad: 90, content: para(run(String(c.failed) + (c.unavailable ? ` (+${c.unavailable} n/a)` : ""), { color: MUTED }), { after: 0 }) },
        { w: cw[4], pad: 90, content: para(bar, { after: 0 }) },
      ];
    }),
  ]);
  b += spacer(80);

  // Priority actions
  const top5 = prioritised(d).slice(0, 5);
  if (top5.length) {
    b += heading(n++, "Priority actions");
    b += text("The issues most worth fixing first, ordered by severity and then by how little effort they take.", { sz: 18, color: MUTED, after: 120 });
    b += table(
      [600, CONTENT_W - 2500, 1900],
      top5.map((f, i): Cell[] => [
        { w: 600, pad: 100, vAlign: "center", content: para(run(String(i + 1), { b: true, sz: 28, color: ORANGE }), { jc: "center", after: 0 }) },
        { w: CONTENT_W - 2500, pad: 100, content: para(run(f.title, { b: true }), { after: 20, keepNext: true }) + para(run(f.recommendation ?? f.detail, { sz: 18, color: GRAY }), { after: 0 }) },
        { w: 1900, pad: 100, vAlign: "center", content: para(run(SEV_LABEL[f.severity as keyof typeof SEV_LABEL] ?? f.severity, { b: true, sz: 17, color: SEV_HEX[f.severity] ?? MUTED }), { jc: "right", after: 0 }) },
      ]),
    );
    b += spacer(80);
    if (wins.length) {
      b += para(label("Quick wins: high impact, low effort", GREEN), { before: 120, after: 60, keepNext: true });
      for (const f of wins) b += bullet(f.title, INK, GREEN);
    }
  }

  // Progress
  if (d.compare) {
    const c = d.compare;
    b += heading(n++, "Progress since the previous audit");
    const t = Math.floor((CONTENT_W - 240) / 3);
    const tLast = CONTENT_W - 2 * t - 240;
    const chg = c.scoreChange === null ? "N/A" : `${c.scoreChange > 0 ? "+" : ""}${c.scoreChange} pts`;
    b += table(
      [t, 120, t, 120, tLast],
      [[statTile(t, chg, `Score change since ${c.previousOn}`, c.scoreChange === null ? MUTED : c.scoreChange >= 0 ? GREEN : RED), gap(120), statTile(t, String(c.resolved.length), "Issues resolved", GREEN), gap(120), statTile(tLast, String(c.newIssues.length), "New issues", c.newIssues.length ? RED : MUTED)]],
    );
    b += spacer(100);
    if (!c.sameRubric) b += text("Note: the previous audit used a different rubric version, so compare with care.", { sz: 17, color: AMBER });
    if (c.resolved.length) {
      b += para(label("Resolved", GREEN), { before: 80, after: 40, keepNext: true });
      for (const x of c.resolved.slice(0, 8)) b += bullet(x, INK, GREEN);
    }
    if (c.newIssues.length) {
      b += para(label("New issues", RED), { before: 80, after: 40, keepNext: true });
      for (const x of c.newIssues.slice(0, 8)) b += bullet(x, INK, RED);
    }
  }

  // Findings
  if (issues.length) {
    b += heading(n++, "Detailed findings");
    for (const s of SEVERITIES) {
      const group = issues.filter((f) => f.severity === s);
      if (!group.length) continue;
      b += para(run(`  ${SEV_LABEL[s].toUpperCase()}   |   ${group.length} ${group.length === 1 ? "finding" : "findings"}`, { b: true, sz: 18, color: "FFFFFF" }), { before: 160, after: 120, fill: SEV_HEX[s], keepNext: true, line: 320 });
      for (const f of group) b += findingBlock(f);
    }
  }

  // Working well
  if (passed.length) {
    b += heading(n++, "What is working well");
    const half = Math.ceil(passed.length / 2);
    const colW = CONTENT_W / 2;
    const col = (items: ReportFinding[]) => items.map((f) => para(run("✓  ", { b: true, color: GREEN }) + run(f.title, { sz: 19 }), { indent: 320, hanging: 320, after: 50 })).join("");
    b += table([colW, colW], [[{ w: colW, pad: 40, content: col(passed.slice(0, half)) }, { w: colW, pad: 40, content: col(passed.slice(half)) }]]);
    b += spacer(80);
  }

  if (unavailable.length) {
    b += heading(n++, "Could not be checked");
    b += text("These checks need access or data that was not available to the audit. They are excluded from the score.", { sz: 18, color: MUTED, after: 100 });
    for (const f of unavailable) b += para(run("•  ", { b: true, color: MUTED }) + run(f.title, { b: true, sz: 19 }) + (f.detail ? run(`  ${f.detail}`, { sz: 17, color: MUTED }) : ""), { indent: 300, hanging: 300, after: 60 });
  }

  const services = serviceRollup(d);
  if (services.length) {
    b += heading(n++, "How Gexart can help");
    for (const s of services) {
      const line = `Addresses ${s.findings.length} ${s.findings.length === 1 ? "finding" : "findings"}: ${s.findings.slice(0, 4).join("; ")}${s.findings.length > 4 ? "; ..." : ""}`;
      b += table([CONTENT_W], [[{ w: CONTENT_W, fill: TINT, leftBar: ORANGE, pad: 130, content: para(run(s.name, { b: true, sz: 22 }), { after: 30, keepNext: true }) + para(run(line, { sz: 18, color: GRAY }), { after: 0 }) }]]);
      b += spacer(100);
    }
    b += para(run("Suggested next steps", { b: true, sz: 22 }), { before: 120, after: 60, keepNext: true });
    ["Review this report and share any questions with your Gexart contact.", "Agree the priority actions and the order they should be done in.", "Gexart prepares a fixed-scope plan and quote, then schedules the work."].forEach((s, i) => {
      b += para(run(`${i + 1}.  `, { b: true, color: ORANGE }) + run(s, { sz: 19 }), { indent: 360, hanging: 360, after: 50 });
    });
  }

  b += heading(n++, "Scope and method");
  b += text(`Pages inspected (${d.scope.pages.length}): ${d.scope.pages.join(", ") || "none recorded"}.`, { sz: 18 });
  if (d.scope.linksDiscovered) b += text(`${d.scope.linksChecked} internal links were checked out of ${d.scope.linksDiscovered} discovered.`, { sz: 18 });
  if (d.scope.note) b += text(d.scope.note, { sz: 18 });
  b += text(
    "The score is the weighted share of passed checks in each category (partial results count half; checks that could not be run are excluded). It reflects publicly observable evidence on the pages inspected and is not a full-site crawl. It does not measure search rankings, traffic or AI visibility, and is not a guarantee of results.",
    { sz: 18, color: MUTED },
  );
  for (const x of d.warnings) b += text(`Warning: ${x}`, { sz: 18, color: AMBER });

  return wrapInLetterhead(b, d.phone);
}

/** Writes body XML into Gexart_Letterhead.docx, keeping its header, footer and page setup. */
export async function wrapInLetterhead(bodyXml: string, phone?: string | null): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(LETTERHEAD_DOCX_BASE64, { base64: true });
  // The letterhead lists two numbers; print only the one chosen for this document.
  const header = await zip.file("word/header1.xml")!.async("string");
  zip.file("word/header1.xml", header.replace(/\+91 8274872626\s*[·•]\s*\+91 9038991880/, resolvePhone(phone)));
  const xml = await zip.file("word/document.xml")!.async("string");
  const sect = xml.match(/<w:sectPr[\s\S]*<\/w:sectPr>/)?.[0] ?? "";
  zip.file("word/document.xml", xml.replace(/<w:body>[\s\S]*<\/w:body>/, () => `<w:body>${bodyXml}${sect}</w:body>`));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
