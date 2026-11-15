// Builds a genuine .pptx in the browser from a reviewed outline, in the fixed Gexart deck format
// (same look as the CRM-ERP enterprise deck: navy cover and closing, white content slides, orange
// letter-spaced eyebrows, contact footer with logo and page number). pptxgenjs is loaded on demand.
import { LETTERHEAD, LOGO_ASPECT, LOGO_PNG_BASE64, resolvePhone } from "../../shared/letterhead";

export interface Slide {
  layout: "title" | "section" | "bullets" | "two_column" | "table" | "metrics" | "closing";
  title: string;
  subtitle: string;
  bullets: string[];
  left_heading: string;
  left_bullets: string[];
  right_heading: string;
  right_bullets: string[];
  table_headers: string[];
  table_rows: string[][];
  metrics: { label: string; value: string }[];
  notes: string;
  /** Small orange caption above the title. Defaults to the client name. */
  eyebrow?: string;
}

const NAVY = "0F1B2D";
const PANEL = "16233A";
const PANEL_LINE = "24344F";
const ORANGE = "F47A20";
const INK = "0F172A";
const MUTED = "5B6B82";
const SOFT = "AEB9CC";
const PALE = "C9D3E3";
const LINE = "E5E7EB";
const CARD = "F8FAFC";
const RED = "B42318";
const RED_BG = "FDEEEE";
const RED_LINE = "F8CFCF";
const GREEN = "16A34A";
const AMBER = "D97706";
const FONT = "Arial";
const SEV_COLOR: Record<string, string> = { critical: "B42318", high: "C2410C", medium: "B45309", low: "0E7490" };

const LOGO = `image/png;base64,${LOGO_PNG_BASE64}`;
const LOGO_W = 0.92;
const LOGO_H = LOGO_W / LOGO_ASPECT;

const pick = (s: string, big: number, mid: number, small: number, a: number, b: number) => (s.length > b ? small : s.length > a ? mid : big);
const scoreColor = (n: number) => (n >= 80 ? GREEN : n >= 50 ? AMBER : "DC2626");

export interface DeckMeta {
  title: string;
  company: string;
  author: string;
  /** The one contact number printed in footers and on the closing slide. */
  phone?: string;
}

