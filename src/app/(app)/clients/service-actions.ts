"use server";

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";
import { requireClientInOwnOrg } from "./actions";
import { createClientService } from "@/lib/services";
import type { BillingFrequency } from "@/generated/prisma/client";

const VALID_FREQUENCIES: BillingFrequency[] = [
  "MONTHLY",
  "QUARTERLY",
  "HALF_YEARLY",
  "YEARLY",
  "ONE_TIME",
];

/**
 * Resolves a clientServiceId to its owning client, scoped to the
 * authenticated admin's organization — the service-level counterpart to
 * requireClientInOwnOrg. Never throws for a missing/wrong-org id; callers
 * check `clientService === null`.
 */
export async function requireClientServiceInOwnOrg(clientServiceId: number) {
  const admin = await requireAdmin();
  const clientService = await prisma.clientService.findFirst({
    where: {
      id: clientServiceId,
      client: { organizationId: admin.organizationId },
    },
    include: { client: true },
  });
  return { admin, clientService };
}

export async function createServiceAction(
  clientId: number,
  formData: FormData
): Promise<{ error: string } | { clientServiceId: number }> {
  const { client } = await requireClientInOwnOrg(clientId);
  if (!client) {
    return { error: "Client not found." };
  }

  const serviceName = String(formData.get("serviceName") ?? "").trim();
  if (!serviceName) {
    return { error: "Service name is required." };
  }

  const feeInRupees = Number(formData.get("feeInRupees"));
  if (!Number.isFinite(feeInRupees) || feeInRupees <= 0) {
    return { error: "Price must be greater than zero." };
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
    feeInPaise: Math.round(feeInRupees * 100),
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
  const { clientService } = await requireClientServiceInOwnOrg(clientServiceId);
  if (!clientService) {
    return { error: "Service not found." };
  }

  const feeInRupees = Number(formData.get("feeInRupees"));
  if (!Number.isFinite(feeInRupees) || feeInRupees <= 0) {
    return { error: "Price must be greater than zero." };
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
        amountInPaise: Math.round(feeInRupees * 100),
        frequency: frequency as BillingFrequency,
        billingDay,
      },
    }),
  ]);

  return { ok: true };
}

export async function updateServiceStatusAction(
  clientServiceId: number,
  status: "ACTIVE" | "PAUSED" | "CANCELLED"
): Promise<{ error: string } | { ok: true }> {
  const { admin, clientService } = await requireClientServiceInOwnOrg(clientServiceId);
  if (!clientService) {
    return { error: "Service not found." };
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
