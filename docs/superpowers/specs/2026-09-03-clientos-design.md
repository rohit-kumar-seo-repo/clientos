# ClientOS — Architecture & Database Design

Status: approved by Rohit (design), scaffold built and committed 2026-09-03.
Founding brief: the full 39-section product brief lives in chat history for
this build; this doc distills it into an implementable architecture.

## Scope

Internal tool for Rohit's marketing/SEO agency clients only — billing,
recurring work, reminders, renewals. **Not** a generic CRM, **not** an
AI assistant, and **hard-separate** from `digital-products-bundle` (a
different business, digitalproductsbundle.in): own repo, own database,
own Razorpay keys, own subdomain (`clientos.rohitkumarseo.com`). Only
architectural *patterns* are reused from that sibling project — never its
data or deploy target.

## Stack & hosting

- Next.js 16 (App Router, TypeScript, Tailwind 4)
- MySQL + Prisma 7 (driver-adapter pattern via `@prisma/adapter-mariadb`)
- Razorpay (Orders for one-time billing periods; Subscriptions not used —
  billing periods are generated and reconciled by ClientOS itself, not
  driven by Razorpay's subscription engine, so a fee change or paused
  service doesn't require juggling a live Razorpay subscription object)
- Nodemailer direct SMTP for email reminders
- Target: Hostinger shared hosting (Business plan), own site/subdomain,
  own MySQL database — chosen over Vercel+Supabase because Postgres isn't
  available on the account's plan (verified live via the Hostinger API
  for the sibling project) and this avoids standing up new infrastructure
  for a single-admin internal tool

## Multi-tenant readiness

Every business-owned table carries `organizationId`. V1 has exactly one
`Organization` row and no org-switcher UI, no invite flow, no roles — this
satisfies §22's "architect for it, don't build the UI for it."

## Domain model

See `prisma/schema.prisma` (fully commented) for the authoritative field-level
definitions. Summary by area:

- **Org/Auth** — `Organization`, `OrganizationSettings` (the global
  communication switch), `AdminUser`, `AdminSession` (DB-backed, revocable),
  `AuditLog`.
- **Clients** — `Client`, `ClientContact`, `ClientNote`, `ClientActivity`
  (the timeline).
- **Services & work** — `ServiceTemplate` + `ServiceTemplateTask` (editable,
  reusable per §17), `ClientService` (a client's subscription to a template,
  carries its own fee), `TaskInstance` (generated per period, historical
  instances never mutated per §18).
- **Billing (obligation)** — `BillingPlan` (1:1 with a `ClientService` —
  frequency, amount, billing day) → `BillingPeriod` rows (one per
  Aug/Sep/Oct…, each with its own status). Immutable/auditable per §36 —
  generation never edits a past period, and a fee change only affects
  periods generated after it.
- **Billing (collection)** — `Invoice` (client-level, one or more
  `BillingPeriod`s via `InvoiceLineItem`) → `Payment` rows (one per
  Razorpay attempt, against the invoice, never overwritten) → `Refund`.
  `WebhookEvent` is the idempotency ledger keyed on Razorpay's own event id.
  See "Invoicing" below for why this is a separate layer from
  `BillingPeriod`.
- **Renewals** — `Renewal`, states exactly as listed in §19.
- **Reminders** — `ReminderRule` (per client or per client-service, offset +
  channel + mode), `ReminderJob` (a scheduled instance against one billing
  period or one renewal), `NotificationLog` (what was actually sent).

## Priority engine

A pure function computed at read time — never a stored field, so it can't
go stale. Input: today's date + a client's billing periods + task instances
+ renewal date. Output: a rank per §4 (overdue → due today → due tomorrow →
due in 3 days → due in 7 days → important overdue work → renewal upcoming →
normal work → none), tie-broken by longest-overdue → highest-amount →
nearest-deadline. Both the dashboard's "Clients Requiring Attention" table
and every filtered list (Overdue, Due Today, …) call through this one
function — no separate sort logic duplicated per view.

## Billing lifecycle (obligation)

`BillingPeriod.status` transitions are computed automatically except two
which are only ever set by a trusted, signature-verified Razorpay webhook
event (`PAID`) or an explicit admin action (`REFUNDED`, `CANCELLED`):

```
UPCOMING → DUE → DUE_TODAY → OVERDUE      (date-driven, computed on read)
       ↘ PARTIALLY_PAID ↗
DUE/DUE_TODAY/OVERDUE → PAID              (webhook-driven only)
any → FAILED / REFUNDED / CANCELLED       (webhook or explicit admin action)
```

As of the invoice layer below, a period's `PAID`/`PARTIALLY_PAID`
transition is triggered by its **invoice** reaching that state, not by a
payment recorded directly against the period — see "Invoicing."

Client-side payment status is never trusted (§9). A period generation job
(cron-triggered) creates the next `BillingPeriod` when the current one's
`dueDate` has passed, using `BillingPlan.billingDay`/`frequency` — it never
edits a past period. The *first* `BillingPeriod` is created synchronously
when the `BillingPlan` itself is created (client onboarded onto a service),
not deferred to the next cron run — a new client should never show as
"no billing" simply because the daily job hasn't run yet.

