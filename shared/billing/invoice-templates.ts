/**
 * Invoice templates: 10 layouts × 6 colours = 60 templates. "Classic · Black" reproduces the owner's preferred
 * invoice (logo tile + company block left, spaced TAX INVOICE right, black item header, HSN summary, UPI + bank,
 * signature box, notes, terms, "digitally signed" footer) and is the default.
 */

export interface TemplateLayout {
  key: string;
  name: string;
  /** plain = company block left, title right · band = colour strip across the top · block = full colour header ·
   *  centered = company centred over a rule */
  header: 'plain' | 'band' | 'block' | 'centered';
  /** item table header: solid colour, light tint, or just an underline */
  tableHeader: 'solid' | 'tint' | 'line';
  /** item rows: plain separators, zebra stripes, or a full grid */
  rows: 'plain' | 'zebra' | 'grid';
  font: 'sans' | 'serif';
  density: 'normal' | 'compact';
  /** draw each section inside a bordered box */
  boxed: boolean;
}

export interface TemplateAccent {
  key: string;
  name: string;
  /** strong colour (headers, totals) */
  hex: string;
  /** light tint of it (tinted headers, zebra rows) */
  tint: string;
}

export const TEMPLATE_LAYOUTS: TemplateLayout[] = [
  { key: 'classic', name: 'Classic', header: 'plain', tableHeader: 'solid', rows: 'plain', font: 'sans', density: 'normal', boxed: false },
  { key: 'modern', name: 'Modern', header: 'band', tableHeader: 'solid', rows: 'plain', font: 'sans', density: 'normal', boxed: false },
  { key: 'minimal', name: 'Minimal', header: 'plain', tableHeader: 'line', rows: 'plain', font: 'sans', density: 'normal', boxed: false },
  { key: 'bold', name: 'Bold', header: 'block', tableHeader: 'solid', rows: 'plain', font: 'sans', density: 'normal', boxed: false },
  { key: 'boxed', name: 'Boxed', header: 'plain', tableHeader: 'tint', rows: 'grid', font: 'sans', density: 'normal', boxed: true },
  { key: 'elegant', name: 'Elegant', header: 'centered', tableHeader: 'line', rows: 'plain', font: 'serif', density: 'normal', boxed: false },
  { key: 'stripe', name: 'Stripe', header: 'band', tableHeader: 'tint', rows: 'zebra', font: 'sans', density: 'normal', boxed: false },
  { key: 'ledger', name: 'Ledger', header: 'plain', tableHeader: 'solid', rows: 'grid', font: 'sans', density: 'compact', boxed: false },
  { key: 'compact', name: 'Compact', header: 'plain', tableHeader: 'tint', rows: 'zebra', font: 'sans', density: 'compact', boxed: false },
  { key: 'royal', name: 'Royal', header: 'block', tableHeader: 'tint', rows: 'zebra', font: 'serif', density: 'normal', boxed: true },
];

export const TEMPLATE_ACCENTS: TemplateAccent[] = [
  { key: 'black', name: 'Black', hex: '#111111', tint: '#F1F1F1' },
  { key: 'navy', name: 'Navy', hex: '#1E3A8A', tint: '#E8EEFB' },
  { key: 'orange', name: 'Orange', hex: '#C2410C', tint: '#FFF1E7' },
  { key: 'green', name: 'Green', hex: '#0E7C4A', tint: '#E6F5EC' },
  { key: 'maroon', name: 'Maroon', hex: '#8B1E3F', tint: '#F8E8EE' },
  { key: 'teal', name: 'Teal', hex: '#0F766E', tint: '#E3F4F2' },
];

export interface InvoiceTemplate {
  id: string;
  name: string;
  layout: TemplateLayout;
  accent: TemplateAccent;
}

export const INVOICE_TEMPLATES: InvoiceTemplate[] = TEMPLATE_LAYOUTS.flatMap((layout) =>
  TEMPLATE_ACCENTS.map((accent) => ({ id: `${layout.key}-${accent.key}`, name: `${layout.name} · ${accent.name}`, layout, accent })),
);

export const DEFAULT_TEMPLATE_ID = 'classic-black';

export function templateById(id: string | null | undefined): InvoiceTemplate {
  return INVOICE_TEMPLATES.find((t) => t.id === id) ?? INVOICE_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID)!;
}
