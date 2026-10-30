import { describe, expect, it } from "vitest";
import { bouncedAddress, classifyByRules, dncMatch, effectiveDailyCap, footer, inSendWindow, OPT_OUT_LINE, templateSequence, type ResearchFacts } from "../worker/autopilot/rules";
import { buildMime, newReplyText } from "../worker/lib/gmail";
import { pickEmail } from "../worker/autopilot/research";

const reply = (text: string, extra: Partial<{ from: string; subject: string; autoSubmitted: boolean }> = {}) =>
  classifyByRules({ from: extra.from ?? "owner@clinic.in", subject: extra.subject ?? "Re: Quick idea", text, autoSubmitted: extra.autoSubmitted ?? false });

describe("do-not-contact matching", () => {
  const list = ["acme.in", "jane@shop.com"];
  it("blocks an address, its plus-tags, a domain and its subdomains", () => {
    expect(dncMatch("jane@shop.com", list)).toBe("jane@shop.com");
    expect(dncMatch("Jane+news@Shop.com", list)).toBe("jane@shop.com");
    expect(dncMatch("ravi@acme.in", list)).toBe("acme.in");
    expect(dncMatch("ravi@mail.acme.in", list)).toBe("acme.in");
  });
  it("does not over-match", () => {
    expect(dncMatch("ravi@notacme.in", list)).toBeNull();
    expect(dncMatch("john@shop.com", list)).toBeNull();
  });
});

describe("reply rules (compliance never depends on a model)", () => {
  it("treats any opt-out wording as an opt-out", () => {
    for (const t of ["No thanks", "please remove me from your list", "STOP", "Unsubscribe", "Don't email me again", "no thank you, all good"]) expect(reply(t)).toBe("opt_out");
  });
  it("detects bounces and out-of-office", () => {
    expect(reply("Address not found", { from: "mailer-daemon@googlemail.com", subject: "Delivery Status Notification (Failure)" })).toBe("bounce");
    expect(reply("I am out of the office until Monday", { autoSubmitted: false })).toBe("out_of_office");
    expect(reply("anything", { autoSubmitted: true })).toBe("out_of_office");
  });
  it("leaves real conversations to a human", () => {
    expect(reply("Sounds interesting, what would it cost for 2 locations?")).toBeNull();
    expect(reply("Can we talk on Thursday?")).toBeNull();
  });
  it("reads a short 'not interested' as a polite no", () => {
    expect(reply("Not interested, we already have someone.")).toBe("not_interested");
  });
  it("finds the bounced address", () => {
    expect(bouncedAddress("Your message wasn't delivered to info@clinic.in because the address couldn't be found")).toBe("info@clinic.in");
  });
});

describe("sending limits", () => {
  it("only sends inside the window, in the window's time zone", () => {
    const w = { start: "10:00", end: "18:00", days: [1, 2, 3, 4, 5, 6], tz: "Asia/Kolkata" };
    expect(inSendWindow(w, new Date("2026-11-02T05:00:00Z"))).toBe(true); // Mon 10:30 IST
    expect(inSendWindow(w, new Date("2026-11-02T03:00:00Z"))).toBe(false); // Mon 08:30 IST
    expect(inSendWindow(w, new Date("2026-11-01T06:00:00Z"))).toBe(false); // Sunday
  });
  it("ramps new mailboxes up slowly", () => {
    const start = "2026-11-01";
    expect(effectiveDailyCap(40, start, new Date("2026-11-03T12:00:00Z"))).toBe(5);
    expect(effectiveDailyCap(40, start, new Date("2026-11-10T12:00:00Z"))).toBe(10);
    expect(effectiveDailyCap(40, start, new Date("2027-01-10T12:00:00Z"))).toBe(40);
    expect(effectiveDailyCap(40, null)).toBe(40);
  });
});

describe("email content", () => {
  const facts: ResearchFacts = { company: "Smile Dental", domain: "smiledental.in", city: "Kolkata", industry: "Dentist", firstName: null, observations: [{ text: "There's no enquiry form on the main pages", source: "https://smiledental.in" }], hiring: false, tech: [], rating: 4.6, reviews: 120 };
  it("template quotes a real observation and never fakes a thread on email 1", () => {
    const s = templateSequence(facts, { offer: "We build sites that turn visits into bookings.", entry_offer: "a free audit", booking_url: null, sender_name: "Rati" });
    expect(s).toHaveLength(3);
    expect(s[0].subject.startsWith("Re:")).toBe(false);
    expect(s[0].body).toContain("there's no enquiry form");
    expect(s[0].body).toContain("Hi Smile Dental team,");
  });
  it("footer always carries the opt-out line and the address", () => {
    const f = footer("Rati · Gexart", "12 Park St, Kolkata");
    expect(f).toContain(OPT_OUT_LINE);
    expect(f).toContain("12 Park St, Kolkata");
  });
  it("builds safe MIME with unsubscribe header and no header injection", () => {
    const m = buildMime({ from: "rati@gexart-mail.com", fromName: "Rati", to: "a@b.in\r\nBcc: x@evil.com", subject: "Hello\nBcc: y@evil.com", text: "Hi", unsubscribeTo: "rati@gexart-mail.com" });
    const headers = m.split("\r\n\r\n")[0];
    expect(headers).toContain("List-Unsubscribe: <mailto:rati@gexart-mail.com?subject=unsubscribe>");
    expect(headers.split("\r\n").filter((l) => /^bcc:/i.test(l))).toHaveLength(0);
  });
  it("strips quoted history from replies", () => {
    expect(newReplyText("Yes please, call me.\n\nOn Mon, 2 Nov 2026 Rati wrote:\n> Hi there")).toBe("Yes please, call me.");
  });
  it("picks a published address on their own domain and ignores junk", () => {
    expect(pickEmail(["noreply@smiledental.in", "logo@2x.png", "dr.sen@gmail.com", "info@smiledental.in"], "smiledental.in")).toBe("info@smiledental.in");
    expect(pickEmail(["dr.sen@gmail.com"], "smiledental.in")).toBe("dr.sen@gmail.com");
    expect(pickEmail([], "x.in")).toBeNull();
  });
});
