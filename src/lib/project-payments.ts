/**
 * Payment logic for one-time project obligations.
 *
 * Mirrors markBillingPeriodPaid in payments.ts:
 *   - Atomic updateMany for the idempotency lock (PENDING → PAID)
 *   - Full $transaction for Invoice + InvoiceLineItem + Payment
 *   - Amount integrity: obligation amount === line-item amount === payment amount
 *   - No partial payments in V1
 *
 * The only differences from the recurring path:
 *   - InvoiceLineItem.projectMilestoneId / projectAddOnId instead of billingPeriodId
 *   - No next-period generation after payment
 */

import { prisma } from "@/lib/db";
import type { Invoice, ProjectMilestone, ProjectAddOn } from "@/generated/prisma/client";

// Shared with payment-actions.ts; ₹1,00,00,000 in paise.
export const MAX_PROJECT_AMOUNT_IN_PAISE = 1_000_000_000;

const INVOICE_NUMBER_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateInvoiceNumber(): string {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += INVOICE_NUMBER_CHARS[Math.floor(Math.random() * INVOICE_NUMBER_CHARS.length)];
  }
  return `INV-${s}`;
}

// ---------------------------------------------------------------------------
// Milestone payment
// ---------------------------------------------------------------------------

export type MarkMilestonePaidInput = {
  milestoneId: number;
  paidAt: Date;
  recordedByAdminId: number;
};

export type MarkMilestonePaidResult =
  | { error: "already_paid" }
  | { invoice: Invoice; milestone: ProjectMilestone };

export async function markMilestonePaid(
  input: MarkMilestonePaidInput
): Promise<MarkMilestonePaidResult> {
  return prisma.$transaction(async (tx) => {
    // Atomic check-and-claim: InnoDB row lock prevents double-recording.
    const claimed = await tx.projectMilestone.updateMany({
      where: { id: input.milestoneId, status: "PENDING" },
      data: { status: "PAID", paidAt: input.paidAt },
    });
    if (claimed.count === 0) {
      return { error: "already_paid" as const };
    }

    const milestone = await tx.projectMilestone.findUniqueOrThrow({
      where: { id: input.milestoneId },
      include: {
        project: { include: { client: true } },
        invoiceLineItem: { include: { invoice: true } },
      },
    });

    // Amount integrity: always use the obligation's own amount.
    const amountInPaise = milestone.amountInPaise;
    const clientId = milestone.project.clientId;

    let invoice: Invoice;
    if (milestone.invoiceLineItem) {
      // A line item was pre-created (not a V1 path, but handle it).
      invoice = milestone.invoiceLineItem.invoice;
    } else {
      invoice = await tx.invoice.create({
        data: {
          clientId,
          invoiceNumber: generateInvoiceNumber(),
          totalAmountInPaise: amountInPaise,
          dueDate: milestone.dueDate ?? new Date(),
        },
      });
      await tx.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          projectMilestoneId: milestone.id,
          description: `${milestone.project.title} — ${milestone.label}`,
          amountInPaise,
        },
      });
    }

    await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        recordedByAdminId: input.recordedByAdminId,
        status: "CAPTURED",
        method: "manual",
        amountInPaise,
        capturedAt: input.paidAt,
      },
    });

    await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });

    return { invoice, milestone };
  });
}

// ---------------------------------------------------------------------------
// Add-on payment
// ---------------------------------------------------------------------------

export type MarkAddOnPaidInput = {
  addOnId: number;
  paidAt: Date;
  recordedByAdminId: number;
};

export type MarkAddOnPaidResult =
  | { error: "already_paid" }
  | { invoice: Invoice; addOn: ProjectAddOn };

export async function markAddOnPaid(
  input: MarkAddOnPaidInput
): Promise<MarkAddOnPaidResult> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.projectAddOn.updateMany({
      where: { id: input.addOnId, status: "PENDING" },
      data: { status: "PAID" },
    });
    if (claimed.count === 0) {
      return { error: "already_paid" as const };
    }

    const addOn = await tx.projectAddOn.findUniqueOrThrow({
      where: { id: input.addOnId },
      include: {
        project: { include: { client: true } },
        invoiceLineItem: { include: { invoice: true } },
      },
    });

    const amountInPaise = addOn.amountInPaise;
    const clientId = addOn.project.clientId;

    let invoice: Invoice;
    if (addOn.invoiceLineItem) {
      invoice = addOn.invoiceLineItem.invoice;
    } else {
      invoice = await tx.invoice.create({
        data: {
          clientId,
          invoiceNumber: generateInvoiceNumber(),
          totalAmountInPaise: amountInPaise,
          dueDate: addOn.dueDate ?? new Date(),
        },
      });
      await tx.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          projectAddOnId: addOn.id,
          description: `${addOn.project.title} — ${addOn.description}`,
          amountInPaise,
        },
      });
    }

    await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        recordedByAdminId: input.recordedByAdminId,
        status: "CAPTURED",
        method: "manual",
        amountInPaise,
        capturedAt: input.paidAt,
      },
    });

    await tx.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });

    return { invoice, addOn };
  });
}
