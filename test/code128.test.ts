import { describe, expect, it } from "vitest";
import { CODE128_PATTERNS, code128Clean, code128Widths } from "../shared/code128";

describe("Code 128", () => {
  it("has the 107 standard patterns, each 11 modules wide (stop is 13)", () => {
    expect(CODE128_PATTERNS.length).toBe(107);
    CODE128_PATTERNS.forEach((p, i) => expect([...p].reduce((a, c) => a + Number(c), 0), `pattern ${i}`).toBe(i === 106 ? 13 : 11));
  });
  it("encodes a known value: 'A' uses start B, value 33, checksum (104 + 33) mod 103 = 34", () => {
    const w = code128Widths("A");
    expect(w.reduce((a, c) => a + c, 0)).toBe(11 * 3 + 13); // start, A, checksum, stop
    const expected = [CODE128_PATTERNS[104], CODE128_PATTERNS[33], CODE128_PATTERNS[34], CODE128_PATTERNS[106]].join("");
    expect(w.join("")).toBe(expected);
  });
  it("never fails on odd input", () => {
    expect(code128Clean("आ")).toBe("0");
    expect(code128Widths("Item 12-34").length).toBeGreaterThan(20);
  });
});
