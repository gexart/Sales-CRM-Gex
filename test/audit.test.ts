import { describe, expect, it } from "vitest";
import { assertPublicUrl, parseRobots, robotsAllows, type CrawlResult, type PageData } from "../worker/audits/crawler";
import { evaluate, seoRubric, websiteRubric } from "../worker/audits/rubrics";

function page(overrides: Partial<PageData> = {}): PageData {
  return {
    url: "https://acme.example/",
    finalUrl: "https://acme.example/",
    status: 200,
    timeMs: 400,
    bytes: 20_000,
    contentType: "text/html",
    headers: { "strict-transport-security": "max-age=1", "x-content-type-options": "nosniff", "x-frame-options": "DENY" },
    title: "Acme Hospital — Multispeciality care in Kolkata",
    titleCount: 1,
    metaDescription: "Acme Hospital offers 24x7 emergency care, diagnostics and specialist consultations across Kolkata. Book an appointment online.",
    metaRobots: null,
    viewport: "width=device-width, initial-scale=1",
    canonical: "https://acme.example/",
    lang: "en",
    favicon: true,
    generator: null,
    author: null,
    ogTitle: "Acme",
    ogImage: "https://acme.example/og.png",
    modifiedTime: null,
    headings: [
      { level: 1, text: "Acme Hospital" },
      { level: 2, text: "What services do you offer?" },
    ],
    images: [{ src: "a.png", alt: "Ward", hasDims: true }],
    links: [{ href: "https://acme.example/contact", text: "Book an appointment", internal: true }],
    jsonLd: [{ "@type": "Hospital", name: "Acme" }],
    jsonLdErrors: 0,
    forms: 1,
    formFields: 3,
    hasTel: true,
    hasMailto: true,
    lists: 4,
    headScriptsBlocking: 0,
    scripts: 2,
    stylesheets: 1,
    insecureResources: [],
    wordCount: 600,
    timeElements: 0,
    emails: [],
    phones: [],
    resources: [],
    inlineScript: "",
    ...overrides,
  };
}

function crawl(pages: PageData[], overrides: Partial<CrawlResult> = {}): CrawlResult {
  return {
    startUrl: "https://acme.example/",
    origin: "https://acme.example",
    homepage: pages[0] ?? null,
    homepageError: null,
    pages,
    pageErrors: [],
    skippedByRobots: [],
    robots: { status: "found", disallowAll: false, rules: [], sitemaps: ["https://acme.example/sitemap.xml"], aiCrawlerBlocks: [] },
    sitemap: { status: "found", url: "https://acme.example/sitemap.xml", urlCount: 12 },
    httpRedirectsToHttps: true,
    linkChecks: [{ url: "https://acme.example/contact", status: 200 }],
    linksDiscovered: 1,
    scannedAt: "2026-10-29T00:00:00.000Z",
    ...overrides,
  };
}

describe("robots.txt", () => {
  const robots = parseRobots(
    ["User-agent: *", "Disallow: /admin", "Allow: /admin/public", "", "User-agent: GPTBot", "Disallow: /", "", "Sitemap: https://acme.example/sm.xml"].join("\n"),
  );
  it("parses sitemaps and AI crawler blocks", () => {
    expect(robots.sitemaps).toEqual(["https://acme.example/sm.xml"]);
    expect(robots.aiCrawlerBlocks).toEqual(["GPTBot"]);
    expect(robots.disallowAll).toBe(false);
  });
  it("applies longest-match allow/disallow for the wildcard group", () => {
    expect(robotsAllows(robots, "/")).toBe(true);
    expect(robotsAllows(robots, "/admin/settings")).toBe(false);
    expect(robotsAllows(robots, "/admin/public/page")).toBe(true);
  });
  it("detects a site-wide block", () => {
    expect(parseRobots("User-agent: *\nDisallow: /").disallowAll).toBe(true);
  });
});

describe("audit target safety", () => {
  it("refuses private and local targets", () => {
    for (const u of ["http://localhost", "http://127.0.0.1", "http://10.0.0.5", "http://192.168.1.1", "http://169.254.169.254", "ftp://acme.example", "http://user:pw@acme.example", "http://intranet"]) {
      expect(() => assertPublicUrl(u), u).toThrow();
    }
  });
  it("accepts public websites", () => {
    expect(assertPublicUrl("https://acme.example/path").hostname).toBe("acme.example");
  });
});

describe("scoring", () => {
  it("passes a well-built site except for the thin internal-link fixture", () => {
    const about = page({ url: "https://acme.example/about", finalUrl: "https://acme.example/about", title: "About Acme Hospital and our medical team", canonical: "https://acme.example/about" });
    const r = evaluate(seoRubric, crawl([page(), about]));
    const issues = r.findings.filter((f) => f.result === "fail" || f.result === "warn").map((f) => f.checkId);
    expect(issues).toEqual(["internal_links"]);
    expect(r.overall).toBeGreaterThan(90);
  });

  it("never treats missing data as a pass", () => {
    const r = evaluate(websiteRubric, crawl([page({ images: [] })], { linkChecks: [], httpRedirectsToHttps: null }));
    const byId = Object.fromEntries(r.findings.map((f) => [f.checkId, f.result]));
    expect(byId.image_alt).toBe("unavailable");
    expect(byId.http_redirect).toBe("unavailable");
    expect(byId.broken_internal_links).toBe("unavailable");
  });

  it("fails availability and maps findings to catalogue SKUs when the homepage is down", () => {
    const r = evaluate(websiteRubric, crawl([], { homepage: null, homepageError: "timeout" }));
    const reach = r.findings.find((f) => f.checkId === "reachable")!;
    expect(reach.result).toBe("fail");
    expect(reach.severity).toBe("critical");
    expect(reach.skus).toContain("GX-TEC-WEB");
    expect(r.categories.filter((c) => c.score !== null).map((c) => c.category)).toEqual(["availability"]);
  });

  it("flags missing metadata with evidence", () => {
    const r = evaluate(seoRubric, crawl([page({ title: null, metaDescription: null })]));
    const t = r.findings.find((f) => f.checkId === "title_present")!;
    expect(t.result).toBe("fail");
    expect(t.evidence[0].url).toBe("https://acme.example/");
  });

  it("weights categories as documented", () => {
    const r = evaluate(websiteRubric, crawl([page()]));
    expect(r.categories.reduce((s, c) => s + c.weight, 0)).toBe(100);
    const scored = r.categories.filter((c) => c.score !== null);
    const expected = Math.round(scored.reduce((s, c) => s + c.score! * c.weight, 0) / scored.reduce((s, c) => s + c.weight, 0));
    expect(r.overall).toBe(expected);
  });
});
