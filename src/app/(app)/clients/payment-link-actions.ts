"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  requireClientInOwnOrg,
  requirePaymentLinkInOwnOrg,
  requireMilestoneInOwnOrg,
  requireAddOnInOwnOrg,
} from "@/lib/authz";
import { requireBillingPeriodInOwnOrg } from "@/app/(app)/clients/payment-actions";
import {
  createPaymentLinkForObligation,
  cancelPaymentLinkById,
  MAX_PAYMENT_LINK_AMOUNT_IN_PAISE,
} from "@/lib/payment-links";

type ActionResult = { error: string } | { ok: true };

type CommonFields = { allowsPartialPayment: boolean; minPartialAmountInPaise: number | null; expiresAt: Date | null };

function parseCommonFields(formData: FormData): { error: string } | CommonFields {
  const allowsPartialPayment = formData.get("allowsPartialPayment") === "on";
  const minPartialRaw = String(formData.get("minPartialAmountInRupees") ?? "").trim();
  const minPartialAmountInPaise = minPartialRaw ? Math.round(Number(minPartialRaw) * 100) : null;
  const expiresAtRaw = String(formData.get("expiresAt") ?? "").trim();
  const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return { error: "Invalid expiry date." };
  }
  if (minPartialAmountInPaise !== null && (!Number.isFinite(minPartialAmountInPaise) || minPartialAmountInPaise < 1)) {
    return { error: "Invalid minimum partial amount." };
  }
  return { allowsPartialPayment, minPartialAmountInPaise, expiresAt };
}

function formatCreateError(
  result: { error: string } | { paymentLink: unknown; clientId: number }
): string | null {
  if (!("error" in result)) return null;
  switch (result.error) {
    case "not_found":
      return "Not found.";
    case "already_paid":
      return "This is already fully paid — a payment link isn't needed.";
    case "duplicate_active_link":
      return "An active payment link already exists for this. Cancel it first to issue a new one.";
    case "unsupported_currency":
      return "That currency isn't supported.";
    case "invalid_amount":
      return "Amount must be between ₹0.01 and ₹1,00,00,000.";
    case "razorpay_error":
      return "Razorpay: " + ((result as { message?: string }).message ?? "could not create the payment link.");
    default:
      return "Could not create the payment link.";
  }
}

