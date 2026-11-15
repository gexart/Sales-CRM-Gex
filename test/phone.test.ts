import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import JSZip from "jszip";
import { CONTACT_NUMBERS, DEFAULT_PHONE, resolvePhone } from "../shared/letterhead";
import { buildAuditReportData } from "../shared/audit-report";
import { renderAuditDocx } from "../worker/lib/audit-docx";
import { renderAuditPdf } from "../worker/lib/audit-pdf";
import { sampleCompare, sampleRun } from "./fixtures/audit-sample";

const out = process.env.REPORT_OUT;
const header = async (docx: Uint8Array) => (await (await JSZip.loadAsync(docx)).file("word/header1.xml")!.async("string")).replace(/<[^>]+>/g, " ");

describe("contact number choice", () => {
  it("defaults to 9038991880 and offers the three numbers", () => {
    expect(DEFAULT_PHONE).toBe("+91 9038991880");
    expect(CONTACT_NUMBERS).toEqual(["+91 9038991880", "+91 877 767 2293", "+91 8274872626"]);
  });
  it("matches by digits and falls back to the default for anything unknown", () => {
    expect(resolvePhone("8777672293")).toBe("+91 877 767 2293");
    expect(resolvePhone("+91 8274872626")).toBe("+91 8274872626");
    expect(resolvePhone("12345")).toBe(DEFAULT_PHONE);
    expect(resolvePhone(undefined)).toBe(DEFAULT_PHONE);
  });
  it("prints only the chosen number in the Word letterhead", async () => {
    for (const n of CONTACT_NUMBERS) {
      const h = await header(await renderAuditDocx(buildAuditReportData(sampleRun, sampleCompare, "P", n)));
      expect(h).toContain(n);
      for (const other of CONTACT_NUMBERS.filter((x) => x !== n)) expect(h).not.toContain(other);
      expect(h).toContain("A unit of Gexart Ventures");
    }
  });
  it("renders the PDF letterhead with the chosen number", async () => {
    const pdf = await renderAuditPdf(buildAuditReportData(sampleRun, sampleCompare, "P", "+91 877 767 2293"));
    expect(pdf.byteLength).toBeGreaterThan(20_000);
    if (out) writeFileSync(`${out}/audit-877.pdf`, pdf);
  });
});
