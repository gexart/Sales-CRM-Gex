// Additional audits: technology & AI-automation readiness, social presence,
// Google Business Profile, and competitor comparison. Same honesty rules as the
// website rubrics: only observable evidence; anything not measurable is "unavailable".
import type { Env } from "../env";
import type { CrawlResult, PageData } from "./crawler";
import { crawl } from "./crawler";
import { aeoRubric, evaluate, seoRubric, websiteRubric, type CategoryScore, type Finding, type Rubric } from "./rubrics";
import { placesTextSearch, youtubeChannel } from "../lib/providers";
import { domainOf, normalizeName } from "../lib/util";

export interface AuditOutcome {
  findings: Finding[];
  categories: CategoryScore[];
  overall: number | null;
  scope: Record<string, unknown>;
  warnings: string[];
  failed?: string;
}

const SKU = { seo: "GX-MKT-SEO", web: "GX-TEC-WEB", webmkt: "GX-MKT-WEB", crm: "GX-TEC-CRM", int: "GX-TEC-INT", aia: "GX-TEC-AIA", sw: "GX-TEC-SW", ecom: "GX-TEC-ECOM", perf: "GX-MKT-PERF", meta: "GX-MKT-META", gads: "GX-MKT-GADS", smm: "GX-MKT-SMM" };
const htmlPages = (r: CrawlResult) => r.pages.filter((p) => /html/i.test(p.contentType) && p.status < 400);
const ev = (p: PageData, observation: string) => ({ url: p.finalUrl, observation });

