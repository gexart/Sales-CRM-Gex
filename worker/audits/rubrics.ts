// Transparent audit rubrics. Each check evaluates observable crawl data and returns
// pass / warn / fail / unavailable with evidence. Scores are documented in
// docs/AUDIT_SCORING.md:
//   category score  = (Σ weight of passes + ½ Σ weight of warnings) ÷ Σ weight of assessed checks × 100
//   overall score   = Σ(category score × category weight) ÷ Σ(weight of categories that have a score)
// Unavailable checks are excluded from both numerator and denominator and are shown as such;
// missing data is never counted as a pass.
import type { CrawlResult, PageData } from "./crawler";
import { MAX_LINK_CHECKS, MAX_PAGES, schemaTypes } from "./crawler";

export type CheckResult = "pass" | "warn" | "fail" | "unavailable";
export type Severity = "critical" | "high" | "medium" | "low";

export interface Finding {
  checkId: string;
  category: string;
  result: CheckResult;
  severity: Severity | "positive";
  title: string;
  detail: string;
  recommendation: string | null;
  effort: "low" | "medium" | "high" | null;
  skus: string[];
  evidence: { url: string | null; observation: string }[];
}

export interface CategoryScore {
  category: string;
  label: string;
  weight: number;
  score: number | null;
  passed: number;
  failed: number;
  unavailable: number;
}

interface CheckDef {
  id: string;
  category: string;
  weight: number;
  severity: Severity; // severity when the check fails (warnings drop one level)
  effort: "low" | "medium" | "high";
  skus: string[];
  title: string; // what is being checked
  recommendation: string;
  run: (r: CrawlResult) => { result: CheckResult; detail: string; evidence?: { url: string | null; observation: string }[] };
}

export interface Rubric {
  version: string;
  categories: { key: string; label: string; weight: number }[];
  checks: CheckDef[];
}

const SKU = { seo: "GX-MKT-SEO", web: "GX-TEC-WEB", webmkt: "GX-MKT-WEB", crm: "GX-TEC-CRM", smm: "GX-MKT-SMM", aia: "GX-TEC-AIA" };
const NA = (detail: string) => ({ result: "unavailable" as const, detail });
const home = (r: CrawlResult) => r.homepage;
const htmlPages = (r: CrawlResult) => r.pages.filter((p) => /html/i.test(p.contentType) && p.status < 400);
const ev = (p: PageData, observation: string) => ({ url: p.finalUrl, observation });
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

// ─── shared checks ───
const reachable: CheckDef = {
  id: "reachable", category: "availability", weight: 3, severity: "critical", effort: "medium", skus: [SKU.web],
  title: "Homepage responds successfully",
  recommendation: "Make sure the homepage returns HTTP 200 for visitors and crawlers.",
  run: (r) => {
    const h = home(r);
    if (!h) return { result: "fail", detail: `The homepage could not be loaded: ${r.homepageError ?? "unknown error"}.`, evidence: [{ url: r.startUrl, observation: r.homepageError ?? "No response" }] };
    return h.status < 400
      ? { result: "pass", detail: `HTTP ${h.status} in ${h.timeMs} ms.`, evidence: [ev(h, `HTTP ${h.status}`)] }
      : { result: "fail", detail: `The homepage returned HTTP ${h.status}.`, evidence: [ev(h, `HTTP ${h.status}`)] };
  },
};

const brokenLinks = (category: string): CheckDef => ({
  id: "broken_internal_links", category, weight: 2, severity: "high", effort: "low", skus: [SKU.web, SKU.seo],
  title: "Internal links resolve",
  recommendation: "Fix or redirect internal links that return errors.",
  run: (r) => {
    const checked = r.linkChecks.filter((l) => l.status !== null);
    if (!checked.length) return NA("No internal links could be checked.");
    const broken = checked.filter((l) => (l.status ?? 0) >= 400);
    const detail = `${broken.length} of ${checked.length} checked internal links returned an error (sample of up to ${MAX_LINK_CHECKS} beyond crawled pages; ${r.linksDiscovered} discovered).`;
    return {
      result: broken.length === 0 ? "pass" : broken.length <= 2 ? "warn" : "fail",
      detail,
      evidence: broken.slice(0, 8).map((l) => ({ url: l.url, observation: `HTTP ${l.status}` })),
    };
  },
});

const imageAlt = (category: string, sku: string): CheckDef => ({
  id: "image_alt", category, weight: 2, severity: "medium", effort: "low", skus: [sku],
  title: "Images have alternative text",
  recommendation: "Add descriptive alt text to meaningful images (empty alt for decorative ones).",
  run: (r) => {
    const imgs = htmlPages(r).flatMap((p) => p.images.map((i) => ({ ...i, page: p.finalUrl })));
    if (!imgs.length) return NA("No <img> elements were found on the inspected pages.");
    const missing = imgs.filter((i) => i.alt === null);
    const cover = pct(imgs.length - missing.length, imgs.length);
    return {
      result: cover >= 95 ? "pass" : cover >= 75 ? "warn" : "fail",
      detail: `${missing.length} of ${imgs.length} images have no alt attribute (${cover}% coverage).`,
      evidence: missing.slice(0, 6).map((i) => ({ url: i.page, observation: `Missing alt: ${i.src.slice(0, 160)}` })),
    };
  },
});

