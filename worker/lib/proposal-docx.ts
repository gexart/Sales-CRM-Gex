// Proposal as a Word document written into Gexart_Letterhead.docx (same letterhead as the PDF).
import type { ProposalData } from "./pdf";
import {
  CONTENT_W,
  GRAY,
  INK,
  MUTED,
  ORANGE,
  SEV_HEX,
  TINT,
  bullet,
  heading,
  label,
  para,
  run,
  spacer,
  table,
  text,
  wrapInLetterhead,
  type Cell,
} from "./audit-docx";

export async function renderProposalDocx(d: ProposalData): Promise<Uint8Array> {
  let b = "";
  b += para(run(d.title.toUpperCase(), { b: true, sz: 17, color: ORANGE, spacing: 40 }), { before: 120, after: 60 });
  b += para(run(d.clientName, { b: true, sz: 52 }), { after: 40, line: 240 });
  if (d.clientMeta) b += para(run(d.clientMeta, { sz: 20, color: MUTED }), { after: 200 });
  const q = Math.floor(CONTENT_W / 4);
  const metaCell = (w: number, k: string, v: string): Cell => ({ w, pad: 0, content: para(label(k), { after: 20 }) + para(run(v, { b: true }), { after: 0 }) });
  b += table(
    [q, q, q, CONTENT_W - 3 * q],
    [[metaCell(q, "Prepared for", d.contactLine ?? d.clientName), metaCell(q, "Prepared by", `${d.preparedBy}, Gexart`), metaCell(q, "Date", d.date), metaCell(CONTENT_W - 3 * q, "Valid for", `${d.validityDays} days`)]],
  );
  b += spacer(160);
  if (d.introNote) {
    b += table([CONTENT_W], [[{ w: CONTENT_W, fill: TINT, leftBar: ORANGE, pad: 150, content: para(run(d.introNote, { sz: 20 }), { after: 0 }) }]]);
    b += spacer(120);
  }

  let n = 1;
  b += heading(n++, "Executive summary");
  b += text(d.summary, { sz: 21, after: 120 });

  if (d.findings.length) {
    b += heading(n++, "What we found");
    for (const f of d.findings) {
      const color = SEV_HEX[f.severity] ?? MUTED;
      let c = para(run(f.title, { b: true, sz: 22 }) + run(`     ${f.severity.toUpperCase()}`, { b: true, sz: 15, color }), { after: 40, keepNext: true });
      c += para(run(f.detail, { sz: 19 }), { after: 40 });
      if (f.evidence) c += para(run(`Evidence: ${f.evidence}`, { sz: 16, color: MUTED }), { after: 0 });
      b += table([CONTENT_W], [[{ w: CONTENT_W, fill: TINT, leftBar: color, pad: 130, content: c }]]) + spacer(100);
    }
  }

  b += heading(n++, "Recommended solutions");
  for (const s of d.solutions) {
    let c = para(run(`${s.service}${s.packageName ? ` - ${s.packageName}` : ""}`, { b: true, sz: 23 }), { after: 40, keepNext: true });
    if (s.description) c += para(run(s.description, { sz: 19 }), { after: 60 });
    for (const del of s.deliverables.slice(0, 10)) c += bullet(del, INK, ORANGE);
    if (s.timeline) c += para(run(`Timeline: ${s.timeline}`, { b: true, sz: 18, color: GRAY }), { before: 60, after: 0 });
    b += table([CONTENT_W], [[{ w: CONTENT_W, fill: TINT, leftBar: ORANGE, pad: 140, content: c }]]) + spacer(100);
  }

  b += heading(n++, "Investment");
  const cw = [4000, 1700, 700, 1700, CONTENT_W - 8100];
  const head = (t: string, w: number, right = false): Cell => ({ w, fill: INK, pad: 90, content: para(run(t, { b: true, sz: 17, color: "FFFFFF" }), { after: 0, jc: right ? "right" : "left" }) });
  b += table(cw, [
    [head("Service / package", cw[0]), head("Billing", cw[1]), head("Qty", cw[2]), head("Unit price", cw[3], true), head("Total", cw[4], true)],
    ...d.prices.map((r, i): Cell[] => {
      const fill = i % 2 === 0 ? TINT : undefined;
      const cell = (w: number, t: string, o: { b?: boolean; right?: boolean; muted?: boolean } = {}): Cell => ({ w, fill, pad: 90, content: para(run(t, { sz: 19, b: o.b, color: o.muted ? MUTED : INK }), { after: 0, jc: o.right ? "right" : "left" }) });
      return [
        cell(cw[0], `${r.service}${r.packageName ? ` - ${r.packageName}` : ""}`, { b: true }),
        cell(cw[1], r.billing),
        cell(cw[2], String(r.qty)),
        cell(cw[3], r.unit, { right: true, muted: r.custom }),
        cell(cw[4], r.total, { right: true, b: true, muted: r.custom }),
      ];
    }),
    ...d.totals.map((t): Cell[] => [
      { w: cw[0], pad: 90, content: "<w:p/>" },
      { w: cw[1], pad: 90, content: "<w:p/>" },
      { w: cw[2], pad: 90, content: "<w:p/>" },
      { w: cw[3], pad: 90, content: para(run(t.label, { b: true, sz: 19, color: GRAY }), { after: 0, jc: "right" }) },
      { w: cw[4], pad: 90, fill: TINT, content: para(run(t.value, { b: true, sz: 22 }), { after: 0, jc: "right" }) },
    ]),
  ]);
  b += spacer(80);
  b += text(d.priceNote, { sz: 17, color: MUTED });

  b += heading(n++, "Next steps");
  ["Review this proposal and share any questions.", "A short discovery call to confirm scope, priorities and timelines.", "Written confirmation from you to begin; we then share a project plan and kick-off date."].forEach((s, i) => {
    b += para(run(`${i + 1}.  `, { b: true, color: ORANGE }) + run(s, { sz: 20 }), { indent: 360, hanging: 360, after: 50 });
  });
  b += text(`This proposal is valid for ${d.validityDays} days from ${d.date}.`, { sz: 18, color: MUTED, before: 100 });
  if (d.scopeNote) b += text(d.scopeNote, { sz: 17, color: MUTED });
  return wrapInLetterhead(b);
}
