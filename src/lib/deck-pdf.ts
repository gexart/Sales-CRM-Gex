// Renders the same slides as deck.ts to a 16:9 PDF in the same Gexart design, so every deck comes as .pptx + .pdf.
// pdf-lib is loaded on demand.
import { LETTERHEAD, LOGO_ASPECT, LOGO_PNG_BASE64, resolvePhone } from "../../shared/letterhead";
import type { DeckMeta, Slide } from "./deck";

const PW = 960;
const PH = 540;
const hex = (h: string) => {
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as [number, number, number];
};
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
const SEV: Record<string, string> = { critical: "B42318", high: "C2410C", medium: "B45309", low: "0E7490" };

/** Standard PDF fonts only encode WinAnsi. */
const safe = (s: string) =>
  (s ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/₹/g, "Rs.")
    .replace(/[•●]/g, "-")
    .replace(/→/g, "->")
    .replace(/✓/g, "+")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");

export async function buildDeckPdf(slides: Slide[], meta: DeckMeta): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb, LineCapStyle } = await import("pdf-lib");
  const phone = resolvePhone(meta.phone);
  const CONTACT = [LETTERHEAD.email, phone, LETTERHEAD.addressShort, LETTERHEAD.web].join("  ·  ");
  const doc = await PDFDocument.create();
  doc.setTitle(safe(meta.title));
  doc.setAuthor(safe(meta.author));
  doc.setCreator("Sales CRM");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const logo = await doc.embedPng(Uint8Array.from(atob(LOGO_PNG_BASE64), (c) => c.charCodeAt(0)));
  type Page = ReturnType<typeof doc.addPage>;
  const col = (h: string, a = 1) => ({ color: rgb(...hex(h)), opacity: a });

  const wrap = (text: string, size: number, width: number, f = font): string[] => {
    const out: string[] = [];
    for (const para of safe(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) > width && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  };
  const rect = (p: Page, x: number, top: number, w: number, h: number, fill: string, o: { line?: string; a?: number } = {}) =>
    p.drawRectangle({ x, y: PH - top - h, width: w, height: h, ...(fill ? { color: rgb(...hex(fill)), opacity: o.a ?? 1 } : {}), ...(o.line ? { borderColor: rgb(...hex(o.line)), borderWidth: 1 } : {}) });
  const circle = (p: Page, cx: number, cy: number, r: number, fill: string, o: { line?: string; a?: number } = {}) =>
    p.drawCircle({ x: cx, y: PH - cy, size: r, ...(fill ? { color: rgb(...hex(fill)), opacity: o.a ?? 1 } : {}), ...(o.line ? { borderColor: rgb(...hex(o.line)), borderWidth: 1 } : {}) });
  const text = (p: Page, t: string, x: number, top: number, size: number, f = font, color = INK, o: { w?: number; align?: "center" | "right"; lh?: number; max?: number } = {}) => {
    const lines = o.w ? wrap(t, size, o.w, f).slice(0, o.max ?? 99) : safe(t).split("\n");
    const lh = o.lh ?? size * 1.25;
    lines.forEach((l, i) => {
      const lw = f.widthOfTextAtSize(l, size);
      const dx = o.align === "center" && o.w ? (o.w - lw) / 2 : o.align === "right" && o.w ? o.w - lw : 0;
      p.drawText(l, { x: x + dx, y: PH - top - size - i * lh, size, font: f, ...col(color) });
    });
    return lines.length * lh;
  };
  const spaced = (s: string) => s.toUpperCase().split(/\s+/).map((w) => w.split("").join(" ")).join("   ");
  const lw = 66;
  const lh = lw / LOGO_ASPECT;

  const footer = (p: Page, n: number, dark: boolean) => {
    if (dark) rect(p, 43, 497, lw + 10, lh + 8, "FFFFFF");
    p.drawImage(logo, { x: dark ? 48 : 43, y: PH - (dark ? 501 : 497) - lh, width: lw, height: lh });
    text(p, CONTACT, 135, 507, 8, font, dark ? SOFT : MUTED);
    if (n > 0) text(p, String(n), 880, 507, 9, font, dark ? SOFT : MUTED, { w: 37, align: "right" });
  };
  const head = (p: Page, label: string, title: string, dark: boolean) => {
    text(p, spaced(label).slice(0, 110), 43, 29, 9, bold, ORANGE);
    const size = title.length > 70 ? 22 : title.length > 48 ? 26 : 30;
    text(p, title, 43, 48, size, bold, dark ? "FFFFFF" : INK, { w: 880, max: 1 });
  };
  const bg = (p: Page, h: string) => rect(p, 0, 0, PW, PH, h);

  slides.forEach((sl, idx) => {
    const p = doc.addPage([PW, PH]);
    const n = idx + 1;
    const label = sl.eyebrow || meta.company;

    if (sl.layout === "title") {
      bg(p, NAVY);
      circle(p, 800, 60, 250, PANEL, { line: PANEL_LINE, a: 0.8 });
      circle(p, 880, 340, 160, PANEL, { line: PANEL_LINE, a: 0.6 });
      circle(p, 690, 78, 8, ORANGE);
      circle(p, 560, 380, 11, ORANGE);
      rect(p, 43, 43, 118, 44, "FFFFFF");
      p.drawImage(logo, { x: 52, y: PH - 50 - 100 / LOGO_ASPECT, width: 100, height: 100 / LOGO_ASPECT });
      text(p, spaced(`${LETTERHEAD.company}  ·  ${LETTERHEAD.unit}`), 43, 112, 9, bold, ORANGE);
      const th = text(p, sl.title, 43, 144, sl.title.length > 60 ? 30 : 38, bold, "FFFFFF", { w: 590, lh: sl.title.length > 60 ? 38 : 47, max: 4 });
      if (sl.subtitle) text(p, sl.subtitle, 43, 144 + th + 18, 16, font, PALE, { w: 590, max: 3 });
      let x = 43;
      sl.bullets.filter(Boolean).slice(0, 4).forEach((t) => {
        const w = bold.widthOfTextAtSize(safe(t), 11) + 30;
        rect(p, x, 410, w, 30, PANEL, { line: PANEL_LINE });
        text(p, t, x, 418, 11, bold, "FFFFFF", { w, align: "center" });
        x += w + 12;
      });
      footer(p, 0, true);
      return;
    }

    if (sl.layout === "section") {
      bg(p, NAVY);
      circle(p, 860, 280, 190, PANEL, { line: PANEL_LINE, a: 0.7 });
      text(p, spaced(label).slice(0, 110), 43, 29, 9, bold, ORANGE);
      rect(p, 43, 198, 65, 4, ORANGE);
      const th = text(p, sl.title, 43, 214, 36, bold, "FFFFFF", { w: 720, lh: 44, max: 3 });
      if (sl.subtitle) text(p, sl.subtitle, 43, 214 + th + 14, 16, font, PALE, { w: 720, max: 3 });
      footer(p, n, true);
      return;
    }

    if (sl.layout === "closing") {
      bg(p, NAVY);
      head(p, label, sl.title, true);
      if (sl.subtitle) text(p, sl.subtitle, 43, 112, 13, font, PALE, { w: 520, max: 2 });
      const steps = sl.bullets.filter(Boolean).slice(0, 5);
      if (steps.length) {
        text(p, spaced("How we work"), 43, 190, 9, bold, ORANGE);
        const cw = 520 / steps.length;
        p.drawLine({ start: { x: 43 + cw / 2, y: PH - 262 }, end: { x: 43 + 520 - cw / 2, y: PH - 262 }, thickness: 1.5, ...col(PANEL_LINE) });
        steps.forEach((t, i) => {
          const cx = 43 + i * cw + cw / 2;
          circle(p, cx, 262, 22, i === 0 ? ORANGE : NAVY, { line: ORANGE });
          text(p, String(i + 1), cx - 22, 253, 14, bold, "FFFFFF", { w: 44, align: "center" });
          text(p, t, cx - cw / 2 + 4, 296, 11, bold, "FFFFFF", { w: cw - 8, align: "center", max: 3 });
        });
      }
      rect(p, 600, 118, 317, 360, "FFFFFF");
      p.drawImage(logo, { x: 624, y: PH - 142 - 120 / LOGO_ASPECT, width: 120, height: 120 / LOGO_ASPECT });
      text(p, "Let's build your growth plan.", 624, 186, 18, bold, INK, { w: 270, lh: 22, max: 2 });
      text(p, "Start with a short discovery call. We confirm priorities, scope and timelines, then send a fixed-price proposal.", 624, 244, 9.5, font, MUTED, { w: 270, max: 4, lh: 12.5 });
      [LETTERHEAD.email, phone, LETTERHEAD.web, LETTERHEAD.addressShort].forEach((t, i) => {
        circle(p, 630, 324 + i * 22 + 6, 3.5, ORANGE);
        text(p, t, 642, 324 + i * 22, i === 1 ? Math.min(10, 258 / bold.widthOfTextAtSize(safe(t), 1)) : 10, i < 3 ? bold : font, INK, { w: 262, max: 1 });
      });
      rect(p, 624, 420, 270, 36, ORANGE);
      text(p, "Book a discovery call  ->", 624, 431, 12, bold, "FFFFFF", { w: 270, align: "center" });
      footer(p, n, true);
      return;
    }

    // content slides
    bg(p, "FFFFFF");
    head(p, label, sl.title, false);
    if (sl.subtitle) text(p, sl.subtitle, 43, 88, 13, font, MUTED, { w: 880, max: 1 });
    const top = sl.subtitle ? 126 : 108;
    const avail = 490 - top;

    if (sl.layout === "two_column") {
      const nRows = Math.max(sl.left_bullets.length, sl.right_bullets.length, 1);
      const long = [...sl.left_bullets, ...sl.right_bullets].some((t) => t.length > 70);
      const ph = Math.min(avail, 76 + nRows * (long ? 52 : 38));
      const px = [43, 510];
      rect(p, px[0], top, 407, ph, RED_BG, { line: RED_LINE });
      rect(p, px[1], top, 407, ph, NAVY);
      text(p, sl.left_heading || "Today", px[0] + 26, top + 16, 16, bold, RED, { w: 350, max: 1 });
      text(p, sl.right_heading || "With Gexart", px[1] + 26, top + 16, 16, bold, "FFFFFF", { w: 350, max: 1 });
      const rh = (ph - 66) / nRows;
      [sl.left_bullets, sl.right_bullets].forEach((items, side) =>
        items.slice(0, 8).forEach((t, i) => {
          const y = top + 58 + i * rh;
          text(p, side === 0 ? "x" : "+", px[side] + 26, y + rh / 2 - 8, 14, bold, side === 0 ? RED : ORANGE);
          text(p, t, px[side] + 54, y + Math.max(4, rh / 2 - (long ? 14 : 8)), long ? 11 : 12.5, font, side === 0 ? INK : "FFFFFF", { w: 330, max: 3, lh: long ? 13.5 : 15 });
          if (i < items.length - 1) p.drawLine({ start: { x: px[side] + 26, y: PH - y - rh }, end: { x: px[side] + 381, y: PH - y - rh }, thickness: 0.7, ...col(side === 0 ? RED_LINE : PANEL_LINE) });
        }),
      );
      circle(p, 480, top + ph / 2, 19, ORANGE, { line: "FFFFFF" });
      text(p, "->", 461, top + ph / 2 - 7, 13, bold, "FFFFFF", { w: 38, align: "center" });
    } else if (sl.layout === "table" && sl.table_headers.length) {
      const rowsIn = sl.table_rows.slice(0, 12);
      const weights = sl.table_headers.map((h, ci) => Math.max(8, Math.min(60, Math.max(h.length, ...rowsIn.map((r) => (r[ci] ?? "").length)))));
      const tot = weights.reduce((a, b) => a + b, 0);
      const cw = weights.map((w) => (874 * w) / tot);
      const fs = rowsIn.length > 8 ? 9.5 : 11;
      let y = top;
      rect(p, 43, y, 874, 26, NAVY);
      let x = 43;
      sl.table_headers.forEach((h, ci) => {
        text(p, h.toUpperCase(), x + 10, y + 8, 8.5, bold, "FFFFFF", { w: cw[ci] - 16, max: 1 });
        x += cw[ci];
      });
      y += 26;
      const sevCol = sl.table_headers.findIndex((h) => /priority|severity/i.test(h));
      rowsIn.forEach((r, ri) => {
        const linesN = Math.max(1, ...sl.table_headers.map((_, ci) => wrap(r[ci] ?? "", fs, cw[ci] - 20, ci === 0 ? bold : font).slice(0, 3).length));
        const rh = linesN * fs * 1.25 + 14;
        if (y + rh > 492) return;
        rect(p, 43, y, 874, rh, ri % 2 ? "FFFFFF" : CARD);
        let cx = 43;
        sl.table_headers.forEach((_, ci) => {
          const v = r[ci] ?? "";
          const sv = ci === sevCol ? SEV[v.toLowerCase()] : undefined;
          text(p, sv ? v.toUpperCase() : v, cx + 10, y + 7, sv ? 9 : fs, ci === 0 || sv ? bold : font, sv ?? INK, { w: cw[ci] - 20, max: 3, lh: fs * 1.25 });
          cx += cw[ci];
        });
        p.drawLine({ start: { x: 43, y: PH - y - rh }, end: { x: 917, y: PH - y - rh }, thickness: 0.6, ...col(LINE) });
        y += rh;
      });
    } else if (sl.layout === "metrics" && sl.metrics.length) {
      const items = sl.metrics.slice(0, 8);
      const per = Math.min(items.length, 4);
      const rowsN = Math.ceil(items.length / per);
      const gap = 20;
      const cw = (874 - (per - 1) * gap) / per;
      const ch = rowsN > 1 ? 150 : 215;
      items.forEach((m, i) => {
        const x = 43 + (i % per) * (cw + gap);
        const y = top + 8 + Math.floor(i / per) * (ch + 16);
        rect(p, x, y, cw, ch, "FFFFFF", { line: LINE });
        const sc = /^\s*(\d{1,3})\s*\/\s*100\s*$/.exec(m.value);
        const r = Math.min((ch - 70) / 2, 60);
        const cx = x + cw / 2;
        const cy = y + 14 + r;
        if (sc) {
          const v = Math.min(100, Number(sc[1]));
          const color = v >= 80 ? "16A34A" : v >= 50 ? "D97706" : "DC2626";
          p.drawCircle({ x: cx, y: PH - cy, size: r - 5, borderColor: rgb(...hex(LINE)), borderWidth: 9 });
          const total = (v / 100) * 2 * Math.PI;
          const steps = Math.max(2, Math.ceil(total / 0.06));
          for (let k = 0; k < steps; k++) {
            const a0 = Math.PI / 2 - (total * k) / steps;
            const a1 = Math.PI / 2 - (total * (k + 1)) / steps;
            p.drawLine({ start: { x: cx + (r - 5) * Math.cos(a0), y: PH - cy + (r - 5) * Math.sin(a0) }, end: { x: cx + (r - 5) * Math.cos(a1), y: PH - cy + (r - 5) * Math.sin(a1) }, thickness: 9, lineCap: LineCapStyle.Round, ...col(color) });
          }
          text(p, String(v), cx - 40, cy - 12, 24, bold, INK, { w: 80, align: "center" });
        } else {
          text(p, m.value, x, cy - 14, m.value.length > 10 ? 20 : 30, bold, ORANGE, { w: cw, align: "center" });
        }
        text(p, m.label, x + 10, y + ch - 42, 11, bold, INK, { w: cw - 20, align: "center", max: 2 });
      });
      if (sl.bullets.length) text(p, sl.bullets.filter(Boolean).join("   ·   "), 43, rowsN > 1 ? 468 : 440, 10, italic, MUTED, { w: 874, max: 1 });
    } else {
      const items = sl.bullets.filter(Boolean).slice(0, 8);
      const rh = Math.min(58, avail / Math.max(items.length, 1));
      items.forEach((t, i) => {
        const y = top + i * rh;
        circle(p, 56, y + rh / 2, 14, i === 0 ? ORANGE : NAVY);
        text(p, String(i + 1), 42, y + rh / 2 - 6, 11, bold, "FFFFFF", { w: 28, align: "center" });
        const fs = t.length > 150 ? 12 : t.length > 90 ? 13.5 : 15;
        const th = Math.min(3, wrap(t, fs, 820).length) * fs * 1.25;
        text(p, t, 90, y + (rh - th) / 2, fs, font, INK, { w: 820, max: 3 });
        if (i < items.length - 1) p.drawLine({ start: { x: 90, y: PH - y - rh }, end: { x: 917, y: PH - y - rh }, thickness: 0.7, ...col(LINE) });
      });
    }
    footer(p, n, false);
  });
  const bytes = await doc.save();
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/pdf" });
}