const robotsTxt = (category: string): CheckDef => ({
  id: "robots_txt", category, weight: 1, severity: "low", effort: "low", skus: [SKU.seo],
  title: "robots.txt is published and does not block the site",
  recommendation: "Publish a robots.txt that allows important pages and links to the sitemap.",
  run: (r) => {
    if (r.robots.status === "error") return NA("robots.txt could not be retrieved (network or server error).");
    if (r.robots.status === "missing") return { result: "warn", detail: "No robots.txt file was found.", evidence: [{ url: `${r.origin}/robots.txt`, observation: "Not found" }] };
    if (r.robots.disallowAll) return { result: "fail", detail: "robots.txt disallows all crawlers from the whole site.", evidence: [{ url: `${r.origin}/robots.txt`, observation: "User-agent: * / Disallow: /" }] };
    return { result: "pass", detail: `robots.txt found${r.robots.sitemaps.length ? " and declares a sitemap" : ""}.`, evidence: [{ url: `${r.origin}/robots.txt`, observation: "Present" }] };
  },
});

const sitemap = (category: string): CheckDef => ({
  id: "sitemap", category, weight: 2, severity: "medium", effort: "low", skus: [SKU.seo],
  title: "XML sitemap is available",
  recommendation: "Publish an XML sitemap and reference it from robots.txt.",
  run: (r) => {
    if (r.sitemap.status === "error") return NA("The sitemap could not be retrieved (network or server error).");
    if (r.sitemap.status === "missing") return { result: "fail", detail: "No XML sitemap found at the robots.txt location or /sitemap.xml.", evidence: [{ url: r.sitemap.url, observation: "Not found" }] };
    return { result: "pass", detail: `Sitemap found with ${r.sitemap.urlCount} <loc> entries.`, evidence: [{ url: r.sitemap.url, observation: `${r.sitemap.urlCount} entries` }] };
  },
});

const headingStructure = (category: string, sku: string): CheckDef => ({
  id: "single_h1", category, weight: 2, severity: "medium", effort: "low", skus: [sku],
  title: "Each page has exactly one H1",
  recommendation: "Give every page a single, descriptive H1 heading.",
  run: (r) => {
    const pages = htmlPages(r);
    if (!pages.length) return NA("No HTML pages were inspected.");
    const bad = pages.filter((p) => p.headings.filter((h) => h.level === 1).length !== 1);
    return {
      result: bad.length === 0 ? "pass" : bad.length < pages.length / 2 ? "warn" : "fail",
      detail: `${pages.length - bad.length} of ${pages.length} inspected pages have exactly one H1.`,
      evidence: bad.slice(0, 5).map((p) => ev(p, `${p.headings.filter((h) => h.level === 1).length} H1 elements`)),
    };
  },
});

const structuredData = (category: string, weight: number): CheckDef => ({
  id: "structured_data", category, weight, severity: "medium", effort: "medium", skus: [SKU.seo],
  title: "Structured data (JSON-LD) describes the organisation",
  recommendation: "Add JSON-LD for Organization or LocalBusiness (name, logo, contact, sameAs links).",
  run: (r) => {
    const h = home(r);
    if (!h) return NA("Homepage not available.");
    const types = [...new Set(htmlPages(r).flatMap((p) => schemaTypes(p)))];
    const org = types.some((t) => /Organization|LocalBusiness|Corporation|School|Hotel|Restaurant|RealEstate|Store|EducationalOrganization|MedicalBusiness|Hospital/i.test(t));
    if (!types.length) return { result: "fail", detail: "No JSON-LD structured data was found on the inspected pages.", evidence: [ev(h, "No application/ld+json blocks")] };
    return {
      result: org ? "pass" : "warn",
      detail: `Schema types found: ${types.slice(0, 10).join(", ")}${org ? "." : ". No organisation-level type was found."}`,
      evidence: [ev(h, `Types: ${types.slice(0, 10).join(", ")}${h.jsonLdErrors ? `; ${h.jsonLdErrors} invalid JSON-LD block(s)` : ""}`)],
    };
  },
});

