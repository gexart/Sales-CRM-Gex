import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import JSZip from "jszip";
import { CONTACT_NUMBERS } from "../shared/letterhead";
import { buildDeckPdf } from "../src/lib/deck-pdf";
import { buildPptx, type Slide } from "../src/lib/deck";

const out = process.env.REPORT_OUT;
const blank = (s: Partial<Slide>): Slide => ({ layout: "bullets", title: "", subtitle: "", bullets: [], left_heading: "", left_bullets: [], right_heading: "", right_bullets: [], table_headers: [], table_rows: [], metrics: [], notes: "", ...s });
const slides = [
  blank({ layout: "title", title: "Sunrise Dental Care", subtitle: "Digital growth proposal" }),
  blank({ layout: "closing", title: "Next steps", subtitle: "Pranay · info@gexart.com", bullets: ["Discovery call", "Proposal", "Kick-off"] }),
];
const meta = (phone: string) => ({ title: "Deck", company: "Sunrise Dental", author: "P", phone });

describe("deck with several contact numbers", () => {
  it("prints only the chosen numbers in the PowerPoint", async () => {
    const [A, B, C] = CONTACT_NUMBERS;
    const blob = await buildPptx(slides, meta(`${A},${B}`));
    const zip = await JSZip.loadAsync(new Uint8Array(await blob.arrayBuffer()));
    const all = (await Promise.all(Object.keys(zip.files).filter((f) => /^ppt\/(slides|slideMasters)\/.*\.xml$/.test(f)).map((f) => zip.file(f)!.async("string")))).join(" ");
    expect(all).toContain(A);
    expect(all).toContain(B);
    expect(all).not.toContain(C);
  });
  it("renders the deck PDF with all three numbers", async () => {
    const blob = await buildDeckPdf(slides, meta(CONTACT_NUMBERS.join(",")));
    const buf = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(buf.slice(0, 5))).toBe("%PDF-");
    if (out) writeFileSync(`${out}/deck-3-numbers.pdf`, buf);
  });
});
