import { describe, expect, it } from "vitest";
import { ALL_PERMISSION_KEYS, SYSTEM_ROLES, buildAccess, hasPermission, isPermission } from "../shared/access";
import { ruleFor } from "../worker/billing/access";

const role = (name: string) => SYSTEM_ROLES.find((r) => r.name === name)!;
const access = (name: string, extra: string[] = [], denied: string[] = []) => buildAccess({ isAdmin: false, role: role(name), extra, denied });

describe("billing permissions", () => {
  it("every role only lists real permissions", () => {
    for (const r of SYSTEM_ROLES) expect(r.permissions.every(isPermission), r.name).toBe(true);
  });
  it("administrators hold everything", () => {
    const a = buildAccess({ isAdmin: true, role: null });
    expect(ALL_PERMISSION_KEYS.every((k) => hasPermission(a, k))).toBe(true);
  });
  it("sales executive cannot create or request invoices; billing agent can only request", () => {
    const exec = access("Sales Executive");
    expect(hasPermission(exec, "quotation.create") && hasPermission(exec, "proforma.create")).toBe(true);
    expect(hasPermission(exec, "invoice.create") || hasPermission(exec, "invoice.request")).toBe(false);
    const agent = access("Billing Agent");
    expect(hasPermission(agent, "invoice.request")).toBe(true);
    expect(hasPermission(agent, "invoice.create") || hasPermission(agent, "invoice.approve")).toBe(false);
    expect(["reports.view", "sales_analysis.view", "collections.view"].some((k) => hasPermission(agent, k))).toBe(false);
  });
  it("extras add and denials remove; no role means no access", () => {
    expect(hasPermission(access("Billing Agent", ["invoice.create"]), "invoice.create")).toBe(true);
    expect(hasPermission(access("View only", [], ["invoice.view"]), "invoice.view")).toBe(false);
    expect(buildAccess({ isAdmin: false, role: null }).permissions.size).toBe(0);
  });
  it("unknown permissions in extras are ignored", () => {
    expect(access("View only", ["made.up"]).permissions.has("made.up")).toBe(false);
  });
});

describe("billing route rules (deny by default)", () => {
  it("maps known routes", () => {
    expect(ruleFor("GET", "/reports/profit-loss", {})).toEqual({ all: ["reports.view"] });
    expect(ruleFor("POST", "/sales/invoices", {})).toEqual({ special: "invoice_create" });
    expect(ruleFor("POST", "/documents", { docType: "QUOTATION" })).toEqual({ all: ["quotation.create"] });
    expect(ruleFor("POST", "/documents", { docType: "PROFORMA" })).toEqual({ all: ["proforma.create"] });
  });
  it("has no rule for unknown routes, unknown document types or conversion into invoices", () => {
    expect(ruleFor("GET", "/settings/members", {})).toBeNull();
    expect(ruleFor("POST", "/documents", { docType: "NOPE" })).toBeNull();
    expect(ruleFor("POST", "/documents/x/convert", { target: "INVOICE" })).toBeNull();
    expect(ruleFor("DELETE", "/sales/invoices", {})).toBeNull();
  });
});
