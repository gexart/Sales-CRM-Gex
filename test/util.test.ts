import { describe, expect, it } from "vitest";
import { domainOf, normalizeEmail, normalizeName, normalizePhone } from "../worker/lib/util";
import { accountSchema, opportunitySchema } from "../shared/schemas";

describe("duplicate-detection normalisation", () => {
  it("normalises company names conservatively", () => {
    expect(normalizeName("Eskag Sanjeevani Pvt. Ltd.")).toBe(normalizeName("eskag sanjeevani"));
    expect(normalizeName("A & B Hotels")).toBe("a and b hotels");
    // Different companies must stay different.
    expect(normalizeName("Sanjeevani Hospital")).not.toBe(normalizeName("Sanjeevani Clinic"));
  });
  it("extracts comparable domains", () => {
    expect(domainOf("https://www.Acme.example/about")).toBe("acme.example");
    expect(domainOf("acme.example")).toBe("acme.example");
    expect(domainOf(null)).toBeNull();
  });
  it("normalises email and phone", () => {
    expect(normalizeEmail("  Ravi@Acme.Example ")).toBe("ravi@acme.example");
    expect(normalizePhone("+91 98300-12345")).toBe(normalizePhone("098300 12345"));
    expect(normalizePhone("12")).toBeNull();
  });
});

describe("shared validation", () => {
  it("adds a scheme to bare websites and blanks optional fields", () => {
    const r = accountSchema.parse({ name: "Acme", website: "acme.example", email: "" });
    expect(r.website).toBe("https://acme.example");
    expect(r.email).toBeNull();
    expect(r.status).toBe("new");
  });
  it("rejects invalid status values", () => {
    expect(accountSchema.safeParse({ name: "Acme", status: "won" }).success).toBe(false);
  });
  it("requires an account for opportunities and bounds probability", () => {
    expect(opportunitySchema.safeParse({ name: "Deal" }).success).toBe(false);
    expect(opportunitySchema.safeParse({ name: "Deal", account_id: "a", probability: 120 }).success).toBe(false);
  });
});
