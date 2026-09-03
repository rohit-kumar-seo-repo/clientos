# ClientOS — Architecture & Database Design

Status: approved by Rohit (design), scaffold built and committed 2026-09-03.
Founding brief: the full 39-section product brief lives in chat history for
this build; this doc distills it into an implementable architecture.

## Scope

Internal tool for Rohit's marketing/SEO agency clients only — billing,
recurring work, reminders, renewals. **Not** a generic CRM, **not** an
AI assistant, and **hard-separate** from `digital-products-bundle` (a
different business, digitalproductsbundle.in): own repo, own database,
own Razorpay keys, own subdomain. Only architectural *patterns* are
reused from that sibling project — never its data or deploy target.

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
- **Billing** — `BillingPlan` (1:1 with a `ClientService` — frequency,
  amount, billing day) → `BillingPeriod` rows (one per Aug/Sep/Oct…, each
  with its own status) → `Payment` rows (one per attempt, never overwritten)
  → `Refund`. `WebhookEvent` is the idempotency ledger keyed on Razorpay's
  own event id.
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

## Billing lifecycle

`BillingPeriod.status` transitions are computed automatically except two
which are only ever set by a trusted, signature-verified Razorpay webhook
event (`PAID`) or an explicit admin action (`REFUNDED`, `CANCELLED`):

```
UPCOMING → DUE → DUE_TODAY → OVERDUE      (date-driven, computed on read)
       ↘ PARTIALLY_PAID ↗
DUE/DUE_TODAY/OVERDUE → PAID              (webhook-driven only)
any → FAILED / REFUNDED / CANCELLED       (webhook or explicit admin action)
```

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

## Webhook processing

Razorpay → `/api/webhooks/razorpay` → verify signature → look up
`razorpayEventId` in `WebhookEvent`; if already `processedAt`-set, return
200 and do nothing (idempotent replay-safe) → otherwise process the event,
update the matching `Payment`/`BillingPeriod`, write `ClientActivity`, mark
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
