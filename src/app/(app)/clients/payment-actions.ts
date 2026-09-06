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
