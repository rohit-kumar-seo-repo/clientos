# V1 Client Services & Recurring Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client can have multiple named services, each with its own price, billing frequency, billing day, status, and optional end date — and each service's first recurring billing obligation (`BillingPeriod`) exists the moment the service is created. This is Phases A+B of the V1 brief.

**Architecture:** Reuses the dormant Phase-1 schema (`ServiceTemplate`, `ClientService`, `BillingPlan`, `BillingPeriod`) unchanged in structure, adding only new columns. A small, purely-functional billing date-math module (no DB) computes period labels and due dates — the highest-risk logic in this plan, given the heaviest test coverage. Service creation is one DB transaction: find-or-create the `ServiceTemplate`, create the `ClientService`, create its `BillingPlan`, create its first `BillingPeriod`.

**Tech Stack:** Same as Foundation — Next.js 16 Server Actions, Prisma 7/MySQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-v1-billing-work-attention-design.md` (also read `docs/superpowers/specs/2026-09-03-clientos-design.md` for the underlying schema's original rationale)

## Global Constraints

- Every new server action calls `requireAdmin()` (or the ownership-checking helpers below) as its own first line and derives `organizationId`/`adminId` from that — never from a parameter. This is non-negotiable; Foundation's Task 8 found and fixed exactly this class of bug once already.
- A new `requireClientServiceInOwnOrg(clientServiceId)` helper (parallel to the existing `requireClientInOwnOrg` in `src/app/(app)/clients/actions.ts`) resolves a `clientServiceId` to its owning client + org in one query, returning `{ admin, clientService }` or `{ admin, clientService: null }` — never throws for a not-found/wrong-org id, callers check for `null`.
- Money is always `Int` paise (matches the existing `feeInPaise`/`amountInPaise` convention) — never a float, never a string.
- `BillingPeriod` rows, once created, are never edited except their `status` field transitioning `UPCOMING → PAID` (that transition is Plan 2's job, not this plan's — this plan only ever creates periods in `UPCOMING` status). Editing a `ClientService`'s price/frequency/billingDay only affects periods created *after* the edit — never rewrites an existing period's `amountInPaise` or `dueDate`.
- `ServiceTemplate` lookup-or-create is case-insensitive on `name` within the organization (so "local seo" and "Local SEO" resolve to the same template) — MySQL's default collation on this column is already case-insensitive (`utf8mb4_unicode_ci` or similar; verify during Task 2, don't assume).
- Run `npm run build`, `npm run lint`, and the full `npm test` at the end of every task — all three must pass clean before moving to the next task.
- Follow the established Server/Client component split for any form (`src/app/(app)/clients/new/page.tsx` + `ClientForm.tsx` is the reference pattern) — the page is a Server Component calling `requireAdmin()` for the render gate; the form is a `"use client"` component that calls the server action with no identity/ownership arguments.

---

## Task 1: Schema migration

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: the `WorkStatus` enum, `HALF_YEARLY` added to `BillingFrequency`, six new fields on `ClientService`, `actorAdminId` on `ClientActivity`, `recordedByAdminId` on `Payment`. Every later task in this plan and in Plans 2-3 depends on these existing.

- [ ] **Step 1: Edit the enums**

In `prisma/schema.prisma`, find `enum BillingFrequency` and add `HALF_YEARLY` between `QUARTERLY` and `YEARLY`:

```prisma
enum BillingFrequency {
  MONTHLY
  QUARTERLY
  HALF_YEARLY
  YEARLY
  ONE_TIME
}
```

Add a new enum immediately after `enum RecurrenceType { ... }` (keep it near the other work/task-related enums):

```prisma
enum WorkStatus {
  NOT_STARTED
  IN_PROGRESS
  COMPLETED
  ON_HOLD
}
```

- [ ] **Step 2: Add fields to `ClientService`**

Find `model ClientService` and add these fields after `status` and before `createdAt`:

```prisma
model ClientService {
  id                Int           @id @default(autoincrement())
  clientId          Int
  serviceTemplateId Int
  feeInPaise        Int
  startDate         DateTime
  status            ServiceStatus @default(ACTIVE)
  endDate           DateTime?
  workStatus        WorkStatus    @default(NOT_STARTED)
  progressPercent   Int?
  workNote          String?       @db.VarChar(500)
  nextActionNote    String?       @db.VarChar(255)
  nextActionDate    DateTime?
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt

  client          Client          @relation(fields: [clientId], references: [id])
  serviceTemplate ServiceTemplate @relation(fields: [serviceTemplateId], references: [id])

  billingPlan   BillingPlan?
  taskInstances TaskInstance[]
  reminderRules ReminderRule[]

  @@index([clientId])
  @@index([serviceTemplateId])
  @@map("client_services")
}
```

- [ ] **Step 3: Add actor-tracking fields**

In `model ClientActivity`, add `actorAdminId` after `clientId` and a relation to `AdminUser`:

```prisma
model ClientActivity {
  id            Int      @id @default(autoincrement())
  clientId      Int
  actorAdminId  Int?
  eventType     String   @db.VarChar(60)
  summary       String   @db.VarChar(255)
  metadata      Json?
  createdAt     DateTime @default(now())

  client      Client     @relation(fields: [clientId], references: [id])
  actorAdmin  AdminUser? @relation(fields: [actorAdminId], references: [id])

  @@index([clientId])
  @@map("client_activity")
}
```

In `model Payment`, add `recordedByAdminId` after `invoiceId` and a relation to `AdminUser`:

```prisma
model Payment {
  id                Int           @id @default(autoincrement())
  invoiceId         Int
  recordedByAdminId Int?
  razorpayOrderId   String?       @db.VarChar(60)
  razorpayPaymentId String?       @unique @db.VarChar(60)
  razorpaySignature String?       @db.VarChar(255)
  status            PaymentStatus @default(CREATED)
  amountInPaise     Int
  method            String?       @db.VarChar(30)
  failureReason     String?       @db.VarChar(255)
  capturedAt        DateTime?
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt

  invoice         Invoice    @relation(fields: [invoiceId], references: [id])
  recordedByAdmin AdminUser? @relation(fields: [recordedByAdminId], references: [id])

  refunds Refund[]

  @@index([invoiceId])
  @@map("payments")
}
```

Both new relations need a matching back-reference. In `model AdminUser`, find this exact block:

```prisma
  sessions          AdminSession[]
  auditLogs         AuditLog[]
  clientNotes       ClientNote[]
  refundsInitiated  Refund[]
  reminderApprovals ReminderJob[]