// ─── Technology detection ───
const SIGNATURES: { name: string; cat: string; re: RegExp }[] = [
  { name: "WordPress", cat: "cms", re: /\/wp-content\/|\/wp-includes\// },
  { name: "Shopify", cat: "cms", re: /cdn\.shopify\.com|myshopify\.com/ },
  { name: "Wix", cat: "cms", re: /static\.wixstatic\.com|parastorage\.com/ },
  { name: "Squarespace", cat: "cms", re: /squarespace(-cdn)?\.com|sqspcdn/ },
  { name: "Webflow", cat: "cms", re: /website-files\.com|webflow\.(com|io)/ },
  { name: "Google Analytics 4", cat: "analytics", re: /googletagmanager\.com\/gtag\/js|gtag\(\s*['"]config['"]\s*,\s*['"]G-/ },
  { name: "Google Tag Manager", cat: "analytics", re: /googletagmanager\.com\/gtm\.js|['"]GTM-[A-Z0-9]+['"]/ },
  { name: "Hotjar", cat: "analytics", re: /static\.hotjar\.com/ },
  { name: "Microsoft Clarity", cat: "analytics", re: /clarity\.ms/ },
  { name: "Meta Pixel", cat: "ads", re: /connect\.facebook\.net\/[^/]+\/fbevents\.js|fbq\(\s*['"]init/ },
  { name: "Google Ads tag", cat: "ads", re: /['"]AW-\d+['"]|googleadservices\.com/ },
  { name: "LinkedIn Insight Tag", cat: "ads", re: /snap\.licdn\.com/ },
  { name: "Tawk.to", cat: "chat", re: /embed\.tawk\.to/ },
  { name: "Intercom", cat: "chat", re: /widget\.intercom\.io|intercomcdn\.com/ },
  { name: "Crisp", cat: "chat", re: /client\.crisp\.chat/ },
  { name: "Zendesk", cat: "chat", re: /static\.zdassets\.com/ },
  { name: "Freshchat", cat: "chat", re: /wchat\.freshchat\.com/ },
  { name: "WhatsApp click-to-chat", cat: "chat", re: /wa\.me\/|api\.whatsapp\.com/ },
  { name: "HubSpot", cat: "crm", re: /js\.hs-scripts\.com|js\.hsforms\.net|hs-analytics\.net/ },
  { name: "Zoho", cat: "crm", re: /salesiq\.zoho|zohopublic|forms\.zoho/ },
  { name: "Salesforce", cat: "crm", re: /WebToLead|salesforce\.com\/servlet/ },
  { name: "Calendly", cat: "booking", re: /calendly\.com/ },
  { name: "Cal.com", cat: "booking", re: /\bcal\.com\// },
  { name: "Practo", cat: "booking", re: /practo\.com/ },
  { name: "Razorpay", cat: "payments", re: /checkout\.razorpay\.com/ },
  { name: "Stripe", cat: "payments", re: /js\.stripe\.com/ },
  { name: "PayU", cat: "payments", re: /payu\.in|payumoney/ },
  { name: "Paytm", cat: "payments", re: /securegw\.paytm|paytm\.(in|com)\/.*checkout/ },
];

export function detectTech(r: CrawlResult): { name: string; cat: string; url: string }[] {
  const found = new Map<string, { name: string; cat: string; url: string }>();
  for (const p of htmlPages(r)) {
    const hay = `${p.resources.join("\n")}\n${p.inlineScript}\n${p.links.map((l) => l.href).join("\n")}\n${p.generator ?? ""}`;
    for (const s of SIGNATURES) if (!found.has(s.name) && s.re.test(hay)) found.set(s.name, { name: s.name, cat: s.cat, url: p.finalUrl });
    if (p.generator && /wordpress/i.test(p.generator) && !found.has("WordPress")) found.set("WordPress", { name: "WordPress", cat: "cms", url: p.finalUrl });
  }
  return [...found.values()];
}

const has = (r: CrawlResult, cat: string) => detectTech(r).filter((t) => t.cat === cat);
const names = (xs: { name: string }[]) => xs.map((x) => x.name).join(", ");

export const techRubric: Rubric = {
  version: "tech-1.0",
  categories: [
    { key: "measurement", label: "Measurement & tracking", weight: 25 },
    { key: "engagement", label: "Customer response & booking", weight: 30 },
    { key: "lead", label: "Lead capture & CRM", weight: 30 },
    { key: "commerce", label: "Online payments", weight: 10 },
    { key: "stack", label: "Platform", weight: 5 },
  ],
  checks: [
    {
      id: "analytics", category: "measurement", weight: 3, severity: "high", effort: "low", skus: [SKU.perf],
      title: "Website analytics installed",
      recommendation: "Install GA4 (via Google Tag Manager) and define conversion events for enquiries and calls.",
      run: (r) => {
        if (!r.homepage) return { result: "unavailable", detail: "Homepage not available." };
        const a = has(r, "analytics");
        return a.length ? { result: "pass", detail: `Detected: ${names(a)}.`, evidence: a.map((t) => ({ url: t.url, observation: t.name })) } : { result: "fail", detail: "No analytics tag was detected in the inspected pages' scripts.", evidence: [ev(r.homepage, "No GA4/GTM/Clarity/Hotjar tag")] };
      },
    },
    {
      id: "ad_tracking", category: "measurement", weight: 2, severity: "medium", effort: "low", skus: [SKU.perf, SKU.meta, SKU.gads],
      title: "Ad conversion / retargeting tags",
      recommendation: "Add Meta Pixel and Google Ads conversion tracking so paid campaigns can optimise and retarget visitors.",
      run: (r) => {
        if (!r.homepage) return { result: "unavailable", detail: "Homepage not available." };
        const a = has(r, "ads");
        return a.length ? { result: "pass", detail: `Detected: ${names(a)}.` } : { result: "warn", detail: "No Meta Pixel, Google Ads or LinkedIn tag detected." };
      },
    },
    {
      id: "instant_response", category: "engagement", weight: 3, severity: "high", effort: "medium", skus: [SKU.aia],
      title: "Instant response channel (chat / WhatsApp)",
      recommendation: "Add a WhatsApp or AI chat assistant that answers common questions 24×7 and hands qualified enquiries to the team.",
      run: (r) => {
        if (!r.homepage) return { result: "unavailable", detail: "Homepage not available." };
        const a = has(r, "chat");
        return a.length ? { result: "pass", detail: `Detected: ${names(a)}.` } : { result: "fail", detail: "No live chat, chatbot or WhatsApp click-to-chat was found on the inspected pages.", evidence: [ev(r.homepage, "No chat/WhatsApp widget")] };
      },
    },
    {
      id: "online_booking", category: "engagement", weight: 2, severity: "medium", effort: "medium", skus: [SKU.aia, SKU.sw],
      title: "Self-service booking or scheduling",
      recommendation: "Let customers book appointments, site visits or demos online with automatic reminders.",
      run: (r) => {
        if (!r.homepage) return { result: "unavailable", detail: "Homepage not available." };
        const tools = has(r, "booking");
        const links = htmlPages(r).flatMap((p) => p.links).filter((l) => /book|appointment|schedule|reserve/i.test(`${l.text} ${l.href}`));
        if (tools.length) return { result: "pass", detail: `Booking tool detected: ${names(tools)}.` };
        return links.length ? { result: "warn", detail: `Booking-related links found (${links.slice(0, 3).map((l) => `"${l.text.slice(0, 30)}"`).join(", ")}) but no scheduling tool detected; booking may be manual.` } : { result: "fail", detail: "No online booking or scheduling option found." };
      },
    },
    {
      id: "lead_routing", category: "lead", weight: 3, severity: "high", effort: "medium", skus: [SKU.crm, SKU.int],
      title: "Enquiries flow into a CRM",
      recommendation: "Route website enquiries straight into a CRM with automatic assignment, acknowledgement and follow-up reminders.",
      run: (r) => {
        const pages = htmlPages(r);
        if (!pages.length) return { result: "unavailable", detail: "No pages inspected." };
        const forms = pages.filter((p) => p.forms > 0 && p.formFields >= 2);
        const crm = has(r, "crm");
        if (crm.length) return { result: "pass", detail: `CRM/forms platform detected: ${names(crm)}.` };
        if (forms.length) return { result: "warn", detail: `${forms.length} page(s) have enquiry forms, but no CRM integration was detected in the page code (a server-side integration may still exist).`, evidence: forms.slice(0, 3).map((p) => ev(p, `${p.forms} form(s)`)) };
        return { result: "fail", detail: "No enquiry form or CRM capture found on the inspected pages." };
      },
    },
    {
      id: "online_payments", category: "commerce", weight: 1, severity: "low", effort: "medium", skus: [SKU.ecom],
      title: "Online payments",
      recommendation: "If customers pay deposits, fees or orders, add an online payment link or checkout.",
      run: (r) => {
        if (!r.homepage) return { result: "unavailable", detail: "Homepage not available." };
        const a = has(r, "payments");
        return a.length ? { result: "pass", detail: `Detected: ${names(a)}.` } : { result: "warn", detail: "No payment gateway detected (only relevant if the business takes payments online)." };
      },
    },
    {
      id: "platform", category: "stack", weight: 1, severity: "low", effort: "high", skus: [SKU.web],
      title: "Website platform identified",
      recommendation: "Know the platform before quoting changes; legacy or unidentified stacks may need a rebuild estimate.",
      run: (r) => {
        if (!r.homepage) return { result: "unavailable", detail: "Homepage not available." };
        const a = has(r, "cms");
        return a.length ? { result: "pass", detail: `Platform: ${names(a)}.` } : { result: "unavailable", detail: "The platform could not be identified from public code (custom build or hidden)." };
      },
    },
  ],
};

export function techOutcome(r: CrawlResult): AuditOutcome {
  const e = evaluate(techRubric, r);
  return { ...e, scope: { technologies: detectTech(r) }, warnings: [] };
}

// ─── Social presence ───
const SOCIAL = [
  { key: "linkedin_url", label: "LinkedIn", re: /linkedin\.com\/(company|in|school)\//i },
  { key: "instagram_url", label: "Instagram", re: /instagram\.com\//i },
  { key: "facebook_url", label: "Facebook", re: /facebook\.com\//i },
  { key: "youtube_url", label: "YouTube", re: /youtube\.com\/(@|channel\/|c\/|user\/)/i },
];

function score(categories: { key: string; label: string; weight: number }[], findings: (Finding & { weight: number })[]): { categories: CategoryScore[]; overall: number | null } {
  const cats = categories.map((c) => {
    const fs = findings.filter((f) => f.category === c.key);
    const assessed = fs.filter((f) => f.result !== "unavailable");
    const total = assessed.reduce((s, f) => s + f.weight, 0);
    const got = assessed.reduce((s, f) => s + (f.result === "pass" ? f.weight : f.result === "warn" ? f.weight / 2 : 0), 0);
    return {
      category: c.key, label: c.label, weight: c.weight, score: total ? Math.round((got / total) * 100) : null,
      passed: fs.filter((f) => f.result === "pass").length, failed: fs.filter((f) => f.result === "fail" || f.result === "warn").length, unavailable: fs.filter((f) => f.result === "unavailable").length,
    };
  });
  const scored = cats.filter((c) => c.score !== null);
  const w = scored.reduce((s, c) => s + c.weight, 0);
  return { categories: cats, overall: w ? Math.round(scored.reduce((s, c) => s + c.score! * c.weight, 0) / w) : null };
}

function finding(f: Partial<Finding> & Pick<Finding, "checkId" | "category" | "result" | "title" | "detail"> & { weight: number; sev?: Finding["severity"] }): Finding & { weight: number } {
  const bad = f.result === "fail" || f.result === "warn";
  return {
    severity: f.result === "pass" ? "positive" : f.result === "unavailable" ? "low" : (f.sev ?? "medium"),
    recommendation: bad ? (f.recommendation ?? null) : null,
    effort: bad ? (f.effort ?? "low") : null,
    skus: bad ? (f.skus ?? []) : [],
    evidence: f.evidence ?? [],
    ...f,
  } as Finding & { weight: number };
}

export async function socialAudit(env: Env, account: Record<string, unknown>, progress: (p: number) => Promise<void>): Promise<AuditOutcome> {
  const recorded = SOCIAL.filter((s) => account[s.key]);
  let site: CrawlResult | null = null;
  const warnings: string[] = [];
  if (account.website) {
    try {
      site = await crawl(String(account.website), undefined, { maxPages: 1, maxLinkChecks: 0, checkHttpRedirect: false });
    } catch (e) {
      warnings.push(`Website could not be read: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  await progress(40);
  const home = site?.homepage ?? null;
  const siteLinks = home ? home.links.map((l) => l.href) : [];
  const discovered = SOCIAL.map((s) => ({ ...s, url: siteLinks.find((h) => s.re.test(h)) ?? null })).filter((s) => s.url);
  const F: (Finding & { weight: number })[] = [];

  F.push(finding({
    checkId: "profiles_on_record", category: "presence", weight: 2, sev: "high", skus: [SKU.smm],
    result: recorded.length >= 3 ? "pass" : recorded.length ? "warn" : discovered.length ? "warn" : "fail",
    title: "Official social profiles are known",
    detail: recorded.length ? `Recorded: ${recorded.map((s) => s.label).join(", ")}.` : discovered.length ? `None recorded on the account, but the website links to: ${discovered.map((s) => s.label).join(", ")}.` : "No social profiles are recorded and none are linked from the website.",
    recommendation: "Maintain active profiles on the platforms the target audience uses (LinkedIn for B2B; Instagram/Facebook/YouTube for consumers).",
    evidence: [...recorded.map((s) => ({ url: String(account[s.key]), observation: `${s.label} (recorded on account)` })), ...discovered.map((s) => ({ url: s.url!, observation: `${s.label} (linked from website)` }))],
  }));
  if (!home) {
    F.push(finding({ checkId: "website_links_profiles", category: "presence", weight: 2, result: "unavailable", title: "Website links to social profiles", detail: account.website ? "The website could not be read." : "No website on record." }));
  } else {
    const all = [...new Set([...recorded.map((s) => s.label), ...discovered.map((s) => s.label)])];
    const linked = discovered.map((s) => s.label);
    F.push(finding({
      checkId: "website_links_profiles", category: "presence", weight: 2, sev: "medium", skus: [SKU.smm, SKU.web],
      result: !all.length ? "fail" : linked.length === all.length ? "pass" : linked.length ? "warn" : "fail",
      title: "Website links to social profiles",
      detail: linked.length ? `Homepage links to ${linked.join(", ")}${all.length > linked.length ? `; not linked: ${all.filter((x) => !linked.includes(x)).join(", ")}` : ""}.` : "The homepage does not link to any social profile.",
      recommendation: "Link every official profile from the website header or footer so visitors (and search engines) can verify the brand.",
      evidence: [{ url: home.finalUrl, observation: linked.length ? linked.join(", ") : "No social links" }],
    }));
    const sameAs = JSON.stringify(home.jsonLd).includes('"sameAs"');
    F.push(finding({ checkId: "same_as", category: "consistency", weight: 1, sev: "low", skus: [SKU.seo], result: sameAs ? "pass" : "warn", title: "Profiles declared in structured data (sameAs)", detail: sameAs ? "Organization sameAs is present." : "No sameAs links in structured data.", recommendation: "List official profiles in Organization sameAs so search and answer engines connect them to the brand.", evidence: [{ url: home.finalUrl, observation: sameAs ? "sameAs present" : "sameAs absent" }] }));
    F.push(finding({ checkId: "share_previews", category: "consistency", weight: 1, sev: "low", skus: [SKU.smm], result: home.ogTitle && home.ogImage ? "pass" : home.ogTitle || home.ogImage ? "warn" : "fail", title: "Link previews for social sharing", detail: home.ogImage ? "og:image set." : "No og:image; shared links preview poorly.", recommendation: "Add og:title and og:image so links shared on WhatsApp, LinkedIn and Facebook look professional." }));
  }
  await progress(60);

  // YouTube: only platform with free public statistics through an official API key.
  const yt = (account.youtube_url as string) ?? discovered.find((s) => s.label === "YouTube")?.url ?? null;
  if (!yt) {
    F.push(finding({ checkId: "youtube_activity", category: "activity", weight: 3, result: "unavailable", title: "YouTube posting activity", detail: "No YouTube channel on record." }));
  } else if (!env.YOUTUBE_API_KEY) {
    F.push(finding({ checkId: "youtube_activity", category: "activity", weight: 3, result: "unavailable", title: "YouTube posting activity", detail: "Add a YouTube Data API key (Settings → Integrations) to measure posting frequency." }));
  } else {
    try {
      const c = await youtubeChannel(env, yt);
      if (!c) throw new Error("Channel not found");
      const since = Date.now() - 90 * 86400_000;
      const recent = c.recentUploads.filter((d) => Date.parse(d) >= since).length;
      F.push(finding({
        checkId: "youtube_activity", category: "activity", weight: 3, sev: "medium", skus: [SKU.smm],
        result: recent >= 6 ? "pass" : recent >= 1 ? "warn" : "fail",
        title: "YouTube posting activity (last 90 days)",
        detail: `${recent} upload(s) in the last 90 days · ${c.videos} videos total · ${c.subscribers === null ? "subscriber count hidden" : `${c.subscribers.toLocaleString("en-IN")} subscribers`} · ${c.views.toLocaleString("en-IN")} views.`,
        recommendation: "Publish consistently (at least every two weeks) with short-form clips repurposed across platforms.",
        evidence: [{ url: yt, observation: `${recent} uploads/90d; latest ${c.recentUploads[0]?.slice(0, 10) ?? "n/a"}` }],
      }));
    } catch (e) {
      F.push(finding({ checkId: "youtube_activity", category: "activity", weight: 3, result: "unavailable", title: "YouTube posting activity", detail: `YouTube data unavailable: ${e instanceof Error ? e.message : "error"}` }));
    }
  }
  F.push(finding({
    checkId: "platform_metrics", category: "activity", weight: 3, result: "unavailable",
    title: "Instagram, Facebook and LinkedIn engagement",
    detail: "Followers, posting frequency and engagement on these platforms require the business's own authorised connection (Meta Graph / LinkedIn APIs). They are not scraped and are not scored. Review the profiles manually before the pitch.",
  }));
  const { categories, overall } = score(
    [{ key: "presence", label: "Presence", weight: 40 }, { key: "consistency", label: "Brand consistency", weight: 20 }, { key: "activity", label: "Measurable activity", weight: 40 }],
    F,
  );
  return { findings: F, categories, overall, scope: { recorded: recorded.map((s) => s.label), discovered_on_website: discovered.map((s) => ({ platform: s.label, url: s.url })) }, warnings };
}

// ─── Google Business Profile (via Places API) ───
export async function gbpAudit(env: Env, account: Record<string, unknown>, progress: (p: number) => Promise<void>): Promise<AuditOutcome> {
  const query = [account.name, account.city].filter(Boolean).join(" ");
  const results = await placesTextSearch(env, query, 5);
  await progress(50);
  const nameKey = normalizeName(String(account.name));
  const domain = domainOf(account.website as string);
  const scored = results
    .map((p) => {
      const n = normalizeName(p.name);
      const nameScore = n === nameKey ? 3 : n.includes(nameKey) || nameKey.includes(n) ? 2 : nameKey.split(" ").filter((w) => w.length > 2 && n.includes(w)).length >= 2 ? 1 : 0;
      const domainMatch = !!domain && domainOf(p.website) === domain;
      return { p, s: nameScore + (domainMatch ? 3 : 0), domainMatch };
    })
    .sort((a, b) => b.s - a.s);
  const best = scored[0] && scored[0].s >= 2 ? scored[0] : null;
  const F: (Finding & { weight: number })[] = [];
  if (!best) {
    F.push(finding({
      checkId: "profile_found", category: "presence", weight: 4, sev: "high", skus: [SKU.seo, SKU.webmkt], result: "fail",
      title: "Google Business Profile found",
      detail: `No confident match for "${query}" in Google Places (${results.length} candidate(s): ${results.slice(0, 3).map((r) => r.name).join("; ") || "none"}).`,
      recommendation: "Claim and verify a Google Business Profile with the exact business name, category, address and website.",
    }));
  } else {
    const p = best.p;
    const mapsEv = [{ url: p.mapsUrl, observation: `${p.name} · ${p.address ?? ""}` }];
    F.push(finding({ checkId: "profile_found", category: "presence", weight: 4, result: "pass", title: "Google Business Profile found", detail: `Matched "${p.name}"${best.domainMatch ? " (website matches)" : ""}.`, evidence: mapsEv }));
    F.push(finding({ checkId: "operational", category: "presence", weight: 2, sev: "critical", skus: [SKU.seo], result: p.businessStatus === "OPERATIONAL" ? "pass" : p.businessStatus ? "fail" : "unavailable", title: "Listed as operational", detail: `Status: ${p.businessStatus ?? "not reported"}.`, recommendation: "Correct the business status on the profile immediately.", evidence: mapsEv }));
    F.push(finding({ checkId: "website_linked", category: "presence", weight: 2, sev: "medium", skus: [SKU.seo], result: p.website ? (domain && domainOf(p.website) !== domain ? "warn" : "pass") : "fail", title: "Website linked from the profile", detail: p.website ? `Profile links to ${p.website}${domain && domainOf(p.website) !== domain ? " (differs from the account website)" : ""}.` : "No website on the profile.", recommendation: "Link the profile to the main website (ideally a location landing page)." }));
    F.push(finding({ checkId: "phone", category: "presence", weight: 1, sev: "medium", skus: [SKU.seo], result: p.phone ? "pass" : "fail", title: "Phone number listed", detail: p.phone ? `Phone: ${p.phone}.` : "No phone number on the profile.", recommendation: "Add a phone number that is answered during listed hours." }));
    F.push(finding({ checkId: "hours", category: "presence", weight: 1, sev: "medium", skus: [SKU.seo], result: p.hasHours ? "pass" : "fail", title: "Opening hours listed", detail: p.hasHours ? "Regular hours are published." : "No opening hours.", recommendation: "Publish opening hours, including holiday hours." }));
    F.push(finding({ checkId: "category", category: "presence", weight: 1, sev: "low", skus: [SKU.seo], result: p.category ? "pass" : "warn", title: "Primary category set", detail: p.category ? `Category: ${p.category}.` : "No primary category reported.", recommendation: "Choose the most specific primary category." }));
    const rating = p.rating;
    F.push(finding({ checkId: "rating", category: "reputation", weight: 3, sev: "high", skus: [SKU.webmkt, SKU.aia], result: rating === null ? "unavailable" : rating >= 4.3 ? "pass" : rating >= 3.8 ? "warn" : "fail", title: "Average rating", detail: rating === null ? "No rating yet." : `${rating.toFixed(1)} ★ average.`, recommendation: "Run a review-request flow after every completed service and respond to every review.", evidence: mapsEv }));
    const n = p.reviewCount ?? 0;
    F.push(finding({ checkId: "review_volume", category: "reputation", weight: 2, sev: "medium", skus: [SKU.webmkt, SKU.aia], result: n >= 50 ? "pass" : n >= 15 ? "warn" : "fail", title: "Review volume", detail: `${n} review(s).`, recommendation: "Automate review requests by WhatsApp/SMS after each visit to build volume steadily.", evidence: mapsEv }));
    F.push(finding({ checkId: "photos", category: "content", weight: 1, sev: "low", skus: [SKU.smm], result: p.photoCount >= 10 ? "pass" : p.photoCount >= 3 ? "warn" : "fail", title: "Photos on the profile", detail: `${p.photoCount}${p.photoCount >= 10 ? "+" : ""} photo(s) returned by the API (the API returns at most 10).`, recommendation: "Upload recent exterior, interior, team and service photos regularly." }));
  }
  const { categories, overall } = score(
    [{ key: "presence", label: "Profile completeness", weight: 45 }, { key: "reputation", label: "Reputation", weight: 40 }, { key: "content", label: "Visual content", weight: 15 }],
    F,
  );
  return {
    findings: F, categories, overall,
    scope: { query, candidates: results.map((r) => ({ name: r.name, address: r.address, maps_url: r.mapsUrl })), matched: best?.p.name ?? null, source: "Google Places API (New)" },
    warnings: best && !best.domainMatch && domain ? ["The matched profile's website differs from the account's website; confirm it is the right business."] : [],
  };
}

// ─── Competitor comparison ───
const RUBRICS: [string, Rubric][] = [["website", websiteRubric], ["seo", seoRubric], ["aeo", aeoRubric], ["tech", techRubric]];

export async function competitorAudit(account: Record<string, unknown>, competitors: { name: string; website: string }[], progress: (p: number) => Promise<void>): Promise<AuditOutcome> {
  const sites = [{ name: String(account.name), website: String(account.website), own: true }, ...competitors.slice(0, 3).map((c) => ({ ...c, own: false }))];
  const rows: { name: string; url: string; own: boolean; scores: Record<string, number | null>; results: Record<string, Record<string, string>>; error?: string }[] = [];
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    try {
      const r = await crawl(s.website, undefined, { maxPages: 2, maxLinkChecks: 0, checkHttpRedirect: false });
      const scores: Record<string, number | null> = {};
      const results: Record<string, Record<string, string>> = {};
      for (const [key, rubric] of RUBRICS) {
        const e = evaluate(rubric, r);
        scores[key] = e.overall;
        results[key] = Object.fromEntries(e.findings.map((f) => [f.checkId, f.result]));
      }
      rows.push({ name: s.name, url: s.website, own: s.own, scores, results, ...(r.homepage ? {} : { error: r.homepageError ?? "unreachable" }) });
    } catch (e) {
      rows.push({ name: s.name, url: s.website, own: s.own, scores: {}, results: {}, error: e instanceof Error ? e.message : "error" });
    }
    await progress(10 + Math.round(((i + 1) / sites.length) * 80));
  }
  const own = rows[0];
  const rivals = rows.slice(1).filter((r) => !r.error);
  const F: (Finding & { weight: number })[] = [];
  if (own.error) return { findings: [], categories: [], overall: null, scope: { comparison: rows }, warnings: [], failed: `The account's own website could not be audited: ${own.error}` };
  for (const [key, rubric] of RUBRICS) {
    for (const c of rubric.checks) {
      const mine = own.results[key]?.[c.id];
      const passing = rivals.filter((r) => r.results[key]?.[c.id] === "pass").map((r) => r.name);
      if ((mine === "fail" || mine === "warn") && passing.length) {
        F.push(finding({ checkId: `${key}:${c.id}`, category: key, weight: c.weight, sev: c.severity, skus: c.skus, effort: c.effort, result: "fail", title: `Competitors are ahead: ${c.title}`, detail: `${passing.join(", ")} pass this check; ${own.name} does not.`, recommendation: c.recommendation, evidence: rivals.filter((r) => passing.includes(r.name)).map((r) => ({ url: r.url, observation: `${r.name}: pass` })) }));
      } else if (mine === "pass" && rivals.length && rivals.every((r) => r.results[key]?.[c.id] === "fail" || r.results[key]?.[c.id] === "warn")) {
        F.push(finding({ checkId: `${key}:${c.id}`, category: key, weight: c.weight, result: "pass", title: `Differentiator: ${c.title}`, detail: `${own.name} passes while the compared competitors do not.` }));
      }
    }
  }
  const categories: CategoryScore[] = RUBRICS.map(([key]) => ({
    category: key, label: { website: "Website", seo: "SEO", aeo: "AEO", tech: "Tech & automation" }[key]!, weight: 25,
    score: own.scores[key] ?? null, passed: F.filter((f) => f.category === key && f.result === "pass").length, failed: F.filter((f) => f.category === key && f.result === "fail").length, unavailable: 0,
  }));
  const scored = categories.filter((c) => c.score !== null);
  return {
    findings: F, categories,
    overall: scored.length ? Math.round(scored.reduce((s, c) => s + c.score!, 0) / scored.length) : null,
    scope: { comparison: rows.map(({ results: _r, ...x }) => x), note: "Each site: up to 2 pages, no link checks. Scores use the same rubrics as the individual audits." },
    warnings: rows.filter((r) => r.error).map((r) => `${r.name} could not be audited: ${r.error}`),
  };
}
