# V1 Attention Engine, Dashboard & Client Detail Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening the app immediately answers "what needs my attention right now" — a deterministic priority ranking over every active client service, a rebuilt Overview dashboard (Attention summary + Client Attention List + Monthly summary), payment history and renewal visibility on the client detail page. This is Phases E+F+G+H of the V1 brief — the last plan before V1 is complete.

**Architecture:** The priority engine (`src/lib/attention.ts`) is a pure function with zero DB access — it takes plain data and returns a rank; this is what makes it exhaustively unit-testable and guarantees the dashboard never relies on a stored, staleable priority field. A separate data-loading module (`src/lib/dashboard.ts`) fetches the DB rows and feeds them to the pure function. The dashboard page and the client detail page's new sections are thin consumers of both.

**Tech Stack:** Same as Foundation and Plans 1-2 — Next.js 16 Server Actions/Server Components, Prisma 7/MySQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-v1-billing-work-attention-design.md`
**Depends on:** Plan 1 (`2026-09-05-v1-services-billing.md`) and Plan 2 (`2026-09-05-v1-payments-work-status.md`) — this plan assumes `ClientService`/`BillingPeriod`/`markPaidAction` already exist and work.

## One documented interpretation this plan makes (not explicit in the brief — flag if you pictured it differently)

**Monthly summary semantics.** "Expected / Collected / Pending" are computed over billing periods whose `periodLabel` is the *current calendar month* (how much business is billed this cycle, how much of that has come in, how much of that is still not yet due). **Overdue**, by contrast, sums every currently-unpaid period whose due date has passed *regardless of which month it belongs to* — an unpaid August period doesn't stop being overdue money just because September started, and this keeps the Monthly Summary's Overdue figure consistent with the Attention section's own Overdue card (same underlying query, so the two numbers on the same page can never contradict each other).

## Global Constraints

- The priority engine (`src/lib/attention.ts`) has zero imports from `@/lib/db` or anything Prisma-shaped in its core functions — it takes plain, already-fetched data and returns a rank. This is what makes it fast to test exhaustively and impossible to accidentally make stale/cacheable.
- "Today" is always normalized to UTC midnight before any date-difference math, exactly like Plan 1's `billing-dates.ts` — a shared `startOfUTCDay(date: Date): Date` helper (new, in `src/lib/attention.ts`) is used everywhere a "how many days between X and today" comparison happens, so a comparison never depends on the time-of-day a request happens to run at.
- `ON_HOLD` never independently elevates a service's tier (confirmed with Rohit 2026-09-05) — it is a legitimate, intentional status and only ever appears as *displayed* work status, never as an attention-tier input on its own.
- Every dashboard/detail-page number is computed from the database at request time — no hardcoded demo figures anywhere, matching the brief's explicit "no hardcoded metrics" requirement.
- Run `npm run build`, `npm run lint`, and the full `npm test` at the end of every task — all three must pass clean before moving to the next task.

---

## Task 1: Priority/attention engine (pure function, no DB)

**Files:**
- Create: `src/lib/attention.ts`
- Test: `src/lib/attention.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  ```typescript
  export type AttentionTier =
    | "overdue_payment" | "due_today" | "due_tomorrow"
    | "due_within_3_days" | "due_within_7_days"
    | "overdue_work" | "upcoming_renewal"
    | "normal_upcoming_work" | "no_action_required";

  export type AttentionPeriodSignal = {
    id: number; // the BillingPeriod's own id — carried through purely so
                // callers (the dashboard's Mark Paid button) can act on
                // the period without a second lookup; the engine itself
                // never reads this field
    dueDate: Date;
    amountInPaise: number;
    status: "UPCOMING" | "PAID";
  } | null;

  export type AttentionInput = {
    clientServiceId: number;
    clientId: number;
    clientName: string;
    serviceName: string;
    workStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "ON_HOLD";
    nextActionDate: Date | null;
    endDate: Date | null;
    currentPeriod: AttentionPeriodSignal;
  };

  export type RankedService = AttentionInput & {
    tier: AttentionTier;
    tierRank: number;      // 1-9, lower = more urgent
    daysOverdue: number;   // 0 unless tier is "overdue_payment"
    outstandingAmountInPaise: number; // 0 unless a payment is owed
  };

  export function computeServiceTier(
    input: AttentionInput,
    today: Date
  ): Pick<RankedService, "tier" | "tierRank" | "daysOverdue" | "outstandingAmountInPaise">;

  export function rankServicesForAttention(
    inputs: AttentionInput[],
    today: Date
  ): RankedService[];
  ```
  Task 2 (`getAttentionData`) is the only consumer of `rankServicesForAttention`; Task 3 (dashboard UI) reads its output.

**Tier logic (restating the spec precisely — implement exactly this, in this order):**

