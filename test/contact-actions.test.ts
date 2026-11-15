import { describe, expect, it } from "vitest";
import { telHref, waHref, waNumber } from "../src/lib/contact-links";

describe("click-to-call and WhatsApp links", () => {
  it("adds India's country code to bare 10-digit numbers", () => {
    expect(waNumber("98300 12345")).toBe("919830012345");
    expect(waNumber("098300-12345")).toBe("919830012345");
  });
  it("keeps numbers that already carry a country code", () => {
    expect(waNumber("+91 877 767 2293")).toBe("918777672293");
    expect(waNumber("+1 (415) 555-0100")).toBe("14155550100");
    expect(waNumber("0091 9038991880")).toBe("919038991880");
  });
  it("builds tel and wa.me links, with the message URL-encoded", () => {
    expect(telHref("98300 12345")).toBe("tel:+919830012345");
    expect(waHref("98300 12345")).toBe("https://wa.me/919830012345");
    expect(waHref("98300 12345", "Hi, proposal & deck")).toBe("https://wa.me/919830012345?text=Hi%2C%20proposal%20%26%20deck");
  });
});