```

Replace it with (two new lines added, nothing else changed):

```prisma
  sessions          AdminSession[]
  auditLogs         AuditLog[]
  clientNotes       ClientNote[]
  clientActivity    ClientActivity[]
  refundsInitiated  Refund[]
  paymentsRecorded  Payment[]
  reminderApprovals ReminderJob[]
```

- [ ] **Step 4: Format, validate, migrate**

```bash
npx prisma format
npx prisma validate
npx prisma migrate dev --name add_v1_service_billing_fields
```

Expected: migration applies cleanly to `clientos_dev`, no errors. If Prisma reports the `ClientActivity`/`Payment`/`AdminUser` relation changes require you to also update `AdminUser`'s relation list (it may auto-suggest edits) — accept only the two additions shown above, nothing else.

- [ ] **Step 5: Migrate the test database too**

```bash
DATABASE_URL="mysql://root:@localhost:3306/clientos_test?ssl=false" npx prisma migrate deploy
```

Expected: "All migrations have been successfully applied."

- [ ] **Step 6: Regenerate the client and verify nothing broke**

```bash
npx prisma generate
npm test
npm run build
npm run lint
```

Expected: all four commands exit clean. The full pre-existing test suite (61 tests) must still pass unmodified — this migration is purely additive, nothing existing should need updating.

- [ ] **Step 7: Verify MySQL's collation on `ServiceTemplate.name` is case-insensitive**

Run: `mysql -u root clientos_dev -e "SHOW FULL COLUMNS FROM service_templates WHERE Field = 'name';"`

Expected: the `Collation` column shows something ending in `_ci` (case-insensitive), e.g. `utf8mb4_unicode_ci`. If it instead ends in `_bin` or `_cs` (case-sensitive), report this in your task report as a concern rather than assuming — Task 2's find-or-create logic needs to know which comparison to use.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add V1 schema fields for services, work status, and payment actor tracking

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Billing date-math engine (pure functions, no DB)

**Files:**
- Create: `src/lib/billing-dates.ts`
- Test: `src/lib/billing-dates.test.ts`

**Interfaces:**
- Consumes: `BillingFrequency` (Prisma enum type)
- Produces: `firstPeriodLabel(startDate: Date, billingDay: number): string`, `nextPeriodLabel(currentLabel: string, frequency: BillingFrequency): string | null`, `dueDateForPeriod(periodLabel: string, billingDay: number): Date` — Task 3 (`createClientService`) and Plan 2's Mark Paid action both call all three.

This is the highest-risk logic in the whole V1 slice — get the tests right before anything else depends on it.

**Design (for reference while implementing — not new decisions, restating the spec):**
- A period is identified by a `"YYYY-MM"` label (matches the existing `BillingPeriod.periodLabel` column), not by its due date directly — the due date is *derived* from the label plus the plan's `billingDay`, every time, never stored as the source of truth for period identity.
- `dueDateForPeriod` clamps `billingDay` to the target month's actual last day (a `billingDay` of 31 in a 30-day month becomes that month's 30th; in February, the 28th or 29th depending on the year).
- `nextPeriodLabel` advances the label by 1/3/6/12 calendar months for `MONTHLY`/`QUARTERLY`/`HALF_YEARLY`/`YEARLY`, wrapping the year correctly (December + 1 month → next January). Returns `null` for `ONE_TIME` — there is no next period.
- `firstPeriodLabel` picks the service's own start month if `billingDay` hasn't passed yet relative to `startDate`'s day-of-month; otherwise the *following* month. (A service starting Aug 12 with `billingDay` 5 has already missed August's billing day — its first period is September. A service starting Aug 3 with `billingDay` 5 hasn't missed it yet — first period is August.)

- [ ] **Step 1: Write the failing tests**

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- billing-dates.test`
Expected: FAIL — `Cannot find module '@/lib/billing-dates'`.

- [ ] **Step 3: Implement `src/lib/billing-dates.ts`**

```typescript
import type { BillingFrequency } from "@/generated/prisma/client";

const MONTHS_PER_FREQUENCY: Record<Exclude<BillingFrequency, "ONE_TIME">, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  HALF_YEARLY: 6,
  YEARLY: 12,
};

/** Parses "YYYY-MM" into { year, month } with month 0-indexed (0 = January). */
function parseLabel(label: string): { year: number; month: number } {
  const [yearStr, monthStr] = label.split("-");
  return { year: Number(yearStr), month: Number(monthStr) - 1 };
}

function formatLabel(year: number, month: number): string {
  // month may be >11 or <0 here before normalization — normalize via a
  // real Date so year-wrapping (month 12 -> next year, month -1 -> prior
  // year) is handled correctly rather than hand-rolled.
  const normalized = new Date(Date.UTC(year, month, 1));
  const y = normalized.getUTCFullYear();
  const m = String(normalized.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Number of days in a given UTC month (0-indexed month). */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the *next* month is the last day of *this* month.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * The due date for a given period, given the plan's billingDay.
 * Clamps to the target month's actual last day when billingDay doesn't
 * exist there (e.g. the 31st in a 30-day month) — never rolls over into
 * the next month.
 */
export function dueDateForPeriod(periodLabel: string, billingDay: number): Date {
  const { year, month } = parseLabel(periodLabel);
  const clampedDay = Math.min(billingDay, daysInMonth(year, month));
  return new Date(Date.UTC(year, month, clampedDay));
}

/**
 * The next period's label, or null for ONE_TIME (which never recurs).
 * Always advances from the CURRENT label's month — never from a
 * previously-clamped due date — so a clamped February doesn't cause
 * March's due date to drift down from the plan's real billingDay.
 */
export function nextPeriodLabel(
  currentLabel: string,
  frequency: BillingFrequency
): string | null {
  if (frequency === "ONE_TIME") {
    return null;
  }
  const { year, month } = parseLabel(currentLabel);
  const monthsToAdd = MONTHS_PER_FREQUENCY[frequency];
  return formatLabel(year, month + monthsToAdd);
}

/**
 * The label of a ClientService's very first billing period: the start
 * month itself if billingDay hasn't happened yet that month (relative to
 * startDate's own day-of-month), otherwise the following month.
 */
export function firstPeriodLabel(startDate: Date, billingDay: number): string {
  const year = startDate.getUTCFullYear();
  const month = startDate.getUTCMonth();
  const startDay = startDate.getUTCDate();

  if (startDay <= billingDay) {
    return formatLabel(year, month);
  }
  return formatLabel(year, month + 1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- billing-dates.test`