`BillingPeriod.amountInPaise` is snapshotted from `BillingPlan.amountInPaise`
at generation time, not read live from the plan — so changing a client's fee
only affects periods generated after the change, and every past period keeps
the amount that was actually billed (§36: never rewrite historical financial
records).

## Invoicing (collection) — obligation vs. collection, kept separate

Rohit's requirement: a client can have several services each billed
independently (different fee/frequency/billing day), but payment
*collection* should optionally be combinable into one invoice without ever
touching the underlying per-service records. This is a real structural
addition on top of the original design, not just a naming change:

- `BillingPeriod` stays exactly what it was — the immutable, per-service
  obligation. It is never billed twice: `InvoiceLineItem.billingPeriodId`
  is `@unique`, so a period can belong to **at most one** invoice — this
  makes "never duplicate financial records when combining invoices" a
  schema-level guarantee, not a policy someone has to remember.
- `Invoice` is the collection instrument: `clientId` + one or more
  `InvoiceLineItem`s, each pointing at exactly one `BillingPeriod` and
  snapshotting its amount. `totalAmountInPaise` is the sum at creation
  time, not recomputed live.
- `Payment` moved from `BillingPeriod` to `Invoice` — one Razorpay order
  now settles the whole invoice, whether that invoice wraps one service's
  period (the default) or several.
- The relationship from an invoice line item back to its billing period is
  a direct FK, never inferred — so "which service does this ₹22,000
  payment cover, and how much of it was Local SEO vs. Website SEO" is
  always a straight join, never a reconstruction.
- Dashboard reads: **service-level** detail reads `BillingPeriod` (+ its
  `BillingPlan`/`ClientService`) directly, unaffected by invoicing.
  **Client-total-outstanding** sums `BillingPeriod.amountInPaise` for
  periods in DUE/DUE_TODAY/OVERDUE/PARTIALLY_PAID across all the client's
  services — also independent of how (or whether) they've been invoiced
  yet.

**Two default policies I'm adopting — flag if you want different behavior:**

1. **When an invoice gets created.** Default: the daily billing job
   auto-creates a single-line-item `Invoice` for a `BillingPeriod` the
   moment it becomes `DUE`, *unless* that period already has an
   `InvoiceLineItem` (meaning you pre-emptively bundled it into a combined
   invoice earlier — e.g. combining a period that's due in a few days
   together with one that's due today). Combining is always an explicit
   admin action ("create combined invoice," pick 2+ of a client's currently
   due/upcoming periods); it's never automatic.
2. **Partial payment on a combined invoice.** Which service's period counts
   as "paid" when ₹15,000 comes in against a ₹22,000 combined invoice is a
   business call, not something I'll silently decide. V1 default: the
   invoice moves to `PARTIALLY_PAID`; none of its underlying periods change
   status automatically. Full payment (captured amount == invoice total)
   cascades `PAID` to every linked period in the same transaction. Manual
   reconciliation (an admin explicitly marks which specific period(s) a
   partial payment covers) is a Phase 5 UI action, not inferred by the
   system.

## Webhook processing

Razorpay → `/api/webhooks/razorpay` → verify signature → look up
`razorpayEventId` in `WebhookEvent`; if already `processedAt`-set, return
200 and do nothing (idempotent replay-safe) → otherwise process the event,
update the matching `Payment`/`Invoice` (and cascade to linked
`BillingPeriod`s per the policy above), write `ClientActivity`, mark
`processedAt`. All of this in one DB transaction per event.

## Reminder engine & safety switch

A rule only ever produces a live send when **all** of: (1) the
`ReminderRule.isEnabled` is true, (2) `OrganizationSettings.
automaticClientCommunicationEnabled` is true (org-level kill switch,
checked server-side inside the one function allowed to call an
email/WhatsApp provider — not a UI-only gate), (3) for
`APPROVAL_REQUIRED` mode, an admin has clicked Send on the resulting
`ReminderJob`. WhatsApp channel is modeled fully now but has no live
provider wired until Rohit supplies API access — a `ReminderJob` with
`channel = WHATSAPP` before then fails closed (logged, never silently
dropped) rather than silently no-op'ing.

## Scheduling

No existing background-job infra in this stack. Plan: a Hostinger cron job
hits secured internal API routes (`/api/cron/generate-billing-periods`,
`/api/cron/process-reminders`), auth'd by a shared secret header, running
daily. Revisit with Inngest/Trigger.dev only if Hostinger cron proves too
limited (e.g. no sub-daily granularity) once reminder timing requirements
are concrete.

## Out of scope for V1 (per brief §38)

Client portal, automated reports, Google Ads/GSC/GA4/GBP integrations,
team collaboration/roles, multi-org UI, AI anything.

## Open items carried into later phases

Actual domain name/subdomain for deployment; SMTP mailbox to send reminder
email from; Razorpay key provisioning; first real `ServiceTemplate` set
(Local SEO, Website SEO, Google Ads, etc., per §17) — draft from Rohit's
existing service lineup once we reach Phase 4.
