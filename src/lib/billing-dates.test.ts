// src/lib/billing-dates.test.ts
import { describe, it, expect } from "vitest";
import {
  firstPeriodLabel,
  nextPeriodLabel,
  dueDateForPeriod,
} from "@/lib/billing-dates";

describe("dueDateForPeriod", () => {
  it("returns the exact billing day for a month long enough to have it", () => {
    const date = dueDateForPeriod("2026-09", 5);
    expect(date.getUTCFullYear()).toBe(2026);
    expect(date.getUTCMonth()).toBe(8); // 0-indexed: September
    expect(date.getUTCDate()).toBe(5);
  });

  it("returns exactly midnight UTC, not just the right calendar day", () => {
    const date = dueDateForPeriod("2026-09", 5);
    expect(date.toISOString()).toBe("2026-09-05T00:00:00.000Z");
  });

  it("clamps to the last day of a 30-day month when billingDay is 31", () => {
    const date = dueDateForPeriod("2026-04", 31); // April has 30 days
    expect(date.getUTCMonth()).toBe(3);
    expect(date.getUTCDate()).toBe(30);
  });

  it("clamps to 28 in a non-leap February", () => {
    const date = dueDateForPeriod("2026-02", 31); // 2026 is not a leap year
    expect(date.getUTCMonth()).toBe(1);
    expect(date.getUTCDate()).toBe(28);
  });

  it("clamps to 29 in a leap February", () => {
    const date = dueDateForPeriod("2028-02", 31); // 2028 IS a leap year
    expect(date.getUTCMonth()).toBe(1);
    expect(date.getUTCDate()).toBe(29);
  });

  it("resumes the full billingDay once a long-enough month comes around again", () => {
    // billingDay 31: Jan (31 days, exact) -> Feb (clamped) -> Mar (31 days, exact again)
    expect(dueDateForPeriod("2026-01", 31).getUTCDate()).toBe(31);
    expect(dueDateForPeriod("2026-02", 31).getUTCDate()).toBe(28);
    expect(dueDateForPeriod("2026-03", 31).getUTCDate()).toBe(31);
  });
});

describe("nextPeriodLabel", () => {
  it("advances one month for MONTHLY", () => {
    expect(nextPeriodLabel("2026-09", "MONTHLY")).toBe("2026-10");
  });

  it("wraps the year for MONTHLY across December", () => {
    expect(nextPeriodLabel("2026-12", "MONTHLY")).toBe("2027-01");
  });

  it("advances three months for QUARTERLY", () => {
    expect(nextPeriodLabel("2026-01", "QUARTERLY")).toBe("2026-04");
  });

  it("advances three months for QUARTERLY across a year boundary", () => {
    expect(nextPeriodLabel("2026-11", "QUARTERLY")).toBe("2027-02");
  });

  it("advances six months for HALF_YEARLY", () => {
    expect(nextPeriodLabel("2026-03", "HALF_YEARLY")).toBe("2026-09");
  });

  it("advances six months for HALF_YEARLY across a year boundary", () => {
    expect(nextPeriodLabel("2026-09", "HALF_YEARLY")).toBe("2027-03");
  });

  it("advances twelve months for YEARLY", () => {
    expect(nextPeriodLabel("2026-06", "YEARLY")).toBe("2027-06");
  });

  it("returns null for ONE_TIME — there is no next period", () => {
    expect(nextPeriodLabel("2026-06", "ONE_TIME")).toBeNull();
  });
});

describe("firstPeriodLabel", () => {
  it("uses the start month when billingDay has not yet passed", () => {
    // starts Aug 3, billing day is the 5th — hasn't happened yet this month
    const label = firstPeriodLabel(new Date(Date.UTC(2026, 7, 3)), 5);
    expect(label).toBe("2026-08");
  });

  it("uses the next month when billingDay has already passed", () => {
    // starts Aug 12, billing day is the 5th — already passed this month
    const label = firstPeriodLabel(new Date(Date.UTC(2026, 7, 12)), 5);
    expect(label).toBe("2026-09");
  });

  it("uses the start month when startDate falls exactly on billingDay", () => {
    const label = firstPeriodLabel(new Date(Date.UTC(2026, 7, 5)), 5);
    expect(label).toBe("2026-08");
  });

  it("handles a December start month crossing into January", () => {
    const label = firstPeriodLabel(new Date(Date.UTC(2026, 11, 20)), 5);
    expect(label).toBe("2027-01");
  });
});
