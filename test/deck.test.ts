import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import JSZip from "jszip";
import { buildAuditReportData } from "../shared/audit-report";
import { auditDeckSlides } from "../src/lib/audit-deck";
import { buildPptx, type Slide } from "../src/lib/deck";
import { sampleCompare, sampleRun } from "./fixtures/audit-sample";

const out = process.env.REPORT_OUT;
const blank = (s: Partial<Slide>): Slide => ({ layout: "bullets", title: "", subtitle: "", bullets: [], left_heading: "", left_bullets: [], right_heading: "", right_bullets: [], table_headers: [], table_rows: [], metrics: [], notes: "", ...s });

async function check(blob: Blob, name: string, minSlides: number) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (out) writeFileSync(`${out}/${name}.pptx`, buf);
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  expect(slides.length).toBeGreaterThanOrEqual(minSlides);
  const { DOMParser } = await import("node:util").then(() => import("node:module")).then(() => ({ DOMParser: undefined as unknown }));
  void DOMParser;
  for (const f of slides) expect((await zip.file(f)!.async("string")).startsWith("<?xml")).toBe(true);
  return zip;
}

describe("deck", () => {
  it("builds the audit deck", async () => {
    const d = buildAuditReportData(sampleRun, sampleCompare, "Pranay Chatterjee");
    const slides = auditDeckSlides(d);
    const zip = await check(await buildPptx(slides, { title: "Audit", company: d.accountName, author: "Pranay" }), "audit-deck", 8);
    expect(await zip.file("ppt/slides/slide1.xml")!.async("string")).toContain("A UNIT OF GEXART VENTURES");
  });
  it("builds every layout of the sales deck", async () => {
    const slides = [
      blank({ layout: "title", title: "Sunrise Dental Care", subtitle: "Digital growth proposal", bullets: ["SEO", "Website"] }),
      blank({ layout: "section", title: "Where you are today", subtitle: "Audit findings" }),
      blank({ title: "Executive summary", bullets: ["One", "Two", "Three"] }),
      blank({ layout: "two_column", title: "Problem → solution", left_heading: "What we found", left_bullets: ["A", "B"], right_heading: "How Gexart fixes it", right_bullets: ["Fix A", "Fix B"] }),
      blank({ layout: "table", title: "Key findings", table_headers: ["Priority", "Finding", "Evidence"], table_rows: [["critical", "No meta", "Missing"], ["low", "Headers", "None"]] }),
      blank({ layout: "metrics", title: "Snapshot", metrics: [{ label: "Website", value: "72/100" }, { label: "SEO", value: "41/100" }, { label: "Deals", value: "12" }] }),
      blank({ layout: "closing", title: "Next steps", subtitle: "Pranay · info@gexart.com", bullets: ["Call", "Proposal", "Kick-off"] }),
    ];
    await check(await buildPptx(slides, { title: "Deck", company: "Sunrise Dental", author: "Pranay" }), "sales-deck", 7);
  });
});