Expected: `17 passed`.

- [ ] **Step 5: Run full verification**

Run: `npm run build && npm run lint`
Expected: both pass clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add pure billing date-math functions (period labels, due dates)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `createClientService` (transactional: template + service + billing plan + first period)

**Files:**
- Create: `src/lib/services.ts`
- Test: `src/lib/services.test.ts`

**Interfaces:**
- Consumes: `firstPeriodLabel`, `dueDateForPeriod` (Task 2).
- Produces: `findOrCreateServiceTemplate(organizationId: number, name: string): Promise<ServiceTemplate>`, `createClientService(input: CreateClientServiceInput): Promise<ClientService>` where
  ```typescript
  type CreateClientServiceInput = {
    clientId: number;
    serviceName: string;
    feeInPaise: number;
    frequency: BillingFrequency;
    billingDay: number;
    startDate: Date;
    endDate: Date | null;
  };
  ```
  Task 4's `createServiceAction` consumes both. `getServicesForClient(clientId: number)` also added here — Plan 3's dashboard/detail-page work consumes it.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/services.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import {
  findOrCreateServiceTemplate,
  createClientService,
  getServicesForClient,
} from "@/lib/services";

describe("findOrCreateServiceTemplate", () => {
  let orgId: number;

  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
  });

  it("creates a new template when none exists", async () => {
    const template = await findOrCreateServiceTemplate(orgId, "Local SEO");
    expect(template.name).toBe("Local SEO");
    expect(template.organizationId).toBe(orgId);
  });

  it("reuses an existing template with an exact name match", async () => {
    const first = await findOrCreateServiceTemplate(orgId, "Local SEO");
    const second = await findOrCreateServiceTemplate(orgId, "Local SEO");
    expect(second.id).toBe(first.id);
    const count = await prisma.serviceTemplate.count();
    expect(count).toBe(1);
  });

  it("reuses an existing template case-insensitively", async () => {
    const first = await findOrCreateServiceTemplate(orgId, "Local SEO");
    const second = await findOrCreateServiceTemplate(orgId, "local seo");
    expect(second.id).toBe(first.id);
  });

  it("does not reuse a template from a different organization", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    await findOrCreateServiceTemplate(otherOrg.id, "Local SEO");

    const template = await findOrCreateServiceTemplate(orgId, "Local SEO");

    const count = await prisma.serviceTemplate.count();
    expect(count).toBe(2);
    expect(template.organizationId).toBe(orgId);
  });
});

describe("createClientService", () => {
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

  it("creates the service, its billing plan, and its first billing period", async () => {
    const service = await createClientService({
      clientId,
      serviceName: "Local SEO",
      feeInPaise: 500000, // ₹5,000
      frequency: "MONTHLY",
      billingDay: 5,
      startDate: new Date(Date.UTC(2026, 7, 3)), // Aug 3 2026 — billing day not yet passed
      endDate: null,
    });

    expect(service.feeInPaise).toBe(500000);
    expect(service.workStatus).toBe("NOT_STARTED");

    const plan = await prisma.billingPlan.findUniqueOrThrow({
      where: { clientServiceId: service.id },
    });
    expect(plan.amountInPaise).toBe(500000);
    expect(plan.frequency).toBe("MONTHLY");
    expect(plan.billingDay).toBe(5);

    const period = await prisma.billingPeriod.findFirstOrThrow({
      where: { billingPlanId: plan.id },
    });
    expect(period.periodLabel).toBe("2026-08");
    expect(period.amountInPaise).toBe(500000);
    expect(period.status).toBe("UPCOMING");
    expect(period.dueDate.getUTCDate()).toBe(5);
    expect(period.dueDate.getUTCMonth()).toBe(7); // August
  });

  it("reuses a service template across two different clients", async () => {
    const otherClient = await prisma.client.create({
      data: { organizationId: orgId, businessName: "XYZ Salon" },
    });

    await createClientService({
      clientId,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 5,
      startDate: new Date(Date.UTC(2026, 7, 3)),
      endDate: null,
    });
    await createClientService({
      clientId: otherClient.id,
      serviceName: "Local SEO",
      feeInPaise: 300000,
      frequency: "MONTHLY",
      billingDay: 10,
      startDate: new Date(Date.UTC(2026, 7, 3)),
      endDate: null,
    });

    const templateCount = await prisma.serviceTemplate.count();
    expect(templateCount).toBe(1);
  });

  it("creates a one-time service with no next-period expectation (billing plan still created)", async () => {
    const service = await createClientService({
      clientId,
      serviceName: "Website Build",
      feeInPaise: 1500000,
      frequency: "ONE_TIME",
      billingDay: 1,
      startDate: new Date(Date.UTC(2026, 7, 1)),
      endDate: null,
    });

    const plan = await prisma.billingPlan.findUniqueOrThrow({
      where: { clientServiceId: service.id },
    });
    expect(plan.frequency).toBe("ONE_TIME");
    const periodCount = await prisma.billingPeriod.count({
      where: { billingPlanId: plan.id },
    });
    expect(periodCount).toBe(1); // exactly one period ever, for a one-time fee
  });

  it("stores an optional endDate", async () => {
    const endDate = new Date(Date.UTC(2027, 7, 3));
    const service = await createClientService({
      clientId,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 5,
      startDate: new Date(Date.UTC(2026, 7, 3)),
      endDate,
    });
    expect(service.endDate?.getTime()).toBe(endDate.getTime());
  });
});

