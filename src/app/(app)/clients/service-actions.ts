"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireClientInOwnOrg, requireClientServiceInOwnOrg } from "@/lib/authz";
import { createClientService } from "@/lib/services";
import type { BillingFrequency, WorkStatus } from "@/generated/prisma/client";
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

  // Multi-value: FormData.getAll("categories") returns every checked value.
  const categories = formData.getAll("categories").map(String).filter(Boolean);

  const service = await createClientService({
    clientId,
    serviceName,
    feeInPaise,
    frequency: frequency as BillingFrequency,
    billingDay,
    startDate,
    endDate,
    categories,
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

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath(`/clients/${clientId}`);
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

  // Categories: replace all existing tags atomically inside the transaction.
  const categories = [
    ...new Set(formData.getAll("categories").map(String).filter(Boolean)),
  ];

  await prisma.$transaction(async (tx) => {
    await tx.clientService.update({
      where: { id: clientServiceId },
      data: { endDate },
    });
    await tx.billingPlan.update({
      where: { clientServiceId },
      data: {
        amountInPaise: feeInPaise,
        frequency: frequency as BillingFrequency,
        billingDay,
      },
    });
    // Replace categories: delete existing, insert new.
    await tx.clientServiceCategory.deleteMany({ where: { clientServiceId } });
    if (categories.length > 0) {
      await tx.clientServiceCategory.createMany({
        data: categories.map((category) => ({ clientServiceId, category })),
      });
    }
    await tx.clientActivity.create({
      data: {
        clientId: clientService.clientId,
        actorAdminId: admin.id,
        eventType: "service.updated",
        summary: `Service updated: ₹${feeInRupees.toLocaleString("en-IN")} / ${frequency}, billing day ${billingDay}${endDate ? `, ends ${endDate.toISOString().slice(0, 10)}` : ""}.`,
      },
    });
  });

  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath(`/clients/${clientService.clientId}`);
  return { ok: true };
}

function optionalString(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value || null;
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

  revalidatePath("/");
  revalidatePath(`/clients/${clientService.clientId}`);
  return { ok: true };
}

const VALID_WORK_STATUSES: WorkStatus[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETED",
  "ON_HOLD",
];

export async function updateWorkStatusAction(
  clientServiceId: number,
  formData: FormData
): Promise<{ error: string } | { ok: true }> {
  // M1: Reject non-integer IDs before any DB call (matches sibling actions)
  if (!Number.isInteger(clientServiceId)) {
    return { error: "Service not found." };
  }

  const { admin, clientService } = await requireClientServiceInOwnOrg(clientServiceId);
  if (!clientService) {
    return { error: "Service not found." };
  }

  const workStatus = String(formData.get("workStatus") ?? "").trim();
  if (!VALID_WORK_STATUSES.includes(workStatus as WorkStatus)) {
    return { error: "Invalid work status." };
  }

  const progressRaw = String(formData.get("progressPercent") ?? "").trim();
  let progressPercent: number | null = null;
  if (progressRaw) {
    const parsed = Number(progressRaw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      return { error: "Progress must be between 0 and 100." };
    }
    progressPercent = Math.round(parsed);
  }

  // I3: Only include optional fields when the form actually submitted them.
  // Without formData.has() guards, an absent field would overwrite the DB
  // column with null — a partial update (e.g. status-only) would silently
  // erase existing notes. This also future-proofs for non-full-form callers
  // (Plan 3+ quick-toggle UI).
  const updateData: Record<string, unknown> = {
    workStatus: workStatus as WorkStatus,
    progressPercent,
  };
  if (formData.has("workNote")) updateData.workNote = optionalString(formData, "workNote");
  if (formData.has("nextActionNote")) updateData.nextActionNote = optionalString(formData, "nextActionNote");

  let nextActionDate: Date | null | undefined;
  if (formData.has("nextActionDate")) {
    const raw = String(formData.get("nextActionDate") ?? "").trim();
    nextActionDate = raw ? new Date(raw) : null;
    if (nextActionDate && Number.isNaN(nextActionDate.getTime())) {
      return { error: "Next action date is invalid." };
    }
    updateData.nextActionDate = nextActionDate;
  }

  await prisma.clientService.update({
    where: { id: clientServiceId },
    data: updateData,
  });

  if (workStatus !== clientService.workStatus) {
    await prisma.clientActivity.create({
      data: {
        clientId: clientService.clientId,
        actorAdminId: admin.id,
        eventType: "service.work_updated",
        summary: `Work status changed to ${workStatus.replace("_", " ")}.`,
      },
    });
  }

  revalidatePath("/");
  revalidatePath("/work");
  revalidatePath(`/clients/${clientService.clientId}`);
  return { ok: true };
}
