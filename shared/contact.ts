// Contact numbers a user can print on a letterhead / deck. Kept apart from letterhead.ts (which carries the logo image)
// so screens that only need the list do not download the logo.
export const CONTACT_NUMBERS = ["+91 9038991880", "+91 877 767 2293", "+91 8274872626"] as const;
export const DEFAULT_PHONE: string = CONTACT_NUMBERS[0];
/** Matches by the last 10 digits, so "8777672293" and "+91 877 767 2293" are the same; anything unknown falls back to the default. */
export function resolvePhone(value: string | null | undefined): string {
  const tail = (s: string) => s.replace(/\D/g, "").slice(-10);
  const want = tail(String(value ?? ""));
  return CONTACT_NUMBERS.find((n) => tail(n) === want) ?? DEFAULT_PHONE;
}
