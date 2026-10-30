// Research one prospect from public sources (their website + what discovery stored), and draft the
// sequence. Observations are phrased the way a business owner would say them, and every one has a source.
import type { Env } from "../env";
import { crawl } from "../audits/crawler";
import { evaluate, seoRubric, websiteRubric, type Finding } from "../audits/rubrics";
import { detectTech } from "../audits/extra";
import { claudeJson, untrusted } from "../lib/providers";
import { templateSequence, type ResearchFacts, type Step } from "./rules";

const SAY: Record<string, (f: Finding) => string | null> = {
  reachable: () => "the website didn't load when I checked it",
  https: () => "the site isn't on a secure https connection, so browsers label it \"Not secure\"",
  viewport: () => "the site isn't set up for mobile screens, where most local customers search",
  response_time: (f) => {
    const ms = Number(f.detail.match(/(\d+)\s*ms/)?.[1]);
    return ms >= 2500 ? `the homepage took about ${(ms / 1000).toFixed(1)} seconds to load in my test` : null;
  },
  lead_form: () => "there's no enquiry form on the main pages, so visitors have to call or email to get in touch",
  cta: () => "the homepage has no clear next step like \"Book now\" or \"Get a quote\"",
  contact_visible: () => "the phone number and contact details are hard to find on the homepage",
  meta_description: () => "most pages have no description for Google search results",
  title_present: () => "some pages have no title for Google search results",
  sitemap: () => "there's no sitemap, so Google may be missing some of your pages",
  noindex: () => "some key pages are set to be hidden from Google",
  structured_data: () => "Google isn't getting your business details (hours, location, reviews) from the site",
  mixed_content: () => "some pages load content insecurely, which can trigger browser warnings",
};
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, positive: 9 };

const JUNK_EMAIL = /(noreply|no-reply|donotreply|example\.|sentry|wixpress|@2x|\.png|\.jpg|\.webp|\.gif|user@domain|email@|yourname|privacy@|abuse@|webmaster@)/i;

/** Picks the best published address: on their own domain first, role inboxes over nothing. */
export function pickEmail(found: string[], domain: string | null): string | null {
  const clean = [...new Set(found.map((e) => e.trim().toLowerCase()))].filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !JUNK_EMAIL.test(e));
  if (!clean.length) return null;
  const own = domain ? clean.filter((e) => e.endsWith(`@${domain}`) || e.endsWith(`.${domain}`)) : [];
  const pool = own.length ? own : clean;
  const rank = (e: string) => (/^(info|hello|contact|enquir|inquir|sales|office|admin|reception|book)/.test(e) ? 1 : 0);
  return pool.sort((a, b) => rank(a) - rank(b))[0];
}

export async function researchProspect(p: Record<string, unknown>): Promise<{ facts: ResearchFacts; email: string | null; error: string | null }> {
  const company = String(p.company_name);
  const website = (p.website as string) || null;
  const domain = (p.domain as string) || null;
  const research = String(p.research_notes ?? "");
  const facts: ResearchFacts = {
    company,
    domain,
    city: ((p.geography as string) || "").split(",")[0].trim() || null,
    industry: (p.industry as string) || null,
    firstName: ((p.contact_name as string) || "").trim().split(/\s+/)[0] || null,
    observations: [],
    hiring: false,
    tech: [],
    rating: Number(research.match(/([\d.]+)★/)?.[1]) || null,
    reviews: Number(research.match(/\((\d+) reviews\)/)?.[1]) || null,
  };
  const emails: string[] = p.email ? [String(p.email)] : [];
  if (!website) {
    facts.observations.push({ text: `I couldn't find a website for ${company}`, source: "Google listing" });
    return { facts, email: pickEmail(emails, domain), error: null };
  }
  try {
    const r = await crawl(website, undefined, { maxPages: 3, maxLinkChecks: 0, checkHttpRedirect: true });
    for (const pg of r.pages) emails.push(...pg.emails);
    facts.hiring = r.pages.some((pg) => pg.links.some((l) => /careers|jobs|we.?re.?hiring|join.?(our|the).?team|vacanc/i.test(`${l.href} ${l.text}`)));
    facts.tech = detectTech(r).map((t) => t.name).slice(0, 6);
    const findings = [...evaluate(websiteRubric, r).findings, ...evaluate(seoRubric, r).findings]
      .filter((f) => f.result === "fail" || (f.result === "warn" && f.checkId === "response_time"))
      .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 5) - (SEVERITY_RANK[b.severity] ?? 5));
    const seen = new Set<string>();
    for (const f of findings) {
      const say = SAY[f.checkId]?.(f);
      if (!say || seen.has(f.checkId)) continue;
      seen.add(f.checkId);
      facts.observations.push({ text: say, source: f.evidence[0]?.url ?? website });
      if (facts.observations.length >= 4) break;
    }
    return { facts, email: pickEmail(emails, domain), error: r.homepage ? null : r.homepageError };
  } catch (e) {
    return { facts, email: pickEmail(emails, domain), error: e instanceof Error ? e.message : "Website could not be read" };
  }
}

const SEQUENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["steps"],
  properties: {
    steps: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: { type: "object", additionalProperties: false, required: ["subject", "body"], properties: { subject: { type: "string" }, body: { type: "string" } } },
    },
  },
};

const SYSTEM = `You write cold emails for Gexart, a digital growth agency (websites, SEO, social media, CRM and AI automation) that sells mainly to small and mid-sized businesses in India.
Write a 3-email sequence to one business. Rules:
- Plain text, no markdown, no emojis, no hype words ("revolutionary", "game-changer"), no fake urgency.
- Email 1: under 110 words. Open with ONE specific observation from the research, stated plainly and kindly (never insulting). Connect it to a business outcome (enquiries, calls, bookings, trust). Then one sentence on what we'd do, then a single low-friction ask.
- Email 2 (follow-up, sent in the same thread): under 70 words, adds one new angle or a second observation.
- Email 3 (polite close): under 50 words, no guilt-tripping.
- Use only facts given. Never invent numbers, clients, results or prices.
- Subjects: short, lowercase-friendly, honest. Email 1 subject must not start with "Re:". Emails 2 and 3 use "Re: " + email 1's subject.
- Greeting: "Hi {first name}," if known, else "Hi {company} team,".
- End each email with the sender's first name only. Do not add an opt-out line or address; they are appended automatically.`;

export async function draftSequence(env: Env, facts: ResearchFacts, pb: { offer: string; entry_offer: string | null; booking_url: string | null; sender_name: string }): Promise<{ steps: Step[]; generator: "claude" | "template" }> {
  if (!env.ANTHROPIC_API_KEY) return { steps: templateSequence(facts, pb), generator: "template" };
  try {
    const { data } = await claudeJson<{ steps: Step[] }>(env, {
      system: SYSTEM,
      effort: "low",
      schema: SEQUENCE_SCHEMA,
      prompt: [
        `Sender first name: ${pb.sender_name}`,
        `What we offer them: ${pb.offer}`,
        pb.entry_offer ? `Low-commitment ask to use: ${pb.entry_offer}` : "Ask: a 15-minute call.",
        pb.booking_url ? `Booking link (put it in email 1 only): ${pb.booking_url}` : "",
        "Research about the business:",
        untrusted("prospect_research", facts),
      ].filter(Boolean).join("\n"),
    });
    const steps = data.steps.slice(0, 3).map((s) => ({ subject: s.subject.replace(/[\r\n]+/g, " ").slice(0, 120), body: s.body.trim().slice(0, 4000) }));
    if (steps.length === 3 && steps.every((s) => s.subject && s.body)) return { steps, generator: "claude" };
  } catch (e) {
    console.warn("autopilot draft fell back to template", e instanceof Error ? e.message : e);
  }
  return { steps: templateSequence(facts, pb), generator: "template" };
}