// ─── Website audit ───
export const websiteRubric: Rubric = {
  version: "website-1.0",
  categories: [
    { key: "availability", label: "Availability & security", weight: 25 },
    { key: "mobile", label: "Mobile & UX basics", weight: 20 },
    { key: "conversion", label: "Lead capture & conversion", weight: 25 },
    { key: "accessibility", label: "Accessibility indicators", weight: 15 },
    { key: "performance", label: "Performance indicators", weight: 15 },
  ],
  checks: [
    reachable,
    {
      id: "https", category: "availability", weight: 3, severity: "critical", effort: "low", skus: [SKU.web],
      title: "Site is served over HTTPS",
      recommendation: "Serve every page over HTTPS with a valid certificate.",
      run: (r) => {
        const h = home(r);
        if (!h) return NA("Homepage not available.");
        return new URL(h.finalUrl).protocol === "https:"
          ? { result: "pass", detail: "The homepage is served over HTTPS.", evidence: [ev(h, "HTTPS")] }
          : { result: "fail", detail: "The homepage is served over plain HTTP.", evidence: [ev(h, "HTTP only")] };
      },
    },
    {
      id: "http_redirect", category: "availability", weight: 1, severity: "medium", effort: "low", skus: [SKU.web],
      title: "HTTP redirects to HTTPS",
      recommendation: "Permanently redirect http:// requests to https://.",
      run: (r) =>
        r.httpRedirectsToHttps === null
          ? NA("The plain-HTTP version could not be tested.")
          : r.httpRedirectsToHttps
            ? { result: "pass", detail: "http:// redirects to https://." }
            : { result: "fail", detail: "http:// does not redirect to https://.", evidence: [{ url: `http://${new URL(r.startUrl).host}/`, observation: "No redirect to HTTPS" }] },
    },
    {
      id: "mixed_content", category: "availability", weight: 1, severity: "medium", effort: "low", skus: [SKU.web],
      title: "No insecure (http://) resources on HTTPS pages",
      recommendation: "Load all scripts, styles and images over HTTPS.",
      run: (r) => {
        const pages = htmlPages(r).filter((p) => p.finalUrl.startsWith("https:"));
        if (!pages.length) return NA("No HTTPS pages were inspected.");
        const bad = pages.filter((p) => p.insecureResources.length);
        return bad.length
          ? { result: "fail", detail: `${bad.length} page(s) load resources over plain HTTP.`, evidence: bad.flatMap((p) => p.insecureResources.slice(0, 3).map((x) => ev(p, x))).slice(0, 6) }
          : { result: "pass", detail: "No insecure resource URLs found." };
      },
    },
    {
      id: "security_headers", category: "availability", weight: 1, severity: "low", effort: "low", skus: [SKU.web],
      title: "Basic security headers are set",
      recommendation: "Add Strict-Transport-Security, X-Content-Type-Options and a frame-ancestors/X-Frame-Options policy.",
      run: (r) => {
        const h = home(r);
        if (!h) return NA("Homepage not available.");
        const want = { "strict-transport-security": "HSTS", "x-content-type-options": "X-Content-Type-Options", "x-frame-options": "X-Frame-Options" };
        const csp = h.headers["content-security-policy"] ?? "";
        const missing = Object.entries(want).filter(([k]) => !h.headers[k] && !(k === "x-frame-options" && /frame-ancestors/i.test(csp))).map(([, v]) => v);
        return {
          result: missing.length === 0 ? "pass" : missing.length < 3 ? "warn" : "fail",
          detail: missing.length ? `Missing: ${missing.join(", ")}.` : "All checked headers are present.",
          evidence: [ev(h, missing.length ? `Missing ${missing.join(", ")}` : "Headers present")],
        };
      },
    },
    brokenLinks("availability"),
    {
      id: "viewport", category: "mobile", weight: 3, severity: "high", effort: "medium", skus: [SKU.web],
      title: "Mobile viewport is configured",
      recommendation: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> and use a responsive layout.",
      run: (r) => {
        const h = home(r);
        if (!h) return NA("Homepage not available.");
        return h.viewport && /width\s*=\s*device-width/i.test(h.viewport)
          ? { result: "pass", detail: `Viewport: "${h.viewport}".`, evidence: [ev(h, h.viewport)] }
          : { result: "fail", detail: h.viewport ? `Viewport does not use device-width: "${h.viewport}".` : "No viewport meta tag found.", evidence: [ev(h, h.viewport ?? "No viewport meta tag")] };
      },
    },
    {
      id: "favicon", category: "mobile", weight: 1, severity: "low", effort: "low", skus: [SKU.web],
      title: "Favicon / app icon is declared",
      recommendation: "Declare a favicon and touch icon for brand recognition in tabs and bookmarks.",
      run: (r) => (home(r) ? (home(r)!.favicon ? { result: "pass", detail: "Icon link found." } : { result: "warn", detail: "No <link rel=\"icon\"> found (a default /favicon.ico may still exist)." }) : NA("Homepage not available.")),
    },
    {
      id: "navigation", category: "mobile", weight: 1, severity: "medium", effort: "medium", skus: [SKU.web],
      title: "Homepage links to internal pages",
      recommendation: "Provide clear navigation to key pages (services, about, contact).",
      run: (r) => {
        const h = home(r);
        if (!h) return NA("Homepage not available.");
        const n = new Set(h.links.filter((l) => l.internal).map((l) => l.href)).size;
        return { result: n >= 5 ? "pass" : n >= 2 ? "warn" : "fail", detail: `${n} unique internal links on the homepage.`, evidence: [ev(h, `${n} internal links`)] };
      },
    },
    {
      id: "contact_visible", category: "conversion", weight: 3, severity: "high", effort: "low", skus: [SKU.webmkt],
      title: "Contact details are easy to find",
      recommendation: "Show a click-to-call number, email, or a clear Contact link on every page.",
      run: (r) => {
        const pages = htmlPages(r);
        if (!pages.length) return NA("No HTML pages were inspected.");
        const h = pages[0];
        const contactLink = h.links.some((l) => /contact|enquir|get in touch/i.test(l.text + " " + l.href));
        const signals = [h.hasTel && "click-to-call link", h.hasMailto && "email link", contactLink && "contact page link"].filter(Boolean);
        return {
          result: signals.length >= 2 ? "pass" : signals.length === 1 ? "warn" : "fail",
          detail: signals.length ? `Homepage has: ${signals.join(", ")}.` : "No tel:, mailto: or contact-page link was found on the homepage.",
          evidence: [ev(h, signals.length ? signals.join(", ") : "No contact signals")],
        };
      },
    },
    {
      id: "cta", category: "conversion", weight: 2, severity: "medium", effort: "low", skus: [SKU.webmkt],
      title: "Clear calls to action",
      recommendation: "Add prominent calls to action (e.g. Book a consultation, Get a quote, Enquire now).",
      run: (r) => {
        const h = home(r);
        if (!h) return NA("Homepage not available.");
        const ctas = [...new Set(h.links.map((l) => l.text).filter((t) => /book|quote|enquir|inquir|contact us|get started|call|schedule|demo|apply|register|buy|order|reserve|whatsapp|talk to/i.test(t)))];
        return {
          result: ctas.length >= 2 ? "pass" : ctas.length === 1 ? "warn" : "fail",
          detail: ctas.length ? `Call-to-action links found: ${ctas.slice(0, 6).map((t) => `"${t.slice(0, 40)}"`).join(", ")}.` : "No recognisable call-to-action link text found on the homepage.",
          evidence: [ev(h, ctas.length ? ctas.slice(0, 6).join(" | ") : "None found")],
        };
      },
    },
    {
      id: "lead_form", category: "conversion", weight: 2, severity: "medium", effort: "medium", skus: [SKU.webmkt, SKU.crm],
      title: "Lead capture form on inspected pages",
      recommendation: "Add a short enquiry form and route submissions into a CRM for follow-up.",
      run: (r) => {
        const pages = htmlPages(r);
        if (!pages.length) return NA("No HTML pages were inspected.");
        const withForm = pages.filter((p) => p.forms > 0 && p.formFields >= 2);
        return withForm.length
          ? { result: "pass", detail: `${withForm.length} of ${pages.length} inspected pages contain a form.`, evidence: withForm.slice(0, 3).map((p) => ev(p, `${p.forms} form(s), ${p.formFields} visible fields`)) }
          : { result: "fail", detail: `None of the ${pages.length} inspected pages contains an enquiry form. Other pages may have one.`, evidence: [] };
      },
    },
    imageAlt("accessibility", SKU.web),
    {
      id: "lang", category: "accessibility", weight: 1, severity: "low", effort: "low", skus: [SKU.web],
      title: "Page language is declared",
      recommendation: "Set the lang attribute on the <html> element (e.g. lang=\"en\").",
      run: (r) => (home(r) ? (home(r)!.lang ? { result: "pass", detail: `lang="${home(r)!.lang}".` } : { result: "fail", detail: "The <html> element has no lang attribute.", evidence: [ev(home(r)!, "No lang attribute")] }) : NA("Homepage not available.")),
    },
    headingStructure("accessibility", SKU.web),
    {
      id: "response_time", category: "performance", weight: 2, severity: "medium", effort: "medium", skus: [SKU.web],
      title: "Server responds quickly",
      recommendation: "Reduce server response time with caching, a CDN and optimised hosting.",
      run: (r) => {
        const h = home(r);
        if (!h) return NA("Homepage not available.");
        return {
          result: h.timeMs <= 1500 ? "pass" : h.timeMs <= 3000 ? "warn" : "fail",
          detail: `Full HTML response took ${h.timeMs} ms from the audit server (single measurement; not a field/Lighthouse metric).`,
          evidence: [ev(h, `${h.timeMs} ms`)],
        };
      },
    },
    {
      id: "html_weight", category: "performance", weight: 1, severity: "low", effort: "medium", skus: [SKU.web],
      title: "Homepage HTML is reasonably small",
      recommendation: "Trim inline scripts/styles and unused markup.",
      run: (r) => {
        const h = home(r);
        if (!h) return NA("Homepage not available.");
        const kb = Math.round(h.bytes / 1024);
        return { result: kb <= 300 ? "pass" : kb <= 800 ? "warn" : "fail", detail: `HTML document is ${kb} KB.`, evidence: [ev(h, `${kb} KB`)] };
      },
    },
    {
      id: "render_blocking", category: "performance", weight: 2, severity: "medium", effort: "medium", skus: [SKU.web],
      title: "Few render-blocking scripts",
      recommendation: "Add defer/async to scripts in <head> or move them to the end of the body.",
      run: (r) => {
        const h = home(r);
        if (!h) return NA("Homepage not available.");
        const n = h.headScriptsBlocking;
        return { result: n <= 1 ? "pass" : n <= 4 ? "warn" : "fail", detail: `${n} external script(s) in <head> without async/defer.`, evidence: [ev(h, `${n} blocking scripts`)] };
      },
    },
    {
      id: "image_dimensions", category: "performance", weight: 1, severity: "low", effort: "low", skus: [SKU.web],
      title: "Images declare width and height",
      recommendation: "Set width/height on images to prevent layout shift.",
      run: (r) => {
        const imgs = htmlPages(r).flatMap((p) => p.images);
        if (!imgs.length) return NA("No images found on inspected pages.");
        const ok = pct(imgs.filter((i) => i.hasDims).length, imgs.length);
        return { result: ok >= 80 ? "pass" : ok >= 40 ? "warn" : "fail", detail: `${ok}% of ${imgs.length} images declare both width and height.` };
      },
    },
  ],
};

