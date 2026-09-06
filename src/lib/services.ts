import { prisma } from "@/lib/db";
import { firstPeriodLabel, dueDateForPeriod } from "@/lib/billing-dates";
import type { BillingFrequency } from "@/generated/prisma/client";

export async function findOrCreateServiceTemplate(
  organizationId: number,
  name: string
) {
  const trimmedName = name.trim();

  const existing = await prisma.serviceTemplate.findFirst({
    where: {
      organizationId,
      name: { equals: trimmedName },
    },
  });
  if (existing) {
    return existing;
  }

  return prisma.serviceTemplate.create({
    data: { organizationId, name: trimmedName },
  });
}

export type CreateClientServiceInput = {
  clientId: number;
  serviceName: string;
  feeInPaise: number;
  frequency: BillingFrequency;
  billingDay: number;
  startDate: Date;
  endDate: Date | null;
  /** Service-category tags (e.g. ["Google Ads", "Local SEO"]). Zero or more. */
  categories?: string[];
};

/**
 * Creates a client's service, its billing plan, and its first billing
 * period in one transaction. The service template is found-or-created
 * as part of the same transaction so a concurrent duplicate-name create
 * can't race past this function's own lookup.
 */
export async function createClientService(input: CreateClientServiceInput) {
  return prisma.$transaction(async (tx) => {
    const client = await tx.client.findUniqueOrThrow({
      where: { id: input.clientId },
    });
    const trimmedName = input.serviceName.trim();

    const template =
      (await tx.serviceTemplate.findFirst({
        where: {
          organizationId: client.organizationId,
          name: { equals: trimmedName },
        },
      })) ??
      (await tx.serviceTemplate.create({
        data: {
          organizationId: client.organizationId,
          name: trimmedName,
        },
      }));

    const service = await tx.clientService.create({
      data: {
        clientId: input.clientId,
        serviceTemplateId: template.id,
        feeInPaise: input.feeInPaise,
        startDate: input.startDate,
        endDate: input.endDate,
      },
    });

    const plan = await tx.billingPlan.create({
      data: {
        clientServiceId: service.id,
        amountInPaise: input.feeInPaise,
        frequency: input.frequency,
        billingDay: input.billingDay,
        startDate: input.startDate,
      },
    });

    const periodLabel = firstPeriodLabel(input.startDate, input.billingDay);
    await tx.billingPeriod.create({
      data: {
        billingPlanId: plan.id,
        periodLabel,
        amountInPaise: input.feeInPaise,
        dueDate: dueDateForPeriod(periodLabel, input.billingDay),
      },
    });

    // Write category tags. Deduped and trimmed; silently skipped if empty.
    const categories = [
      ...new Set((input.categories ?? []).map((c) => c.trim()).filter(Boolean)),
    ];
    if (categories.length > 0) {
      await tx.clientServiceCategory.createMany({
        data: categories.map((category) => ({
          clientServiceId: service.id,
          category,
        })),
      });
    }

    return service;
  });
}

export async function getServicesForClient(clientId: number) {
  return prisma.clientService.findMany({
    where: { clientId },
    include: {
      serviceTemplate: true,
      billingPlan: {
        include: {
          billingPeriods: { orderBy: { periodLabel: "desc" } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}
