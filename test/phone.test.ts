import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import JSZip from "jszip";
import { CONTACT_NUMBERS, DEFAULT_PHONE, parsePhones, resolvePhone } from "../shared/letterhead";
import { buildAuditReportData } from "../shared/audit-report";
import { renderAuditDocx } from "../worker/lib/audit-docx";
import { renderAuditPdf } from "../worker/lib/audit-pdf";
import { sampleCompare, sampleRun } from "./fixtures/audit-sample";

const out = process.env.REPORT_OUT;
const header = async (docx: Uint8Array) => (await (await JSZip.loadAsync(docx)).file("word/header1.xml")!.async("string")).replace(/<[^>]+>/g, " ");
const [A, B, C] = CONTACT_NUMBERS;

describe("contact numbers", () => {
  it("offers three numbers with 9038991880 as the default", () => {
    expect(DEFAULT_PHONE).toBe("+91 9038991880");
    expect([A, B, C]).toEqual(["+91 9038991880", "+91 877 767 2293", "+91 8274872626"]);
  });
  it("matches by digits, keeps a fixed order and falls back to the default for anything unknown", () => {
    expect(parsePhones("8777672293")).toEqual([B]);
    expect(parsePhones("+91 8274872626,9038991880")).toEqual([A, C]);
    expect(parsePhones([C, B, A])).toEqual([A, B, C]);
    expect(parsePhones("12345")).toEqual([A]);
    expect(parsePhones(undefined)).toEqual([A]);
    expect(resolvePhone(`${A}, ${B}`)).toBe(`${A}  ·  ${B}`);
  });
  it("prints exactly the chosen numbers in the Word letterhead", async () => {
    for (const choice of [[A], [B], [A, B], [B, C], [A, B, C]]) {
      const h = await header(await renderAuditDocx(buildAuditReportData(sampleRun, sampleCompare, "P", choice.join(","))));
      for (const n of CONTACT_NUMBERS) (choice as string[]).includes(n) ? expect(h).toContain(n) : expect(h).not.toContain(n);
      expect(h).toContain("A unit of Gexart Ventures");
    }
  });
  it("renders the PDF letterhead with two chosen numbers", async () => {
    const pdf = await renderAuditPdf(buildAuditReportData(sampleRun, sampleCompare, "P", `${A},${B}`));
    expect(pdf.byteLength).toBeGreaterThan(20_000);
    if (out) writeFileSync(`${out}/audit-two-numbers.pdf`, pdf);
  });
});
