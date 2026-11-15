import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import JSZip from "jszip";
import type { ProposalData } from "../worker/lib/pdf";
import { renderProposalPdf } from "../worker/lib/proposal-pdf";
import { renderProposalDocx } from "../worker/lib/proposal-docx";

const out = process.env.REPORT_OUT;
const data: ProposalData = {
  title: "Digital Growth Proposal",
  clientName: "Sunrise Dental Care Pvt Ltd",
  clientMeta: "Dental clinic  |  Kolkata  |  sunrisedental.example",
  contactLine: "Dr. Ananya Sen, Managing Director",
  preparedBy: "Pranay Chatterjee",
  date: "15 November 2026",
  validityDays: 30,
  introNote: "Thank you for the time on Tuesday. This proposal puts the audit findings next to the fixes and what they cost.",
  summary: "Sunrise Dental Care operates in dentistry in Kolkata. Gexart reviewed its public online presence (Website audit on 10 Nov, score 58/100) and recorded 6 issues that affect how patients find and contact the clinic. We recommend Search Engine Optimisation and Website Development.",
  findings: [
    { severity: "critical", title: "Homepage has no meta description", detail: "Search engines generate the snippet, which usually performs worse than a written one.", evidence: "/ : <meta name=description> not found", source: "Website audit" },
    { severity: "high", title: "Images are not compressed", detail: "Homepage image weight is 4.8 MB; the hero image alone is 2.1 MB.", evidence: null, source: "Website audit" },
    { severity: "medium", title: "Tap targets too close together on mobile", detail: "Navigation links are 28px apart; the recommended minimum is 44px.", evidence: null, source: "Website audit" },
  ],
  solutions: [
    { service: "Search Engine Optimisation", packageName: "Growth", description: "On-page, technical and local SEO for a single location.", deliverables: ["Keyword and page map", "Unique titles and descriptions for every page", "LocalBusiness schema", "Monthly ranking and traffic report"], timeline: "3 months" },
    { service: "Website Development", packageName: null, description: "Speed and mobile fixes on the existing site.", deliverables: ["Image optimisation", "Mobile navigation fixes"], timeline: "2 weeks" },
  ],
  prices: [
    { service: "Search Engine Optimisation", packageName: "Growth", billing: "Monthly", qty: 3, unit: "Rs. 25,000", total: "Rs. 75,000", custom: false },
    { service: "Website Development", packageName: null, billing: "One time", qty: 1, unit: "Custom quote", total: "Custom quote", custom: true },
  ],
  totals: [{ label: "Monthly total", value: "Rs. 75,000" }],
  priceNote: "Prices from the Gexart price book as of 15 November 2026. Items marked Custom quote will be priced in writing after scope is confirmed.",
  scopeNote: "Audit findings reflect publicly observable evidence on the pages inspected; they are not a guarantee of rankings or revenue.",
};

describe("proposal on the letterhead", () => {
  it("renders the PDF", async () => {
    const pdf = await renderProposalPdf(data);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    if (out) writeFileSync(`${out}/proposal.pdf`, pdf);
  });
  it("renders the Word file with the letterhead header", async () => {
    const docx = await renderProposalDocx(data);
    const zip = await JSZip.loadAsync(docx);
    expect(await zip.file("word/header1.xml")!.async("string")).toContain("A unit of Gexart Ventures");
    const body = await zip.file("word/document.xml")!.async("string");
    expect(body).toContain("Sunrise Dental Care");
    expect(body).toContain("Rs. 75,000");
    if (out) writeFileSync(`${out}/proposal.docx`, docx);
  });
});