1. `overdue_payment` — has an unpaid `currentPeriod` whose `dueDate` is before today.
2. `due_today` — has an unpaid `currentPeriod` due today.
3. `due_tomorrow` — has an unpaid `currentPeriod` due exactly tomorrow.
4. `due_within_3_days` — has an unpaid `currentPeriod` due in 2 or 3 days (1 day is already claimed by tier 3, so this tier's practical range is 2-3 days — comment this clearly in the code so it doesn't read as a bug).
5. `due_within_7_days` — has an unpaid `currentPeriod` due in 4-7 days.
6. `overdue_work` — not in tiers 1-5, AND `nextActionDate` is before today.
7. `upcoming_renewal` — not in tiers 1-6, AND `endDate` is between today and 30 days from now (inclusive).
8. `normal_upcoming_work` — not in tiers 1-7, AND (has an unpaid `currentPeriod` due more than 7 days out, OR `workStatus` is anything other than `COMPLETED`).
9. `no_action_required` — everything else.

A service matches exactly one tier: check 1 through 9 in order, first match wins.

- [ ] **Step 1: Write the failing tests**

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- attention.test`
Expected: FAIL — `Cannot find module '@/lib/attention'`.

- [ ] **Step 3: Implement `src/lib/attention.ts`**

```typescript
export type AttentionTier =
  | "overdue_payment"
  | "due_today"
  | "due_tomorrow"
  | "due_within_3_days"
  | "due_within_7_days"
  | "overdue_work"
  | "upcoming_renewal"
  | "normal_upcoming_work"
  | "no_action_required";

const TIER_RANK: Record<AttentionTier, number> = {
  overdue_payment: 1,
  due_today: 2,
  due_tomorrow: 3,
  due_within_3_days: 4,
  due_within_7_days: 5,
  overdue_work: 6,
  upcoming_renewal: 7,
  normal_upcoming_work: 8,
  no_action_required: 9,
};

export type AttentionPeriodSignal = {
  id: number;
  dueDate: Date;
  amountInPaise: number;
  status: "UPCOMING" | "PAID";
} | null;

export type AttentionInput = {
  clientServiceId: number;
  clientId: number;
  clientName: string;
  serviceName: string;
  workStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "ON_HOLD";
  nextActionDate: Date | null;
  endDate: Date | null;
  currentPeriod: AttentionPeriodSignal;
};

export type RankedService = AttentionInput & {
  tier: AttentionTier;
  tierRank: number;
  daysOverdue: number;
  outstandingAmountInPaise: number;
};

/** Truncates to UTC midnight so day-difference math never depends on time-of-day. */
export function startOfUTCDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Positive when `date` is in the future relative to `today`, negative if in the past. */
function daysUntil(date: Date, today: Date): number {
  return Math.round((startOfUTCDay(date).getTime() - startOfUTCDay(today).getTime()) / MS_PER_DAY);
}

export function computeServiceTier(
  input: AttentionInput,
  today: Date
): Pick<RankedService, "tier" | "tierRank" | "daysOverdue" | "outstandingAmountInPaise"> {
  const period = input.currentPeriod;
  const isUnpaidObligation = period !== null && period.status !== "PAID";

  if (isUnpaidObligation) {
    const daysToDue = daysUntil(period!.dueDate, today);

    if (daysToDue < 0) {
      return {
        tier: "overdue_payment",
        tierRank: TIER_RANK.overdue_payment,
        daysOverdue: -daysToDue,
        outstandingAmountInPaise: period!.amountInPaise,
      };
    }
    if (daysToDue === 0) {
      return {
        tier: "due_today",
        tierRank: TIER_RANK.due_today,
        daysOverdue: 0,
        outstandingAmountInPaise: period!.amountInPaise,
      };
    }
    if (daysToDue === 1) {
      return {
        tier: "due_tomorrow",
        tierRank: TIER_RANK.due_tomorrow,
        daysOverdue: 0,
        outstandingAmountInPaise: period!.amountInPaise,
      };
    }
    // daysToDue is 2 or 3 here — 0 and 1 are already claimed above, so this
    // tier's real range is 2-3 days even though it's named "within 3 days."
    if (daysToDue <= 3) {
      return {
        tier: "due_within_3_days",
        tierRank: TIER_RANK.due_within_3_days,
        daysOverdue: 0,
        outstandingAmountInPaise: period!.amountInPaise,
      };
    }
    // Similarly this is really "4-7 days" — 1-3 are already claimed.
    if (daysToDue <= 7) {
      return {
        tier: "due_within_7_days",
        tierRank: TIER_RANK.due_within_7_days,
        daysOverdue: 0,
        outstandingAmountInPaise: period!.amountInPaise,
      };
    }
  }

  // Not in tiers 1-5 (either fully paid/no obligation, or unpaid but more
  // than 7 days out). ON_HOLD is deliberately NOT checked here — it never
  // independently creates urgency (confirmed with Rohit 2026-09-05).
  if (input.nextActionDate && daysUntil(input.nextActionDate, today) < 0) {
    return {
      tier: "overdue_work",
      tierRank: TIER_RANK.overdue_work,
      daysOverdue: 0,
      outstandingAmountInPaise: 0,
    };
  }

  if (input.endDate) {
    const daysToRenewal = daysUntil(input.endDate, today);
    if (daysToRenewal >= 0 && daysToRenewal <= 30) {
      return {
        tier: "upcoming_renewal",
        tierRank: TIER_RANK.upcoming_renewal,
        daysOverdue: 0,
        outstandingAmountInPaise: 0,
      };
    }
  }

  const hasUnpaidObligationFarOut = isUnpaidObligation; // implies >7 days out, having fallen through tiers 1-5
  const hasOngoingWork = input.workStatus !== "COMPLETED";
  if (hasUnpaidObligationFarOut || hasOngoingWork) {
    return {
      tier: "normal_upcoming_work",
      tierRank: TIER_RANK.normal_upcoming_work,
      daysOverdue: 0,
      outstandingAmountInPaise: hasUnpaidObligationFarOut ? period!.amountInPaise : 0,
    };
  }

  return {
    tier: "no_action_required",
    tierRank: TIER_RANK.no_action_required,
    daysOverdue: 0,
    outstandingAmountInPaise: 0,
  };
}

