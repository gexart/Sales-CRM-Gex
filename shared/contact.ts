// Contact numbers a user can print on a letterhead / deck. Kept apart from letterhead.ts (which carries the logo image)
// so screens that only need the list do not download the logo.
export const CONTACT_NUMBERS = ["+91 9038991880", "+91 877 767 2293", "+91 8274872626"] as const;
export const DEFAULT_PHONE: string = CONTACT_NUMBERS[0];
export const PHONE_SEPARATOR = "  ·  ";

const tail = (s: string) => s.replace(/\D/g, "").slice(-10);

/**
 * Which of the allowed numbers a value refers to: one number, several ("9038991880, 8777672293") or an array.
 * Always in the fixed order of CONTACT_NUMBERS, never more than the allowed three; anything unknown or empty
 * falls back to the default number.
 */
export function parsePhones(value: string | readonly string[] | null | undefined): string[] {
  const all = (Array.isArray(value) ? value.join(",") : String(value ?? "")).replace(/\D/g, "");
  const picked = CONTACT_NUMBERS.filter((n) => all.includes(tail(n)));
  return picked.length ? [...picked] : [DEFAULT_PHONE];
}

/** The line printed on the letterhead / slides: the chosen numbers joined with a dot. */
export const resolvePhone = (value: string | readonly string[] | null | undefined): string => parsePhones(value).join(PHONE_SEPARATOR);
