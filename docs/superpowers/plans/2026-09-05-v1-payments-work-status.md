# V1 Payment Recording & Work Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin can click "Mark Paid" on any unpaid billing period and reliably record the payment — creating the underlying `Invoice`+`Payment` rows, marking the period paid, generating the next recurring period automatically, and logging activity — with full idempotency (can't double-process the same period) and zero risk of touching historical records. Separately, an admin can quickly update a service's work status/progress/next-action from the same page. This is Phases C+D of the V1 brief.

**Architecture:** One transactional library function (`markBillingPeriodPaid`) is the single source of truth for "what happens when a payment is recorded" — both the client-detail-page's Mark Paid button and (later, Plan 3) the dashboard's Mark Paid button call the exact same function through the exact same server action, so there is only ever one payment-recording code path to get right. Work status updates are a separate, much simpler action operating only on `ClientService` fields.

**Tech Stack:** Same as Foundation and Plan 1 — Next.js 16 Server Actions, Prisma 7/MySQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-05-v1-billing-work-attention-design.md`
**Depends on:** `docs/superpowers/plans/2026-09-05-v1-services-billing.md` (Plan 1) — this plan assumes `ClientService`/`BillingPlan`/`BillingPeriod` rows already exist, and reuses `firstPeriodLabel`/`nextPeriodLabel`/`dueDateForPeriod` from `src/lib/billing-dates.ts` and `requireClientServiceInOwnOrg`/`requireClientInOwnOrg` from `src/app/(app)/clients/{actions,service-actions}.ts`.

## Global Constraints

- Every new server action calls `requireAdmin()` (via an ownership-checking helper) as its own first line — never trusts a caller-supplied id at face value. This plan introduces one new helper: `requireBillingPeriodInOwnOrg(billingPeriodId)`.
- **Idempotency is enforced inside the database transaction, not by the UI.** A `BillingPeriod` already `PAID` cannot be marked paid again — the check-and-write happen atomically, so two concurrent Mark Paid clicks on the same period can't both succeed (matches the exact lost-update-race lesson Foundation's Task 4 fix already established for a different feature — same discipline, applied here).
- **Historical `BillingPeriod` rows are never edited except the one `status` transition `UPCOMING → PAID`.** The next period's `amountInPaise` comes from the *current* `BillingPlan.amountInPaise` at the moment of generation (so a fee change already takes effect for the next cycle), never copied from the period just paid.
- **A `ClientService` that is not `ACTIVE` (`PAUSED` or `CANCELLED`) never gets a new `BillingPeriod` generated for it** (confirmed with Rohit 2026-09-05) — if a lingering unpaid period on a paused/cancelled service is later settled via Mark Paid, the payment is recorded normally but no next period is created. Reactivating the service resumes normal generation on its next Mark Paid.
- Money stays `Int` paise throughout; user-facing forms convert from rupees at the boundary, exactly like Plan 1's `feeInRupees` → `feeInPaise` conversion.
- Run `npm run build`, `npm run lint`, and the full `npm test` at the end of every task — all three must pass clean before moving to the next task.

---

## Task 1: `markBillingPeriodPaid` — the core transactional payment-recording function

**Files:**
- Create: `src/lib/payments.ts`
- Test: `src/lib/payments.test.ts`

**Interfaces:**
- Consumes: `nextPeriodLabel`, `dueDateForPeriod` (Plan 1's `src/lib/billing-dates.ts`).
- Produces: `markBillingPeriodPaid(input: MarkPaidInput): Promise<MarkPaidResult>` where
  ```typescript
  type MarkPaidInput = {
    billingPeriodId: number;
    amountInPaise: number;
    paidAt: Date;
    recordedByAdminId: number;
  };
  type MarkPaidResult =
    | { error: "already_paid" }
    | { invoice: Invoice; period: BillingPeriod };
  ```
  Task 2's `markPaidAction` is the only consumer.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/payments.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { createClientService } from "@/lib/services";
import { markBillingPeriodPaid } from "@/lib/payments";

async function setupServiceWithOpenPeriod(overrides?: {
  frequency?: "MONTHLY" | "QUARTERLY" | "ONE_TIME";
  billingDay?: number;
  feeInPaise?: number;
}) {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  const client = await prisma.client.create({
    data: { organizationId: org.id, businessName: "ABC Interiors" },
  });
  const admin = await prisma.adminUser.create({
    data: { organizationId: org.id, email: "rohit@example.com", passwordHash: "x" },
  });
  const service = await createClientService({
    clientId: client.id,
    serviceName: "Local SEO",
    feeInPaise: overrides?.feeInPaise ?? 500000,
    frequency: overrides?.frequency ?? "MONTHLY",
    billingDay: overrides?.billingDay ?? 5,
    startDate: new Date(Date.UTC(2026, 7, 3)), // Aug 3 -> first period Aug
    endDate: null,
  });
  const plan = await prisma.billingPlan.findUniqueOrThrow({
    where: { clientServiceId: service.id },
  });
  const period = await prisma.billingPeriod.findFirstOrThrow({
    where: { billingPlanId: plan.id },
  });
  return { org, client, admin, service, plan, period };
}

describe("markBillingPeriodPaid", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates an invoice and a captured payment", async () => {
    const { admin, period } = await setupServiceWithOpenPeriod();

    const result = await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(Date.UTC(2026, 7, 4)),
      recordedByAdminId: admin.id,
    });

    expect("error" in result).toBe(false);
    const invoice = (result as { invoice: { id: number } }).invoice;
    const payment = await prisma.payment.findFirstOrThrow({
      where: { invoiceId: invoice.id },
    });
    expect(payment.status).toBe("CAPTURED");
    expect(payment.method).toBe("manual");
    expect(payment.amountInPaise).toBe(500000);
    expect(payment.recordedByAdminId).toBe(admin.id);
  });

  it("marks the invoice and the billing period PAID", async () => {
    const { admin, period } = await setupServiceWithOpenPeriod();

    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });

    const updatedPeriod = await prisma.billingPeriod.findUniqueOrThrow({
      where: { id: period.id },
    });
    expect(updatedPeriod.status).toBe("PAID");

    const lineItem = await prisma.invoiceLineItem.findUniqueOrThrow({
      where: { billingPeriodId: period.id },
      include: { invoice: true },
    });
    expect(lineItem.invoice.status).toBe("PAID");
  });

  it("generates the next billing period with the correct label, due date, and amount", async () => {
    const { plan, period } = await setupServiceWithOpenPeriod();
    const admin = await prisma.adminUser.findFirstOrThrow();

    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });

    const periods = await prisma.billingPeriod.findMany({
      where: { billingPlanId: plan.id },
      orderBy: { periodLabel: "asc" },
    });
    expect(periods).toHaveLength(2);
    expect(periods[0].periodLabel).toBe("2026-08");
    expect(periods[1].periodLabel).toBe("2026-09");
    expect(periods[1].status).toBe("UPCOMING");
    expect(periods[1].dueDate.getUTCDate()).toBe(5);
    expect(periods[1].dueDate.getUTCMonth()).toBe(8); // September
    expect(periods[1].amountInPaise).toBe(500000);
  });

  it("does not generate a next period for a ONE_TIME service", async () => {
    const { plan, period } = await setupServiceWithOpenPeriod({ frequency: "ONE_TIME" });
    const admin = await prisma.adminUser.findFirstOrThrow();

    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });

    const count = await prisma.billingPeriod.count({ where: { billingPlanId: plan.id } });
    expect(count).toBe(1);
  });

  it("uses the CURRENT plan amount for the next period, not the just-paid period's amount", async () => {
    const { plan, period } = await setupServiceWithOpenPeriod();
    const admin = await prisma.adminUser.findFirstOrThrow();

    // Simulate a fee change made between period creation and payment —
    // Plan 1's updateServiceAction would do this in real usage.
    await prisma.billingPlan.update({
      where: { id: plan.id },
      data: { amountInPaise: 600000 },
    });

    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000, // the OLD amount was what was actually paid
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });

    const paidPeriod = await prisma.billingPeriod.findUniqueOrThrow({
      where: { id: period.id },
    });
    expect(paidPeriod.amountInPaise).toBe(500000); // untouched, historical

    const nextPeriod = await prisma.billingPeriod.findFirstOrThrow({
      where: { billingPlanId: plan.id, periodLabel: "2026-09" },
    });
    expect(nextPeriod.amountInPaise).toBe(600000); // reflects the new fee
  });

  it("is idempotent: marking an already-PAID period paid again returns an error and creates nothing new", async () => {
    const { period } = await setupServiceWithOpenPeriod();
    const admin = await prisma.adminUser.findFirstOrThrow();

    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });
    const paymentCountAfterFirst = await prisma.payment.count();
    const periodCountAfterFirst = await prisma.billingPeriod.count();

    const secondResult = await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });

    expect(secondResult).toEqual({ error: "already_paid" });
    expect(await prisma.payment.count()).toBe(paymentCountAfterFirst);
    expect(await prisma.billingPeriod.count()).toBe(periodCountAfterFirst);
  });

  it("records the admin-entered amount even when it differs from the period's own amount", async () => {
    const { period } = await setupServiceWithOpenPeriod();
    const admin = await prisma.adminUser.findFirstOrThrow();

    const result = await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 450000, // admin recorded a different amount than expected
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });

    const invoice = (result as { invoice: { id: number } }).invoice;
    const payment = await prisma.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(payment.amountInPaise).toBe(450000);
    // V1 does not reconcile partial/over payments — whatever was recorded
    // is trusted, and the period is still marked fully PAID.
    const updatedPeriod = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(updatedPeriod.status).toBe("PAID");
  });

  it("does not generate a next period when the service is PAUSED", async () => {
    const { plan, period, service } = await setupServiceWithOpenPeriod();
    const admin = await prisma.adminUser.findFirstOrThrow();
    await prisma.clientService.update({ where: { id: service.id }, data: { status: "PAUSED" } });

    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });

    const count = await prisma.billingPeriod.count({ where: { billingPlanId: plan.id } });
    expect(count).toBe(1); // only the one period being paid — no next one
    const paidPeriod = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(paidPeriod.status).toBe("PAID"); // the payment itself still goes through
  });

  it("does not generate a next period when the service is CANCELLED", async () => {
    const { plan, period, service } = await setupServiceWithOpenPeriod();
    const admin = await prisma.adminUser.findFirstOrThrow();
    await prisma.clientService.update({ where: { id: service.id }, data: { status: "CANCELLED" } });

    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });

    const count = await prisma.billingPeriod.count({ where: { billingPlanId: plan.id } });
    expect(count).toBe(1);
  });

  it("resumes generating future periods once a paused service is reactivated", async () => {
    const { plan, period, service } = await setupServiceWithOpenPeriod();
    const admin = await prisma.adminUser.findFirstOrThrow();
    await prisma.clientService.update({ where: { id: service.id }, data: { status: "PAUSED" } });
    await prisma.clientService.update({ where: { id: service.id }, data: { status: "ACTIVE" } }); // reactivated before payment

    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });

    const count = await prisma.billingPeriod.count({ where: { billingPlanId: plan.id } });
    expect(count).toBe(2); // normal generation resumes once ACTIVE again
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- payments.test`
Expected: FAIL — `Cannot find module '@/lib/payments'`.

