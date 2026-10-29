import { describe, expect, it } from "vitest";
import { escapeHtml, hasUnresolved, placeholdersIn, render, textToHtml, unknownPlaceholders } from "../shared/templating";
import { nineAmIn } from "../worker/routes/outreach";

describe("template rendering", () => {
  it("fills known placeholders, tolerating spaces inside braces", () => {
    const r = render("Hi {{ contact_first_name }}, about {{company_name}}", { contact_first_name: "Asha", company_name: "Acme" });
    expect(r.text).toBe("Hi Asha, about Acme");
    expect(r.missing).toEqual([]);
  });

  it("leaves missing values in place and reports them", () => {
    const r = render("Hi {{contact_first_name}} from {{company_name}}", { company_name: "Acme", contact_first_name: "  " });
    expect(r.text).toBe("Hi {{contact_first_name}} from Acme");
    expect(r.missing).toEqual(["contact_first_name"]);
    expect(hasUnresolved(r.text)).toBe(true);
  });

  it("reports unsupported placeholders instead of evaluating them", () => {
    const r = render("{{constructor}} {{__proto__}} {{company_name}}", { company_name: "Acme" });
    expect(r.unknown.sort()).toEqual(["__proto__", "constructor"]);
    expect(r.text).toBe("{{constructor}} {{__proto__}} Acme");
    expect(unknownPlaceholders("{{sender_name}} {{case_study_link}}")).toEqual(["case_study_link"]);
  });

  it("does not re-expand placeholders that appear inside values", () => {
    const r = render("Hello {{company_name}}", { company_name: "{{sender_email}} Ltd" });
    expect(r.text).toBe("Hello {{sender_email}} Ltd");
  });

  it("lists placeholders once", () => {
    expect(placeholdersIn("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
    expect(hasUnresolved("No placeholders here", null)).toBe(false);
  });

  it("escapes values for HTML email", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'q'`)).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;");
    expect(textToHtml("Hi <b>\nthere\n\nBye")).toBe("<p>Hi &lt;b&gt;<br>there</p>\n<p>Bye</p>");
  });
});

describe("sequence scheduling", () => {
  it("schedules steps at 09:00 in the user's timezone", () => {
    expect(nineAmIn("2026-11-02", "Asia/Kolkata")).toBe("2026-11-02T03:30:00.000Z");
    expect(nineAmIn("2026-07-01", "Europe/London")).toBe("2026-07-01T08:00:00.000Z");
    expect(nineAmIn("2026-01-15", "UTC")).toBe("2026-01-15T09:00:00.000Z");
  });
});