describe("getServicesForClient", () => {
  it("returns services with their billing plan and periods included", async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    const client = await prisma.client.create({
      data: { organizationId: org.id, businessName: "ABC Interiors" },
    });
    await createClientService({
      clientId: client.id,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 5,
      startDate: new Date(Date.UTC(2026, 7, 3)),
      endDate: null,
    });

    const services = await getServicesForClient(client.id);

    expect(services).toHaveLength(1);
    expect(services[0].billingPlan?.billingPeriods).toHaveLength(1);
    expect(services[0].serviceTemplate.name).toBe("Local SEO");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- services.test`
Expected: FAIL — `Cannot find module '@/lib/services'`.

- [ ] **Step 3: Implement `src/lib/services.ts`**

```typescript
import { prisma } from "@/lib/db";
import { firstPeriodLabel, dueDateForPeriod } from "@/lib/billing-dates";
import type { BillingFrequency } from "@/generated/prisma/client";

export async function findOrCreateServiceTemplate(
  organizationId: number,
  name: string
) {
  const trimmedName = name.trim();

  const existing = await prisma.serviceTemplate.findFirst({
    where: {
      organizationId,
      name: { equals: trimmedName },
    },
  });
  if (existing) {
    return existing;
  }

  return prisma.serviceTemplate.create({
    data: { organizationId, name: trimmedName },
  });
}

export type CreateClientServiceInput = {
  clientId: number;
  serviceName: string;
  feeInPaise: number;
  frequency: BillingFrequency;
  billingDay: number;
  startDate: Date;
  endDate: Date | null;
};

/**
 * Creates a client's service, its billing plan, and its first billing
 * period in one transaction. The service template is found-or-created
 * as part of the same transaction so a concurrent duplicate-name create
 * can't race past this function's own lookup.
 */
export async function createClientService(input: CreateClientServiceInput) {
  return prisma.$transaction(async (tx) => {
    const trimmedName = input.serviceName.trim();
    const template =
      (await tx.serviceTemplate.findFirst({
        where: {
          organizationId: (
            await tx.client.findUniqueOrThrow({ where: { id: input.clientId } })
          ).organizationId,
          name: { equals: trimmedName },
        },
      })) ??
      (await tx.serviceTemplate.create({
        data: {
          organizationId: (
            await tx.client.findUniqueOrThrow({ where: { id: input.clientId } })
          ).organizationId,
          name: trimmedName,
        },
      }));

    const service = await tx.clientService.create({
      data: {
        clientId: input.clientId,
        serviceTemplateId: template.id,
        feeInPaise: input.feeInPaise,
        startDate: input.startDate,
        endDate: input.endDate,
      },
    });

    const plan = await tx.billingPlan.create({
      data: {
        clientServiceId: service.id,
        amountInPaise: input.feeInPaise,
        frequency: input.frequency,
        billingDay: input.billingDay,
        startDate: input.startDate,
      },
    });

    const periodLabel = firstPeriodLabel(input.startDate, input.billingDay);
    await tx.billingPeriod.create({
      data: {
        billingPlanId: plan.id,
        periodLabel,
        amountInPaise: input.feeInPaise,
        dueDate: dueDateForPeriod(periodLabel, input.billingDay),
      },
    });

    return service;
  });
}

export async function getServicesForClient(clientId: number) {
  return prisma.clientService.findMany({
    where: { clientId },
    include: {
      serviceTemplate: true,
      billingPlan: {
        include: {
          billingPeriods: { orderBy: { periodLabel: "desc" } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}
```

Note: the template lookup is duplicated (client fetched twice) inside the transaction above only to keep the find-or-create logic linear and readable — Prisma's `??` short-circuit means the second `client.findUniqueOrThrow` only runs when no template was found, so this is not two extra always-run queries. If you find a cleaner way to fetch the client's `organizationId` once and reuse it, prefer that — just keep the whole thing inside one `$transaction`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- services.test`
Expected: `9 passed`.

- [ ] **Step 5: Run full verification**

Run: `npm run build && npm run lint`
Expected: both pass clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add createClientService (template + service + billing plan + first period)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: `createServiceAction` + `requireClientServiceInOwnOrg` helper

**Files:**
- Modify: `src/app/(app)/clients/actions.ts` (add `requireClientServiceInOwnOrg`, exported for Plan 2 to reuse)
- Create: `src/app/(app)/clients/service-actions.ts`
- Test: `src/app/(app)/clients/service-actions.test.ts`

**Interfaces:**
- Consumes: `createClientService` (Task 3), the existing `requireAdmin`/`requireClientInOwnOrg` pattern.
- Produces: `requireClientServiceInOwnOrg(clientServiceId: number): Promise<{ admin: Admin; clientService: (ClientService & { client: Client }) | null }>` (exported from `actions.ts` so Plan 2's Mark Paid and work-status actions can import it without duplicating the org-check pattern a third time); `createServiceAction(clientId: number, formData: FormData): Promise<{ error: string } | { clientServiceId: number }>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/(app)/clients/service-actions.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";

vi.mock("@/lib/require-admin", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/require-admin";
import { createServiceAction } from "@/app/(app)/clients/service-actions";

function mockAdmin(organizationId: number, adminId = 1) {
  vi.mocked(requireAdmin).mockResolvedValue({
    id: adminId,
    email: "admin@example.com",
    organizationId,
  });
}

function serviceForm(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  return form;
}

describe("createServiceAction", () => {
  let orgId: number;
  let clientId: number;
  let adminId: number;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors" },
    });
    clientId = client.id;
    // createServiceAction writes a ClientActivity row under a real FK to
    // admin_users (added in Task 1) — mockAdmin alone only stubs
    // requireAdmin()'s return value, it doesn't create a backing row, so
    // a real AdminUser is required here too.
    const admin = await prisma.adminUser.create({
      data: { organizationId: orgId, email: "admin@example.com", passwordHash: "x" },
    });
    adminId = admin.id;
    mockAdmin(orgId, adminId);
  });

  it("creates a service and returns its id", async () => {
    const form = serviceForm({
      serviceName: "Local SEO",
      feeInRupees: "5000",
      frequency: "MONTHLY",
      billingDay: "5",
      startDate: "2026-08-03",
    });

    const result = await createServiceAction(clientId, form);

    expect("clientServiceId" in result).toBe(true);
    const service = await prisma.clientService.findUniqueOrThrow({
      where: { id: (result as { clientServiceId: number }).clientServiceId },
    });
    expect(service.feeInPaise).toBe(500000);
  });

  it("writes a service.added activity row naming the service", async () => {
    const form = serviceForm({
      serviceName: "Local SEO",
      feeInRupees: "5000",
      frequency: "MONTHLY",
      billingDay: "5",
      startDate: "2026-08-03",
    });

    await createServiceAction(clientId, form);

    const activity = await prisma.clientActivity.findFirstOrThrow({
      where: { clientId, eventType: "service.added" },
    });
    expect(activity.summary).toContain("Local SEO");
    expect(activity.actorAdminId).toBe(adminId);
  });

  it("rejects a missing service name", async () => {
    const form = serviceForm({
      serviceName: "  ",
      feeInRupees: "5000",
      frequency: "MONTHLY",
      billingDay: "5",
      startDate: "2026-08-03",
    });

    const result = await createServiceAction(clientId, form);

    expect(result).toEqual({ error: "Service name is required." });
  });

  it("rejects a non-positive fee", async () => {
    const form = serviceForm({
      serviceName: "Local SEO",
      feeInRupees: "0",
      frequency: "MONTHLY",
      billingDay: "5",
      startDate: "2026-08-03",
    });

    const result = await createServiceAction(clientId, form);

    expect(result).toEqual({ error: "Price must be greater than zero." });
  });

  it("rejects a billing day outside 1-28", async () => {
    const form = serviceForm({
      serviceName: "Local SEO",
      feeInRupees: "5000",
      frequency: "MONTHLY",
      billingDay: "30",
      startDate: "2026-08-03",
    });

    const result = await createServiceAction(clientId, form);

    expect(result).toEqual({ error: "Billing day must be between 1 and 28." });
  });

  it("rejects an invalid frequency value", async () => {
    const form = serviceForm({
      serviceName: "Local SEO",
      feeInRupees: "5000",
      frequency: "FORTNIGHTLY",
      billingDay: "5",
      startDate: "2026-08-03",
    });

    const result = await createServiceAction(clientId, form);

    expect(result).toEqual({ error: "Invalid billing frequency." });
  });

  it("returns an error when the client belongs to a different organization", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    mockAdmin(otherOrg.id);
    const form = serviceForm({
      serviceName: "Local SEO",
      feeInRupees: "5000",
      frequency: "MONTHLY",
      billingDay: "5",
      startDate: "2026-08-03",
    });

    const result = await createServiceAction(clientId, form);

    expect(result).toEqual({ error: "Client not found." });
    const count = await prisma.clientService.count();
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- service-actions.test`
Expected: FAIL — `Cannot find module '@/app/(app)/clients/service-actions'`.

- [ ] **Step 3: Export `requireClientInOwnOrg`'s pattern for service-scoped ownership**

Add to `src/app/(app)/clients/actions.ts` (it already has `requireAdmin`, `prisma` imported, and the existing `requireClientInOwnOrg`) — change the existing helper from module-private to exported, since Task 4's new file and Plan 2 both need it:

Find this line:
```typescript
async function requireClientInOwnOrg(clientId: number) {
```
Change it to:
```typescript
export async function requireClientInOwnOrg(clientId: number) {
```

(No other change to that function — this is a one-word visibility change only.)

- [ ] **Step 4: Implement `src/app/(app)/clients/service-actions.ts`**

`requireClientServiceInOwnOrg` calls `requireAdmin()` directly (not `requireClientInOwnOrg`, which is for resolving a *client* id, not a *service* id) — do not route through it just to obtain `admin`, that would query for a client using the service id by mistake.

```typescript
"use server";

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";
import { requireClientInOwnOrg } from "./actions";
import { createClientService } from "@/lib/services";
import type { BillingFrequency } from "@/generated/prisma/client";

const VALID_FREQUENCIES: BillingFrequency[] = [
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "YEARLY",
  "ONE_TIME",
];

/**
 * Resolves a clientServiceId to its owning client, scoped to the
 * authenticated admin's organization — the service-level counterpart to
 * requireClientInOwnOrg. Never throws for a missing/wrong-org id; callers
 * check `clientService === null`.
 */
export async function requireClientServiceInOwnOrg(clientServiceId: number) {
  const admin = await requireAdmin();
  const clientService = await prisma.clientService.findFirst({
    where: {
      id: clientServiceId,
      client: { organizationId: admin.organizationId },
    },
    include: { client: true },
  });
  return { admin, clientService };
}

export async function createServiceAction(
  clientId: number,
  formData: FormData
): Promise<{ error: string } | { clientServiceId: number }> {
  const { client } = await requireClientInOwnOrg(clientId);
  if (!client) {
    return { error: "Client not found." };
  }

  const serviceName = String(formData.get("serviceName") ?? "").trim();
  if (!serviceName) {
    return { error: "Service name is required." };
  }

  const feeInRupees = Number(formData.get("feeInRupees"));
  if (!Number.isFinite(feeInRupees) || feeInRupees <= 0) {
    return { error: "Price must be greater than zero." };
  }

  const billingDay = Number(formData.get("billingDay"));
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28) {
    return { error: "Billing day must be between 1 and 28." };
  }

  const frequency = String(formData.get("frequency"));
  if (!VALID_FREQUENCIES.includes(frequency as BillingFrequency)) {
    return { error: "Invalid billing frequency." };
  }

  const startDateRaw = String(formData.get("startDate") ?? "");
  const startDate = new Date(startDateRaw);
  if (Number.isNaN(startDate.getTime())) {
    return { error: "A valid start date is required." };
  }

  const endDateRaw = String(formData.get("endDate") ?? "").trim();
  const endDate = endDateRaw ? new Date(endDateRaw) : null;
  if (endDate && Number.isNaN(endDate.getTime())) {
    return { error: "End date is invalid." };
  }

  const service = await createClientService({
    clientId,
    serviceName,
    feeInPaise: Math.round(feeInRupees * 100),
    frequency: frequency as BillingFrequency,
    billingDay,
    startDate,
    endDate,
  });

  const { admin } = await requireClientInOwnOrg(clientId);
  await prisma.clientActivity.create({
    data: {
      clientId,
      actorAdminId: admin!.id,
      eventType: "service.added",
      summary: `${serviceName} added as a service.`,
    },
  });

  return { clientServiceId: service.id };
}
```

Billing day is capped at 1-28 deliberately (not 1-31) — every month has at least 28 days, so a billing day in this range never needs clamping at all. `dueDateForPeriod`'s clamping logic (Task 2) still exists and is still tested for correctness, but restricting user input to 1-28 means V1 never actually exercises the clamped path in real usage — it's defensive depth, not dead code, since the function itself is general-purpose and Task 2's tests prove it handles the full 1-31 range correctly regardless of what this form allows.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- service-actions.test`
Expected: `7 passed`.

- [ ] **Step 6: Run full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all pass clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add createServiceAction and requireClientServiceInOwnOrg helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `updateServiceAction` and `updateServiceStatusAction`

**Files:**
- Modify: `src/app/(app)/clients/service-actions.ts`
- Modify: `src/app/(app)/clients/service-actions.test.ts` (extend)

**Interfaces:**
- Consumes: `requireClientServiceInOwnOrg` (Task 4).
- Produces: `updateServiceAction(clientServiceId: number, formData: FormData): Promise<{ error: string } | { ok: true }>` (edits price/frequency/billingDay/endDate — never rewrites an existing `BillingPeriod`, only affects `BillingPlan` and periods generated after this edit), `updateServiceStatusAction(clientServiceId: number, status: ServiceStatus): Promise<{ error: string } | { ok: true }>` (a quick one-click Pause/Cancel/Reactivate, separate from the full edit form).

- [ ] **Step 1: Add the failing tests**

```typescript
// append to src/app/(app)/clients/service-actions.test.ts
import {
  updateServiceAction,
  updateServiceStatusAction,
} from "@/app/(app)/clients/service-actions";
import { createServiceAction } from "@/app/(app)/clients/service-actions";

describe("updateServiceAction", () => {
  let orgId: number;
  let clientServiceId: number;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors" },
    });
    // createServiceAction (below) writes a ClientActivity row with a real
    // FK to admin_users — mockAdmin alone only stubs requireAdmin()'s
    // return value, it doesn't create a backing row, so a real AdminUser
    // is required here (same pattern as the existing addNoteAction block
    // in this file, and the fix Task 4's own review surfaced this gap
    // through).
    const admin = await prisma.adminUser.create({
      data: { organizationId: orgId, email: "admin@example.com", passwordHash: "x" },
    });
    mockAdmin(orgId, admin.id);
    const created = await createServiceAction(
      client.id,
      serviceForm({
        serviceName: "Local SEO",
        feeInRupees: "5000",
        frequency: "MONTHLY",
        billingDay: "5",
        startDate: "2026-08-03",
      })
    );
    clientServiceId = (created as { clientServiceId: number }).clientServiceId;
  });

  it("updates the fee going forward without touching the existing billing period", async () => {
    const before = await prisma.billingPeriod.findFirstOrThrow({
      where: { billingPlan: { clientServiceId } },
    });

    const form = new FormData();
    form.set("feeInRupees", "6000");
    form.set("frequency", "MONTHLY");
    form.set("billingDay", "5");
    const result = await updateServiceAction(clientServiceId, form);

    expect(result).toEqual({ ok: true });
    const plan = await prisma.billingPlan.findUniqueOrThrow({
      where: { clientServiceId },
    });
    expect(plan.amountInPaise).toBe(600000);

    const stillTheOriginalPeriod = await prisma.billingPeriod.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(stillTheOriginalPeriod.amountInPaise).toBe(500000); // unchanged
  });

  it("rejects a non-positive fee", async () => {
    const form = new FormData();
    form.set("feeInRupees", "-5");
    form.set("frequency", "MONTHLY");
    form.set("billingDay", "5");

    const result = await updateServiceAction(clientServiceId, form);

    expect(result).toEqual({ error: "Price must be greater than zero." });
  });

  it("returns an error for a service in a different organization", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    mockAdmin(otherOrg.id);
    const form = new FormData();
    form.set("feeInRupees", "6000");
    form.set("frequency", "MONTHLY");
    form.set("billingDay", "5");

    const result = await updateServiceAction(clientServiceId, form);

    expect(result).toEqual({ error: "Service not found." });
  });
});

describe("updateServiceStatusAction", () => {
  let orgId: number;
  let clientServiceId: number;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors" },
    });
    // Both createServiceAction (below) and updateServiceStatusAction
    // (called by every test in this block) write a ClientActivity row
    // with a real FK to admin_users — see the note in the
    // updateServiceAction block above for why a real row is required.
    const admin = await prisma.adminUser.create({
      data: { organizationId: orgId, email: "admin@example.com", passwordHash: "x" },
    });
    mockAdmin(orgId, admin.id);
    const created = await createServiceAction(
      client.id,
      serviceForm({
        serviceName: "Local SEO",
        feeInRupees: "5000",
        frequency: "MONTHLY",
        billingDay: "5",
        startDate: "2026-08-03",
      })
    );
    clientServiceId = (created as { clientServiceId: number }).clientServiceId;
  });

  it("pauses a service and logs activity", async () => {
    const result = await updateServiceStatusAction(clientServiceId, "PAUSED");

    expect(result).toEqual({ ok: true });
    const service = await prisma.clientService.findUniqueOrThrow({
      where: { id: clientServiceId },
    });
    expect(service.status).toBe("PAUSED");
    const activity = await prisma.clientActivity.findFirstOrThrow({
      where: { eventType: "service.status_changed" },
    });
    expect(activity.summary).toContain("PAUSED");
  });

  it("rejects a status change for a service in a different organization", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    mockAdmin(otherOrg.id);

    const result = await updateServiceStatusAction(clientServiceId, "CANCELLED");

    expect(result).toEqual({ error: "Service not found." });
    const service = await prisma.clientService.findUniqueOrThrow({
      where: { id: clientServiceId },
    });
    expect(service.status).toBe("ACTIVE"); // untouched
  });

  it("leaves the existing billing period completely unchanged when pausing", async () => {
    const before = await prisma.billingPeriod.findFirstOrThrow({
      where: { billingPlan: { clientServiceId } },
    });

    await updateServiceStatusAction(clientServiceId, "PAUSED");

    const after = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.amountInPaise).toBe(before.amountInPaise);
    expect(after.dueDate.getTime()).toBe(before.dueDate.getTime());
    expect(after.status).toBe(before.status);
    expect(after.periodLabel).toBe(before.periodLabel);
    const periodCount = await prisma.billingPeriod.count({
      where: { billingPlan: { clientServiceId } },
    });
    expect(periodCount).toBe(1); // pausing does not spawn or remove periods
  });

  it("leaves the existing billing period completely unchanged when cancelling", async () => {
    const before = await prisma.billingPeriod.findFirstOrThrow({
      where: { billingPlan: { clientServiceId } },
    });

    await updateServiceStatusAction(clientServiceId, "CANCELLED");

    const after = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.amountInPaise).toBe(before.amountInPaise);
    expect(after.dueDate.getTime()).toBe(before.dueDate.getTime());
    expect(after.status).toBe(before.status);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- service-actions.test`
Expected: FAIL — `updateServiceAction is not a function`.

- [ ] **Step 3: Implement both actions**

Add to `src/app/(app)/clients/service-actions.ts`:

```typescript
export async function updateServiceAction(
  clientServiceId: number,
  formData: FormData
): Promise<{ error: string } | { ok: true }> {
  const { clientService } = await requireClientServiceInOwnOrg(clientServiceId);
  if (!clientService) {
    return { error: "Service not found." };
  }

  const feeInRupees = Number(formData.get("feeInRupees"));
  if (!Number.isFinite(feeInRupees) || feeInRupees <= 0) {
    return { error: "Price must be greater than zero." };
  }

  const billingDay = Number(formData.get("billingDay"));
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28) {
    return { error: "Billing day must be between 1 and 28." };
  }

  const frequency = String(formData.get("frequency"));
  if (!VALID_FREQUENCIES.includes(frequency as BillingFrequency)) {
    return { error: "Invalid billing frequency." };
  }

  const endDateRaw = String(formData.get("endDate") ?? "").trim();
  const endDate = endDateRaw ? new Date(endDateRaw) : null;
  if (endDate && Number.isNaN(endDate.getTime())) {
    return { error: "End date is invalid." };
  }

  await prisma.$transaction([
    prisma.clientService.update({
      where: { id: clientServiceId },
      data: { endDate },
    }),
    prisma.billingPlan.update({
      where: { clientServiceId },
      data: {
        amountInPaise: Math.round(feeInRupees * 100),
        frequency: frequency as BillingFrequency,
        billingDay,
      },
    }),
  ]);

  return { ok: true };
}

export async function updateServiceStatusAction(
  clientServiceId: number,
  status: "ACTIVE" | "PAUSED" | "CANCELLED"
): Promise<{ error: string } | { ok: true }> {
  const { admin, clientService } = await requireClientServiceInOwnOrg(clientServiceId);
  if (!clientService) {
    return { error: "Service not found." };
  }

  await prisma.$transaction([
    prisma.clientService.update({
      where: { id: clientServiceId },
      data: { status },
    }),
    prisma.clientActivity.create({
      data: {
        clientId: clientService.clientId,
        actorAdminId: admin.id,
        eventType: "service.status_changed",
        summary: `Service status changed to ${status}.`,
      },
    }),
  ]);

  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- service-actions.test`
Expected: all pass (7 from Task 4 + 7 new = 14).

- [ ] **Step 5: Run full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all pass clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add updateServiceAction and updateServiceStatusAction

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: Services panel on the client detail page

**Files:**
- Create: `src/components/clients/ServicesPanel.tsx`
- Create: `src/components/clients/AddServiceForm.tsx`
- Modify: `src/lib/clients.ts` (extend `getClientById`'s `include` with services)
- Modify: `src/app/(app)/clients/[id]/page.tsx` (render the panel)

**Interfaces:**
- Consumes: `getServicesForClient`'s shape (Task 3), `createServiceAction`/`updateServiceStatusAction` (Tasks 4-5).
- Produces: nothing new consumed by later tasks in this plan — Plan 2 and Plan 3 read services via `getClientById`'s extended include or via `getServicesForClient` directly, both already in place after this task.

- [ ] **Step 1: Extend `getClientById`'s include**

In `src/lib/clients.ts`, find `getClientById` and add a `services` block to its `include`:

```typescript
export async function getClientById(organizationId: number, clientId: number) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId },
    include: {
      contacts: { orderBy: { isPrimary: "desc" } },
      notes: { orderBy: { createdAt: "desc" } },
      activity: { orderBy: { createdAt: "desc" } },
      services: {
        orderBy: { createdAt: "asc" },
        include: {
          serviceTemplate: true,
          billingPlan: {
            include: {
              billingPeriods: { orderBy: { periodLabel: "desc" }, take: 1 },
            },
          },
        },
      },
    },
  });
  return client;
}
```

`take: 1` on `billingPeriods` (ordered newest-label-first) fetches only the *current* open period for the detail page's service rows — the full payment history table (Plan 3) queries periods separately, unpaginated, rather than loading every historical period on every page view.

- [ ] **Step 2: Write a test for the extended include**

Add to `src/lib/clients.test.ts`:

```typescript
// append to src/lib/clients.test.ts
import { createClientService } from "@/lib/services";

describe("getClientById with services", () => {
  it("includes services with their template and current billing period", async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    const client = await prisma.client.create({
      data: { organizationId: org.id, businessName: "ABC Interiors" },
    });
    await createClientService({
      clientId: client.id,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 5,
      startDate: new Date(Date.UTC(2026, 7, 3)),
      endDate: null,
    });

    const result = await getClientById(org.id, client.id);

    expect(result?.services).toHaveLength(1);
    expect(result?.services[0].serviceTemplate.name).toBe("Local SEO");
    expect(result?.services[0].billingPlan?.billingPeriods).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails, then passes**

Run: `npm test -- clients.test`
Expected: FAILs first (services undefined on the returned shape isn't yet typed/populated the way the test expects — actually since Step 1 already changed the query, this should pass immediately once Step 1's code is in place; run it to confirm, not to hunt a RED state that may not exist here since the include and the test land together. If it's already GREEN on first run, that's fine — say so in your report rather than forcing an artificial RED.)

- [ ] **Step 4: Write `src/components/clients/AddServiceForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createServiceAction } from "@/app/(app)/clients/service-actions";

const FREQUENCY_OPTIONS = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "HALF_YEARLY", label: "Half-yearly" },
  { value: "YEARLY", label: "Yearly" },
  { value: "ONE_TIME", label: "One-time" },
];

export function AddServiceForm({ clientId }: { clientId: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function handleSubmit(formData: FormData) {
    const result = await createServiceAction(clientId, formData);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
      >
        Add Service
      </button>
    );
  }

  return (
    <form action={handleSubmit} className="space-y-3 rounded-lg border border-neutral-200 p-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field name="serviceName" label="Service name" required />
        <Field name="feeInRupees" label="Price (₹)" type="number" required />
        <div>
          <label className="mb-1 block text-sm text-neutral-600" htmlFor="frequency">
            Billing frequency
          </label>
          <select
            id="frequency"
            name="frequency"
            required
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          >
            {FREQUENCY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <Field name="billingDay" label="Billing day (1-28)" type="number" required />
        <Field name="startDate" label="Start date" type="date" required />
        <Field name="endDate" label="End date (optional)" type="date" />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Add Service
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  type = "text",
  required = false,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm text-neutral-600" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
      />
    </div>
  );
}
```

`router.refresh()` (not `router.push`) after a successful add — the form stays on the same client detail page and the newly-added service should appear in the list below without a full navigation, following the same revalidation lesson Foundation's final review already established for this exact kind of in-place list update.

- [ ] **Step 5: Write `src/components/clients/ServicesPanel.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ClientService,
  ServiceTemplate,
  BillingPlan,
  BillingPeriod,
} from "@/generated/prisma/client";
import { updateServiceStatusAction } from "@/app/(app)/clients/service-actions";
import { AddServiceForm } from "./AddServiceForm";

type ServiceWithBilling = ClientService & {
  serviceTemplate: ServiceTemplate;
  billingPlan:
    | (BillingPlan & { billingPeriods: BillingPeriod[] })
    | null;
};

const FREQUENCY_LABELS: Record<string, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  HALF_YEARLY: "Half-yearly",
  YEARLY: "Yearly",
  ONE_TIME: "One-time",
};

export function ServicesPanel({
  clientId,
  services,
}: {
  clientId: number;
  services: ServiceWithBilling[];
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-900">Services</h2>
        <AddServiceForm clientId={clientId} />
      </div>
      <ul className="space-y-3">
        {services.map((service) => (
          <ServiceRow key={service.id} service={service} />
        ))}
        {services.length === 0 && (
          <li className="text-sm text-neutral-400">No services yet.</li>
        )}
      </ul>
    </section>
  );
}

function ServiceRow({ service }: { service: ServiceWithBilling }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const period = service.billingPlan?.billingPeriods[0];
  const feeInRupees = (service.feeInPaise / 100).toLocaleString("en-IN");

  function handleStatusChange(next: "ACTIVE" | "PAUSED" | "CANCELLED") {
    startTransition(async () => {
      await updateServiceStatusAction(service.id, next);
      router.refresh();
    });
  }

  return (
    <li className="rounded-lg border border-neutral-100 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-neutral-900">
          {service.serviceTemplate.name}
        </span>
        <StatusBadge status={service.status} />
      </div>
      <div className="mt-1 text-neutral-600">
        ₹{feeInRupees} — {FREQUENCY_LABELS[service.billingPlan?.frequency ?? ""]}
        {period && (
          <>
            {" · Next due "}
            {new Date(period.dueDate).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </>
        )}
      </div>
      <div className="mt-1 text-neutral-500">
        Work: {service.workStatus.replace("_", " ")}
        {service.progressPercent != null && ` — ${service.progressPercent}%`}
      </div>
      {service.status !== "CANCELLED" && (
        <div className="mt-2 flex gap-3 text-xs">
          {service.status === "ACTIVE" ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleStatusChange("PAUSED")}
              className="text-neutral-500 hover:text-neutral-900"
            >
              Pause
            </button>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleStatusChange("ACTIVE")}
              className="text-neutral-500 hover:text-neutral-900"
            >
              Reactivate
            </button>
          )}
          <button
            type="button"
            disabled={isPending}
            onClick={() => handleStatusChange("CANCELLED")}
            className="text-neutral-500 hover:text-red-600"
          >
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-emerald-50 text-emerald-700",
    PAUSED: "bg-amber-50 text-amber-700",
    CANCELLED: "bg-neutral-100 text-neutral-500",
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs ${styles[status] ?? styles.CANCELLED}`}>
      {status}
    </span>
  );
}
```

This component uses `useTransition` + `router.refresh()` (not a plain `<form action>`) for the Pause/Reactivate/Cancel buttons since they're simple onClick handlers rather than form submissions — both are valid patterns already used elsewhere in this codebase (`ContactsPanel`/`NotesPanel` use form actions; this uses a transition) — pick whichever reads more naturally per button, but be consistent within this file.

- [ ] **Step 6: Render it on the detail page**

In `src/app/(app)/clients/[id]/page.tsx`, import `ServicesPanel` and add it as a full-width row (same `col-span-2` pattern as `ContactsPanel`/`NotesPanel`), placed *before* Contacts and Notes so Services — the most operationally important section — appears higher on the page:

```tsx
import { ServicesPanel } from "@/components/clients/ServicesPanel";
// ... inside the grid, right after the Overview/Activity row, before ContactsPanel:
<div className="col-span-2">
  <ServicesPanel clientId={client.id} services={client.services} />
</div>
```

- [ ] **Step 7: Run full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all pass clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add services panel to the client detail page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Plan-level manual verification (do this once, after Task 6)

1. `npm run dev`, log in, open a client's detail page.
2. Click "Add Service," fill in a service named "Local SEO," ₹5,000, Monthly, billing day 5, a start date a few days in the past → submit.
3. Confirm the service appears immediately (no manual reload) showing the correct next-due date (the *next* occurrence of the 5th after the start date you chose).
4. Add a second service to the same client with a different frequency/billing day (e.g. "Website SEO," ₹7,000, Monthly, day 15) → confirm both services show independently with their own due dates.
5. Click Pause on one service → confirm its badge updates to PAUSED without a full reload.
6. Confirm in `mysql -u root clientos_dev` that `billing_plans` and `billing_periods` each have exactly the expected number of rows (one plan and one period per service created).