- [ ] **Step 3: Implement `src/lib/payments.ts`**

```typescript
import { prisma } from "@/lib/db";
import { nextPeriodLabel, dueDateForPeriod } from "@/lib/billing-dates";
import type { Invoice, BillingPeriod } from "@/generated/prisma/client";

export type MarkPaidInput = {
  billingPeriodId: number;
  amountInPaise: number;
  paidAt: Date;
  recordedByAdminId: number;
};

export type MarkPaidResult =
  | { error: "already_paid" }
  | { invoice: Invoice; period: BillingPeriod };

const INVOICE_NUMBER_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I ambiguity

function generateInvoiceNumber(): string {
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += INVOICE_NUMBER_CHARS[Math.floor(Math.random() * INVOICE_NUMBER_CHARS.length)];
  }
  return `INV-${suffix}`;
}

/**
 * Records a manual payment against a billing period: finds-or-creates the
 * wrapping Invoice, creates a Payment row, marks both the Invoice and the
 * BillingPeriod PAID, and generates the next BillingPeriod (using the
 * BillingPlan's CURRENT amount, not the period's own — a fee change takes
 * effect starting the next cycle). Idempotent: an already-PAID period is
 * rejected, not re-processed.
 *
 * V1 does not reconcile partial/over payments — the admin-entered amount
 * is recorded as-is and the period is marked fully PAID regardless of
 * whether it exactly matches the period's own amountInPaise.
 */
export async function markBillingPeriodPaid(
  input: MarkPaidInput
): Promise<MarkPaidResult> {
  return prisma.$transaction(async (tx) => {
    const period = await tx.billingPeriod.findUniqueOrThrow({
      where: { id: input.billingPeriodId },
      include: {
        billingPlan: { include: { clientService: true } },
        invoiceLineItem: { include: { invoice: true } },
      },
    });

    if (period.status === "PAID") {
      return { error: "already_paid" as const };
    }

    let invoice: Invoice;
    if (period.invoiceLineItem) {
      // Already wrapped in an invoice (e.g. a future "combine invoices"
      // admin action created it ahead of time) — reuse it rather than
      // creating a duplicate. No V1 UI path takes this branch yet, but
      // the schema was built to support it, so the function must too.
      invoice = period.invoiceLineItem.invoice;
    } else {
      invoice = await tx.invoice.create({
        data: {
          clientId: period.billingPlan.clientService.clientId,
          invoiceNumber: generateInvoiceNumber(),
          totalAmountInPaise: period.amountInPaise,
          dueDate: period.dueDate,
        },
      });
      await tx.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          billingPeriodId: period.id,
          amountInPaise: period.amountInPaise,
        },
      });
    }

    await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        recordedByAdminId: input.recordedByAdminId,
        status: "CAPTURED",
        method: "manual",
        amountInPaise: input.amountInPaise,
        capturedAt: input.paidAt,
      },
    });

    await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });
    const paidPeriod = await tx.billingPeriod.update({
      where: { id: period.id },
      data: { status: "PAID" },
    });

    // A paused/cancelled service must never accrue a future obligation —
    // this only matters when its last lingering unpaid period gets settled
    // after the status change (the service itself was already updated
    // elsewhere; this function only ever reads its current status here).
    const serviceIsActive = period.billingPlan.clientService.status === "ACTIVE";
    const nextLabel = serviceIsActive
      ? nextPeriodLabel(period.periodLabel, period.billingPlan.frequency)
      : null;
    if (nextLabel) {
      await tx.billingPeriod.create({
        data: {
          billingPlanId: period.billingPlanId,
          periodLabel: nextLabel,
          amountInPaise: period.billingPlan.amountInPaise,
          dueDate: dueDateForPeriod(nextLabel, period.billingPlan.billingDay),
        },
      });
    }

    return { invoice, period: paidPeriod };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- payments.test`