// ─── SEO audit ───
export const seoRubric: Rubric = {
  version: "seo-1.0",
  categories: [
    { key: "metadata", label: "Titles & meta descriptions", weight: 30 },
    { key: "indexability", label: "Indexability", weight: 25 },
    { key: "content", label: "Content structure", weight: 20 },
    { key: "links", label: "Internal linking", weight: 15 },
    { key: "structured", label: "Structured & social metadata", weight: 10 },
  ],
  checks: [
    {
      id: "title_present", category: "metadata", weight: 3, severity: "high", effort: "low", skus: [SKU.seo],
      title: "Every page has a title",
      recommendation: "Write a unique, descriptive <title> for every page.",
      run: (r) => {
        const pages = htmlPages(r);
        if (!pages.length) return NA("No HTML pages were inspected.");
        const missing = pages.filter((p) => !p.title);
        return { result: missing.length ? "fail" : "pass", detail: `${pages.length - missing.length} of ${pages.length} pages have a title.`, evidence: missing.map((p) => ev(p, "No <title>")) };
      },
    },
    {
      id: "title_length", category: "metadata", weight: 2, severity: "medium", effort: "low", skus: [SKU.seo],
      title: "Titles are 30–65 characters",
      recommendation: "Keep titles roughly 30–65 characters so they are descriptive without truncation.",
      run: (r) => {
        const pages = htmlPages(r).filter((p) => p.title);
        if (!pages.length) return NA("No titles to evaluate.");
        const bad = pages.filter((p) => p.title!.length < 30 || p.title!.length > 65);
        return { result: bad.length === 0 ? "pass" : bad.length < pages.length ? "warn" : "fail", detail: `${pages.length - bad.length} of ${pages.length} titles are within 30–65 characters.`, evidence: bad.slice(0, 5).map((p) => ev(p, `${p.title!.length} chars: "${p.title!.slice(0, 80)}"`)) };
      },
    },
    {
      id: "title_unique", category: "metadata", weight: 1, severity: "medium", effort: "low", skus: [SKU.seo],
      title: "Titles are unique across pages",
      recommendation: "Avoid reusing the same title on different pages.",
      run: (r) => {
        const pages = htmlPages(r).filter((p) => p.title);
        if (pages.length < 2) return NA("Fewer than two titled pages were inspected.");
        const seen = new Map<string, number>();
        pages.forEach((p) => seen.set(p.title!, (seen.get(p.title!) ?? 0) + 1));
        const dup = [...seen].filter(([, n]) => n > 1);
        return dup.length ? { result: "fail", detail: `${dup.length} title(s) are repeated across pages.`, evidence: dup.map(([t, n]) => ({ url: null, observation: `"${t.slice(0, 80)}" used on ${n} pages` })) } : { result: "pass", detail: "All inspected titles are unique." };
      },
    },
    {
      id: "meta_description", category: "metadata", weight: 2, severity: "medium", effort: "low", skus: [SKU.seo],
      title: "Pages have meta descriptions (70–160 characters)",
      recommendation: "Write a compelling meta description of about 70–160 characters for each page.",
      run: (r) => {
        const pages = htmlPages(r);
        if (!pages.length) return NA("No HTML pages were inspected.");
        const missing = pages.filter((p) => !p.metaDescription?.trim());
        const badLen = pages.filter((p) => p.metaDescription && (p.metaDescription.length < 70 || p.metaDescription.length > 160));
        return {
          result: missing.length === 0 && badLen.length === 0 ? "pass" : missing.length < pages.length ? "warn" : "fail",
          detail: `${missing.length} of ${pages.length} pages have no meta description; ${badLen.length} have one outside 70–160 characters.`,
          evidence: [...missing.slice(0, 4).map((p) => ev(p, "No meta description")), ...badLen.slice(0, 3).map((p) => ev(p, `${p.metaDescription!.length} chars`))],
        };
      },
    },
    {
      id: "noindex", category: "indexability", weight: 3, severity: "critical", effort: "low", skus: [SKU.seo],
      title: "Key pages are not set to noindex",
      recommendation: "Remove noindex from pages that should appear in search.",
      run: (r) => {
        const pages = htmlPages(r);
        if (!pages.length) return NA("No HTML pages were inspected.");
        const bad = pages.filter((p) => /noindex/i.test(p.metaRobots ?? "") || /noindex/i.test(p.headers["x-robots-tag"] ?? ""));
        return bad.length ? { result: "fail", detail: `${bad.length} inspected page(s) carry a noindex directive.`, evidence: bad.map((p) => ev(p, p.metaRobots ?? p.headers["x-robots-tag"])) } : { result: "pass", detail: "No noindex directives on inspected pages." };
      },
    },
    {
      id: "canonical", category: "indexability", weight: 2, severity: "medium", effort: "low", skus: [SKU.seo],
      title: "Canonical URLs are declared",
      recommendation: "Add a self-referencing canonical link to each indexable page.",
      run: (r) => {
        const pages = htmlPages(r);
        if (!pages.length) return NA("No HTML pages were inspected.");
        const missing = pages.filter((p) => !p.canonical);
        const foreign = pages.filter((p) => p.canonical && new URL(p.canonical).hostname.replace(/^www\./, "") !== new URL(p.finalUrl).hostname.replace(/^www\./, ""));
        return {
          result: missing.length === 0 && foreign.length === 0 ? "pass" : missing.length < pages.length ? "warn" : "fail",
          detail: `${pages.length - missing.length} of ${pages.length} pages declare a canonical URL${foreign.length ? `; ${foreign.length} point to another domain` : ""}.`,
          evidence: [...missing.slice(0, 4).map((p) => ev(p, "No canonical")), ...foreign.slice(0, 2).map((p) => ev(p, `Canonical → ${p.canonical}`))],
        };
      },
    },
    robotsTxt("indexability"),
    sitemap("indexability"),
    headingStructure("content", SKU.seo),
    {
      id: "heading_hierarchy", category: "content", weight: 1, severity: "low", effort: "low", skus: [SKU.seo],
      title: "Heading levels are not skipped",
      recommendation: "Use headings in order (H1 → H2 → H3) to express page structure.",
      run: (r) => {
        const pages = htmlPages(r).filter((p) => p.headings.length);
        if (!pages.length) return NA("No headings found.");
        const bad = pages.filter((p) => p.headings.some((h, i) => i > 0 && h.level > p.headings[i - 1].level + 1));
        return { result: bad.length === 0 ? "pass" : "warn", detail: `${bad.length} of ${pages.length} pages skip heading levels.`, evidence: bad.slice(0, 4).map((p) => ev(p, p.headings.slice(0, 8).map((h) => `H${h.level}`).join(" → "))) };
      },
    },
    {
      id: "content_depth", category: "content", weight: 2, severity: "medium", effort: "high", skus: [SKU.seo],
      title: "Homepage has substantive text content",
      recommendation: "Explain services, locations and differentiators in crawlable text (aim for 300+ words on key pages).",
      run: (r) => {
        const h = home(r);
        if (!h) return NA("Homepage not available.");
        return { result: h.wordCount >= 300 ? "pass" : h.wordCount >= 120 ? "warn" : "fail", detail: `About ${h.wordCount} words of visible text in the HTML (content rendered only by JavaScript is not counted).`, evidence: [ev(h, `${h.wordCount} words`)] };
      },
    },
    imageAlt("content", SKU.seo),
    brokenLinks("links"),
    {
      id: "internal_links", category: "links", weight: 1, severity: "low", effort: "medium", skus: [SKU.seo],
      title: "Homepage links to supporting pages",
      recommendation: "Link from the homepage to key service and information pages.",
      run: (r) => {
        const h = home(r);
        if (!h) return NA("Homepage not available.");
        const n = new Set(h.links.filter((l) => l.internal).map((l) => l.href)).size;
        return { result: n >= 10 ? "pass" : n >= 4 ? "warn" : "fail", detail: `${n} unique internal links on the homepage.` };
      },
    },
    structuredData("structured", 2),
    {
      id: "open_graph", category: "structured", weight: 1, severity: "low", effort: "low", skus: [SKU.seo, SKU.smm],
      title: "Open Graph tags for link previews",
      recommendation: "Add og:title and og:image so shared links preview well on social platforms and messaging apps.",
      run: (r) => {
        const h = home(r);
        if (!h) return NA("Homepage not available.");
        const has = [h.ogTitle && "og:title", h.ogImage && "og:image"].filter(Boolean);
        return { result: has.length === 2 ? "pass" : has.length ? "warn" : "fail", detail: has.length ? `Found ${has.join(", ")}.` : "No Open Graph title or image found." };
      },
    },
  ],
};