function compareRanked(a: RankedService, b: RankedService): number {
  if (a.tierRank !== b.tierRank) return a.tierRank - b.tierRank;
  if (a.daysOverdue !== b.daysOverdue) return b.daysOverdue - a.daysOverdue; // longest overdue first
  if (a.outstandingAmountInPaise !== b.outstandingAmountInPaise) {
    return b.outstandingAmountInPaise - a.outstandingAmountInPaise; // highest amount first
  }
  const aDue = a.currentPeriod?.dueDate.getTime() ?? Infinity;
  const bDue = b.currentPeriod?.dueDate.getTime() ?? Infinity;
  if (aDue !== bDue) return aDue - bDue; // nearest due date first

  // Not specified by the brief — alphabetical fallback so output order is
  // deterministic and reproducible, rather than depending on input order.
  return (
    a.clientName.localeCompare(b.clientName) ||
    a.serviceName.localeCompare(b.serviceName)
  );
}

export function rankServicesForAttention(
  inputs: AttentionInput[],
  today: Date
): RankedService[] {
  const ranked = inputs.map((input) => ({
    ...input,
    ...computeServiceTier(input, today),
  }));
  return ranked.sort(compareRanked);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- attention.test`
Expected: `23 passed`.

- [ ] **Step 5: Run full verification**

Run: `npm run build && npm run lint`
Expected: both pass clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add deterministic priority/attention engine (pure function)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Dashboard data queries

**Files:**
- Create: `src/lib/dashboard.ts`
- Test: `src/lib/dashboard.test.ts`

**Interfaces:**
- Consumes: `rankServicesForAttention`, `AttentionInput` (Task 1).
- Produces:
  ```typescript
  export async function getAttentionData(organizationId: number, today: Date): Promise<RankedService[]>;

  export type MonthlySummary = {
    expectedInPaise: number;
    collectedInPaise: number;
    pendingInPaise: number;
    overdueInPaise: number;
  };
  export async function getMonthlySummary(organizationId: number, today: Date): Promise<MonthlySummary>;
  ```
  Task 3 (dashboard UI) consumes both.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/dashboard.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { createClientService } from "@/lib/services";
import { markBillingPeriodPaid } from "@/lib/payments";
import { getAttentionData, getMonthlySummary } from "@/lib/dashboard";

const TODAY = new Date(Date.UTC(2026, 8, 10)); // Sep 10, 2026

describe("getAttentionData", () => {
  let orgId: number;

  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
  });

  it("returns one ranked row per active client service, correctly ranked", async () => {
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors" },
    });
    // Overdue: started long enough ago that its Sep 1 period is now overdue.
    await createClientService({
      clientId: client.id,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 1,
      startDate: new Date(Date.UTC(2026, 7, 1)),
      endDate: null,
    });

    const ranked = await getAttentionData(orgId, TODAY);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].tier).toBe("overdue_payment");
    expect(ranked[0].clientName).toBe("ABC Interiors");
    expect(ranked[0].serviceName).toBe("Local SEO");
  });

  it("excludes CANCELLED services", async () => {
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors" },
    });
    const service = await createClientService({
      clientId: client.id,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 1,
      startDate: new Date(Date.UTC(2026, 7, 1)),
      endDate: null,
    });
    await prisma.clientService.update({
      where: { id: service.id },
      data: { status: "CANCELLED" },
    });

    const ranked = await getAttentionData(orgId, TODAY);

    expect(ranked).toHaveLength(0);
  });

  it("never returns another organization's services", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    const otherClient = await prisma.client.create({
      data: { organizationId: otherOrg.id, businessName: "Should Not Appear" },
    });
    await createClientService({
      clientId: otherClient.id,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 1,
      startDate: new Date(Date.UTC(2026, 7, 1)),
      endDate: null,
    });

    const ranked = await getAttentionData(orgId, TODAY);

    expect(ranked).toHaveLength(0);
  });

  it("reflects a PAID period correctly (no longer an urgent payment tier)", async () => {
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors" },
    });
    const service = await createClientService({
      clientId: client.id,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 10, // matches TODAY's day-of-month so this period is paid
                      // right on time — see the note below on why that matters
      startDate: new Date(Date.UTC(2026, 8, 1)), // Sep 1 -> first period "2026-09", due Sep 10
      endDate: null,
    });
    const plan = await prisma.billingPlan.findUniqueOrThrow({ where: { clientServiceId: service.id } });
    const period = await prisma.billingPeriod.findFirstOrThrow({ where: { billingPlanId: plan.id } });
    const admin = await prisma.adminUser.create({
      data: { organizationId: orgId, email: "a@example.com", passwordHash: "x" },
    });
    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: TODAY, // paid exactly on its Sep 10 due date
      recordedByAdminId: admin.id,
    });

    const ranked = await getAttentionData(orgId, TODAY);

    // The just-generated next period is "2026-10", due Oct 10 — 30 days
    // from TODAY (Sep 10), comfortably more than 7 days out. (Using
    // billingDay 1 here instead would generate a next period due Sep 1,
    // which is BEFORE TODAY — i.e. already overdue at the moment it's
    // created, the opposite of what this test needs to check. The billing
    // day has to land on/after TODAY relative to the paid period for the
    // next cycle to land safely in the future.) ->
    // normal_upcoming_work, not one of the urgent payment tiers.
    expect(ranked[0].tier).toBe("normal_upcoming_work");
  });
});

describe("getMonthlySummary", () => {
  let orgId: number;
  let clientId: number;

  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors" },
    });
    clientId = client.id;
  });

  it("computes expected as the sum of this month's periods regardless of status", async () => {
    await createClientService({
      clientId,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 5,
      startDate: new Date(Date.UTC(2026, 8, 1)), // creates the Sep period directly
      endDate: null,
    });

    const summary = await getMonthlySummary(orgId, TODAY);

    expect(summary.expectedInPaise).toBe(500000);
  });

  it("computes collected as payments captured against this month's periods", async () => {
    const service = await createClientService({
      clientId,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 5,
      startDate: new Date(Date.UTC(2026, 8, 1)),
      endDate: null,
    });
    const plan = await prisma.billingPlan.findUniqueOrThrow({ where: { clientServiceId: service.id } });
    const period = await prisma.billingPeriod.findFirstOrThrow({ where: { billingPlanId: plan.id } });
    const admin = await prisma.adminUser.create({
      data: { organizationId: orgId, email: "a@example.com", passwordHash: "x" },
    });
    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: TODAY,
      recordedByAdminId: admin.id,
    });

    const summary = await getMonthlySummary(orgId, TODAY);

    expect(summary.collectedInPaise).toBe(500000);
  });

  it("counts overdue money regardless of which month the period belongs to", async () => {
    // A service whose period is from a prior month and still unpaid.
    await createClientService({
      clientId,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 1,
      startDate: new Date(Date.UTC(2026, 6, 1)), // July -> period is well overdue by Sep 10
      endDate: null,
    });

    const summary = await getMonthlySummary(orgId, TODAY);

    expect(summary.overdueInPaise).toBeGreaterThanOrEqual(500000);
  });

  it("pending excludes both collected and overdue amounts", async () => {
    await createClientService({
      clientId,
      serviceName: "Website SEO",
      feeInPaise: 700000,
      frequency: "MONTHLY",
      billingDay: 25, // due later this month, not yet overdue, unpaid
      startDate: new Date(Date.UTC(2026, 8, 1)),
      endDate: null,
    });

    const summary = await getMonthlySummary(orgId, TODAY);

    expect(summary.pendingInPaise).toBe(700000);
    expect(summary.overdueInPaise).toBe(0);
    expect(summary.collectedInPaise).toBe(0);
  });

  it("never includes another organization's numbers", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    const otherClient = await prisma.client.create({
      data: { organizationId: otherOrg.id, businessName: "Other Client" },
    });
    await createClientService({
      clientId: otherClient.id,
      serviceName: "Local SEO",
      feeInPaise: 999999,
      frequency: "MONTHLY",
      billingDay: 5,
      startDate: new Date(Date.UTC(2026, 8, 1)),
      endDate: null,
    });

    const summary = await getMonthlySummary(orgId, TODAY);

    expect(summary.expectedInPaise).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- dashboard.test`
Expected: FAIL — `Cannot find module '@/lib/dashboard'`.

- [ ] **Step 3: Implement `src/lib/dashboard.ts`**

```typescript
import { prisma } from "@/lib/db";
import { rankServicesForAttention, startOfUTCDay } from "@/lib/attention";
import type { AttentionInput, RankedService } from "@/lib/attention";

function currentPeriodLabel(today: Date): string {
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export async function getAttentionData(
  organizationId: number,
  today: Date
): Promise<RankedService[]> {
  const services = await prisma.clientService.findMany({
    where: {
      status: "ACTIVE",
      client: { organizationId },
    },
    include: {
      client: true,
      serviceTemplate: true,
      billingPlan: {
        include: {
          billingPeriods: {
            where: { status: "UPCOMING" },
            orderBy: { periodLabel: "asc" },
            take: 1,
          },
        },
      },
    },
  });

  const inputs: AttentionInput[] = services.map((service) => {
    const openPeriod = service.billingPlan?.billingPeriods[0] ?? null;
    return {
      clientServiceId: service.id,
      clientId: service.clientId,
      clientName: service.client.businessName,
      serviceName: service.serviceTemplate.name,
      workStatus: service.workStatus,
      nextActionDate: service.nextActionDate,
      endDate: service.endDate,
      currentPeriod: openPeriod
        ? {
            id: openPeriod.id,
            dueDate: openPeriod.dueDate,
            amountInPaise: openPeriod.amountInPaise,
            status: "UPCOMING" as const,
          }
        : null,
    };
  });

  return rankServicesForAttention(inputs, startOfUTCDay(today));
}

export type MonthlySummary = {
  expectedInPaise: number;
  collectedInPaise: number;
  pendingInPaise: number;
  overdueInPaise: number;
};

export async function getMonthlySummary(
  organizationId: number,
  today: Date
): Promise<MonthlySummary> {
  const label = currentPeriodLabel(today);
  const normalizedToday = startOfUTCDay(today);

  const thisMonthPeriods = await prisma.billingPeriod.findMany({
    where: {
      periodLabel: label,
      billingPlan: { clientService: { client: { organizationId } } },
    },
  });

  const expectedInPaise = thisMonthPeriods.reduce((sum, p) => sum + p.amountInPaise, 0);

  const paidThisMonthPeriodIds = thisMonthPeriods
    .filter((p) => p.status === "PAID")
    .map((p) => p.id);

  const collectedInPaise =
    paidThisMonthPeriodIds.length === 0
      ? 0
      : (
          await prisma.payment.aggregate({
            _sum: { amountInPaise: true },
            where: {
              status: "CAPTURED",
              invoice: {
                lineItems: { some: { billingPeriodId: { in: paidThisMonthPeriodIds } } },
              },
            },
          })
        )._sum.amountInPaise ?? 0;

  const overdueThisMonth = thisMonthPeriods.filter(
    (p) => p.status !== "PAID" && p.dueDate < normalizedToday
  );
  const overdueThisMonthInPaise = overdueThisMonth.reduce((sum, p) => sum + p.amountInPaise, 0);

  // Overdue spans ALL months, not just this one — see the plan's documented
  // interpretation at the top of this file.
  const allOverduePeriods = await prisma.billingPeriod.findMany({
    where: {
      status: { not: "PAID" },
      dueDate: { lt: normalizedToday },
      billingPlan: { clientService: { client: { organizationId } } },
    },
  });
  const overdueInPaise = allOverduePeriods.reduce((sum, p) => sum + p.amountInPaise, 0);

  const pendingInPaise = expectedInPaise - collectedInPaise - overdueThisMonthInPaise;

  return { expectedInPaise, collectedInPaise, pendingInPaise, overdueInPaise };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- dashboard.test`
Expected: `9 passed`.

- [ ] **Step 5: Run full verification**

Run: `npm run build && npm run lint`
Expected: both pass clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add dashboard data queries (attention ranking + monthly summary)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Dashboard UI

**Files:**
- Modify: `src/app/(app)/page.tsx` (replace the `ComingSoon` placeholder)
- Create: `src/components/dashboard/AttentionSummary.tsx`
- Create: `src/components/dashboard/ClientAttentionList.tsx`
- Create: `src/components/dashboard/MonthlySummary.tsx`

**Interfaces:**
- Consumes: `getAttentionData`, `getMonthlySummary` (Task 2); `markPaidAction` (Plan 2).
- Produces: nothing new consumed elsewhere — this is the top-level page.

- [ ] **Step 1: Write `src/components/dashboard/AttentionSummary.tsx`**

```tsx
import type { RankedService } from "@/lib/attention";

export function AttentionSummary({ services }: { services: RankedService[] }) {
  const overdueCount = services.filter((s) => s.tier === "overdue_payment").length;
  const dueTodayCount = services.filter((s) => s.tier === "due_today").length;
  const dueSoonCount = services.filter((s) =>
    ["due_tomorrow", "due_within_3_days", "due_within_7_days"].includes(s.tier)
  ).length;
  const workCount = services.filter((s) => s.tier === "overdue_work").length;
  const renewalCount = services.filter((s) => s.tier === "upcoming_renewal").length;

  const totalAttention = overdueCount + dueTodayCount + dueSoonCount + workCount;

  const cards = [
    { label: "Overdue Payments", value: overdueCount, tone: "red" as const },
    { label: "Due Today", value: dueTodayCount, tone: "amber" as const },
    { label: "Due Soon", value: dueSoonCount, tone: "amber" as const },
    { label: "Work Requiring Attention", value: workCount, tone: "indigo" as const },
    ...(renewalCount > 0
      ? [{ label: "Upcoming Renewals", value: renewalCount, tone: "indigo" as const }]
      : []),
  ];

  return (
    <div className="mb-6">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-lg font-semibold text-neutral-900">Attention</h1>
        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
          {totalAttention}
        </span>
        <span className="text-sm text-neutral-500">items require your attention</span>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-neutral-200 bg-white p-4"
          >
            <p className="mb-1 text-xs text-neutral-500">{card.label}</p>
            <p className={`text-2xl font-semibold ${toneTextClass(card.tone)}`}>
              {card.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function toneTextClass(tone: "red" | "amber" | "indigo"): string {
  return { red: "text-red-600", amber: "text-amber-600", indigo: "text-indigo-600" }[tone];
}
```

- [ ] **Step 2: Write `src/components/dashboard/ClientAttentionList.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RankedService } from "@/lib/attention";
import { markPaidAction } from "@/app/(app)/clients/payment-actions";

const TIER_LABELS: Record<string, string> = {
  overdue_payment: "Overdue",
  due_today: "Due Today",
  due_tomorrow: "Due Tomorrow",
  due_within_3_days: "Due Soon",
  due_within_7_days: "Due Soon",
  overdue_work: "Work Overdue",
  upcoming_renewal: "Renewal Upcoming",
  normal_upcoming_work: "In Progress",
  no_action_required: "On Track",
};

const TIER_BADGE_CLASS: Record<string, string> = {
  overdue_payment: "bg-red-50 text-red-600",
  due_today: "bg-amber-50 text-amber-700",
  due_tomorrow: "bg-amber-50 text-amber-700",
  due_within_3_days: "bg-amber-50 text-amber-700",
  due_within_7_days: "bg-amber-50 text-amber-700",
  overdue_work: "bg-indigo-50 text-indigo-600",
  upcoming_renewal: "bg-indigo-50 text-indigo-600",
  normal_upcoming_work: "bg-neutral-100 text-neutral-500",
  no_action_required: "bg-emerald-50 text-emerald-700",
};

export function ClientAttentionList({ services }: { services: RankedService[] }) {
  const visible = services.filter((s) => s.tier !== "no_action_required");

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-medium text-neutral-900">Clients Requiring Attention</h2>
        <span className="text-xs text-neutral-400">Sorted by priority</span>
      </div>
      <table className="w-full text-sm">
        <thead className="border-b border-neutral-200 text-left text-neutral-500">
          <tr>
            <th className="px-4 py-3 font-medium">Client</th>
            <th className="px-4 py-3 font-medium">Service</th>
            <th className="px-4 py-3 font-medium">Payment</th>
            <th className="px-4 py-3 font-medium">Work Status</th>
            <th className="px-4 py-3 font-medium">Due Date</th>
            <th className="px-4 py-3 font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((service) => (
            <AttentionRow key={service.clientServiceId} service={service} />
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                Nothing needs attention right now.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AttentionRow({ service }: { service: RankedService }) {
  const router = useRouter();
  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const period = service.currentPeriod;

  async function handleMarkPaid(formData: FormData) {
    if (!period) return;
    const result = await markPaidAction(period.id, formData);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setShowMarkPaid(false);
    router.refresh();
  }

  return (
    <tr className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
      <td className="px-4 py-3 font-medium text-neutral-900">
        <Link href={`/clients/${service.clientId}`} className="hover:underline">
          {service.clientName}
        </Link>
      </td>
      <td className="px-4 py-3 text-neutral-700">{service.serviceName}</td>
      <td className="px-4 py-3">
        <span className={`rounded-md px-2 py-0.5 text-xs ${TIER_BADGE_CLASS[service.tier]}`}>
          {TIER_LABELS[service.tier]}
        </span>
        {period && (
          <span className="ml-2 text-neutral-600">
            ₹{(period.amountInPaise / 100).toLocaleString("en-IN")}
            {service.daysOverdue > 0 && ` — ${service.daysOverdue} days overdue`}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-neutral-600">
        {service.workStatus.replace("_", " ")}
      </td>
      <td className="px-4 py-3 text-neutral-600">
        {period
          ? new Date(period.dueDate).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
            })
          : "—"}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {period && period.status !== "PAID" && (
            <button
              type="button"
              onClick={() => setShowMarkPaid((v) => !v)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
            >
              Mark Paid
            </button>
          )}
          <Link
            href={`/clients/${service.clientId}`}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            View
          </Link>
        </div>
        {showMarkPaid && (
          <MarkPaidInlineForm
            clientServiceId={service.clientServiceId}
            amountInPaise={period?.amountInPaise ?? 0}
            onSubmit={handleMarkPaid}
            error={error}
            onCancel={() => setShowMarkPaid(false)}
          />
        )}
      </td>
    </tr>
  );
}

function MarkPaidInlineForm({
  amountInPaise,
  onSubmit,
  error,
  onCancel,
}: {
  clientServiceId: number;
  amountInPaise: number;
  onSubmit: (formData: FormData) => void;
  error: string | null;
  onCancel: () => void;
}) {
  return (
    <form action={onSubmit} className="mt-2 flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <input
        name="amountInRupees"
        type="number"
        defaultValue={amountInPaise / 100}
        required
        className="w-24 rounded border border-neutral-300 px-2 py-1 text-xs"
      />
      <input
        name="paidAt"
        type="date"
        defaultValue={new Date().toISOString().slice(0, 10)}
        required
        className="rounded border border-neutral-300 px-2 py-1 text-xs"
      />
      <div className="flex gap-2">
        <button type="submit" className="rounded bg-neutral-900 px-2 py-1 text-xs text-white">
          Confirm
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-neutral-300 px-2 py-1 text-xs">
          Cancel
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Write `src/components/dashboard/MonthlySummary.tsx`**

```tsx
import type { MonthlySummary as MonthlySummaryData } from "@/lib/dashboard";

export function MonthlySummary({ summary }: { summary: MonthlySummaryData }) {
  const rows = [
    { label: "Expected", value: summary.expectedInPaise, tone: "neutral" as const },
    { label: "Collected", value: summary.collectedInPaise, tone: "green" as const },
    { label: "Pending", value: summary.pendingInPaise, tone: "amber" as const },
    { label: "Overdue", value: summary.overdueInPaise, tone: "red" as const },
  ];

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-medium text-neutral-900">This Month</h2>
      <dl className="grid grid-cols-4 gap-4">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="mb-1 text-xs text-neutral-500">{row.label}</dt>
            <dd className={`text-lg font-semibold ${toneClass(row.tone)}`}>
              ₹{(row.value / 100).toLocaleString("en-IN")}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function toneClass(tone: "neutral" | "green" | "amber" | "red"): string {
  return {
    neutral: "text-neutral-900",
    green: "text-emerald-700",
    amber: "text-amber-700",
    red: "text-red-600",
  }[tone];
}
```

- [ ] **Step 4: Rebuild `src/app/(app)/page.tsx`**

```tsx
import { requireAdmin } from "@/lib/require-admin";
import { getAttentionData, getMonthlySummary } from "@/lib/dashboard";
import { AttentionSummary } from "@/components/dashboard/AttentionSummary";
import { ClientAttentionList } from "@/components/dashboard/ClientAttentionList";
import { MonthlySummary } from "@/components/dashboard/MonthlySummary";

export default async function OverviewPage() {
  const admin = await requireAdmin();
  const today = new Date();

  const [services, summary] = await Promise.all([
    getAttentionData(admin.organizationId, today),
    getMonthlySummary(admin.organizationId, today),
  ]);

  return (
    <div>
      <AttentionSummary services={services} />
      <ClientAttentionList services={services} />
      <MonthlySummary summary={summary} />
    </div>
  );
}
```

`src/components/shell/ComingSoon.tsx` stays in the codebase — every other still-unbuilt Sidebar destination continues to use it, only the Overview route stops.

- [ ] **Step 5: Run full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all pass clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: rebuild the Overview page as the attention dashboard

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Payment history and renewal visibility on the client detail page

**Files:**
- Create: `src/components/clients/PaymentHistoryPanel.tsx`
- Modify: `src/lib/clients.ts` (add `getPaymentHistoryForClient`)
- Modify: `src/app/(app)/clients/[id]/page.tsx` (render the panel)
- Modify: `src/components/clients/ServicesPanel.tsx` (show `endDate`/renewal info per service)

**Interfaces:**
- Consumes: nothing new — reads existing `Payment`/`Invoice`/`BillingPeriod` relations.
- Produces: nothing consumed elsewhere — this is the last integration point in V1.

- [ ] **Step 1: Add `getPaymentHistoryForClient` with a test**

Add to `src/lib/clients.test.ts`:

```typescript
// append to src/lib/clients.test.ts
import { markBillingPeriodPaid } from "@/lib/payments";
import { getPaymentHistoryForClient } from "@/lib/clients";

describe("getPaymentHistoryForClient", () => {
  it("returns payments newest-first, scoped to the client's own services", async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    const client = await prisma.client.create({
      data: { organizationId: org.id, businessName: "ABC Interiors" },
    });
    const admin = await prisma.adminUser.create({
      data: { organizationId: org.id, email: "a@example.com", passwordHash: "x" },
    });
    const service = await createClientService({
      clientId: client.id,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 1,
      startDate: new Date(Date.UTC(2026, 6, 1)),
      endDate: null,
    });
    const plan = await prisma.billingPlan.findUniqueOrThrow({ where: { clientServiceId: service.id } });
    const period = await prisma.billingPeriod.findFirstOrThrow({ where: { billingPlanId: plan.id } });
    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(Date.UTC(2026, 6, 3)),
      recordedByAdminId: admin.id,
    });

    const history = await getPaymentHistoryForClient(client.id);

    expect(history).toHaveLength(1);
    expect(history[0].amountInPaise).toBe(500000);
    expect(history[0].status).toBe("CAPTURED");
  });

  it("returns an empty list for a client with no payments yet", async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    const client = await prisma.client.create({
      data: { organizationId: org.id, businessName: "ABC Interiors" },
    });

    const history = await getPaymentHistoryForClient(client.id);

    expect(history).toEqual([]);
  });
});
```

(`import { createClientService } from "@/lib/services";` must already be present in this test file from Plan 1's Task 6 — do not add a duplicate import if it's already there.)

Run: `npm test -- clients.test` — expect FAIL (`getPaymentHistoryForClient is not a function`), then implement:

Add to `src/lib/clients.ts`:

```typescript
export async function getPaymentHistoryForClient(clientId: number) {
  return prisma.payment.findMany({
    where: { invoice: { clientId } },
    orderBy: { createdAt: "desc" },
  });
}
```

Run `npm test -- clients.test` again — expected all pass.

- [ ] **Step 2: Write `src/components/clients/PaymentHistoryPanel.tsx`**

```tsx
import type { Payment } from "@/generated/prisma/client";

