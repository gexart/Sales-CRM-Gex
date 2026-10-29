// Safe, logic-free personalisation for outreach templates.
// Only the placeholders listed in PLACEHOLDERS are recognised. Rendering never
// evaluates anything; missing values are left in place as {{name}} so the UI
// and server can refuse to send until they are resolved.

export const PLACEHOLDERS = {
  contact_first_name: "Contact first name",
  contact_last_name: "Contact last name",
  contact_full_name: "Contact full name",
  contact_title: "Contact job title",
  company_name: "Company name",
  company_website: "Company website",
  company_city: "Company city",
  company_industry: "Company industry",
  sender_name: "Your name",
  sender_email: "Your email",
  service_name: "Selected Gexart service",
} as const;

export type PlaceholderKey = keyof typeof PLACEHOLDERS;
export type TemplateContext = Partial<Record<PlaceholderKey, string | null | undefined>>;

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function placeholdersIn(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set([...text.matchAll(TOKEN)].map((m) => m[1]))];
}

export const isKnownPlaceholder = (name: string): name is PlaceholderKey => Object.prototype.hasOwnProperty.call(PLACEHOLDERS, name);

export function unknownPlaceholders(...texts: (string | null | undefined)[]): string[] {
  return [...new Set(texts.flatMap(placeholdersIn).filter((p) => !isKnownPlaceholder(p)))];
}

export interface RenderResult {
  text: string;
  /** Known placeholders whose value is empty for this recipient. */
  missing: PlaceholderKey[];
  /** Placeholders that are not supported at all. */
  unknown: string[];
}

export function render(text: string | null | undefined, ctx: TemplateContext): RenderResult {
  const missing = new Set<PlaceholderKey>();
  const unknown = new Set<string>();
  const out = (text ?? "").replace(TOKEN, (whole, name: string) => {
    if (!isKnownPlaceholder(name)) {
      unknown.add(name);
      return whole;
    }
    const v = ctx[name];
    if (v === null || v === undefined || String(v).trim() === "") {
      missing.add(name);
      return whole;
    }
    return String(v);
  });
  return { text: out, missing: [...missing], unknown: [...unknown] };
}

export const hasUnresolved = (...texts: (string | null | undefined)[]) => texts.some((t) => placeholdersIn(t).length > 0);

/** Escapes text for inclusion in HTML email bodies (used by the Brevo sender). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Plain text → minimal HTML paragraphs, escaping all content. */
export function textToHtml(s: string): string {
  return s
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}
