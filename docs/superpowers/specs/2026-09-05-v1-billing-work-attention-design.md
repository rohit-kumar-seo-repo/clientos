# ClientOS V1 — Client Services, Recurring Billing, Work Status, Attention Engine

Status: approved by Rohit 2026-09-05, extends the Foundation design
(`2026-09-03-clientos-design.md`). Foundation itself (auth, sessions,
app shell, client CRUD/contacts/notes/activity) is complete, reviewed,
and **not touched by this spec** — every decision here is additive.

## Scope

V1 answers one question when the app opens: *"What clients need my
attention right now, what work is being done, and who needs to pay
me?"* It is a client-services + recurring-payment-tracking + lightweight
work-status system with a deterministic attention/priority dashboard.
It is explicitly **not** an accounting platform, invoicing product,
project-management tool, or CRM — see "Out of scope" below.

## What already exists and is reused as-is

Phase 1 (2026-09-03) designed a full billing/invoicing schema that
Foundation never wired up: `ServiceTemplate`, `ServiceTemplateTask`,
`ClientService`, `BillingPlan`, `BillingPeriod`, `Invoice`,
`InvoiceLineItem`, `Payment`, `Refund`, `WebhookEvent`, `Renewal`. V1
reuses this schema's core structure unchanged:

- **Billing is per-`ClientService`**, not per-`Client` — each service
  keeps its own fee, frequency, and billing day (§8 of the Foundation
  spec's example: Local SEO due the 5th, Website SEO due the 15th,
  same client).
- **`BillingPeriod` is the immutable obligation; `Invoice`+`Payment` is
  the collection instrument.** A manual "Mark Paid" (V1's only payment
  path) creates an `Invoice` (one line item, this period) and a
  `Payment` row exactly the way a future Razorpay webhook will —
  the two paths converge on the same tables, so wiring up Razorpay
  later needs zero schema change and no migration of historical data.
- **`WebhookEvent`'s idempotency ledger and `Payment`'s
  `razorpayOrderId`/`razorpayPaymentId`/`razorpaySignature` columns
  stay dormant**, exactly prepared, until a future Razorpay phase.
- **`Renewal` stays dormant.** V1 renewal visibility uses
  `ClientService.endDate` directly (see "Renewals" below) — the fuller
  `Renewal` workflow (contract duration, `RENEWAL_DISCUSSION` etc.) is
  more machinery than V1 needs and is left for if/when it's wanted.
- **`ServiceTemplate`** becomes the small, implicit service catalog:
  adding a service to a client finds-or-creates a template by name
  within the organization (case-insensitive match on `name`) rather
  than requiring a separate "manage service templates" screen. Typing
  "Local SEO" for a second client reuses the same template row.

## Schema changes (all additive, no existing column touched)

```prisma
enum BillingFrequency {
  MONTHLY
  QUARTERLY
  HALF_YEARLY   // NEW
  YEARLY
  ONE_TIME
}

// NEW enum
enum WorkStatus {
  NOT_STARTED
  IN_PROGRESS
  COMPLETED
  ON_HOLD
}

model ClientService {
  // ...existing fields unchanged (id, clientId, serviceTemplateId,
  // feeInPaise, startDate, status, createdAt, updatedAt)...

  endDate         DateTime?    // NEW, optional — also V1's renewal signal
  workStatus      WorkStatus   @default(NOT_STARTED)  // NEW
  progressPercent Int?         // NEW, 0-100, optional
  workNote        String?      @db.VarChar(500)        // NEW, optional
  nextActionNote  String?      @db.VarChar(255)         // NEW, optional
  nextActionDate  DateTime?    // NEW, optional — drives attention tier 6
}

model ClientActivity {
  // ...existing fields unchanged...
  actorAdminId Int?   // NEW — nobody currently records *who* did an
                       // activity; needed to answer "who marked this paid"
  // relation: actorAdmin AdminUser? @relation(fields: [actorAdminId], references: [id])
}

model Payment {
  // ...existing fields unchanged...
  recordedByAdminId Int?  // NEW — set for a manual "Mark Paid" entry,
                          // null for a future webhook-driven payment,
                          // so the two are always distinguishable
  // relation: recordedByAdmin AdminUser? @relation(fields: [recordedByAdminId], references: [id])
}
```