Expected: `10 passed`.

- [ ] **Step 5: Run full verification**

Run: `npm run build && npm run lint`
Expected: both pass clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add markBillingPeriodPaid (idempotent, transactional payment recording)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: `requireBillingPeriodInOwnOrg` helper + `markPaidAction`

**Files:**
- Create: `src/app/(app)/clients/payment-actions.ts`
- Test: `src/app/(app)/clients/payment-actions.test.ts`

**Interfaces:**
- Consumes: `markBillingPeriodPaid` (Task 1).
- Produces: `requireBillingPeriodInOwnOrg(billingPeriodId: number)` returning `{ admin, period: (BillingPeriod & { billingPlan: { clientService: { client: Client } } }) | null }`; `markPaidAction(billingPeriodId: number, formData: FormData): Promise<{ error: string } | { ok: true }>`. Plan 3's dashboard Mark Paid button also calls `markPaidAction` directly — no new wrapper needed there.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/(app)/clients/payment-actions.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { createClientService } from "@/lib/services";

vi.mock("@/lib/require-admin", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/require-admin";
import { markPaidAction } from "@/app/(app)/clients/payment-actions";

function mockAdmin(organizationId: number, adminId = 1) {
  vi.mocked(requireAdmin).mockResolvedValue({
    id: adminId,
    email: "admin@example.com",
    organizationId,
  });
}

async function setupOpenPeriod(organizationId: number, clientId: number) {
  const service = await createClientService({
    clientId,
    serviceName: "Local SEO",
    feeInPaise: 500000,
    frequency: "MONTHLY",
    billingDay: 5,
    startDate: new Date(Date.UTC(2026, 7, 3)),
    endDate: null,
  });
  const plan = await prisma.billingPlan.findUniqueOrThrow({
    where: { clientServiceId: service.id },
  });
  return prisma.billingPeriod.findFirstOrThrow({ where: { billingPlanId: plan.id } });
}

describe("markPaidAction", () => {
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
    const admin = await prisma.adminUser.create({
      data: { organizationId: orgId, email: "rohit@example.com", passwordHash: "x" },
    });
    adminId = admin.id;
    mockAdmin(orgId, adminId);
  });

  it("marks the period paid and returns ok", async () => {
    const period = await setupOpenPeriod(orgId, clientId);
    const form = new FormData();
    form.set("amountInRupees", "5000");
    form.set("paidAt", "2026-08-04");

    const result = await markPaidAction(period.id, form);

    expect(result).toEqual({ ok: true });
    const updated = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(updated.status).toBe("PAID");
  });

  it("writes a payment.recorded activity row against the client", async () => {
    const period = await setupOpenPeriod(orgId, clientId);
    const form = new FormData();
    form.set("amountInRupees", "5000");
    form.set("paidAt", "2026-08-04");

    await markPaidAction(period.id, form);

    const activity = await prisma.clientActivity.findFirstOrThrow({
      where: { clientId, eventType: "payment.recorded" },
    });
    expect(activity.summary).toContain("5,000");
    expect(activity.actorAdminId).toBe(adminId);
  });

  it("rejects a non-positive amount", async () => {
    const period = await setupOpenPeriod(orgId, clientId);
    const form = new FormData();
    form.set("amountInRupees", "0");
    form.set("paidAt", "2026-08-04");

    const result = await markPaidAction(period.id, form);

    expect(result).toEqual({ error: "Amount must be greater than zero." });
  });

  it("rejects an invalid date", async () => {
    const period = await setupOpenPeriod(orgId, clientId);
    const form = new FormData();
    form.set("amountInRupees", "5000");
    form.set("paidAt", "not-a-date");

    const result = await markPaidAction(period.id, form);

    expect(result).toEqual({ error: "A valid payment date is required." });
  });

  it("returns a friendly error for an already-paid period", async () => {
    const period = await setupOpenPeriod(orgId, clientId);
    const form = new FormData();
    form.set("amountInRupees", "5000");
    form.set("paidAt", "2026-08-04");
    await markPaidAction(period.id, form);

    const secondForm = new FormData();
    secondForm.set("amountInRupees", "5000");
    secondForm.set("paidAt", "2026-08-05");
    const result = await markPaidAction(period.id, secondForm);

    expect(result).toEqual({ error: "This payment has already been recorded." });
  });

  it("returns an error for a billing period in a different organization", async () => {
    const period = await setupOpenPeriod(orgId, clientId);
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    mockAdmin(otherOrg.id);
    const form = new FormData();
    form.set("amountInRupees", "5000");
    form.set("paidAt", "2026-08-04");

    const result = await markPaidAction(period.id, form);

    expect(result).toEqual({ error: "Payment period not found." });
    const untouched = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(untouched.status).toBe("UPCOMING");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- payment-actions.test`
Expected: FAIL — `Cannot find module '@/app/(app)/clients/payment-actions'`.

- [ ] **Step 3: Implement `src/app/(app)/clients/payment-actions.ts`**

```typescript
"use server";

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";
import { markBillingPeriodPaid } from "@/lib/payments";

/**
 * Resolves a billingPeriodId to its owning client, scoped to the
 * authenticated admin's organization. Never throws for a missing/wrong-org
 * id; callers check `period === null`.
 */
export async function requireBillingPeriodInOwnOrg(billingPeriodId: number) {
  const admin = await requireAdmin();
  const period = await prisma.billingPeriod.findFirst({
    where: {
      id: billingPeriodId,
      billingPlan: {
        clientService: {
          client: { organizationId: admin.organizationId },
        },
      },
    },
    include: {
      billingPlan: {
        include: {
          clientService: { include: { client: true } },
        },
      },
    },
  });
  return { admin, period };
}

export async function markPaidAction(
  billingPeriodId: number,
  formData: FormData
): Promise<{ error: string } | { ok: true }> {
  const { admin, period } = await requireBillingPeriodInOwnOrg(billingPeriodId);
  if (!period) {
    return { error: "Payment period not found." };
  }

  const amountInRupees = Number(formData.get("amountInRupees"));
  if (!Number.isFinite(amountInRupees) || amountInRupees <= 0) {
    return { error: "Amount must be greater than zero." };
  }

  const paidAtRaw = String(formData.get("paidAt") ?? "");
  const paidAt = new Date(paidAtRaw);
  if (Number.isNaN(paidAt.getTime())) {
    return { error: "A valid payment date is required." };
  }

  const amountInPaise = Math.round(amountInRupees * 100);
  const result = await markBillingPeriodPaid({
    billingPeriodId,
    amountInPaise,
    paidAt,
    recordedByAdminId: admin.id,
  });

  if ("error" in result) {
    return { error: "This payment has already been recorded." };
  }

  await prisma.clientActivity.create({
    data: {
      clientId: period.billingPlan.clientService.clientId,
      actorAdminId: admin.id,
      eventType: "payment.recorded",
      summary: `Payment of ₹${amountInRupees.toLocaleString("en-IN")} recorded for ${period.periodLabel}.`,
    },
  });

  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- payment-actions.test`
Expected: `6 passed`.

- [ ] **Step 5: Run full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all pass clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add markPaidAction and requireBillingPeriodInOwnOrg helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: `updateWorkStatusAction`

**Files:**
- Modify: `src/app/(app)/clients/service-actions.ts` (add the action; this file already has `requireClientServiceInOwnOrg` from Plan 1)
- Modify: `src/app/(app)/clients/service-actions.test.ts` (extend)

**Interfaces:**
- Consumes: `requireClientServiceInOwnOrg` (Plan 1).
- Produces: `updateWorkStatusAction(clientServiceId: number, formData: FormData): Promise<{ error: string } | { ok: true }>`.

- [ ] **Step 1: Add the failing tests**

```typescript
// append to src/app/(app)/clients/service-actions.test.ts
import { updateWorkStatusAction } from "@/app/(app)/clients/service-actions";

describe("updateWorkStatusAction", () => {
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
    // createServiceAction (below) writes a ClientActivity row under a real
    // FK to admin_users (added in Plan 1's Task 1 migration), and this
    // block's own updateWorkStatusAction calls do too whenever workStatus
    // actually changes — mockAdmin alone only stubs requireAdmin()'s
    // return value, it doesn't create a backing row. A real AdminUser is
    // required here (Plan 1's Task 4 review surfaced this exact gap —
    // same fix applied consistently wherever a mocked admin authors an
    // activity row).
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

  it("updates work status, progress, note, and next action", async () => {
    const form = new FormData();
    form.set("workStatus", "IN_PROGRESS");
    form.set("progressPercent", "70");
    form.set("workNote", "Backlinks in progress");
    form.set("nextActionNote", "Send monthly report");
    form.set("nextActionDate", "2026-09-01");

    const result = await updateWorkStatusAction(clientServiceId, form);

    expect(result).toEqual({ ok: true });
    const service = await prisma.clientService.findUniqueOrThrow({
      where: { id: clientServiceId },
    });
    expect(service.workStatus).toBe("IN_PROGRESS");
    expect(service.progressPercent).toBe(70);
    expect(service.workNote).toBe("Backlinks in progress");
    expect(service.nextActionNote).toBe("Send monthly report");
    expect(service.nextActionDate?.toISOString().slice(0, 10)).toBe("2026-09-01");
  });

  it("allows clearing optional fields by submitting them empty", async () => {
    const form = new FormData();
    form.set("workStatus", "COMPLETED");
    form.set("progressPercent", "100");
    form.set("workNote", "");
    form.set("nextActionNote", "");
    form.set("nextActionDate", "");

    const result = await updateWorkStatusAction(clientServiceId, form);

    expect(result).toEqual({ ok: true });
    const service = await prisma.clientService.findUniqueOrThrow({
      where: { id: clientServiceId },
    });
    expect(service.workNote).toBeNull();
    expect(service.nextActionDate).toBeNull();
  });

  it("rejects an invalid work status", async () => {
    const form = new FormData();
    form.set("workStatus", "BLOCKED");
    form.set("progressPercent", "50");

    const result = await updateWorkStatusAction(clientServiceId, form);

    expect(result).toEqual({ error: "Invalid work status." });
  });

  it("rejects a progress percent outside 0-100", async () => {
    const form = new FormData();
    form.set("workStatus", "IN_PROGRESS");
    form.set("progressPercent", "150");

    const result = await updateWorkStatusAction(clientServiceId, form);

    expect(result).toEqual({ error: "Progress must be between 0 and 100." });
  });

  it("allows an empty progress percent (it is optional)", async () => {
    const form = new FormData();
    form.set("workStatus", "NOT_STARTED");
    form.set("progressPercent", "");

    const result = await updateWorkStatusAction(clientServiceId, form);

    expect(result).toEqual({ ok: true });
    const service = await prisma.clientService.findUniqueOrThrow({
      where: { id: clientServiceId },
    });
    expect(service.progressPercent).toBeNull();
  });

  it("returns an error for a service in a different organization", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    mockAdmin(otherOrg.id);
    const form = new FormData();
    form.set("workStatus", "IN_PROGRESS");
    form.set("progressPercent", "50");

    const result = await updateWorkStatusAction(clientServiceId, form);

    expect(result).toEqual({ error: "Service not found." });
  });

  it("logs activity when the work status actually changes", async () => {
    const form = new FormData();
    form.set("workStatus", "IN_PROGRESS"); // service starts at NOT_STARTED
    form.set("progressPercent", "10");

    await updateWorkStatusAction(clientServiceId, form);

    const activity = await prisma.clientActivity.findFirstOrThrow({
      where: { eventType: "service.work_updated" },
    });
    expect(activity.summary.toLowerCase()).toContain("in progress");
  });

  it("does not log activity when the work status is unchanged (only progress/notes updated)", async () => {
    const firstForm = new FormData();
    firstForm.set("workStatus", "IN_PROGRESS");
    firstForm.set("progressPercent", "10");
    await updateWorkStatusAction(clientServiceId, firstForm);
    const countAfterFirst = await prisma.clientActivity.count({
      where: { eventType: "service.work_updated" },
    });

    const secondForm = new FormData();
    secondForm.set("workStatus", "IN_PROGRESS"); // same status as before
    secondForm.set("progressPercent", "40"); // only progress changes
    await updateWorkStatusAction(clientServiceId, secondForm);

    const countAfterSecond = await prisma.clientActivity.count({
      where: { eventType: "service.work_updated" },
    });
    expect(countAfterSecond).toBe(countAfterFirst); // no new entry
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- service-actions.test`
Expected: FAIL — `updateWorkStatusAction is not a function`.

- [ ] **Step 3: Implement `updateWorkStatusAction`**

Add to `src/app/(app)/clients/service-actions.ts`:

```typescript
import type { WorkStatus } from "@/generated/prisma/client";

const VALID_WORK_STATUSES: WorkStatus[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETED",
  "ON_HOLD",
];

export async function updateWorkStatusAction(
  clientServiceId: number,
  formData: FormData
): Promise<{ error: string } | { ok: true }> {
  const { clientService } = await requireClientServiceInOwnOrg(clientServiceId);
  if (!clientService) {
    return { error: "Service not found." };
  }

  const workStatus = String(formData.get("workStatus"));
  if (!VALID_WORK_STATUSES.includes(workStatus as WorkStatus)) {
    return { error: "Invalid work status." };
  }

  const progressRaw = String(formData.get("progressPercent") ?? "").trim();
  let progressPercent: number | null = null;
  if (progressRaw) {
    const parsed = Number(progressRaw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      return { error: "Progress must be between 0 and 100." };
    }
    progressPercent = Math.round(parsed);
  }

  const workNote = optionalString(formData, "workNote");
  const nextActionNote = optionalString(formData, "nextActionNote");
  const nextActionDateRaw = String(formData.get("nextActionDate") ?? "").trim();
  const nextActionDate = nextActionDateRaw ? new Date(nextActionDateRaw) : null;
  if (nextActionDate && Number.isNaN(nextActionDate.getTime())) {
    return { error: "Next action date is invalid." };
  }

  const { admin } = await requireClientServiceInOwnOrg(clientServiceId);

  await prisma.clientService.update({
    where: { id: clientServiceId },
    data: {
      workStatus: workStatus as WorkStatus,
      progressPercent,
      workNote,
      nextActionNote,
      nextActionDate,
    },
  });

  // Matches the established "only log when something actually changed"
  // convention (Foundation's updateClientAction) — a status change is
  // the one field worth a headline activity summary; progress/notes are
  // visible directly on the service row without needing their own entries.
  if (workStatus !== clientService.workStatus) {
    await prisma.clientActivity.create({
      data: {
        clientId: clientService.clientId,
        actorAdminId: admin.id,
        eventType: "service.work_updated",
        summary: `Work status changed to ${workStatus.replace("_", " ")}.`,
      },
    });
  }

  return { ok: true };
}
```

`optionalString` is already defined (module-private) in this file from Plan 1's Task 4 — reuse it, don't redefine it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- service-actions.test`
Expected: all pass (14 from Plan 1 + 8 new = 22).

- [ ] **Step 5: Run full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all pass clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add updateWorkStatusAction

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Mark Paid UI on the client detail page's service row

**Files:**
- Modify: `src/lib/clients.ts` (extend `getClientById`'s billing-period `select`/`include` — it currently only fetches `id, periodLabel, ...` implicitly via full row; confirm `id` is present for the Mark Paid button, no query change needed if Plan 1's Task 6 already selected full rows — verify, don't assume)
- Modify: `src/components/clients/ServicesPanel.tsx`

**Interfaces:**
- Consumes: `markPaidAction` (Task 2).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Verify the existing query already exposes what this task needs**

Read `src/lib/clients.ts`'s `getClientById` (extended by Plan 1's Task 6). Confirm `billingPeriods` there returns full `BillingPeriod` rows (including `id`, `dueDate`, `amountInPaise`, `status`) — Prisma's `include` without a nested `select` returns all scalar columns by default, so this should already be true. If for any reason it is not (e.g. someone added a `select` narrowing it), widen it to include at least `id`, `dueDate`, `amountInPaise`, `status`. No test changes needed if the existing test from Plan 1 Task 6 already passes with this shape — only touch the query if you find it's actually missing something.

- [ ] **Step 2: Add the Mark Paid form to `ServicesPanel.tsx`**

Modify `ServiceRow` in `src/components/clients/ServicesPanel.tsx` to add an expandable Mark Paid form, following the same expand/collapse pattern as `AddServiceForm` (Plan 1). Replace the existing `ServiceRow` function with:

```tsx
function ServiceRow({ service }: { service: ServiceWithBilling }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [markPaidError, setMarkPaidError] = useState<string | null>(null);

  const period = service.billingPlan?.billingPeriods[0];
  const feeInRupees = (service.feeInPaise / 100).toLocaleString("en-IN");
  const isPaid = period?.status === "PAID";

  function handleStatusChange(next: "ACTIVE" | "PAUSED" | "CANCELLED") {
    startTransition(async () => {
      await updateServiceStatusAction(service.id, next);
      router.refresh();
    });
  }

  async function handleMarkPaid(formData: FormData) {
    if (!period) return;
    const result = await markPaidAction(period.id, formData);
    if ("error" in result) {
      setMarkPaidError(result.error);
      return;
    }
    setMarkPaidError(null);
    setShowMarkPaid(false);
    router.refresh();
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
            {" · "}
            {isPaid ? "Paid" : "Next due"}{" "}
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
          {period && !isPaid && (
            <button
              type="button"
              onClick={() => setShowMarkPaid((v) => !v)}
              className="rounded-md bg-neutral-900 px-2 py-1 text-white hover:bg-neutral-800"
            >
              Mark Paid
            </button>
          )}
        </div>
      )}
      {showMarkPaid && period && (
        <form
          action={handleMarkPaid}
          className="mt-3 flex items-end gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
        >
          {markPaidError && (
            <p className="w-full text-xs text-red-600">{markPaidError}</p>
          )}
          <div>
            <label className="mb-1 block text-xs text-neutral-600" htmlFor={`amount-${period.id}`}>
              Amount (₹)
            </label>
            <input
              id={`amount-${period.id}`}
              name="amountInRupees"
              type="number"
              defaultValue={period.amountInPaise / 100}
              required
              className="w-28 rounded-lg border border-neutral-300 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-600" htmlFor={`paidAt-${period.id}`}>
              Date
            </label>
            <input
              id={`paidAt-${period.id}`}
              name="paidAt"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
              className="rounded-lg border border-neutral-300 px-2 py-1 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setShowMarkPaid(false)}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Cancel
          </button>
        </form>
      )}
    </li>
  );
}
```

Add the import at the top of the file:

```typescript
import { markPaidAction } from "@/app/(app)/clients/payment-actions";
```

- [ ] **Step 3: Run full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all pass clean.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Mark Paid form to the client detail page's service rows

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: Work status quick-update UI

**Files:**
- Modify: `src/components/clients/ServicesPanel.tsx`

**Interfaces:**
- Consumes: `updateWorkStatusAction` (Task 3).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Add an inline work-status editor to `ServiceRow`**

Extend `ServiceRow` further (building on Task 4's version) — replace the static work-status line with an expandable editor, same expand/collapse convention as Mark Paid:

```tsx
// Add to the ServiceRow component's state (alongside showMarkPaid, markPaidError):
const [showWorkForm, setShowWorkForm] = useState(false);
const [workError, setWorkError] = useState<string | null>(null);

// Add this handler alongside handleMarkPaid:
async function handleWorkUpdate(formData: FormData) {
  const result = await updateWorkStatusAction(service.id, formData);
  if ("error" in result) {
    setWorkError(result.error);
    return;
  }
  setWorkError(null);
  setShowWorkForm(false);
  router.refresh();
}
```

Replace the existing static work-status `<div>` with a clickable version plus the expandable form:

```tsx
<button
  type="button"
  onClick={() => setShowWorkForm((v) => !v)}
  className="mt-1 block text-neutral-500 hover:text-neutral-900"
>
  Work: {service.workStatus.replace("_", " ")}
  {service.progressPercent != null && ` — ${service.progressPercent}%`}
  {service.workNote && ` · ${service.workNote}`}
</button>

{showWorkForm && (
  <form
    action={handleWorkUpdate}
    className="mt-2 space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
  >
    {workError && <p className="text-xs text-red-600">{workError}</p>}
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label className="mb-1 block text-xs text-neutral-600" htmlFor={`status-${service.id}`}>
          Status
        </label>
        <select
          id={`status-${service.id}`}
          name="workStatus"
          defaultValue={service.workStatus}
          className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
        >
          <option value="NOT_STARTED">Not Started</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="ON_HOLD">On Hold</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-600" htmlFor={`progress-${service.id}`}>
          Progress %
        </label>
        <input
          id={`progress-${service.id}`}
          name="progressPercent"
          type="number"
          min={0}
          max={100}
          defaultValue={service.progressPercent ?? ""}
          className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
        />
      </div>
    </div>
    <div>
      <label className="mb-1 block text-xs text-neutral-600" htmlFor={`note-${service.id}`}>
        Current note
      </label>
      <input
        id={`note-${service.id}`}
        name="workNote"
        type="text"
        defaultValue={service.workNote ?? ""}
        className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
      />
    </div>
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label className="mb-1 block text-xs text-neutral-600" htmlFor={`next-note-${service.id}`}>
          Next action
        </label>
        <input
          id={`next-note-${service.id}`}
          name="nextActionNote"
          type="text"
          defaultValue={service.nextActionNote ?? ""}
          className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs text-neutral-600" htmlFor={`next-date-${service.id}`}>
          Next action date
        </label>
        <input
          id={`next-date-${service.id}`}
          name="nextActionDate"
          type="date"
          defaultValue={service.nextActionDate ? new Date(service.nextActionDate).toISOString().slice(0, 10) : ""}
          className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
        />
      </div>
    </div>
    <div className="flex gap-2">
      <button
        type="submit"
        className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => setShowWorkForm(false)}
        className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
      >
        Cancel
      </button>
    </div>
  </form>
)}
```

Add the import at the top of the file:

```typescript
import { updateWorkStatusAction } from "@/app/(app)/clients/service-actions";
```

- [ ] **Step 2: Run full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all pass clean.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add work status quick-update form to service rows

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Plan-level manual verification (do this once, after Task 5)

1. `npm run dev`, open a client with a service created via Plan 1.
2. Click "Mark Paid" → confirm the amount/date fields pre-fill sensibly → Confirm.
3. Confirm the service row immediately updates to show "Paid [date]" and the payment succeeded without a full reload.
4. Reload the page and open the service again — confirm a NEW upcoming period now shows as the next due date, one billing cycle after the one just paid.
5. Click Mark Paid again on that same (now-current) period, but first open two browser tabs and click Confirm in both in quick succession — confirm only one payment gets recorded (check `mysql -u root clientos_dev -e "SELECT COUNT(*) FROM payments;"` shows exactly 1, not 2) — this is the idempotency guarantee in practice, not just in tests.
6. Click the work-status line → change status to "In Progress," set progress to 70%, add a note → Save → confirm it displays immediately.
7. Confirm the client's Activity panel now shows both the `payment.recorded` entry and a `service.work_updated` entry for the status change (Task 3 only logs when `workStatus` itself changes — updating just progress/notes without changing the status produces no new activity entry, by design).
