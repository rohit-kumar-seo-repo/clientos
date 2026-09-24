/**
 * Payment Link business logic — creation, cancellation, and webhook-driven
 * payment recording. Mirrors the shape of payments.ts / project-payments.ts:
 * amount integrity from the obligation's own stored amount, atomic
 * check-and-claim for anything that finalizes a payment, no partial
 * payments on ProjectMilestone/ProjectAddOn (MilestoneStatus has no
 * PARTIALLY_PAID value — that stays true here; a partial payment against a
 * milestone/add-on link is visible on PaymentLink.status and Invoice.status
 * only, never on the milestone/add-on's own status).
 *
 * Creating a link calls out to Razorpay (an external HTTP call) and so is
 * deliberately NOT wrapped in a Prisma $transaction — only the final
 * payment-recording step (money already moved) needs that atomicity.
 */
import { prisma } from "@/lib/db";
import {
  createPaymentLink as razorpayCreatePaymentLink,
  cancelPaymentLink as razorpayCancelPaymentLink,
  isSupportedCurrency,
} from "@/lib/razorpay";
import type { PaymentLink, Invoice } from "@/generated/prisma/client";

// Same ceiling as MAX_FEE_IN_PAISE (payment-actions.ts) / MAX_PROJECT_AMOUNT_IN_PAISE
// (project-payments.ts) — ₹1,00,00,000.
export const MAX_PAYMENT_LINK_AMOUNT_IN_PAISE = 1_000_000_000;

const ACTIVE_LINK_STATUSES = ["CREATED", "PARTIALLY_PAID"] as const;

const INVOICE_NUMBER_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateInvoiceNumber(): string {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += INVOICE_NUMBER_CHARS[Math.floor(Math.random() * INVOICE_NUMBER_CHARS.length)];
  }
  return `INV-${s}`;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

type CommonCreateFields = {
  createdByAdminId: number;
  allowsPartialPayment: boolean;
  minPartialAmountInPaise?: number | null;
  expiresAt?: Date | null;
  isUpiOnly?: boolean;
  // Overrides for the Razorpay-facing customer identity on this one link —
  // never written back to the Client record itself.
  customerNameOverride?: string | null;
  customerEmailOverride?: string | null;
  customerContactOverride?: string | null;
};

export type CreatePaymentLinkInput =
  | ({ kind: "billingPeriod"; billingPeriodId: number } & CommonCreateFields)
  | ({ kind: "projectMilestone"; milestoneId: number } & CommonCreateFields)
  | ({ kind: "projectAddOn"; addOnId: number } & CommonCreateFields)
  | ({
      kind: "custom";
      clientId: number;
      amountInPaise: number;
      currency: string;
      description: string;
    } & CommonCreateFields);

export type CreatePaymentLinkResult =
  | { error: "not_found" }
  | { error: "already_paid" }
  | { error: "duplicate_active_link" }
  | { error: "unsupported_currency" }
  | { error: "invalid_amount" }
  | { error: "razorpay_error"; message: string }
  | { paymentLink: PaymentLink; clientId: number };

async function findActiveLinkFor(
  column: "billingPeriodId" | "projectMilestoneId" | "projectAddOnId",
  id: number
): Promise<PaymentLink | null> {
  return prisma.paymentLink.findFirst({
    where: { [column]: id, status: { in: [...ACTIVE_LINK_STATUSES] } },
  });
}

