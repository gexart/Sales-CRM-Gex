import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { buildAuditReportData } from "../shared/audit-report";
import { auditDeckSlides } from "../src/lib/audit-deck";
import { buildDeckPdf } from "../src/lib/deck-pdf";
import type { Slide } from "../src/lib/deck";
import { sampleCompare, sampleRun } from "./fixtures/audit-sample";

const out = process.env.REPORT_OUT;
const blank = (s: Partial<Slide>): Slide => ({ layout: "bullets", title: "", subtitle: "", bullets: [], left_heading: "", left_bullets: [], right_heading: "", right_bullets: [], table_headers: [], table_rows: [], metrics: [], notes: "", ...s });

async function render(slides: Slide[], name: string) {
  const blob = await buildDeckPdf(slides, { title: name, company: "Sunrise Dental Care", author: "Pranay" });
  const buf = new Uint8Array(await blob.arrayBuffer());
  expect(new TextDecoder().decode(buf.slice(0, 5))).toBe("%PDF-");
  if (out) writeFileSync(`${out}/${name}.pdf`, buf);
  return buf;
}

describe("deck pdf", () => {
  it("renders the audit deck", async () => {
    const d = buildAuditReportData(sampleRun, sampleCompare, "Pranay Chatterjee");
    await render(auditDeckSlides(d), "audit-deck");
  });
  it("renders every layout of the sales deck", async () => {
    await render(
      [
        blank({ layout: "title", title: "Sunrise Dental Care", subtitle: "Digital growth proposal", bullets: ["SEO", "Website", "Google Business"] }),
        blank({ layout: "section", title: "Where you are today", subtitle: "Audit findings" }),
        blank({ title: "Executive summary", bullets: ["We audited the public presence and found 6 improvement opportunities.", "Recommended: Search Engine Optimisation, Website Development.", "Services to be confirmed in discovery."] }),
        blank({ layout: "two_column", title: "Problem → solution", left_heading: "What we found", left_bullets: ["No meta description", "Images too heavy"], right_heading: "How Gexart fixes it", right_bullets: ["SEO: write unique descriptions for each page", "Website Development: compress and lazy-load images"] }),
        blank({ layout: "table", title: "Key findings", table_headers: ["Priority", "Finding", "Evidence"], table_rows: [["critical", "No meta description", "Missing on the homepage"], ["low", "Security headers", "Not sent"]] }),
        blank({ layout: "metrics", title: "Snapshot", metrics: [{ label: "Website", value: "72/100" }, { label: "SEO", value: "41/100" }, { label: "Open deals", value: "12" }] }),
        blank({ layout: "closing", title: "Next steps", subtitle: "Pranay · info@gexart.com", bullets: ["30-minute discovery call", "Written proposal", "Kick-off"] }),
      ],
      "sales-deck",
    );
  });
});