// ─── AEO audit ───
export const aeoRubric: Rubric = {
  version: "aeo-1.0",
  categories: [
    { key: "answerability", label: "Answerability", weight: 30 },
    { key: "structure", label: "Extractable structure", weight: 20 },
    { key: "credibility", label: "Source credibility", weight: 25 },
    { key: "freshness", label: "Freshness signals", weight: 10 },
    { key: "crawlability", label: "Crawlability", weight: 15 },
  ],
  checks: [
    {
      id: "question_headings", category: "answerability", weight: 3, severity: "high", effort: "medium", skus: [SKU.seo],
      title: "Content answers explicit questions",
      recommendation: "Add sections whose headings are the questions customers ask, each followed by a direct answer.",
      run: (r) => {
        const pages = htmlPages(r);
        if (!pages.length) return NA("No HTML pages were inspected.");
        const qs = pages.flatMap((p) => p.headings.filter((h) => /\?$|^(what|how|why|when|where|who|which|can|do|does|is|are|should)\b/i.test(h.text)).map((h) => ({ p, h })));
        return {
          result: qs.length >= 5 ? "pass" : qs.length >= 1 ? "warn" : "fail",
          detail: `${qs.length} question-style headings across ${pages.length} inspected pages.`,
          evidence: qs.slice(0, 6).map(({ p, h }) => ev(p, h.text.slice(0, 120))),
        };
      },
    },
    {
      id: "faq_schema", category: "answerability", weight: 2, severity: "medium", effort: "low", skus: [SKU.seo],
      title: "FAQ content is marked up",
      recommendation: "Mark up genuine FAQ sections with FAQPage structured data.",
      run: (r) => {
        const pages = htmlPages(r);
        if (!pages.length) return NA("No HTML pages were inspected.");
        const faq = pages.filter((p) => schemaTypes(p).some((t) => /FAQPage|QAPage/i.test(t)));
        const faqLink = pages.some((p) => p.links.some((l) => /faq/i.test(l.href + l.text)));
        return faq.length
          ? { result: "pass", detail: `FAQPage/QAPage markup found on ${faq.length} page(s).`, evidence: faq.map((p) => ev(p, "FAQPage schema")) }
          : { result: faqLink ? "warn" : "fail", detail: faqLink ? "An FAQ page is linked but no FAQ markup was found on inspected pages." : "No FAQ page or FAQ markup was found." };
      },
    },
    {
      id: "content_depth", category: "answerability", weight: 2, severity: "medium", effort: "high", skus: [SKU.seo],
      title: "Enough explanatory text to cite",
      recommendation: "Publish clear explanatory content about services, pricing approach, locations and process.",
      run: (r) => {
        const pages = htmlPages(r);
        if (!pages.length) return NA("No HTML pages were inspected.");
        const avg = Math.round(pages.reduce((s, p) => s + p.wordCount, 0) / pages.length);
        return { result: avg >= 400 ? "pass" : avg >= 150 ? "warn" : "fail", detail: `Average of ${avg} visible words per inspected page.` };
      },
    },
    headingStructure("structure", SKU.seo),
    {
      id: "lists", category: "structure", weight: 1, severity: "low", effort: "low", skus: [SKU.seo],
      title: "Uses lists for steps and features",
      recommendation: "Present steps, features and comparisons as lists or tables, which are easier to extract.",
      run: (r) => {
        const pages = htmlPages(r);
        if (!pages.length) return NA("No HTML pages were inspected.");
        // Navigation menus are usually lists too, so require more than a couple per page.
        const n = pages.filter((p) => p.lists >= 4).length;
        return { result: n >= Math.ceil(pages.length / 2) ? "pass" : n ? "warn" : "fail", detail: `${n} of ${pages.length} pages use 4+ lists (navigation menus included).` };
      },
    },
    structuredData("credibility", 3),
    {
      id: "about_page", category: "credibility", weight: 2, severity: "medium", effort: "medium", skus: [SKU.seo],
      title: "About / company information is linked",
      recommendation: "Link to an About page that states who the business is, where it operates and its credentials.",
      run: (r) => {
        const h = home(r);
        if (!h) return NA("Homepage not available.");
        const about = h.links.find((l) => l.internal && /about|who-we-are|our-story|company/i.test(l.href + " " + l.text));
        return about ? { result: "pass", detail: `About page linked: ${about.href}.`, evidence: [{ url: about.href, observation: about.text || "About link" }] } : { result: "fail", detail: "No About/company page link found on the homepage." };
      },
    },
    {
      id: "same_as", category: "credibility", weight: 1, severity: "low", effort: "low", skus: [SKU.seo, SKU.smm],
      title: "Official profiles are linked (sameAs / social links)",
      recommendation: "Link official social and directory profiles, and list them in Organization sameAs.",
      run: (r) => {
        const h = home(r);
        if (!h) return NA("Homepage not available.");
        const social = [...new Set(h.links.filter((l) => /(linkedin|instagram|facebook|youtube|x\.com|twitter)\.com/i.test(l.href)).map((l) => new URL(l.href).hostname.replace(/^www\./, "")))];
        const sameAs = JSON.stringify(h.jsonLd).includes('"sameAs"');
        return { result: social.length && sameAs ? "pass" : social.length || sameAs ? "warn" : "fail", detail: `${social.length ? `Linked profiles: ${social.join(", ")}` : "No social profile links"}; sameAs ${sameAs ? "present" : "absent"} in structured data.` };
      },
    },
    {
      id: "contact_nap", category: "credibility", weight: 1, severity: "low", effort: "low", skus: [SKU.webmkt],
      title: "Contact details are published",
      recommendation: "Publish phone, email and address consistently on the site.",
      run: (r) => {
        const h = home(r);
        if (!h) return NA("Homepage not available.");
        return h.hasTel || h.hasMailto ? { result: "pass", detail: "Click-to-call or email link found." } : { result: "warn", detail: "No tel: or mailto: link on the homepage." };
      },
    },
    {
      id: "freshness", category: "freshness", weight: 2, severity: "low", effort: "medium", skus: [SKU.seo],
      title: "Content carries date signals",
      recommendation: "Show published/updated dates on articles and include dateModified in structured data.",
      run: (r) => {
        const pages = htmlPages(r);
        if (!pages.length) return NA("No HTML pages were inspected.");
        const dated = pages.filter((p) => p.modifiedTime || p.timeElements > 0 || /"date(Modified|Published)"/.test(JSON.stringify(p.jsonLd)));
        return { result: dated.length ? "pass" : "warn", detail: `${dated.length} of ${pages.length} inspected pages expose a date (meta, <time> or schema).` };
      },
    },
    robotsTxt("crawlability"),
    sitemap("crawlability"),
    {
      id: "ai_crawlers", category: "crawlability", weight: 1, severity: "low", effort: "low", skus: [SKU.seo],
      title: "AI/answer-engine crawlers are not blocked",
      recommendation: "Review robots.txt rules for AI crawlers and allow the ones the business wants to be cited by.",
      run: (r) => {
        if (r.robots.status !== "found") return NA("robots.txt not available to evaluate.");
        const blocked = r.robots.aiCrawlerBlocks;
        return blocked.length ? { result: "warn", detail: `robots.txt blocks: ${blocked.join(", ")}. This may be intentional.`, evidence: [{ url: `${r.origin}/robots.txt`, observation: `Disallow / for ${blocked.join(", ")}` }] } : { result: "pass", detail: "No site-wide blocks for common AI crawlers." };
      },
    },
  ],
};