export async function createPaymentLinkForBillingPeriodAction(
  billingPeriodId: number,
  formData: FormData
): Promise<ActionResult> {
  if (!Number.isInteger(billingPeriodId)) return { error: "Payment period not found." };
  const { admin, period } = await requireBillingPeriodInOwnOrg(billingPeriodId);
  if (!period) return { error: "Payment period not found." };

  const common = parseCommonFields(formData);
  if ("error" in common) return common;

  const result = await createPaymentLinkForObligation({
    kind: "billingPeriod",
    billingPeriodId,
    createdByAdminId: admin.id,
    ...common,
  });
  const errorMessage = formatCreateError(result);
  if (errorMessage) return { error: errorMessage };
  if (!("paymentLink" in result)) return { error: "Could not create the payment link." };

  const clientId = period.billingPlan.clientService.clientId;
  await prisma.clientActivity.create({
    data: {
      clientId,
      actorAdminId: admin.id,
      eventType: "payment_link.created",
      summary: `Payment link created for ${period.periodLabel} (₹${(result.paymentLink.amountInPaise / 100).toLocaleString("en-IN")}).`,
    },
  });

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/payments");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

export async function createPaymentLinkForMilestoneAction(
  milestoneId: number,
  formData: FormData
): Promise<ActionResult> {
  if (!Number.isInteger(milestoneId)) return { error: "Milestone not found." };
  const { admin, milestone } = await requireMilestoneInOwnOrg(milestoneId);
  if (!milestone) return { error: "Milestone not found." };

  const common = parseCommonFields(formData);
  if ("error" in common) return common;

  const result = await createPaymentLinkForObligation({
    kind: "projectMilestone",
    milestoneId,
    createdByAdminId: admin.id,
    ...common,
  });
  const errorMessage = formatCreateError(result);
  if (errorMessage) return { error: errorMessage };
  if (!("paymentLink" in result)) return { error: "Could not create the payment link." };

  const clientId = milestone.project.clientId;
  await prisma.clientActivity.create({
    data: {
      clientId,
      actorAdminId: admin.id,
      eventType: "payment_link.created",
      summary: `Payment link created for milestone "${milestone.label}" (₹${(result.paymentLink.amountInPaise / 100).toLocaleString("en-IN")}).`,
    },
  });

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/payments");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

export async function createPaymentLinkForAddOnAction(
  addOnId: number,
  formData: FormData
): Promise<ActionResult> {
  if (!Number.isInteger(addOnId)) return { error: "Add-on not found." };
  const { admin, addOn } = await requireAddOnInOwnOrg(addOnId);
  if (!addOn) return { error: "Add-on not found." };

  const common = parseCommonFields(formData);
  if ("error" in common) return common;

  const result = await createPaymentLinkForObligation({
    kind: "projectAddOn",
    addOnId,
    createdByAdminId: admin.id,
    ...common,
  });
  const errorMessage = formatCreateError(result);
  if (errorMessage) return { error: errorMessage };
  if (!("paymentLink" in result)) return { error: "Could not create the payment link." };

  const clientId = addOn.project.clientId;
  await prisma.clientActivity.create({
    data: {
      clientId,
      actorAdminId: admin.id,
      eventType: "payment_link.created",
      summary: `Payment link created for add-on "${addOn.description}" (₹${(result.paymentLink.amountInPaise / 100).toLocaleString("en-IN")}).`,
    },
  });

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/payments");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

export async function createCustomPaymentLinkAction(
  clientId: number,
  formData: FormData
): Promise<ActionResult> {
  if (!Number.isInteger(clientId)) return { error: "Client not found." };
  const { admin, client } = await requireClientInOwnOrg(clientId);
  if (!client) return { error: "Client not found." };

  const common = parseCommonFields(formData);
  if ("error" in common) return common;

  const amountInRupees = Number(formData.get("amountInRupees"));
  const amountInPaise = Math.round(amountInRupees * 100);
  if (!Number.isFinite(amountInRupees) || amountInPaise < 1 || amountInPaise > MAX_PAYMENT_LINK_AMOUNT_IN_PAISE) {
    return { error: "Amount must be between ₹0.01 and ₹1,00,00,000." };
  }
  const currency = String(formData.get("currency") ?? "INR").toUpperCase();
  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { error: "A description is required." };

  const result = await createPaymentLinkForObligation({
    kind: "custom",
    clientId,
    amountInPaise,
    currency,
    description,
    createdByAdminId: admin.id,
    ...common,
  });
  const errorMessage = formatCreateError(result);
  if (errorMessage) return { error: errorMessage };
  if (!("paymentLink" in result)) return { error: "Could not create the payment link." };

  await prisma.clientActivity.create({
    data: {
      clientId,
      actorAdminId: admin.id,
      eventType: "payment_link.created",
      summary: `Custom payment link created: "${description}" (${currency} ${(amountInPaise / 100).toLocaleString("en-IN")}).`,
    },
  });

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/payments");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

export async function cancelPaymentLinkAction(paymentLinkId: number): Promise<ActionResult> {
  if (!Number.isInteger(paymentLinkId)) return { error: "Payment link not found." };
  const { admin, paymentLink } = await requirePaymentLinkInOwnOrg(paymentLinkId);
  if (!paymentLink) return { error: "Payment link not found." };

  const result = await cancelPaymentLinkById(paymentLinkId);
  if ("error" in result) {
    if (result.error === "not_cancellable") return { error: "This payment link can no longer be cancelled." };
    if (result.error === "razorpay_error") return { error: "Razorpay: " + result.message };
    return { error: "Payment link not found." };
  }

  await prisma.clientActivity.create({
    data: {
      clientId: paymentLink.clientId,
      actorAdminId: admin.id,
      eventType: "payment_link.cancelled",
      summary: `Payment link cancelled: "${paymentLink.description}".`,
    },
  });

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/payments");
  revalidatePath(`/clients/${paymentLink.clientId}`);
  return { ok: true };
}
