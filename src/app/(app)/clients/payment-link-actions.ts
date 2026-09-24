"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";
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
  getEligibleObligationsForClient,
  MAX_PAYMENT_LINK_AMOUNT_IN_PAISE,
  type EligibleObligations,
} from "@/lib/payment-links";
import { listClients } from "@/lib/clients";

type ActionResult = { error: string } | { ok: true };

// Public subset of the created PaymentLink row, returned to the browser so
// the "Create Payment Link" modal can render its result screen (Copy/Open
// link, status, expiry). Never includes anything Razorpay-secret — the
// short URL and link id are already meant to be shared with the payer.
export type PaymentLinkSummary = {
  id: number;
  razorpayPaymentLinkId: string;
  razorpayShortUrl: string;
  amountInPaise: number;
  currency: string;
  status: string;
  isUpiOnly: boolean;
  expiresAt: Date | null;
};

type CreateActionResult = { error: string } | { ok: true; paymentLink: PaymentLinkSummary };

function toSummary(link: {
  id: number;
  razorpayPaymentLinkId: string;
  razorpayShortUrl: string;
  amountInPaise: number;
  currency: string;
  status: string;
  isUpiOnly: boolean;
  expiresAt: Date | null;
}): PaymentLinkSummary {
  return {
    id: link.id,
    razorpayPaymentLinkId: link.razorpayPaymentLinkId,
    razorpayShortUrl: link.razorpayShortUrl,
    amountInPaise: link.amountInPaise,
    currency: link.currency,
    status: link.status,
    isUpiOnly: link.isUpiOnly,
    expiresAt: link.expiresAt,
  };
}

type CommonFields = {
  allowsPartialPayment: boolean;
  minPartialAmountInPaise: number | null;
  expiresAt: Date | null;
  isUpiOnly: boolean;
  customerNameOverride: string | null;
  customerEmailOverride: string | null;
  customerContactOverride: string | null;
};

function parseCommonFields(formData: FormData): { error: string } | CommonFields {
  const allowsPartialPayment = formData.get("allowsPartialPayment") === "on";
  const minPartialRaw = String(formData.get("minPartialAmountInRupees") ?? "").trim();
  const minPartialAmountInPaise = minPartialRaw ? Math.round(Number(minPartialRaw) * 100) : null;
  const expiresAtRaw = String(formData.get("expiresAt") ?? "").trim();
  const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return { error: "Invalid expiry date." };
  }
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return { error: "Expiry must be in the future." };
  }
  if (minPartialAmountInPaise !== null && (!Number.isFinite(minPartialAmountInPaise) || minPartialAmountInPaise < 1)) {
    return { error: "Invalid minimum partial amount." };
  }
  if (minPartialAmountInPaise !== null && !allowsPartialPayment) {
    return { error: "A minimum partial amount requires partial payment to be enabled." };
  }
  const isUpiOnly = String(formData.get("paymentType") ?? "standard") === "upi";
  const nameOverride = String(formData.get("customerName") ?? "").trim();
  const emailOverride = String(formData.get("customerEmail") ?? "").trim();
  const contactOverride = String(formData.get("customerContact") ?? "").trim();
  return {
    allowsPartialPayment,
    minPartialAmountInPaise,
    expiresAt,
    isUpiOnly,
    customerNameOverride: nameOverride || null,
    customerEmailOverride: emailOverride || null,
    customerContactOverride: contactOverride || null,
  };
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
): Promise<CreateActionResult> {
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
  return { ok: true, paymentLink: toSummary(result.paymentLink) };
}

export async function createPaymentLinkForMilestoneAction(
  milestoneId: number,
  formData: FormData
): Promise<CreateActionResult> {
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
  return { ok: true, paymentLink: toSummary(result.paymentLink) };
}

export async function createPaymentLinkForAddOnAction(
  addOnId: number,
  formData: FormData
): Promise<CreateActionResult> {
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
  return { ok: true, paymentLink: toSummary(result.paymentLink) };
}

export async function createCustomPaymentLinkAction(
  clientId: number,
  formData: FormData
): Promise<CreateActionResult> {
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
  return { ok: true, paymentLink: toSummary(result.paymentLink) };
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

// ---------------------------------------------------------------------------
// Read actions for the Payments-page "+ Create Payment Link" modal
// ---------------------------------------------------------------------------

export type PaymentLinkClientOption = {
  id: number;
  businessName: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
};

/** Org-scoped client picker list for the create-link modal. */
export async function getClientsForPaymentLinkAction(): Promise<{ clients: PaymentLinkClientOption[] }> {
  const admin = await requireAdmin();
  const clients = await listClients(admin.organizationId);
  return {
    clients: clients.map((c) => ({
      id: c.id,
      businessName: c.businessName,
      contactPerson: c.contactPerson,
      email: c.email,
      phone: c.phone,
    })),
  };
}

/** Eligible (unpaid, unlinked) obligations for one client, for the "Payment For" step. */
export async function getClientObligationsForPaymentLinkAction(
  clientId: number
): Promise<{ error: string } | EligibleObligations> {
  if (!Number.isInteger(clientId)) return { error: "Client not found." };
  const { client } = await requireClientInOwnOrg(clientId);
  if (!client) return { error: "Client not found." };
  return getEligibleObligationsForClient(clientId);
}