export async function createPaymentLinkForObligation(
  input: CreatePaymentLinkInput
): Promise<CreatePaymentLinkResult> {
  if (input.kind === "billingPeriod") {
    const period = await prisma.billingPeriod.findUnique({
      where: { id: input.billingPeriodId },
      include: { billingPlan: { include: { clientService: { include: { client: true } } } } },
    });
    if (!period) return { error: "not_found" };
    if (period.status === "PAID") return { error: "already_paid" };
    if (await findActiveLinkFor("billingPeriodId", period.id)) {
      return { error: "duplicate_active_link" };
    }
    const client = period.billingPlan.clientService.client;
    return createAndPersistLink({
      ...input,
      clientId: client.id,
      amountInPaise: period.amountInPaise,
      currency: period.billingPlan.currency,
      description: `${client.businessName} — billing period ${period.periodLabel}`,
      client,
      billingPeriodId: period.id,
    });
  }

  if (input.kind === "projectMilestone") {
    const milestone = await prisma.projectMilestone.findUnique({
      where: { id: input.milestoneId },
      include: { project: { include: { client: true } } },
    });
    if (!milestone) return { error: "not_found" };
    if (milestone.status === "PAID") return { error: "already_paid" };
    if (await findActiveLinkFor("projectMilestoneId", milestone.id)) {
      return { error: "duplicate_active_link" };
    }
    const client = milestone.project.client;
    return createAndPersistLink({
      ...input,
      clientId: client.id,
      amountInPaise: milestone.amountInPaise,
      currency: "INR", // projects carry no currency field of their own — always INR, matching Invoice's default
      description: `${milestone.project.title} — ${milestone.label}`,
      client,
      projectMilestoneId: milestone.id,
    });
  }

  if (input.kind === "projectAddOn") {
    const addOn = await prisma.projectAddOn.findUnique({
      where: { id: input.addOnId },
      include: { project: { include: { client: true } } },
    });
    if (!addOn) return { error: "not_found" };
    if (addOn.status === "PAID") return { error: "already_paid" };
    if (await findActiveLinkFor("projectAddOnId", addOn.id)) {
      return { error: "duplicate_active_link" };
    }
    const client = addOn.project.client;
    return createAndPersistLink({
      ...input,
      clientId: client.id,
      amountInPaise: addOn.amountInPaise,
      currency: "INR",
      description: `${addOn.project.title} — ${addOn.description}`,
      client,
      projectAddOnId: addOn.id,
    });
  }

  // kind === "custom"
  if (!Number.isInteger(input.amountInPaise) || input.amountInPaise < 1 || input.amountInPaise > MAX_PAYMENT_LINK_AMOUNT_IN_PAISE) {
    return { error: "invalid_amount" };
  }
  if (!isSupportedCurrency(input.currency)) {
    return { error: "unsupported_currency" };
  }
  const client = await prisma.client.findUnique({ where: { id: input.clientId } });
  if (!client) return { error: "not_found" };
  return createAndPersistLink({
    ...input,
    clientId: client.id,
    amountInPaise: input.amountInPaise,
    currency: input.currency.toUpperCase(),
    description: input.description,
    client,
  });
}

type PersistArgs = CommonCreateFields & {
  clientId: number;
  amountInPaise: number;
  currency: string;
  description: string;
  client: { businessName: string; contactPerson: string | null; email: string | null; phone: string | null };
  billingPeriodId?: number;
  projectMilestoneId?: number;
  projectAddOnId?: number;
};

