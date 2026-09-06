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
    // Atomic check-and-claim: acquires an InnoDB row lock so the losing
    // concurrent transaction sees count === 0 and returns already_paid
    // rather than racing past a non-locking snapshot read.
    const claimed = await tx.billingPeriod.updateMany({
      where: { id: input.billingPeriodId, status: { not: "PAID" } },
      data: { status: "PAID" },
    });
    if (claimed.count === 0) {
      return { error: "already_paid" as const };
    }

    // Fetch full period now that we hold the lock and have set status=PAID.
    const period = await tx.billingPeriod.findUniqueOrThrow({
      where: { id: input.billingPeriodId },
      include: {
        billingPlan: { include: { clientService: true } },
        invoiceLineItem: { include: { invoice: true } },
      },
    });

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
    // BillingPeriod status was already set to PAID by the atomic updateMany above.

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

    return { invoice, period };
  });
}