export async function buildPptx(slides: Slide[], meta: DeckMeta): Promise<Blob> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.author = meta.author;
  pptx.company = LETTERHEAD.company;
  pptx.title = meta.title;
  const phone = resolvePhone(meta.phone);
  const CONTACT = [LETTERHEAD.email, phone, LETTERHEAD.addressShort, LETTERHEAD.web].join("  ·  ");

  const footer = (dark: boolean, number: boolean) => ({
    objects: [
      ...(dark
        ? [
            { rect: { x: 0.6, y: 6.9, w: LOGO_W + 0.2, h: LOGO_H + 0.14, fill: { color: "FFFFFF" } } },
            { image: { x: 0.7, y: 6.97, w: LOGO_W, h: LOGO_H, data: LOGO } },
          ]
        : [{ image: { x: 0.6, y: 6.97, w: LOGO_W, h: LOGO_H, data: LOGO } }]),
      { text: { text: CONTACT, options: { x: 1.95, y: 6.98, w: 9.5, h: 0.3, fontFace: FONT, fontSize: 8.5, color: dark ? SOFT : MUTED, valign: "middle" as const } } },
    ],
    ...(number ? { slideNumber: { x: 12.2, y: 6.98, w: 0.55, h: 0.3, fontFace: FONT, fontSize: 9, color: dark ? SOFT : MUTED, align: "right" as const } } : {}),
  });
  pptx.defineSlideMaster({ title: "GX_LIGHT", background: { color: "FFFFFF" }, ...footer(false, true) });
  pptx.defineSlideMaster({ title: "GX_DARK", background: { color: NAVY }, ...footer(true, true) });
  pptx.defineSlideMaster({ title: "GX_COVER", background: { color: NAVY }, ...footer(true, false) });

  type S = ReturnType<typeof pptx.addSlide>;
  const eyebrow = (s: S, text: string, _dark = false) =>
    s.addText(text.toUpperCase(), { x: 0.6, y: 0.38, w: 12.1, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: ORANGE, charSpacing: 3, margin: 0, fit: "shrink" });
  const heading = (s: S, text: string, dark = false) =>
    s.addText(text, { x: 0.6, y: 0.7, w: 12.1, h: 0.75, fontFace: FONT, fontSize: pick(text, 30, 26, 22, 48, 70), bold: true, color: dark ? "FFFFFF" : INK, margin: 0, valign: "middle" });
  const sub = (s: S, text: string, dark = false) => text && s.addText(text, { x: 0.6, y: 1.42, w: 12.1, h: 0.4, fontFace: FONT, fontSize: 14, color: dark ? PALE : MUTED, margin: 0 });

  for (const sl of slides) {
    const label = sl.eyebrow || meta.company;

    // ── Cover ──
    if (sl.layout === "title") {
      const s = pptx.addSlide({ masterName: "GX_COVER" });
      // decorative rings and dots echo the product-screenshot area of the reference deck
      s.addShape(pptx.ShapeType.ellipse, { x: 8.9, y: -1.3, w: 6.6, h: 6.6, fill: { color: PANEL, transparency: 20 }, line: { color: PANEL_LINE, width: 1 } });
      s.addShape(pptx.ShapeType.ellipse, { x: 10.2, y: 2.6, w: 4.4, h: 4.4, fill: { color: PANEL, transparency: 35 }, line: { color: PANEL_LINE, width: 1 } });
      s.addShape(pptx.ShapeType.ellipse, { x: 9.5, y: 1.0, w: 0.22, h: 0.22, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
      s.addShape(pptx.ShapeType.ellipse, { x: 7.6, y: 5.0, w: 0.3, h: 0.3, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
      s.addShape(pptx.ShapeType.roundRect, { x: 0.6, y: 0.6, w: 1.65, h: 0.62, fill: { color: "FFFFFF" }, line: { color: "FFFFFF", width: 0 }, rectRadius: 0.06 });
      s.addImage({ data: LOGO, x: 0.72, y: 0.7, w: 1.41, h: 1.41 / LOGO_ASPECT });
      s.addText(`${LETTERHEAD.company}  ·  ${LETTERHEAD.unit}`.toUpperCase(), { x: 0.6, y: 1.55, w: 9, h: 0.3, fontFace: FONT, fontSize: 11, bold: true, color: ORANGE, charSpacing: 3, margin: 0, fit: "shrink" });
      s.addText(sl.title, { x: 0.6, y: 2.0, w: 8.3, h: 2.3, fontFace: FONT, fontSize: pick(sl.title, 40, 34, 28, 34, 60), bold: true, color: "FFFFFF", margin: 0, valign: "top" });
      if (sl.subtitle) s.addText(sl.subtitle, { x: 0.6, y: 4.4, w: 8.3, h: 0.9, fontFace: FONT, fontSize: 17, color: PALE, margin: 0, valign: "top" });
      sl.bullets.filter(Boolean).slice(0, 4).forEach((t, i, a) => {
        const w = Math.min(2.4, 0.5 + t.length * 0.11);
        const x = 0.6 + a.slice(0, i).reduce((acc, p) => acc + Math.min(2.4, 0.5 + p.length * 0.11) + 0.2, 0);
        s.addText(t, { x, y: 5.8, w, h: 0.42, fontFace: FONT, fontSize: 11, bold: true, color: "FFFFFF", align: "center", valign: "middle", shape: pptx.ShapeType.roundRect, rectRadius: 0.2, fill: { color: PANEL }, line: { color: PANEL_LINE, width: 1 } });
      });
      if (sl.notes) s.addNotes(sl.notes);
      continue;
    }

    // ── Section divider ──
    if (sl.layout === "section") {
      const s = pptx.addSlide({ masterName: "GX_DARK" });
      s.addShape(pptx.ShapeType.ellipse, { x: 9.6, y: 1.2, w: 5, h: 5, fill: { color: PANEL, transparency: 30 }, line: { color: PANEL_LINE, width: 1 } });
      eyebrow(s, label, true);
      s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 2.75, w: 0.9, h: 0.06, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
      s.addText(sl.title, { x: 0.6, y: 2.95, w: 10.5, h: 1.3, fontFace: FONT, fontSize: pick(sl.title, 40, 34, 28, 34, 60), bold: true, color: "FFFFFF", margin: 0, valign: "top" });
      if (sl.subtitle) s.addText(sl.subtitle, { x: 0.6, y: 4.35, w: 10.5, h: 0.8, fontFace: FONT, fontSize: 17, color: PALE, margin: 0, valign: "top" });
      if (sl.notes) s.addNotes(sl.notes);
      continue;
    }

    // ── Closing: steps + contact card ──
    if (sl.layout === "closing") {
      const s = pptx.addSlide({ masterName: "GX_DARK" });
      eyebrow(s, label, true);
      heading(s, sl.title, true);
      const steps = sl.bullets.filter(Boolean).slice(0, 5);
      if (sl.subtitle) s.addText(sl.subtitle, { x: 0.6, y: 1.55, w: 7.2, h: 0.5, fontFace: FONT, fontSize: 14, color: PALE, margin: 0 });
      if (steps.length) {
        s.addText("HOW WE WORK", { x: 0.6, y: 2.6, w: 7, h: 0.3, fontFace: FONT, fontSize: 10, bold: true, color: ORANGE, charSpacing: 3, margin: 0 });
        const colW = 7.2 / steps.length;
        s.addShape(pptx.ShapeType.line, { x: 0.6 + colW / 2, y: 3.55, w: 7.2 - colW, h: 0, line: { color: PANEL_LINE, width: 1.5 } });
        steps.forEach((t, i) => {
          const cx = 0.6 + i * colW + colW / 2;
          s.addText(String(i + 1), { x: cx - 0.3, y: 3.25, w: 0.6, h: 0.6, fontFace: FONT, fontSize: 16, bold: true, color: "FFFFFF", align: "center", valign: "middle", shape: pptx.ShapeType.ellipse, fill: { color: i === 0 ? ORANGE : NAVY }, line: { color: ORANGE, width: 1.5 } });
          s.addText(t, { x: cx - colW / 2 + 0.05, y: 4.0, w: colW - 0.1, h: 0.9, fontFace: FONT, fontSize: pick(t, 13, 12, 11, 22, 40), bold: true, color: "FFFFFF", align: "center", valign: "top", margin: 0 });
        });
      }
      // contact card
      s.addShape(pptx.ShapeType.roundRect, { x: 8.35, y: 1.6, w: 4.4, h: 5.0, fill: { color: "FFFFFF" }, line: { color: "FFFFFF", width: 0 }, rectRadius: 0.1 });
      s.addImage({ data: LOGO, x: 8.7, y: 1.9, w: 1.7, h: 1.7 / LOGO_ASPECT });
      s.addText("Let's build your growth plan.", { x: 8.7, y: 2.65, w: 3.7, h: 0.9, fontFace: FONT, fontSize: 20, bold: true, color: INK, margin: 0, valign: "top" });
      s.addText("Start with a short discovery call. We confirm priorities, scope and timelines, then send a fixed-price proposal.", { x: 8.7, y: 3.5, w: 3.7, h: 0.85, fontFace: FONT, fontSize: 10.5, color: MUTED, margin: 0, valign: "top" });
      const contacts = [LETTERHEAD.email, phone, LETTERHEAD.web, LETTERHEAD.addressShort];
      const phoneSize = Math.max(8, Math.min(10.5, (3.5 * 72) / (phone.length * 0.56)));
      contacts.forEach((t, i) => {
        s.addShape(pptx.ShapeType.ellipse, { x: 8.72, y: 4.5 + i * 0.3 + 0.09, w: 0.1, h: 0.1, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
        s.addText(t, { x: 8.95, y: 4.5 + i * 0.3, w: 3.6, h: 0.28, fontFace: FONT, fontSize: i === 1 ? phoneSize : 10.5, bold: i < 3, color: INK, margin: 0, valign: "middle" });
      });
      s.addText("Book a discovery call  →", { x: 8.7, y: 5.85, w: 3.7, h: 0.5, fontFace: FONT, fontSize: 12, bold: true, color: "FFFFFF", align: "center", valign: "middle", shape: pptx.ShapeType.roundRect, rectRadius: 0.25, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
      if (sl.notes) s.addNotes(sl.notes);
      continue;
    }

    // ── Content slides ──
    const s = pptx.addSlide({ masterName: "GX_LIGHT" });
    eyebrow(s, label);
    heading(s, sl.title);
    sub(s, sl.subtitle);
    const top = sl.subtitle ? 1.95 : 1.7;
    const avail = 6.7 - top;

    if (sl.layout === "two_column") {
      const n = Math.max(sl.left_bullets.length, sl.right_bullets.length, 1);
      const long = [...sl.left_bullets, ...sl.right_bullets].some((t) => t.length > 70);
      const fs = long ? 12 : 13;
      const panelH = Math.min(avail, 1.05 + n * (long ? 0.72 : 0.52));
      const px = [0.6, 7.08];
      s.addShape(pptx.ShapeType.roundRect, { x: px[0], y: top, w: 5.65, h: panelH, fill: { color: RED_BG }, line: { color: RED_LINE, width: 1 }, rectRadius: 0.08 });
      s.addShape(pptx.ShapeType.roundRect, { x: px[1], y: top, w: 5.65, h: panelH, fill: { color: NAVY }, line: { color: NAVY, width: 0 }, rectRadius: 0.08 });
      s.addText(sl.left_heading || "Today", { x: px[0] + 0.35, y: top + 0.18, w: 5, h: 0.5, fontFace: FONT, fontSize: 17, bold: true, color: RED, margin: 0, valign: "middle" });
      s.addText(sl.right_heading || "With Gexart", { x: px[1] + 0.35, y: top + 0.18, w: 5, h: 0.5, fontFace: FONT, fontSize: 17, bold: true, color: "FFFFFF", margin: 0, valign: "middle" });
      const rowH = (panelH - 0.95) / n;
      [sl.left_bullets, sl.right_bullets].forEach((items, side) => {
        items.slice(0, 8).forEach((t, i) => {
          const y = top + 0.85 + i * rowH;
          s.addText(side === 0 ? "×" : "✓", { x: px[side] + 0.35, y, w: 0.35, h: rowH, fontFace: FONT, fontSize: 15, bold: true, color: side === 0 ? RED : ORANGE, margin: 0, valign: "middle" });
          s.addText(t, { x: px[side] + 0.78, y, w: 4.6, h: rowH, fontFace: FONT, fontSize: fs, color: side === 0 ? INK : "FFFFFF", margin: 0, valign: "middle" });
          if (i < items.length - 1) s.addShape(pptx.ShapeType.line, { x: px[side] + 0.35, y: y + rowH, w: 4.95, h: 0, line: { color: side === 0 ? RED_LINE : PANEL_LINE, width: 0.75 } });
        });
      });
      s.addText("→", { x: 6.28, y: top + panelH / 2 - 0.27, w: 0.54, h: 0.54, fontFace: FONT, fontSize: 18, bold: true, color: "FFFFFF", align: "center", valign: "middle", shape: pptx.ShapeType.ellipse, fill: { color: ORANGE }, line: { color: "FFFFFF", width: 2 } });
    } else if (sl.layout === "table" && sl.table_headers.length) {
      const cols = sl.table_headers.length;
      const rowsIn = sl.table_rows.slice(0, 12);
      const weights = sl.table_headers.map((h, ci) => Math.max(8, Math.min(60, Math.max(h.length, ...rowsIn.map((r) => (r[ci] ?? "").length)))));
      const tot = weights.reduce((a, b) => a + b, 0);
      const colW = weights.map((w) => (12.1 * w) / tot);
      const fs = rowsIn.length > 8 ? 10.5 : 12;
      const sevCol = sl.table_headers.findIndex((h) => /priority|severity/i.test(h));
      const rows = [
        sl.table_headers.map((h) => ({ text: h.toUpperCase(), options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, fontSize: 10, charSpacing: 1.5, valign: "middle" as const, margin: [0.08, 0.14, 0.08, 0.14] as [number, number, number, number] } })),
        ...rowsIn.map((r, ri) =>
          sl.table_headers.map((_, ci) => {
            const v = r[ci] ?? "";
            const sev = ci === sevCol ? SEV_COLOR[v.toLowerCase()] : undefined;
            return { text: sev ? v.toUpperCase() : v, options: { bold: ci === 0 || !!sev, color: sev ?? INK, fill: { color: ri % 2 ? "FFFFFF" : CARD }, fontSize: sev ? 10 : fs, valign: "middle" as const, margin: [0.07, 0.14, 0.07, 0.14] as [number, number, number, number], border: [{ type: "none" as const }, { type: "none" as const }, { type: "solid" as const, pt: 0.75, color: LINE }, { type: "none" as const }] } };
          }),
        ),
      ];
      s.addTable(rows as unknown as Parameters<S["addTable"]>[0], { x: 0.6, y: top, w: 12.1, colW, fontFace: FONT, autoPage: false });
      if (sl.bullets.length) s.addText(sl.bullets.filter(Boolean).join("   ·   "), { x: 0.6, y: 6.35, w: 12.1, h: 0.4, fontFace: FONT, fontSize: 10.5, italic: true, color: MUTED, margin: 0 });
      void cols;
    } else if (sl.layout === "metrics" && sl.metrics.length) {
      const items = sl.metrics.slice(0, 8);
      const perRow = Math.min(items.length, 4);
      const rowsN = Math.ceil(items.length / perRow);
      const gap = 0.3;
      const cw = (12.1 - (perRow - 1) * gap) / perRow;
      const ch = rowsN > 1 ? 2.1 : 3.0;
      items.forEach((m, i) => {
        const x = 0.6 + (i % perRow) * (cw + gap);
        const y = top + 0.1 + Math.floor(i / perRow) * (ch + 0.25);
        s.addShape(pptx.ShapeType.roundRect, { x, y, w: cw, h: ch, fill: { color: "FFFFFF" }, line: { color: LINE, width: 1 }, rectRadius: 0.1, shadow: { type: "outer", color: "000000", opacity: 0.08, blur: 6, offset: 2, angle: 90 } });
        const score = /^\s*(\d{1,3})\s*\/\s*100\s*$/.exec(m.value);
        const d = Math.min(ch - 0.9, 1.7);
        if (score) {
          const sc = Math.min(100, Number(score[1]));
          s.addChart(pptx.ChartType.doughnut, [{ name: m.label, labels: ["Score", "Remaining"], values: [sc, 100 - sc] }], { x: x + (cw - d) / 2, y: y + 0.15, w: d, h: d, holeSize: 74, chartColors: [scoreColor(sc), LINE], showLegend: false, showTitle: false, showLabel: false, showValue: false, showPercent: false, dataBorder: { pt: 0, color: "FFFFFF" } });
          s.addText(String(sc), { x: x + (cw - d) / 2, y: y + 0.15, w: d, h: d, fontFace: FONT, fontSize: d > 1.4 ? 30 : 22, bold: true, color: INK, align: "center", valign: "middle", margin: 0 });
        } else {
          s.addText(m.value, { x, y: y + 0.2, w: cw, h: d, fontFace: FONT, fontSize: pick(m.value, 36, 28, 20, 8, 14), bold: true, color: ORANGE, align: "center", valign: "middle", margin: 0 });
        }
        s.addText(m.label, { x: x + 0.15, y: y + ch - 0.7, w: cw - 0.3, h: 0.55, fontFace: FONT, fontSize: 12.5, bold: true, color: INK, align: "center", valign: "middle", margin: 0 });
      });
      if (sl.bullets.length) s.addText(sl.bullets.filter(Boolean).join("   ·   "), { x: 0.6, y: rowsN > 1 ? 6.55 : 6.3, w: 12.1, h: 0.3, fontFace: FONT, fontSize: 11, italic: true, color: MUTED, margin: 0 });
    } else {
      // numbered rows
      const items = sl.bullets.filter(Boolean).slice(0, 8);
      const rowH = Math.min(0.8, avail / Math.max(items.length, 1));
      items.forEach((t, i) => {
        const y = top + i * rowH;
        s.addText(String(i + 1), { x: 0.6, y: y + (rowH - 0.4) / 2, w: 0.4, h: 0.4, fontFace: FONT, fontSize: 12, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0, shape: pptx.ShapeType.ellipse, fill: { color: i === 0 ? ORANGE : NAVY }, line: { color: i === 0 ? ORANGE : NAVY, width: 0 } });
        s.addText(t, { x: 1.25, y, w: 11.45, h: rowH, fontFace: FONT, fontSize: pick(t, 16, 14, 12.5, 90, 150), color: INK, margin: 0, valign: "middle" });
        if (i < items.length - 1) s.addShape(pptx.ShapeType.line, { x: 1.25, y: y + rowH, w: 11.45, h: 0, line: { color: LINE, width: 0.75 } });
      });
    }
    if (sl.notes) s.addNotes(sl.notes);
  }
  return (await pptx.write({ outputType: "blob" })) as Blob;
}