async function createAndPersistLink(args: PersistArgs): Promise<CreatePaymentLinkResult> {
  if (!Number.isInteger(args.amountInPaise) || args.amountInPaise < 1 || args.amountInPaise > MAX_PAYMENT_LINK_AMOUNT_IN_PAISE) {
    return { error: "invalid_amount" };
  }

  let razorpayLink;
  try {
    razorpayLink = await razorpayCreatePaymentLink({
      amountInPaise: args.amountInPaise,
      currency: args.currency,
      description: args.description,
      customerName: args.customerNameOverride ?? args.client.contactPerson ?? args.client.businessName,
      customerEmail: args.customerEmailOverride ?? args.client.email,
      customerContact: args.customerContactOverride ?? args.client.phone,
      acceptPartial: args.allowsPartialPayment,
      firstMinPartialAmountInPaise: args.minPartialAmountInPaise ?? null,
      expireBy: args.expiresAt ?? null,
      upiOnly: args.isUpiOnly,
    });
  } catch (err) {
    return { error: "razorpay_error", message: err instanceof Error ? err.message : "Unknown Razorpay error" };
  }

  // ponytail: a DB write failure here orphans a live Razorpay link with no
  // local record. Accepted for V1 — no saga/compensating-transaction system;
  // the settings/razorpay page's future "sync" affordance (not built in this
  // phase) would be the upgrade path if this ever proves to matter in practice.
  const paymentLink = await prisma.paymentLink.create({
    data: {
      clientId: args.clientId,
      billingPeriodId: args.billingPeriodId ?? null,
      projectMilestoneId: args.projectMilestoneId ?? null,
      projectAddOnId: args.projectAddOnId ?? null,
      razorpayPaymentLinkId: razorpayLink.id,
      razorpayShortUrl: razorpayLink.short_url,
      description: args.description,
      amountInPaise: args.amountInPaise,
      currency: args.currency,
      allowsPartialPayment: args.allowsPartialPayment,
      minPartialAmountInPaise: args.minPartialAmountInPaise ?? null,
      isUpiOnly: args.isUpiOnly ?? false,
      expiresAt: args.expiresAt ?? null,
      status: "CREATED",
      createdByAdminId: args.createdByAdminId,
    },
  });

  return { paymentLink, clientId: args.clientId };
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

export type CancelPaymentLinkResult =
  | { error: "not_found" }
  | { error: "not_cancellable" }
  | { error: "razorpay_error"; message: string }
  | { paymentLink: PaymentLink; clientId: number };

export async function cancelPaymentLinkById(paymentLinkId: number): Promise<CancelPaymentLinkResult> {
  const link = await prisma.paymentLink.findUnique({ where: { id: paymentLinkId } });
  if (!link) return { error: "not_found" };
  if (!ACTIVE_LINK_STATUSES.includes(link.status as (typeof ACTIVE_LINK_STATUSES)[number])) {
    return { error: "not_cancellable" };
  }

  try {
    await razorpayCancelPaymentLink(link.razorpayPaymentLinkId);
  } catch (err) {
    return { error: "razorpay_error", message: err instanceof Error ? err.message : "Unknown Razorpay error" };
  }

  const updated = await prisma.paymentLink.update({
    where: { id: link.id },
    data: { status: "CANCELLED" },
  });
  return { paymentLink: updated, clientId: link.clientId };
}

// ---------------------------------------------------------------------------
// Webhook-driven payment recording
// ---------------------------------------------------------------------------

export type RecordLinkPaymentInput = {
  razorpayPaymentLinkId: string;
  razorpayPaymentId: string;
  razorpayOrderId: string | null;
  amountInPaise: number; // this payment's captured amount (from Razorpay's re-fetched Payment entity)
  currency: string; // this payment's currency (from Razorpay's re-fetched Payment entity)
  cumulativeAmountPaidInPaise: number; // the link's total amount_paid so far (from Razorpay's re-fetched PaymentLink entity)
  capturedAt: Date;
};

export type RecordLinkPaymentResult =
  | { error: "link_not_found" }
  | { error: "already_recorded" } // this exact razorpayPaymentId was already written (unique constraint)
  | { error: "already_fully_paid" }
  | { error: "amount_mismatch"; expected: number; got: number }
  | { error: "currency_mismatch"; expected: string; got: string }
  | { ok: true; clientId: number; fullyPaid: boolean; obligationLabel: string };

/**
 * Records a verified, successful (or partially-successful) Razorpay payment
 * against a Payment Link. Caller (the webhook route) must have already:
 *   1. verified the HMAC signature,
 *   2. independently re-fetched the Payment and PaymentLink entities from
 *      Razorpay's API (never trusts the webhook payload's own numbers).
 * This function trusts its inputs as already server-verified.
 */
export async function recordLinkPayment(input: RecordLinkPaymentInput): Promise<RecordLinkPaymentResult> {
  const link = await prisma.paymentLink.findUnique({
    where: { razorpayPaymentLinkId: input.razorpayPaymentLinkId },
    include: {
      client: true,
      billingPeriod: { include: { billingPlan: { include: { clientService: true } } } },
      projectMilestone: { include: { project: true } },
      projectAddOn: { include: { project: true } },
    },
  });
  if (!link) return { error: "link_not_found" };
  if (link.status === "PAID") return { error: "already_fully_paid" };

  if (input.currency.toUpperCase() !== link.currency.toUpperCase()) {
    return { error: "currency_mismatch", expected: link.currency, got: input.currency };
  }
  // The obligation must never be overpaid beyond what it was created for.
  if (input.cumulativeAmountPaidInPaise > link.amountInPaise) {
    return { error: "amount_mismatch", expected: link.amountInPaise, got: input.cumulativeAmountPaidInPaise };
  }

  const fullyPaid = input.cumulativeAmountPaidInPaise >= link.amountInPaise;

  return prisma.$transaction(async (tx) => {
    // Idempotency belt-and-braces: razorpayPaymentId is @unique on Payment.
    // A retried webhook for a payment we already recorded hits P2002 here,
    // caught by the route handler exactly like markPaidAction already does.
    let invoice: Invoice;
    let obligationLabel: string;

    if (link.billingPeriodId && link.billingPeriod) {
      const period = link.billingPeriod;
      const existingLineItem = await tx.invoiceLineItem.findUnique({
        where: { billingPeriodId: period.id },
        include: { invoice: true },
      });
      if (existingLineItem) {
        invoice = existingLineItem.invoice;
      } else {
        invoice = await tx.invoice.create({
          data: {
            clientId: link.clientId,
            invoiceNumber: generateInvoiceNumber(),
            totalAmountInPaise: period.amountInPaise,
            currency: link.currency,
            dueDate: period.dueDate,
          },
        });
        await tx.invoiceLineItem.create({
          data: { invoiceId: invoice.id, billingPeriodId: period.id, amountInPaise: period.amountInPaise },
        });
      }
      obligationLabel = `billing period ${period.periodLabel}`;

      if (fullyPaid) {
        await tx.billingPeriod.updateMany({ where: { id: period.id, status: { not: "PAID" } }, data: { status: "PAID" } });
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });
      } else {
        await tx.billingPeriod.updateMany({
          where: { id: period.id, status: { notIn: ["PAID"] } },
          data: { status: "PARTIALLY_PAID" },
        });
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PARTIALLY_PAID" } });
      }
    } else if (link.projectMilestoneId && link.projectMilestone) {
      const milestone = link.projectMilestone;
      const existingLineItem = await tx.invoiceLineItem.findUnique({
        where: { projectMilestoneId: milestone.id },
        include: { invoice: true },
      });
      if (existingLineItem) {
        invoice = existingLineItem.invoice;
      } else {
        invoice = await tx.invoice.create({
          data: {
            clientId: link.clientId,
            invoiceNumber: generateInvoiceNumber(),
            totalAmountInPaise: milestone.amountInPaise,
            currency: link.currency,
            dueDate: milestone.dueDate ?? new Date(),
          },
        });
        await tx.invoiceLineItem.create({
          data: {
            invoiceId: invoice.id,
            projectMilestoneId: milestone.id,
            description: `${milestone.project.title} — ${milestone.label}`,
            amountInPaise: milestone.amountInPaise,
          },
        });
      }
      obligationLabel = `${milestone.project.title} — ${milestone.label}`;

      // MilestoneStatus has no PARTIALLY_PAID value — only flip on full payment.
      if (fullyPaid) {
        await tx.projectMilestone.updateMany({
          where: { id: milestone.id, status: "PENDING" },
          data: { status: "PAID", paidAt: input.capturedAt },
        });
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });
      } else {
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PARTIALLY_PAID" } });
      }
    } else if (link.projectAddOnId && link.projectAddOn) {
      const addOn = link.projectAddOn;
      const existingLineItem = await tx.invoiceLineItem.findUnique({
        where: { projectAddOnId: addOn.id },
        include: { invoice: true },
      });
      if (existingLineItem) {
        invoice = existingLineItem.invoice;
      } else {
        invoice = await tx.invoice.create({
          data: {
            clientId: link.clientId,
            invoiceNumber: generateInvoiceNumber(),
            totalAmountInPaise: addOn.amountInPaise,
            currency: link.currency,
            dueDate: addOn.dueDate ?? new Date(),
          },
        });
        await tx.invoiceLineItem.create({
          data: {
            invoiceId: invoice.id,
            projectAddOnId: addOn.id,
            description: `${addOn.project.title} — ${addOn.description}`,
            amountInPaise: addOn.amountInPaise,
          },
        });
      }
      obligationLabel = `${addOn.project.title} — ${addOn.description}`;

      if (fullyPaid) {
        await tx.projectAddOn.updateMany({ where: { id: addOn.id, status: "PENDING" }, data: { status: "PAID" } });
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });
      } else {
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PARTIALLY_PAID" } });
      }
    } else {
      // Custom link — no obligation, so no InvoiceLineItem to key off of
      // (zero line items on its Invoice, preserving InvoiceLineItem's
      // "exactly one FK must be non-null" invariant for every
      // obligation-backed row instead of relaxing it). A prior partial
      // payment on THIS link already created its Invoice — found by
      // paymentLinkId, since that's the only handle available here — and
      // must be reused, not duplicated, on a second partial payment.
      const existingPayment = await tx.payment.findFirst({
        where: { paymentLinkId: link.id },
        include: { invoice: true },
        orderBy: { createdAt: "desc" },
      });
      if (existingPayment) {
        invoice = existingPayment.invoice;
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: fullyPaid ? "PAID" : "PARTIALLY_PAID" },
        });
      } else {
        invoice = await tx.invoice.create({
          data: {
            clientId: link.clientId,
            invoiceNumber: generateInvoiceNumber(),
            totalAmountInPaise: link.amountInPaise,
            currency: link.currency,
            status: fullyPaid ? "PAID" : "PARTIALLY_PAID",
            dueDate: new Date(),
          },
        });
      }
      obligationLabel = link.description;
    }

    await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        recordedByAdminId: null, // webhook-driven — never an admin
        paymentLinkId: link.id,
        razorpayOrderId: input.razorpayOrderId,
        razorpayPaymentId: input.razorpayPaymentId,
        status: "CAPTURED",
        amountInPaise: input.amountInPaise,
        currency: input.currency.toUpperCase(),
        method: "razorpay",
        capturedAt: input.capturedAt,
      },
    });

    await tx.paymentLink.update({
      where: { id: link.id },
      data: { status: fullyPaid ? "PAID" : "PARTIALLY_PAID" },
    });

    return { ok: true as const, clientId: link.clientId, fullyPaid, obligationLabel };
  });
}

