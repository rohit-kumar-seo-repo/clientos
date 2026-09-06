"use server";

import { prisma } from "@/lib/db";
import { requireClientInOwnOrg, requireClientServiceInOwnOrg } from "@/lib/authz";
import { createClientService } from "@/lib/services";
import type { BillingFrequency } from "@/generated/prisma/client";
import { ServiceStatus } from "@/generated/prisma/client";

const VALID_FREQUENCIES: BillingFrequency[] = [
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "YEARLY",
  "ONE_TIME",
];

// MySQL INT tops out at 2,147,483,647; ₹1,00,00,000 (1 crore) in paise
// gives generous headroom for any real agency service fee while catching
// a typo'd extra zero before it reaches the database as an unhandled
// driver error instead of a friendly { error }.
const MAX_FEE_IN_PAISE = 1_000_000_000; // ₹1,00,00,000

const VALID_STATUSES: ServiceStatus[] = Object.values(ServiceStatus);

export async function createServiceAction(
  clientId: number,
  formData: FormData
): Promise<{ error: string } | { clientServiceId: number }> {
  if (!Number.isInteger(clientId)) {
    return { error: "Invalid client." };
  }

  const { client } = await requireClientInOwnOrg(clientId);
  if (!client) {
    return { error: "Client not found." };
  }

  const serviceName = String(formData.get("serviceName") ?? "").trim();
  if (!serviceName) {
    return { error: "Service name is required." };
  }

  const feeInRupees = Number(formData.get("feeInRupees"));
  const feeInPaise = Math.round(feeInRupees * 100);
  if (!Number.isFinite(feeInRupees) || feeInRupees <= 0 || feeInPaise > MAX_FEE_IN_PAISE) {
    return { error: "Price must be greater than zero and no more than ₹1,00,00,000." };
  }

  const billingDay = Number(formData.get("billingDay"));
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28) {
    return { error: "Billing day must be between 1 and 28." };
  }

  const frequency = String(formData.get("frequency"));
  if (!VALID_FREQUENCIES.includes(frequency as BillingFrequency)) {
    return { error: "Invalid billing frequency." };
  }

  const startDateRaw = String(formData.get("startDate") ?? "");
  const startDate = new Date(startDateRaw);
  if (Number.isNaN(startDate.getTime())) {
    return { error: "A valid start date is required." };
  }

  const endDateRaw = String(formData.get("endDate") ?? "").trim();
  const endDate = endDateRaw ? new Date(endDateRaw) : null;
  if (endDate && Number.isNaN(endDate.getTime())) {
    return { error: "End date is invalid." };
  }

  const service = await createClientService({
    clientId,
    serviceName,
    feeInPaise,
    frequency: frequency as BillingFrequency,
    billingDay,
    startDate,
    endDate,
  });

  const { admin } = await requireClientInOwnOrg(clientId);
  await prisma.clientActivity.create({
    data: {
      clientId,
      actorAdminId: admin!.id,
      eventType: "service.added",
      summary: `${serviceName} added as a service.`,
    },
  });

  return { clientServiceId: service.id };
}

export async function updateServiceAction(
  clientServiceId: number,
  formData: FormData
): Promise<{ error: string } | { ok: true }> {
  if (!Number.isInteger(clientServiceId)) {
    return { error: "Invalid service." };
  }

  const { admin, clientService } = await requireClientServiceInOwnOrg(clientServiceId);
  if (!clientService) {
    return { error: "Service not found." };
  }

  const feeInRupees = Number(formData.get("feeInRupees"));
  const feeInPaise = Math.round(feeInRupees * 100);
  if (!Number.isFinite(feeInRupees) || feeInRupees <= 0 || feeInPaise > MAX_FEE_IN_PAISE) {
    return { error: "Price must be greater than zero and no more than ₹1,00,00,000." };
  }

  const billingDay = Number(formData.get("billingDay"));
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28) {
    return { error: "Billing day must be between 1 and 28." };
  }

  const frequency = String(formData.get("frequency"));
  if (!VALID_FREQUENCIES.includes(frequency as BillingFrequency)) {
    return { error: "Invalid billing frequency." };
  }

  const endDateRaw = String(formData.get("endDate") ?? "").trim();
  const endDate = endDateRaw ? new Date(endDateRaw) : null;
  if (endDate && Number.isNaN(endDate.getTime())) {
    return { error: "End date is invalid." };
  }

  await prisma.$transaction([
    prisma.clientService.update({
      where: { id: clientServiceId },
      data: { endDate },
    }),
    prisma.billingPlan.update({
      where: { clientServiceId },
      data: {
        amountInPaise: feeInPaise,
        frequency: frequency as BillingFrequency,
        billingDay,
      },
    }),
    prisma.clientActivity.create({
      data: {
        clientId: clientService.clientId,
        actorAdminId: admin.id,
        eventType: "service.updated",
        summary: `Service updated: ₹${feeInRupees.toLocaleString("en-IN")} / ${frequency}, billing day ${billingDay}${endDate ? `, ends ${endDate.toISOString().slice(0, 10)}` : ""}.`,
      },
    }),
  ]);

  return { ok: true };
}

export async function updateServiceStatusAction(
  clientServiceId: number,
  status: ServiceStatus
): Promise<{ error: string } | { ok: true }> {
  if (!Number.isInteger(clientServiceId)) {
    return { error: "Invalid service." };
  }

  const { admin, clientService } = await requireClientServiceInOwnOrg(clientServiceId);
  if (!clientService) {
    return { error: "Service not found." };
  }

  if (!VALID_STATUSES.includes(status)) {
    return { error: "Invalid status." };
  }

  await prisma.$transaction([
    prisma.clientService.update({
      where: { id: clientServiceId },
      data: { status },
    }),
    prisma.clientActivity.create({
      data: {
        clientId: clientService.clientId,
        actorAdminId: admin.id,
        eventType: "service.status_changed",
        summary: `Service status changed to ${status}.`,
      },
    }),
  ]);

  return { ok: true };
}
