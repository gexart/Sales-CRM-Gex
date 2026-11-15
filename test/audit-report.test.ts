import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import JSZip from "jszip";
import { buildAuditReportData, summaryParagraph } from "../shared/audit-report";
import { renderAuditDocx } from "../worker/lib/audit-docx";
import { renderAuditPdf } from "../worker/lib/audit-pdf";
import { sampleCompare, sampleRun } from "./fixtures/audit-sample";

const data = () => buildAuditReportData(sampleRun, sampleCompare, "Pranay Chatterjee");
const out = process.env.REPORT_OUT;

describe("audit report", () => {
  it("builds a summary from the findings", () => {
    const s = summaryParagraph(data());
    expect(s).toContain("58/100");
    expect(s).toContain("Needs improvement");
  });
  it("renders a Word document on the letterhead", async () => {
    const docx = await renderAuditDocx(data());
    const zip = await JSZip.loadAsync(docx);
    expect(await zip.file("word/header1.xml")!.async("string")).toContain("A unit of Gexart Ventures");
    expect(await zip.file("word/document.xml")!.async("string")).toContain("Sunrise Dental Care");
    if (out) writeFileSync(`${out}/audit.docx`, docx);
  });
  it("renders a multi-page PDF on the letterhead", async () => {
    const pdf = await renderAuditPdf(data());
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(20_000);
    if (out) writeFileSync(`${out}/audit.pdf`, pdf);
  });
});
