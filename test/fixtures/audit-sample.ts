// A realistic loadRunDetail() response used to render the audit report in tests.
const f = (i: number, category: string, result: string, severity: string, title: string, detail: string, recommendation: string | null, effort: string | null, skus: string[] = [], ev: [string, string][] = []) => ({
  id: `f${i}`, category, result, severity, title, detail, recommendation, effort,
  related_products: skus.map((s) => ({ id: s, name: s })),
  evidence: ev.map(([url, observation], k) => ({ id: `e${i}${k}`, url, observation, captured_at: "2026-11-10T10:00:00Z" })),
});
export const sampleRun: Record<string, any> = {
  type_label: "Website audit", account_name: "Sunrise Dental Care Pvt Ltd", target: "https://www.sunrisedental.example/", audit_version: "website-v1.2",
  created_at: "2026-11-10T09:58:00Z", completed_at: "2026-11-10T10:00:12Z", initiated_by_name: "Pranay Chatterjee", overall_score: 58, status: "completed",
  categories: [
    { category: "seo", label: "On-page SEO", weight: 30, score: 52, checks_passed: 9, checks_failed: 6, checks_unavailable: 0 },
    { category: "perf", label: "Speed & performance", weight: 20, score: 41, checks_passed: 4, checks_failed: 5, checks_unavailable: 1 },
    { category: "ux", label: "Mobile & usability", weight: 20, score: 78, checks_passed: 8, checks_failed: 2, checks_unavailable: 0 },
    { category: "trust", label: "Trust & security", weight: 15, score: 90, checks_passed: 7, checks_failed: 1, checks_unavailable: 0 },
    { category: "conv", label: "Conversion readiness", weight: 15, score: null, checks_passed: 0, checks_failed: 0, checks_unavailable: 4 },
  ],
  findings: [
    f(1, "seo", "fail", "critical", "Homepage has no meta description", "Search engines will auto-generate the snippet, which usually performs worse than a written one.", "Write a 140-155 character description that includes the main service and city.", "low", ["Search Engine Optimisation"], [["https://www.sunrisedental.example/", "<meta name=\"description\"> not found in <head>"]]),
    f(2, "perf", "fail", "high", "Images are not compressed or modern-format", "Total image weight on the homepage is 4.8 MB; the largest hero image is 2.1 MB JPEG.", "Convert to WebP/AVIF, resize to display size and lazy-load below-the-fold images.", "medium", ["Website Development"], [["https://www.sunrisedental.example/", "hero-banner.jpg 2,153 KB; gallery-1.png 1,420 KB"], ["https://www.sunrisedental.example/gallery", "14 images over 300 KB"]]),
    f(3, "seo", "fail", "high", "Only 1 of 6 pages has a unique title tag", "Five pages share the same title 'Sunrise Dental Care', which weakens relevance for each service.", "Give each page a unique title of 50-60 characters with the service and location.", "low", ["Search Engine Optimisation"], []),
    f(4, "ux", "warn", "medium", "Tap targets too close together on mobile", "Navigation links on 390px width are 28px apart; recommended minimum is 44px.", "Increase padding on menu links and footer links.", "low", ["Website Development"], [["https://www.sunrisedental.example/contact", "6 links under 32px tall in the footer"]]),
    f(5, "seo", "fail", "medium", "No structured data for local business", "No LocalBusiness / Dentist schema was found, so rich results and map panels are less likely.", "Add LocalBusiness JSON-LD with address, hours, phone and review rating.", "medium", ["Search Engine Optimisation", "Google Business Profile Management"], []),
    f(6, "trust", "fail", "low", "Missing security headers", "Content-Security-Policy and Permissions-Policy headers were not sent.", "Add the headers at the CDN or web server.", "low", [], []),
    f(7, "seo", "pass", "positive", "HTTPS is enforced site-wide", "", null, null),
    f(8, "seo", "pass", "positive", "Sitemap.xml is present and valid", "", null, null),
    f(9, "ux", "pass", "positive", "Viewport meta tag configured", "", null, null),
    f(10, "trust", "pass", "positive", "Privacy policy page linked in footer", "", null, null),
    f(11, "perf", "pass", "positive", "Compression (gzip/brotli) enabled for text assets", "", null, null),
    f(12, "conv", "unavailable", "low", "Contact form submission test", "Forms are not submitted by the audit so no data is created on the client's site.", null, null),
    f(13, "conv", "unavailable", "low", "Analytics and conversion tracking", "Needs the business's own analytics access.", null, null),
  ],
  scope: { pages: [{ url: "https://www.sunrisedental.example/" }, { url: "https://www.sunrisedental.example/about" }, { url: "https://www.sunrisedental.example/services" }, { url: "https://www.sunrisedental.example/contact" }], links_checked: 38, links_discovered: 52, note: "Server-rendered HTML only." },
  warnings: ["robots.txt blocked one internal path, which was skipped."],
};
export const sampleCompare = { previous: { created_at: "2026-09-02T10:00:00Z", overall_score: 49 }, score_change: 9, same_rubric: true, resolved: ["Site is not served over HTTPS", "Missing viewport meta tag"], new_issues: ["No structured data for local business"] };