const DOWNGRADE: Record<Severity, Severity> = { critical: "high", high: "medium", medium: "low", low: "low" };

export function evaluate(rubric: Rubric, crawl: CrawlResult): { findings: Finding[]; categories: CategoryScore[]; overall: number | null } {
  const findings: Finding[] = rubric.checks.map((c) => {
    let out: ReturnType<CheckDef["run"]>;
    try {
      out = c.run(crawl);
    } catch (e) {
      out = { result: "unavailable", detail: `Check could not be completed: ${e instanceof Error ? e.message : "error"}` };
    }
    return {
      checkId: c.id,
      category: c.category,
      result: out.result,
      severity: out.result === "pass" ? "positive" : out.result === "warn" ? DOWNGRADE[c.severity] : out.result === "fail" ? c.severity : "low",
      title: c.title,
      detail: out.detail,
      recommendation: out.result === "pass" ? null : c.recommendation,
      effort: out.result === "pass" ? null : c.effort,
      skus: out.result === "fail" || out.result === "warn" ? c.skus : [],
      evidence: out.evidence ?? [],
    };
  });

  const categories: CategoryScore[] = rubric.categories.map((cat) => {
    const checks = rubric.checks.map((c, i) => ({ c, f: findings[i] })).filter(({ c }) => c.category === cat.key);
    const assessed = checks.filter(({ f }) => f.result !== "unavailable");
    const total = assessed.reduce((s, { c }) => s + c.weight, 0);
    const got = assessed.reduce((s, { c, f }) => s + (f.result === "pass" ? c.weight : f.result === "warn" ? c.weight / 2 : 0), 0);
    return {
      category: cat.key,
      label: cat.label,
      weight: cat.weight,
      score: total ? Math.round((got / total) * 100) : null,
      passed: checks.filter(({ f }) => f.result === "pass").length,
      failed: checks.filter(({ f }) => f.result === "fail" || f.result === "warn").length,
      unavailable: checks.filter(({ f }) => f.result === "unavailable").length,
    };
  });
  const scored = categories.filter((c) => c.score !== null);
  const wsum = scored.reduce((s, c) => s + c.weight, 0);
  const overall = wsum ? Math.round(scored.reduce((s, c) => s + c.score! * c.weight, 0) / wsum) : null;
  return { findings, categories, overall };
}

export const SCOPE_NOTE = `Up to ${MAX_PAGES} pages (homepage first, then key internal pages) and up to ${MAX_LINK_CHECKS} additional internal links are inspected per run.`;
