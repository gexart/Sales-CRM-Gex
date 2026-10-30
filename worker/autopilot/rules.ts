// Pure rules for the autopilot: compliance, timing and the template fallback. No I/O, fully unit-tested.

export const OPT_OUT_LINE = 'Not the right time? Just reply "no thanks" and I won\'t email again.';

/** Lowercased email or domain entries; a domain also covers its subdomains. */
export function dncMatch(email: string, entries: Iterable<string>): string | null {
  const e = email.trim().toLowerCase();
  const domain = e.split("@")[1] ?? "";
  const base = e.replace(/\+[^@]*@/, "@");
  for (const raw of entries) {
    const v = raw.trim().toLowerCase();
    if (!v) continue;
    if (v.includes("@")) {
      if (v === e || v === base) return v;
    } else if (domain === v || domain.endsWith(`.${v}`)) return v;
  }
  return null;
}

export type RuleClass = "opt_out" | "bounce" | "out_of_office" | "not_interested";

const OPT_OUT = /\b(unsubscribe|opt[\s-]?out|remove me|take me off|stop (emailing|contacting|sending)|do not (email|contact)|don'?t (email|contact) me|no thanks|no thank you|^\s*stop\s*$)\b/im;
const NOT_INTERESTED = /\b(not interested|no need|we('re| are) (all )?(set|good|covered)|already have (a|an|someone)|not looking)\b/i;
const OOO = /\b(out of (the )?office|on (annual )?leave|on vacation|away until|limited access to (my )?email|auto(matic)?[- ]?reply)\b/i;

/** Deterministic classification first: these decide compliance, so they never depend on a model. */
export function classifyByRules(m: { from: string; subject: string; text: string; autoSubmitted: boolean }): RuleClass | null {
  if (/^(mailer-daemon|postmaster)@/i.test(m.from) || /(delivery status notification|undeliver(able|ed)|delivery (has )?failed|returned mail|address not found)/i.test(m.subject)) return "bounce";
  if (OPT_OUT.test(m.text) || /\bunsubscribe\b/i.test(m.subject)) return "opt_out";
  if (m.autoSubmitted || OOO.test(m.subject) || (OOO.test(m.text) && m.text.length < 600)) return "out_of_office";
  if (NOT_INTERESTED.test(m.text) && m.text.length < 400) return "not_interested";
  return null;
}

/** Recipient address from a bounce notice, when present. */
export function bouncedAddress(text: string): string | null {
  return text.match(/(?:wasn'?t delivered to|delivery to|address|recipient)[^\n]*?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1]?.toLowerCase() ?? null;
}

export interface SendWindow {
  start: string; // HH:MM
  end: string;
  days: number[]; // 0=Sun … 6=Sat
  tz: string;
}

function zoned(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour12: false, weekday: "short", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

export function inSendWindow(w: SendWindow, at = new Date()): boolean {
  const z = zoned(at, w.tz);
  return w.days.includes(z.day) && z.minutes >= toMin(w.start) && z.minutes < toMin(w.end);
}

/**
 * New mailboxes ramp up: 5/day in week one, then +5/day each week until the cap.
 * Protects the domain's reputation, which is the asset that makes cold email work at all.
 */
export function effectiveDailyCap(cap: number, warmupStartedOn: string | null, today = new Date()): number {
  if (!warmupStartedOn) return cap;
  const days = Math.floor((today.getTime() - Date.parse(`${warmupStartedOn}T00:00:00Z`)) / 86_400_000);
  if (days < 0) return 0;
  return Math.min(cap, 5 + Math.floor(days / 7) * 5);
}

export function footer(signature: string | null, postalAddress: string | null): string {
  return [signature?.trim() || null, "", OPT_OUT_LINE, postalAddress?.trim() || null].filter((x) => x !== null).join("\n").trim();
}

export interface ResearchFacts {
  company: string;
  domain: string | null;
  city: string | null;
  industry: string | null;
  firstName: string | null;
  /** Specific, verifiable observations from their own website, most important first. */
  observations: { text: string; source: string }[];
  hiring: boolean;
  tech: string[];
  rating: number | null;
  reviews: number | null;
}

export interface Step {
  subject: string;
  body: string;
}

/** Used when Claude is not configured: still specific, because it quotes real observations. */
export function templateSequence(f: ResearchFacts, p: { offer: string; entry_offer: string | null; booking_url: string | null; sender_name: string }): Step[] {
  const hi = f.firstName ? `Hi ${f.firstName},` : `Hi ${f.company} team,`;
  const where = f.city ? ` in ${f.city}` : "";
  const obs = f.observations.slice(0, 2).map((o) => o.text);
  const noticed = obs.length
    ? `I was looking at ${f.domain ?? "your website"} and noticed ${obs[0].charAt(0).toLowerCase()}${obs[0].slice(1).replace(/\.$/, "")}${obs[1] ? `, and ${obs[1].charAt(0).toLowerCase()}${obs[1].slice(1).replace(/\.$/, "")}` : ""}.`
    : `I came across ${f.company}${where} and had a quick idea.`;
  const ask = p.entry_offer ? `Happy to send you ${p.entry_offer}, no strings attached.` : "Worth a quick 15-minute call this week?";
  const book = p.booking_url ? `\n\nIf easier, pick a time here: ${p.booking_url}` : "";
  return [
    {
      subject: `Quick idea for ${f.company}`.slice(0, 80),
      body: `${hi}\n\n${noticed}\n\n${p.offer.trim()}\n\n${ask}${book}\n\n${p.sender_name}`,
    },
    {
      subject: `Re: Quick idea for ${f.company}`.slice(0, 80),
      body: `${hi}\n\nFollowing up on my note below. ${obs[0] ? `The ${obs[0].charAt(0).toLowerCase()}${obs[0].slice(1).replace(/\.$/, "")} is usually a quick fix, and it tends to cost enquiries until it's sorted.` : "Would this be useful for you right now?"}\n\nShall I send over the details?\n\n${p.sender_name}`,
    },
    {
      subject: `Re: Quick idea for ${f.company}`.slice(0, 80),
      body: `${hi}\n\nI'll leave it here so I don't crowd your inbox. If improving this becomes a priority later, just reply and I'll pick it up.\n\n${p.sender_name}`,
    },
  ];
}