export type RecordLinkFailureInput = {
  razorpayPaymentLinkId: string;
  razorpayPaymentId: string;
  amountInPaise: number;
  currency: string;
  failureReason: string | null;
};

/**
 * Records a failed payment attempt against a link. Never touches the
 * obligation or the link's own status (a failed attempt doesn't expire or
 * cancel the link — the customer, or a future attempt, may still succeed).
 *
 * If an Invoice already exists for this link (a prior partial payment
 * succeeded before this attempt failed), the FAILED Payment attaches to it.
 * If this is the link's first-ever attempt, there is no Invoice yet under
 * this schema's invariants (an Invoice only comes into existence once money
 * actually moves) — the failure is still visible via the WebhookEvent row
 * and a ClientActivity entry the route handler writes, just without a
 * Payment row that would otherwise need to reference a non-existent invoice.
 */
export async function recordLinkPaymentFailure(
  input: RecordLinkFailureInput
): Promise<{ error: "link_not_found" } | { ok: true; clientId: number; recorded: boolean }> {
  const link = await prisma.paymentLink.findUnique({ where: { razorpayPaymentLinkId: input.razorpayPaymentLinkId } });
  if (!link) return { error: "link_not_found" };

  const existingPayment = await prisma.payment.findFirst({
    where: { paymentLinkId: link.id },
    orderBy: { createdAt: "desc" },
  });
  if (!existingPayment) {
    return { ok: true, clientId: link.clientId, recorded: false };
  }

  await prisma.payment.create({
    data: {
      invoiceId: existingPayment.invoiceId,
      recordedByAdminId: null,
      paymentLinkId: link.id,
      razorpayPaymentId: input.razorpayPaymentId,
      status: "FAILED",
      amountInPaise: input.amountInPaise,
      currency: input.currency.toUpperCase(),
      method: "razorpay",
      failureReason: input.failureReason,
    },
  });
  return { ok: true, clientId: link.clientId, recorded: true };
}

