// src/lib/attention.test.ts
import { describe, it, expect } from "vitest";
import { computeServiceTier, rankServicesForAttention } from "@/lib/attention";
import type { AttentionInput } from "@/lib/attention";

const TODAY = new Date(Date.UTC(2026, 8, 10)); // Sep 10, 2026

function baseInput(overrides: Partial<AttentionInput> = {}): AttentionInput {
  return {
    clientServiceId: 1,
    clientId: 1,
    clientName: "ABC Interiors",
    serviceName: "Local SEO",
    workStatus: "IN_PROGRESS",
    nextActionDate: null,
    endDate: null,
    currentPeriod: null,
    ...overrides,
  };
}

function periodDueOn(daysFromToday: number, amountInPaise = 500000, status: "UPCOMING" | "PAID" = "UPCOMING") {
  const due = new Date(TODAY);
  due.setUTCDate(due.getUTCDate() + daysFromToday);
  return { id: 1, dueDate: due, amountInPaise, status };
}

describe("computeServiceTier — payment-driven tiers", () => {
  it("tier 1: overdue payment, with correct days-overdue and outstanding amount", () => {
    const result = computeServiceTier(
      baseInput({ currentPeriod: periodDueOn(-5, 500000) }),
      TODAY
    );
    expect(result.tier).toBe("overdue_payment");
    expect(result.tierRank).toBe(1);
    expect(result.daysOverdue).toBe(5);
    expect(result.outstandingAmountInPaise).toBe(500000);
  });

  it("tier 2: due today", () => {
    const result = computeServiceTier(baseInput({ currentPeriod: periodDueOn(0) }), TODAY);
    expect(result.tier).toBe("due_today");
    expect(result.tierRank).toBe(2);
  });

  it("tier 3: due tomorrow", () => {
    const result = computeServiceTier(baseInput({ currentPeriod: periodDueOn(1) }), TODAY);
    expect(result.tier).toBe("due_tomorrow");
    expect(result.tierRank).toBe(3);
  });

  it("tier 4: due in 2 days", () => {
    const result = computeServiceTier(baseInput({ currentPeriod: periodDueOn(2) }), TODAY);
    expect(result.tier).toBe("due_within_3_days");
    expect(result.tierRank).toBe(4);
  });

  it("tier 4: due in 3 days", () => {
    const result = computeServiceTier(baseInput({ currentPeriod: periodDueOn(3) }), TODAY);
    expect(result.tier).toBe("due_within_3_days");
  });

  it("tier 5: due in 4 days", () => {
    const result = computeServiceTier(baseInput({ currentPeriod: periodDueOn(4) }), TODAY);
    expect(result.tier).toBe("due_within_7_days");
    expect(result.tierRank).toBe(5);
  });

  it("tier 5: due in 7 days", () => {
    const result = computeServiceTier(baseInput({ currentPeriod: periodDueOn(7) }), TODAY);
    expect(result.tier).toBe("due_within_7_days");
  });

  it("a PAID current period is not treated as a payment obligation at all", () => {
    const result = computeServiceTier(
      baseInput({ currentPeriod: periodDueOn(-5, 500000, "PAID"), workStatus: "COMPLETED" }),
      TODAY
    );
    expect(result.tier).not.toBe("overdue_payment");
  });
});

