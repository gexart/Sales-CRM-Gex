import { describe, expect, it } from "vitest";
import { CONFIG_FIELDS, CONFIG_SECTIONS, checkConfigValue } from "../shared/config";

const field = (key: string) => CONFIG_FIELDS.find((f) => f.key === key)!;

describe("configuration fields", () => {
  it("has unique keys and every provider-backed key is a secret", () => {
    expect(new Set(CONFIG_FIELDS.map((f) => f.key)).size).toBe(CONFIG_FIELDS.length);
    expect(CONFIG_SECTIONS.every((s) => s.fields.length > 0)).toBe(true);
    for (const f of CONFIG_FIELDS.filter((x) => x.provider)) expect(f.kind).toBe("secret");
  });

  it("validates values by kind", () => {
    expect(checkConfigValue(field("BREVO_SENDER_EMAIL"), "sales@gexart.com")).toBeNull();
    expect(checkConfigValue(field("BREVO_SENDER_EMAIL"), "sales@")).toMatch(/email/);
    expect(checkConfigValue(field("QUOTA_CLAUDE"), "250")).toBeNull();
    expect(checkConfigValue(field("QUOTA_CLAUDE"), "2.5")).toMatch(/whole number/);
    expect(checkConfigValue(field("GITHUB_REPO"), "gexart/Sales-CRM-Gex")).toBeNull();
    expect(checkConfigValue(field("GITHUB_REPO"), "https://github.com/gexart")).toMatch(/owner\/name/);
    expect(checkConfigValue(field("ANTHROPIC_API_KEY"), "sk-ant-abc\nX-Header: 1")).toMatch(/single line/);
  });
});
