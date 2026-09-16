"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";
import { markBillingPeriodPaid } from "@/lib/payments";
import { Prisma } from "@/generated/prisma/client";

// Same ceiling as service-actions.ts — ₹1,00,00,000 (1 crore)
const MAX_FEE_IN_PAISE = 1_000_000_000;

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
  // M1: Reject non-integer IDs before any DB call (matches sibling actions)
  if (!Number.isInteger(billingPeriodId)) {
    return { error: "Payment period not found." };
  }

  const { admin, period } = await requireBillingPeriodInOwnOrg(billingPeriodId);
  if (!period) {
    return { error: "Payment period not found." };
  }

  const amountInRupees = Number(formData.get("amountInRupees"));
  const amountInPaise = Math.round(amountInRupees * 100);
  // I2: Reject zero/negative paise (catches 0.005 rupee inputs) and amounts
  // above the same ceiling as service-actions.ts (MySQL INT overflow guard).
  if (
    !Number.isFinite(amountInRupees) ||
    amountInPaise < 1 ||
    amountInPaise > MAX_FEE_IN_PAISE
  ) {
    return { error: "Amount must be between ₹0.01 and ₹1,00,00,000." };
  }

  const paidAtRaw = String(formData.get("paidAt") ?? "");
  const paidAt = new Date(paidAtRaw);
  if (Number.isNaN(paidAt.getTime())) {
    return { error: "A valid payment date is required." };
  }

  let result;
  try {
    result = await markBillingPeriodPaid({
      billingPeriodId,
      amountInPaise,
      paidAt,
      recordedByAdminId: admin.id,
    });
  } catch (err) {
    // I1 belt-and-braces: unique-constraint or serialization errors from a
    // concurrent Mark Paid that won the race surface here as a friendly message.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === "P2002" || err.code === "P2034")
    ) {
      return { error: "This payment has already been recorded." };
    }
    throw err;
  }

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

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/payments");
  revalidatePath(`/clients/${period.billingPlan.clientService.clientId}`);
  return { ok: true };
}