describe("computeServiceTier — work/renewal tiers (no urgent payment)", () => {
  it("tier 6: overdue work — no urgent payment, nextActionDate in the past", () => {
    const past = new Date(TODAY);
    past.setUTCDate(past.getUTCDate() - 2);
    const result = computeServiceTier(
      baseInput({ currentPeriod: periodDueOn(20), nextActionDate: past }),
      TODAY
    );
    expect(result.tier).toBe("overdue_work");
    expect(result.tierRank).toBe(6);
  });

  it("ON_HOLD alone does NOT create tier 6 — must stay deterministic and never auto-urgent", () => {
    const result = computeServiceTier(
      baseInput({ currentPeriod: periodDueOn(20), workStatus: "ON_HOLD", nextActionDate: null }),
      TODAY
    );
    expect(result.tier).not.toBe("overdue_work");
  });

  it("tier 7: upcoming renewal within 30 days, no urgent payment or overdue work", () => {
    const soon = new Date(TODAY);
    soon.setUTCDate(soon.getUTCDate() + 15);
    const result = computeServiceTier(
      baseInput({ currentPeriod: periodDueOn(20), endDate: soon }),
      TODAY
    );
    expect(result.tier).toBe("upcoming_renewal");
    expect(result.tierRank).toBe(7);
  });

  it("a renewal more than 30 days out is not tier 7", () => {
    const farOut = new Date(TODAY);
    farOut.setUTCDate(farOut.getUTCDate() + 45);
    const result = computeServiceTier(
      baseInput({ currentPeriod: periodDueOn(20), endDate: farOut, workStatus: "COMPLETED" }),
      TODAY
    );
    expect(result.tier).not.toBe("upcoming_renewal");
  });

  it("overdue work outranks an upcoming renewal when both are present", () => {
    const past = new Date(TODAY);
    past.setUTCDate(past.getUTCDate() - 1);
    const soon = new Date(TODAY);
    soon.setUTCDate(soon.getUTCDate() + 10);
    const result = computeServiceTier(
      baseInput({ currentPeriod: periodDueOn(20), nextActionDate: past, endDate: soon }),
      TODAY
    );
    expect(result.tier).toBe("overdue_work");
  });

  it("tier 8: normal upcoming work — payment far out, work not completed", () => {
    const result = computeServiceTier(
      baseInput({ currentPeriod: periodDueOn(20), workStatus: "IN_PROGRESS" }),
      TODAY
    );
    expect(result.tier).toBe("normal_upcoming_work");
    expect(result.tierRank).toBe(8);
  });

  it("tier 8: normal upcoming work — no current period at all, but work not completed", () => {
    const result = computeServiceTier(
      baseInput({ currentPeriod: null, workStatus: "NOT_STARTED" }),
      TODAY
    );
    expect(result.tier).toBe("normal_upcoming_work");
  });

  it("tier 9: no action required — paid up, work completed, no near renewal", () => {
    const result = computeServiceTier(
      baseInput({ currentPeriod: periodDueOn(-5, 500000, "PAID"), workStatus: "COMPLETED" }),
      TODAY
    );
    expect(result.tier).toBe("no_action_required");
    expect(result.tierRank).toBe(9);
  });

  it("tier 9: no action required — no period at all, work completed, no endDate", () => {
    const result = computeServiceTier(
      baseInput({ currentPeriod: null, workStatus: "COMPLETED", endDate: null }),
      TODAY
    );
    expect(result.tier).toBe("no_action_required");
  });
});

describe("rankServicesForAttention — sorting and tie-breaks", () => {
  it("sorts strictly by tier first", () => {
    const inputs = [
      baseInput({ clientServiceId: 1, currentPeriod: periodDueOn(20), workStatus: "COMPLETED" }), // tier 9
      baseInput({ clientServiceId: 2, currentPeriod: periodDueOn(-1) }), // tier 1
      baseInput({ clientServiceId: 3, currentPeriod: periodDueOn(0) }), // tier 2
    ];
    const ranked = rankServicesForAttention(inputs, TODAY);
    expect(ranked.map((r) => r.clientServiceId)).toEqual([2, 3, 1]);
  });

  it("within the same tier, sorts by longest overdue first", () => {
    const inputs = [
      baseInput({ clientServiceId: 1, currentPeriod: periodDueOn(-2) }),
      baseInput({ clientServiceId: 2, currentPeriod: periodDueOn(-10) }),
      baseInput({ clientServiceId: 3, currentPeriod: periodDueOn(-5) }),
    ];
    const ranked = rankServicesForAttention(inputs, TODAY);
    expect(ranked.map((r) => r.clientServiceId)).toEqual([2, 3, 1]);
  });

  it("within the same overdue-days tie, sorts by highest outstanding amount", () => {
    const inputs = [
      baseInput({ clientServiceId: 1, currentPeriod: periodDueOn(-3, 300000) }),
      baseInput({ clientServiceId: 2, currentPeriod: periodDueOn(-3, 900000) }),
      baseInput({ clientServiceId: 3, currentPeriod: periodDueOn(-3, 500000) }),
    ];
    const ranked = rankServicesForAttention(inputs, TODAY);
    expect(ranked.map((r) => r.clientServiceId)).toEqual([2, 3, 1]);
  });

  it("within a tied tier and amount, sorts by nearest due date", () => {
    const inputs = [
      baseInput({ clientServiceId: 1, currentPeriod: periodDueOn(3, 500000) }),
      baseInput({ clientServiceId: 2, currentPeriod: periodDueOn(2, 500000) }),
    ];
    const ranked = rankServicesForAttention(inputs, TODAY);
    // Both tier 4 ("due within 3 days"), same amount -> nearest due date wins
    expect(ranked.map((r) => r.clientServiceId)).toEqual([2, 1]);
  });

  it("falls back to alphabetical-by-client-name for a fully tied pair (deterministic, not specified by the brief)", () => {
    const inputs = [
      baseInput({ clientServiceId: 1, clientName: "XYZ Salon", currentPeriod: null, workStatus: "IN_PROGRESS" }),
      baseInput({ clientServiceId: 2, clientName: "ABC Interiors", currentPeriod: null, workStatus: "IN_PROGRESS" }),
    ];
    const ranked = rankServicesForAttention(inputs, TODAY);
    expect(ranked.map((r) => r.clientServiceId)).toEqual([2, 1]);
  });

  it("returns an empty array for no input", () => {
    expect(rankServicesForAttention([], TODAY)).toEqual([]);
  });
});
