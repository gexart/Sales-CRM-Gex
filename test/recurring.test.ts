import { describe, expect, it } from "vitest";
import { nextDate } from "../worker/billing/recurring";

describe("recurring invoice dates", () => {
  it("adds a week", () => expect(nextDate("2026-12-28", "weekly")).toBe("2027-01-04"));
  it("keeps the day each month", () => expect(nextDate("2026-03-15", "monthly")).toBe("2026-04-15"));
  it("short months use their last day, and it does not drift forward", () => {
    expect(nextDate("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextDate("2024-01-31", "monthly")).toBe("2024-02-29");
    expect(nextDate("2026-02-28", "monthly")).toBe("2026-03-28");
  });
  it("rolls over the year", () => {
    expect(nextDate("2026-11-30", "quarterly")).toBe("2027-02-28");
    expect(nextDate("2026-08-31", "half_yearly")).toBe("2027-02-28");
    expect(nextDate("2026-12-15", "monthly")).toBe("2027-01-15");
  });
  it("yearly handles leap days", () => expect(nextDate("2024-02-29", "yearly")).toBe("2025-02-28"));
});