export async function markLinkExpired(razorpayPaymentLinkId: string): Promise<{ error: "link_not_found" } | { ok: true; clientId: number }> {
  const link = await prisma.paymentLink.findUnique({ where: { razorpayPaymentLinkId } });
  if (!link) return { error: "link_not_found" };
  if (link.status === "PAID" || link.status === "CANCELLED") return { ok: true, clientId: link.clientId };
  await prisma.paymentLink.updateMany({
    where: { id: link.id, status: { in: [...ACTIVE_LINK_STATUSES] } },
    data: { status: "EXPIRED" },
  });
  return { ok: true, clientId: link.clientId };
}

export async function markLinkCancelledFromWebhook(razorpayPaymentLinkId: string): Promise<{ error: "link_not_found" } | { ok: true; clientId: number }> {
  const link = await prisma.paymentLink.findUnique({ where: { razorpayPaymentLinkId } });
  if (!link) return { error: "link_not_found" };
  if (link.status === "PAID" || link.status === "CANCELLED") return { ok: true, clientId: link.clientId };
  await prisma.paymentLink.updateMany({
    where: { id: link.id, status: { in: [...ACTIVE_LINK_STATUSES] } },
    data: { status: "CANCELLED" },
  });
  return { ok: true, clientId: link.clientId };
}

