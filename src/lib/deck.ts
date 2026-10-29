// Builds a genuine .pptx in the browser from a reviewed outline, using one fixed
// Gexart master design so every deck looks the same. pptxgenjs is loaded on demand.
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
}

import { gxSvg } from "../../shared/brand";

const BRAND = "0A0A0A";
const INK = "0A0A0A";
const MUTED = "6F6F76";
const LIGHT = "F2F2F0";
const FONT = "Calibri";

/** Rasterise the GX mark to a PNG data URL (pptxgenjs needs bitmaps for reliable rendering). */
async function gxPng(opts: { fg?: string; bg?: string | null }, size = 256): Promise<string> {
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(gxSvg({ ...opts, size, pad: opts.bg === null ? 0.04 : 0.2 }));
  await img.decode();
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d")!.drawImage(img, 0, 0, size, size);
  return c.toDataURL("image/png");
}

export async function buildPptx(slides: Slide[], meta: { title: string; company: string; author: string }): Promise<Blob> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.author = meta.author;
  pptx.company = "Gexart";
  pptx.title = meta.title;
  const [tile, white] = await Promise.all([gxPng({}), gxPng({ bg: null })]);

  pptx.defineSlideMaster({
    title: "GEXART",
    background: { color: "FFFFFF" },
    objects: [
      { rect: { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: BRAND } } },
      { image: { x: 0.5, y: 6.93, w: 0.38, h: 0.38, data: tile } },
      { text: { text: "GEXART", options: { x: 0.95, y: 6.95, w: 2.5, h: 0.35, fontFace: FONT, fontSize: 10, bold: true, color: INK, charSpacing: 3 } } },
      { text: { text: meta.company, options: { x: 4, y: 6.95, w: 5.33, h: 0.35, fontFace: FONT, fontSize: 9, color: MUTED, align: "center" } } },
    ],
    slideNumber: { x: 12.3, y: 6.95, w: 0.6, h: 0.35, fontFace: FONT, fontSize: 9, color: MUTED },
  });

  const heading = (s: ReturnType<typeof pptx.addSlide>, text: string) =>
    s.addText(text, { x: 0.6, y: 0.45, w: 12.1, h: 0.8, fontFace: FONT, fontSize: 28, bold: true, color: INK });
  const bulletList = (items: string[]) => items.filter(Boolean).map((t) => ({ text: t, options: { bullet: { code: "25A0" }, breakLine: true } }));

  for (const sl of slides) {
    if (sl.layout === "title" || sl.layout === "closing") {
      const s = pptx.addSlide();
      s.background = { color: BRAND };
      s.addImage({ data: white, x: 0.7, y: 0.45, w: 0.95, h: 0.95 });
      s.addText("GEXART", { x: 1.85, y: 0.7, w: 4, h: 0.45, fontFace: FONT, fontSize: 14, bold: true, color: "FFFFFF", charSpacing: 6 });
      s.addText(sl.title, { x: 0.7, y: 2.4, w: 11.9, h: 1.4, fontFace: FONT, fontSize: 40, bold: true, color: "FFFFFF", valign: "top" });
      if (sl.subtitle) s.addText(sl.subtitle, { x: 0.7, y: 3.9, w: 11.9, h: 0.6, fontFace: FONT, fontSize: 18, color: "A8A8A3" });
      if (sl.layout === "closing" && sl.bullets.length) s.addText(bulletList(sl.bullets), { x: 0.7, y: 4.7, w: 11.9, h: 1.8, fontFace: FONT, fontSize: 16, color: "FFFFFF" });
      if (sl.notes) s.addNotes(sl.notes);
      continue;
    }
    const s = pptx.addSlide({ masterName: "GEXART" });
    if (sl.layout === "section") {
      s.addShape(pptx.ShapeType.rect, { x: 0, y: 2.6, w: 13.33, h: 2, fill: { color: LIGHT } });
      s.addText(sl.title, { x: 0.8, y: 2.9, w: 11.7, h: 0.9, fontFace: FONT, fontSize: 34, bold: true, color: BRAND });
      if (sl.subtitle) s.addText(sl.subtitle, { x: 0.8, y: 3.8, w: 11.7, h: 0.6, fontFace: FONT, fontSize: 16, color: MUTED });
    } else {
      heading(s, sl.title);
      if (sl.subtitle) s.addText(sl.subtitle, { x: 0.6, y: 1.2, w: 12.1, h: 0.45, fontFace: FONT, fontSize: 14, color: MUTED });
      const top = sl.subtitle ? 1.8 : 1.5;
      if (sl.layout === "two_column") {
        for (const [i, [h, items]] of ([[sl.left_heading, sl.left_bullets], [sl.right_heading, sl.right_bullets]] as [string, string[]][]).entries()) {
          const x = i === 0 ? 0.6 : 6.85;
          s.addShape(pptx.ShapeType.rect, { x, y: top, w: 5.9, h: 4.9, fill: { color: i === 0 ? "FAFAF9" : LIGHT }, line: { color: "E7E6E3" } });
          s.addText(h, { x: x + 0.3, y: top + 0.2, w: 5.3, h: 0.5, fontFace: FONT, fontSize: 16, bold: true, color: i === 0 ? INK : BRAND });
          s.addText(bulletList(items), { x: x + 0.3, y: top + 0.8, w: 5.3, h: 3.9, fontFace: FONT, fontSize: 14, color: INK, valign: "top", paraSpaceAfter: 6 });
        }
      } else if (sl.layout === "table" && sl.table_headers.length) {
        const rows = [
          sl.table_headers.map((h) => ({ text: h, options: { bold: true, color: "FFFFFF", fill: { color: BRAND } } })),
          ...sl.table_rows.slice(0, 12).map((r, ri) => sl.table_headers.map((_, ci) => ({ text: r[ci] ?? "", options: { fill: { color: ri % 2 ? "FFFFFF" : "FAFAF9" } } }))),
        ];
        s.addTable(rows, { x: 0.6, y: top, w: 12.1, fontFace: FONT, fontSize: 12, color: INK, border: { type: "solid", pt: 0.5, color: "E7E6E3" }, autoPage: false });
      } else if (sl.layout === "metrics" && sl.metrics.length) {
        const n = Math.min(sl.metrics.length, 4);
        const w = (12.1 - (n - 1) * 0.3) / n;
        sl.metrics.slice(0, 4).forEach((m, i) => {
          const x = 0.6 + i * (w + 0.3);
          s.addShape(pptx.ShapeType.roundRect, { x, y: top + 0.4, w, h: 2.6, fill: { color: LIGHT }, rectRadius: 0.1 });
          s.addText(m.value, { x, y: top + 0.7, w, h: 1.2, fontFace: FONT, fontSize: 40, bold: true, color: BRAND, align: "center" });
          s.addText(m.label, { x, y: top + 1.9, w, h: 0.8, fontFace: FONT, fontSize: 14, color: INK, align: "center" });
        });
        if (sl.bullets.length) s.addText(bulletList(sl.bullets), { x: 0.6, y: top + 3.3, w: 12.1, h: 1.6, fontFace: FONT, fontSize: 13, color: MUTED });
      } else {
        s.addText(bulletList(sl.bullets), { x: 0.6, y: top, w: 12.1, h: 5.2, fontFace: FONT, fontSize: 18, color: INK, valign: "top", paraSpaceAfter: 10 });
      }
    }
    if (sl.notes) s.addNotes(sl.notes);
  }
  return (await pptx.write({ outputType: "blob" })) as Blob;
}
