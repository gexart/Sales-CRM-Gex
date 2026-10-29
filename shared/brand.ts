// Gexart brand: the hexagonal "G" mark (orange + navy folded ribbon), the palette, and SVG builders
// shared by the web app, the favicon/PNG assets (scripts/brand-assets.mjs), the PDF and the PPTX decks.

export const BRAND = {
  orange: "#F47A20",
  orangeDeep: "#E2650F",
  orangeLight: "#F9A15C",
  sand: "#EADFD3",
  navy: "#141E2E",
  navyMid: "#1C2B44",
  navySoft: "#2B4468",
  white: "#FFFFFF",
  canvas: "#F6F7F9",
  muted: "#64708A",
};

/** Mark artboard (the drawing is authored in these units). */
export const MARK_VIEWBOX = { x: 258, y: 92, w: 452, h: 481 };

// Hexagon geometry (pointy-top), in artboard units.
const OUTER = [[484, 100], [700, 225], [700, 440], [484, 565], [268, 440], [268, 225]] as const;
const INNER = [[484, 247], [558, 290], [558, 375], [484, 418], [410, 375], [410, 290]] as const;

/** Closed polygon path with rounded corners (quadratic joins), r in artboard units. */
function rounded(points: readonly (readonly [number, number])[], r: number) {
  const n = points.length;
  const at = (i: number) => points[(i + n) % n];
  const toward = (a: readonly [number, number], b: readonly [number, number], d: number) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len];
  };
  const f = (v: number) => +v.toFixed(2);
  let d = "";
  for (let i = 0; i < n; i++) {
    const p = at(i);
    const a = toward(p, at(i - 1), r);
    const b = toward(p, at(i + 1), r);
    d += `${i === 0 ? "M" : "L"}${f(a[0])} ${f(a[1])}Q${p[0]} ${p[1]} ${f(b[0])} ${f(b[1])}`;
  }
  return `${d}Z`;
}

export type MarkVariant = "light" | "dark";

/**
 * The mark as standalone SVG markup. `light` is for light backgrounds (navy + orange);
 * `dark` swaps the navy ribbons for soft white so the mark reads on navy/black.
 * `uid` keeps gradient/mask ids unique when several marks share one page.
 */
export function markSvg(opts: { variant?: MarkVariant; uid?: string; size?: number; title?: string } = {}) {
  const v = opts.variant ?? "light";
  const u = (opts.uid ?? "gx").replace(/[^\w-]/g, "");
  const { x, y, w, h } = MARK_VIEWBOX;
  const base = v === "light" ? ["#2A4870", "#1A2940", "#121B2B"] : ["#FFFFFF", "#E4E9F1", "#C3CEDF"];
  const bar = v === "light" ? ["#4A5F80", "#1A2940"] : ["#FFFFFF", "#CBD5E4"];
  const shadow = v === "light" ? "#0E1626" : "#0E1626";
  const size = opts.size ? ` width="${opts.size}" height="${opts.size * (h / w)}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}"${size} role="img" aria-label="${opts.title ?? "Gexart"}">
<defs>
<mask id="${u}-ring" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}">
<path d="${rounded(OUTER, 34)}" fill="#fff"/>
<path d="${rounded(INNER, 8)}" fill="#000"/>
<path d="M548 290H720V376L548 314Z" fill="#000"/>
</mask>
<linearGradient id="${u}-navy" gradientUnits="userSpaceOnUse" x1="300" y1="540" x2="690" y2="330">
<stop offset="0" stop-color="${base[0]}"/><stop offset=".45" stop-color="${base[1]}"/><stop offset="1" stop-color="${base[2]}"/>
</linearGradient>
<linearGradient id="${u}-orange" gradientUnits="userSpaceOnUse" x1="268" y1="330" x2="700" y2="230">
<stop offset="0" stop-color="#EE6E14"/><stop offset=".35" stop-color="#F47A20"/><stop offset=".62" stop-color="#F68A3A"/><stop offset=".82" stop-color="#F4B888"/><stop offset="1" stop-color="#EADFD3"/>
</linearGradient>
<linearGradient id="${u}-fold" gradientUnits="userSpaceOnUse" x1="447" y1="268" x2="398" y2="184">
<stop offset="0" stop-color="${shadow}" stop-opacity=".88"/><stop offset=".5" stop-color="${shadow}" stop-opacity=".4"/><stop offset="1" stop-color="${shadow}" stop-opacity="0"/>
</linearGradient>
<linearGradient id="${u}-foldfade" gradientUnits="userSpaceOnUse" x1="300" y1="0" x2="540" y2="0">
<stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".55" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
</linearGradient>
<mask id="${u}-foldmask" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${u}-foldfade)"/></mask>
<clipPath id="${u}-hex"><path d="${rounded(OUTER, 34)}"/></clipPath>
<linearGradient id="${u}-accent" gradientUnits="userSpaceOnUse" x1="500" y1="420" x2="680" y2="470">
<stop offset="0" stop-color="#F9A15C"/><stop offset=".55" stop-color="#F47A20"/><stop offset="1" stop-color="#C9570C"/>
</linearGradient>
<linearGradient id="${u}-bar" gradientUnits="userSpaceOnUse" x1="510" y1="320" x2="690" y2="390">
<stop offset="0" stop-color="${bar[0]}"/><stop offset="1" stop-color="${bar[1]}"/>
</linearGradient>
</defs>
<g mask="url(#${u}-ring)">
<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${u}-navy)"/>
<path d="M250 90H720V290H410L250 427Z" fill="url(#${u}-orange)"/>
<path d="M410 290L484 247L560 120L250 120L250 427Z" fill="url(#${u}-fold)" mask="url(#${u}-foldmask)"/>
<path d="M496 431L585 382L700 437V455L612 493Z" fill="url(#${u}-accent)"/>
</g>
<path d="M530 329L760 412" clip-path="url(#${u}-hex)" stroke="url(#${u}-bar)" stroke-width="45" stroke-linecap="round"/>
</svg>`;
}

/** Square icon: the mark centred on a rounded tile (favicon, app icons, deck footer). */
export function markTileSvg(opts: { variant?: MarkVariant; bg?: string | null; size?: number; pad?: number; uid?: string } = {}) {
  const size = opts.size ?? 512;
  const pad = opts.pad ?? 0.14;
  const { x, y, w, h } = MARK_VIEWBOX;
  const scale = (size * (1 - pad * 2)) / Math.max(w, h);
  const tx = size / 2 - (x + w / 2) * scale;
  const ty = size / 2 - (y + h / 2) * scale;
  const inner = markSvg({ variant: opts.variant, uid: opts.uid })
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "");
  const bg = opts.bg ? `<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="${opts.bg}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${bg}<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(5)})">${inner}</g></svg>`;
}