// ---------------------------------------------------------------------------
// Read models for the "Create Payment Link" form and the Payments-page
// Payment Link history section
// ---------------------------------------------------------------------------

export type EligibleObligations = {
  billingPeriods: { id: number; label: string; amountInPaise: number; currency: string }[];
  milestones: { id: number; label: string; amountInPaise: number }[];
  addOns: { id: number; label: string; amountInPaise: number }[];
};

/**
 * Obligations for one client that a Payment Link can meaningfully be created
 * for: not already PAID, and not already carrying an active (CREATED /
 * PARTIALLY_PAID) link — createPaymentLinkForObligation re-checks both
 * server-side regardless; this is purely so the form doesn't offer a choice
 * that would just bounce back as an error.
 */
export async function getEligibleObligationsForClient(clientId: number): Promise<EligibleObligations> {
  const activeLinkFilter = { paymentLinks: { none: { status: { in: [...ACTIVE_LINK_STATUSES] } } } };

  const [periods, milestones, addOns] = await Promise.all([
    prisma.billingPeriod.findMany({
      where: { status: { not: "PAID" }, billingPlan: { clientService: { clientId } }, ...activeLinkFilter },
      include: { billingPlan: { include: { clientService: { include: { serviceTemplate: true } } } } },
      orderBy: { dueDate: "asc" },
    }),
    prisma.projectMilestone.findMany({
      where: { status: "PENDING", project: { clientId }, ...activeLinkFilter },
      include: { project: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.projectAddOn.findMany({
      where: { status: "PENDING", project: { clientId }, ...activeLinkFilter },
      include: { project: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return {
    billingPeriods: periods.map((p) => ({
      id: p.id,
      label: `${p.billingPlan.clientService.serviceTemplate.name} — ${p.periodLabel}`,
      amountInPaise: p.amountInPaise,
      currency: p.billingPlan.currency,
    })),
    milestones: milestones.map((m) => ({
      id: m.id,
      label: `${m.project.title} — ${m.label}`,
      amountInPaise: m.amountInPaise,
    })),
    addOns: addOns.map((a) => ({
      id: a.id,
      label: `${a.project.title} — ${a.description}`,
      amountInPaise: a.amountInPaise,
    })),
  };
}

/** All Payment Links across the org, newest first — for the Payments page. */
export async function listPaymentLinksForOrg(organizationId: number) {
  return prisma.paymentLink.findMany({
    where: { client: { organizationId } },
    include: { client: true },
    orderBy: { createdAt: "desc" },
  });
}