No other model changes. `BillingPeriodStatus`, `InvoiceStatus`,
`PaymentStatus` keep every existing value (V1 only ever *produces*
`UPCOMING`/`PAID` on `BillingPeriod` and `DUE`/`PAID` on `Invoice` and
`CAPTURED` on `Payment` — the other values stay available, unused,
for refunds/partial-payments/failures whenever that's built).

## Billing period lifecycle (no scheduler)

`BillingPeriod.status` only ever transitions `UPCOMING → PAID` (or, via
an explicit future admin action not built in V1, `→ CANCELLED`). It is
**never** advanced through a `DUE`/`DUE_TODAY`/`OVERDUE` sequence by a
background job — there is no scheduler in this system. Instead:

- **"Upcoming / Due Today / Due in N days / Overdue"** is computed
  live, every time it's read, purely from `dueDate` vs. `today()` for
  any period whose `status` is not `PAID`. This is a pure function,
  colocated with the priority engine (see below) — never a stored,
  cacheable value.
- **The first `BillingPeriod` for a `ClientService`** is created
  synchronously when its `BillingPlan` is created (already Foundation
  spec's principle, restated here since V1 is the first thing to
  actually exercise it).
- **The next `BillingPeriod`** is created synchronously, in the same
  transaction, the moment the current one is marked `PAID` — matching
  Rohit's own example exactly ("when September is marked Paid, next
  payment automatically becomes October 5"). There is deliberately no
  path that creates a period ahead of the previous one being paid: an
  unpaid client shows one aging, increasingly-overdue period, not a
  pile of newly-generated future ones. `ONE_TIME` frequency never
  generates a next period.
- **Next-period date math** (add 1/3/6/12 months per
  `MONTHLY`/`QUARTERLY`/`HALF_YEARLY`/`YEARLY` to the *previous
  period's `dueDate`*, not to "today") clamps to the shorter month's
  last day when the billing day doesn't exist there (a `billingDay` of
  31 on a service due at the end of a 30-day or 28/29-day month lands
  on that month's actual last day, then resumes on `billingDay` the
  next month it exists — standard "clamp, don't roll over" semantics).
  This is the single most edge-case-prone piece of V1 and gets the
  heaviest test coverage (leap years, end-of-month billing days,
  every frequency).

## Manual payment recording ("Mark Paid")

One transaction, given a `BillingPeriod` that is not yet `PAID`:

1. Find or create its `Invoice` (one line item wrapping this period —
   V1 never combines periods into one invoice; that capability already
   exists in the schema for later, unused here).
2. Create a `Payment` row: `status: CAPTURED`, `method: "manual"`,
   `amountInPaise` (defaults to the period's amount, admin-editable),
   `capturedAt` (defaults to today, admin-editable),
   `recordedByAdminId: admin.id`.
3. Set `Invoice.status = PAID`, `BillingPeriod.status = PAID`.
4. Generate the next `BillingPeriod` (skip for `ONE_TIME`).
5. Write a `ClientActivity` row (`eventType: "payment.recorded"`,
   `actorAdminId: admin.id`).

Idempotency: a `BillingPeriod` already `PAID` cannot be marked paid
again (the action re-checks status inside the transaction and returns
an error rather than double-processing — the DB-state check, not a
client-side disabled-button, is the actual guard).

## Work status

Four states (`NOT_STARTED`/`IN_PROGRESS`/`COMPLETED`/`ON_HOLD`) plus an
optional 0-100 `progressPercent`, an optional free-text `workNote`
("current note"), and an optional `nextActionNote`+`nextActionDate`
pair ("next action/date"). Updated from the client detail page's
service row directly — no separate work-management screen, no task
list, no subtasks. `ON_HOLD` is a legitimate, intentional state and
carries no automatic urgency (see Attention Engine below) — a paused
service is not by itself something requiring Rohit's attention.

## Attention/priority engine

A pure function — no stored priority field anywhere — computed from
current DB state at request time, one rank per active `ClientService`:

```
1. Overdue payment            (has an unpaid period, dueDate < today)
2. Payment due today          (dueDate == today)
3. Payment due tomorrow       (dueDate == today + 1)
4. Payment due within 3 days  (today < dueDate <= today + 3)
5. Payment due within 7 days  (today < dueDate <= today + 7)
6. Overdue work                (not in tiers 1-5, AND
                                 nextActionDate < today)
7. Upcoming renewal            (not in tiers 1-6, AND
                                 endDate is within the next 30 days)
8. Normal upcoming work        (not in tiers 1-7, AND (has an unpaid
                                 period due more than 7 days out OR
                                 workStatus is NOT_STARTED, IN_PROGRESS,
                                 or ON_HOLD))
9. No action required          (not in tiers 1-8 — current period PAID
                                 or no period at all, workStatus is
                                 COMPLETED or unset, no near-term
                                 endDate)
```

Each tier's condition is evaluated only after every higher tier has
been ruled out ("not in tiers 1-N") — a service matches exactly one
tier, the first one (in this order) it satisfies. This removes any
double-counting ambiguity between tiers 6-9.

Tie-break within a tier: (1) longest overdue first — largest
`today - dueDate`; (2) highest outstanding `amountInPaise`; (3)
nearest `dueDate`. `ON_HOLD` never independently elevates a service's
tier — it only ever appears in the UI as the displayed work status.

This function operates on `ClientService`, not `Client` — a client
with three services can have three separate rows at three different
tiers (matches the dashboard's row-per-service examples).

## Dashboard

Rebuilds the current `ComingSoon` Overview page into three sections,
matching the visual reference exactly (white cards, restrained status
badges, no gradients/charts):

1. **Attention summary** — small stat cards: Overdue payments, Due
   today, Due soon (tomorrow through 7 days, collapsed into one card),
   Work requiring attention, Upcoming renewals (only shown if
   non-zero, per "if available").
2. **Client Attention List** — table, columns Client / Service /
   Payment / Work Status / Due Date / Action, sorted by the priority
   engine, `[Mark Paid]` (only shown when a payment is actually owed)
   and `[View]` per row.
3. **Monthly summary** — Expected / Collected / Pending / Overdue for
   the current calendar month, computed from `BillingPeriod`/`Payment`
   rows whose period falls in it. No hardcoded numbers anywhere.

No calendar widget, no "Quick Actions," no "Upcoming Reminders" panel
— none of those have real functionality behind them yet in V1's
feature list, and building the UI chrome for them would be exactly the
"extra features simply because they're technically possible" the brief
warns against.

## Client detail page

Extends the existing Overview/Contacts/Notes/Activity sections
(untouched) with:

- **Services** — one row per `ClientService`: name, status, price,
  frequency, next payment due date + amount, payment state badge, work
  status + progress, inline quick-update for work status/progress.
- **Payment history** — every `Payment` across the client's services,
  newest first, read-only.

The existing Activity timeline is reused unchanged — `payment.recorded`
and `service.added`/`service.updated` events flow into the same
`ClientActivity` feed contacts/notes already use.

## Renewals

`ClientService.endDate`, when set, surfaces on the client detail page
next to that service and (if within 30 days) on the dashboard as tier
7. No renewal status field, no renewal-discussion workflow — exactly
the "very simple" version asked for.

## Razorpay boundary (unbuilt, but load-bearing for later)

Nothing server-side calls Razorpay in V1. The boundary that keeps this
safe to add later without a redesign: `Payment` is already the single
table any payment — manual or Razorpay — writes to, and
`WebhookEvent` already exists as the idempotency ledger a future
webhook handler needs. When that phase happens, it adds a webhook
route and an order-creation call; it does not touch this phase's
schema or its manual-payment code path.

## Security (restates Foundation's established pattern, extended)

Every new server action (`createServiceAction`, `markPaidAction`,
`updateWorkStatusAction`, etc.) calls `requireAdmin()` (or the
`requireClientInOwnOrg`-style helper) internally and re-verifies
organization + client + service ownership from the DB — never trusts
an `organizationId`/`clientId`/`serviceId` argument at face value, per
Foundation's hard-won §8 fix. A new `requireClientServiceInOwnOrg`
helper (parallel to the existing `requireClientInOwnOrg`) resolves a
`clientServiceId` to its owning client/org in one query.

## Out of scope (explicitly deferred)

Full invoice UI, accounting/financial reports beyond the monthly
summary, WhatsApp/email/SMS of any kind, Jira-style task/project
management, an AI assistant, multi-role permissions, partial-payment
reconciliation, combined-invoice UI (schema supports it, no UI in V1),
the `Renewal` model's fuller workflow, any background job scheduler.
