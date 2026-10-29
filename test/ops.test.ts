import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { computeQualification } from "../worker/lib/qualification";
import { autoMap, csvCell, parseCsv } from "../worker/routes/imports";
import { pdfSafe, renderProposalPdf } from "../worker/lib/pdf";
import { detectTech, techRubric } from "../worker/audits/extra";
import { evaluate } from "../worker/audits/rubrics";
import type { CrawlResult, PageData } from "../worker/audits/crawler";

describe("qualification", () => {
  it("scores only observed facts and explains each factor", () => {
    const q = computeQualification({
      industry: "Healthcare", geography: "Kolkata", website: "https://acme.example", service_fit: "SEO", email: "a@acme.example",
      contact_name: "Asha Roy", contact_title: "Managing Director", campaign: { target_industry: "Healthcare, Hospitality", target_geography: "Kolkata" }, touches: 2, replied: true,
    });
    expect(q.factors.every((f) => f.points === (f.observed ? f.max : 0))).toBe(true);
    expect(q.score).toBe(95); // everything except written evidence
    expect(q.level).toBe("high");
  });
  it("marks thin records as needing research", () => {
    const q = computeQualification({ industry: "Retail", service_fit: "Website" });
    expect(q.level).toBe("needs_research");
    expect(q.factors.find((f) => f.key === "reachable")!.observed).toBe(false);
  });
  it("does not treat a missing campaign target as a match", () => {
    const q = computeQualification({ industry: "Retail", website: "x.example", email: "a@x.example" });
    expect(q.factors.find((f) => f.key === "industry_match")!.observed).toBe(false);
  });
});

describe("CSV", () => {
  it("parses quotes, escaped quotes, CRLF and embedded newlines", () => {
    const rows = parseCsv('﻿Company,Notes\r\n"Acme, Inc","He said ""hi""\nnext line"\r\nBeta,\r\n\r\n');
    expect(rows).toEqual([["Company", "Notes"], ["Acme, Inc", 'He said "hi"\nnext line'], ["Beta", ""]]);
  });
  it("maps common header names", () => {
    expect(autoMap(["Business Name", "Website", "City", "Mobile", "Designation"])).toMatchObject({ company_name: "Business Name", website: "Website", geography: "City", phone: "Mobile", contact_title: "Designation" });
  });
  it("neutralises spreadsheet formulas and quotes cells", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe("");
  });
});

describe("PDF proposal", () => {
  it("maps unsupported characters to WinAnsi-safe text", () => {
    expect(pdfSafe("₹25,000 — “quote” → done…")).toBe('Rs.25,000 - "quote" -> done...');
    expect(pdfSafe("नमस्ते Acme")).toBe(" Acme");
  });
  it("renders a valid multi-page PDF with the fixed sections", async () => {
    const bytes = await renderProposalPdf({
      title: "Digital Growth Proposal", clientName: "Acme Hospital", clientMeta: "Healthcare | Kolkata", contactLine: "Asha Roy, Director", preparedBy: "Dev Admin",
      date: "29 October 2026", validityDays: 30, introNote: "Thanks for your time.", summary: "Summary ".repeat(40),
      findings: Array.from({ length: 12 }, (_, i) => ({ severity: ["critical", "high", "medium", "low"][i % 4], title: `Finding ${i}`, detail: "Detail ".repeat(30), evidence: "https://acme.example/", source: "Website audit, 2026-10-29" })),
      solutions: [{ service: "SEO", packageName: "Growth", description: "Technical and content SEO", deliverables: ["Audit fixes", "Monthly report"], timeline: "3 months" }],
      prices: [{ service: "SEO", packageName: "Growth", billing: "Per month", qty: 1, unit: "INR 25,000", total: "INR 25,000", custom: false }, { service: "CRM", packageName: null, billing: "One-time", qty: 1, unit: "Custom quote", total: "Custom quote", custom: true }],
      totals: [{ label: "Per month total", value: "INR 25,000" }], priceNote: "Prices from the price book.", scopeNote: null,
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
    expect(doc.getTitle()).toContain("Acme Hospital");
  });
});

describe("technology & automation audit", () => {
  const page = (o: Partial<PageData>): PageData => ({
    url: "https://acme.example/", finalUrl: "https://acme.example/", status: 200, timeMs: 300, bytes: 1000, contentType: "text/html", headers: {}, title: "Acme", titleCount: 1,
    metaDescription: null, metaRobots: null, viewport: null, canonical: null, lang: "en", favicon: true, generator: null, author: null, ogTitle: null, ogImage: null, modifiedTime: null,
    headings: [], images: [], links: [], jsonLd: [], jsonLdErrors: 0, forms: 0, formFields: 0, hasTel: false, hasMailto: false, lists: 0, headScriptsBlocking: 0, scripts: 0, stylesheets: 0,
    insecureResources: [], wordCount: 100, timeElements: 0, emails: [], phones: [], resources: [], inlineScript: "", ...o,
  });
  const crawl = (p: PageData): CrawlResult => ({
    startUrl: p.url, origin: "https://acme.example", homepage: p, homepageError: null, pages: [p], pageErrors: [], skippedByRobots: [],
    robots: { status: "missing", disallowAll: false, rules: [], sitemaps: [], aiCrawlerBlocks: [] }, sitemap: { status: "missing", url: null, urlCount: null }, httpRedirectsToHttps: true, linkChecks: [], linksDiscovered: 0, scannedAt: "2026-10-29T00:00:00Z",
  });
  it("detects common stacks from script URLs and inline code", () => {
    const r = crawl(page({ resources: ["https://acme.example/wp-content/x.js", "https://www.googletagmanager.com/gtag/js?id=G-1", "https://embed.tawk.to/abc"], inlineScript: "fbq('init', '123');" }));
    const names = detectTech(r).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["WordPress", "Google Analytics 4", "Tawk.to", "Meta Pixel"]));
  });
  it("flags missing chat, booking and CRM capture as automation opportunities", () => {
    const e = evaluate(techRubric, crawl(page({ forms: 1, formFields: 4 })));
    const byId = Object.fromEntries(e.findings.map((f) => [f.checkId, f]));
    expect(byId.instant_response.result).toBe("fail");
    expect(byId.instant_response.skus).toContain("GX-TEC-AIA");
    expect(byId.lead_routing.result).toBe("warn");
    expect(byId.platform.result).toBe("unavailable");
  });
});