export function PaymentHistoryPanel({ payments }: { payments: Payment[] }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-medium text-neutral-900">Payment History</h2>
      {payments.length === 0 ? (
        <p className="text-sm text-neutral-400">No payments recorded yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {payments.map((payment) => (
            <li key={payment.id} className="flex items-center justify-between">
              <span className="text-neutral-900">
                ₹{(payment.amountInPaise / 100).toLocaleString("en-IN")}
              </span>
              <span className="text-neutral-500">
                {payment.capturedAt
                  ? new Date(payment.capturedAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })
                  : "—"}
              </span>
              <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                {payment.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Render it on the detail page**

In `src/app/(app)/clients/[id]/page.tsx`:

```tsx
import { getPaymentHistoryForClient } from "@/lib/clients";
import { PaymentHistoryPanel } from "@/components/clients/PaymentHistoryPanel";

// Inside the page component, alongside the existing getClientById call:
const payments = await getPaymentHistoryForClient(clientId);

// In the JSX, as another col-span-2 row, after ServicesPanel:
<div className="col-span-2">
  <PaymentHistoryPanel payments={payments} />
</div>
```

- [ ] **Step 4: Show `endDate`/renewal info per service in `ServicesPanel.tsx`**

In `ServiceRow` (in `src/components/clients/ServicesPanel.tsx`), add a renewal line under the existing work-status line, shown only when `endDate` is set:

```tsx
{service.endDate && (
  <div className="mt-1 text-neutral-500">
    {isWithin30Days(service.endDate) ? (
      <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">
        Renewal due {new Date(service.endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
      </span>
    ) : (
      <>Ends {new Date(service.endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</>
    )}
  </div>
)}
```

Add this small helper near the top of the file, alongside the other module-level constants:

```typescript
function isWithin30Days(date: Date): boolean {
  const now = new Date();
  const diffMs = new Date(date).getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 30;
}
```

- [ ] **Step 5: Run full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all pass clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add payment history panel and renewal visibility to client detail page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Plan-level manual verification (do this once, after Task 4 — this is the V1 success-criteria checklist)

1. `npm run dev`, log in — the Overview page now shows Attention/Client Attention List/Monthly Summary instead of "coming soon."
2. Create a new client, add 3 services with different frequencies and billing days (matching the brief's own example: Local SEO ₹5,000/mo due the 5th, Website SEO ₹7,000/mo due the 15th, Google Ads ₹10,000/mo due the 20th).
3. Set one service's start date far enough in the past that it's now overdue — confirm it appears at the top of the dashboard's Client Attention List with the correct days-overdue and amount.
4. Click Mark Paid from the dashboard directly (not the client detail page) — confirm it works identically to the detail-page version (same underlying action).
5. Reload — confirm the paid service drops out of the urgent tiers and the next period's due date is one billing cycle later.
6. Set a service's `nextActionDate` to yesterday (via the client detail page's work-status form) on a service whose payment isn't currently urgent — confirm it now shows up under "Work Overdue" on the dashboard.
7. Set a service's `endDate` to 10 days from now — confirm a "Renewal due" badge appears both on the client detail page and (if nothing more urgent exists for that service) as an Upcoming Renewals count on the dashboard.
8. Open the client detail page — confirm Services, Payment History, and Activity all show a coherent, complete picture of that client without needing to navigate anywhere else, per the brief's own success criterion.
9. Walk through the brief's exact 14-point "Success Criteria" list from the original request and confirm each one works end-to-end.
