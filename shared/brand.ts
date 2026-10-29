// Gexart brand: the GX monogram as a single vector path, plus the monochrome palette.
// Used by the web app, the PDF proposal (pdf-lib drawSvgPath) and the PPTX decks.

/** viewBox of the GX mark (cropped tightly to the letters). */
export const GX_VIEWBOX = { x: 185, y: 356, w: 703, h: 366 };

/**
 * G and the "\" stroke of the X share one outline; the "/" stroke is a second subpath
 * with the same winding, so a nonzero fill unions them.
 */
export const GX_PATH =
  "M255 356H620L888 694V722H812L585 436H258V642H453V588H380V510H528V652A70 70 0 0 1 458 722H255A70 70 0 0 1 185 652V426A70 70 0 0 1 255 356Z" +
  "M812 356H888V384L620 722H545V694Z";

export const BRAND = {
  black: "#0A0A0A",
  white: "#FFFFFF",
  ink: "#0A0A0A",
  muted: "#71717A",
  line: "#E7E5E4",
  canvas: "#F7F7F5",
  soft: "#F2F2F0",
};

/** Standalone SVG markup of the mark (white on black tile by default). */
export function gxSvg(opts: { fg?: string; bg?: string | null; size?: number; pad?: number } = {}) {
  const fg = opts.fg ?? BRAND.white;
  const size = opts.size ?? 512;
  const pad = opts.pad ?? 0.22; // fraction of the tile left around the mark
  const { x, y, w, h } = GX_VIEWBOX;
  const scale = (size * (1 - pad * 2)) / w;
  const tx = size / 2 - (x + w / 2) * scale;
  const ty = size / 2 - (y + h / 2) * scale;
  const bg = opts.bg === null ? "" : `<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="${opts.bg ?? BRAND.black}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${bg}<path fill="${fg}" transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(5)})" d="${GX_PATH}"/></svg>`;
}
