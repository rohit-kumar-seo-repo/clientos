import { prisma } from "@/lib/db";
import { rankServicesForAttention, startOfUTCDay } from "@/lib/attention";
import type { AttentionInput, RankedService } from "@/lib/attention";

function currentPeriodLabel(today: Date): string {
  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export async function getAttentionData(
  organizationId: number,
  today: Date
): Promise<RankedService[]> {
  const services = await prisma.clientService.findMany({
    where: {
      status: "ACTIVE",
      client: { organizationId },
    },
    include: {
      client: true,
      serviceTemplate: true,
      billingPlan: {
        include: {
          billingPeriods: {
            where: { status: "UPCOMING" },
            orderBy: { periodLabel: "asc" },
            take: 1,
          },
        },
      },
    },
  });

  const inputs: AttentionInput[] = services.map((service) => {
    const openPeriod = service.billingPlan?.billingPeriods[0] ?? null;
    return {
      clientServiceId: service.id,
      clientId: service.clientId,
      clientName: service.client.businessName,
      serviceName: service.serviceTemplate.name,
      workStatus: service.workStatus,
      nextActionDate: service.nextActionDate,
      endDate: service.endDate,
      currentPeriod: openPeriod
        ? {
            id: openPeriod.id,
            dueDate: openPeriod.dueDate,
            amountInPaise: openPeriod.amountInPaise,
            status: "UPCOMING" as const,
          }
        : null,
    };
  });

  return rankServicesForAttention(inputs, startOfUTCDay(today));
}

export type MonthlySummary = {
  expectedInPaise: number;
  collectedInPaise: number;
  pendingInPaise: number;
  overdueInPaise: number;
};

export async function getMonthlySummary(
  organizationId: number,
  today: Date
): Promise<MonthlySummary> {
  const label = currentPeriodLabel(today);
  const normalizedToday = startOfUTCDay(today);

  const thisMonthPeriods = await prisma.billingPeriod.findMany({
    where: {
      periodLabel: label,
      billingPlan: { clientService: { client: { organizationId } } },
    },
  });

  const expectedInPaise = thisMonthPeriods.reduce((sum, p) => sum + p.amountInPaise, 0);

  const paidThisMonthPeriodIds = thisMonthPeriods
    .filter((p) => p.status === "PAID")
    .map((p) => p.id);

  const collectedInPaise =
    paidThisMonthPeriodIds.length === 0
      ? 0
      : (
          await prisma.payment.aggregate({
            _sum: { amountInPaise: true },
            where: {
              status: "CAPTURED",
              invoice: {
                lineItems: { some: { billingPeriodId: { in: paidThisMonthPeriodIds } } },
              },
            },
          })
        )._sum.amountInPaise ?? 0;

  const overdueThisMonth = thisMonthPeriods.filter(
    (p) => p.status !== "PAID" && p.dueDate < normalizedToday
  );
  const overdueThisMonthInPaise = overdueThisMonth.reduce((sum, p) => sum + p.amountInPaise, 0);

  // Overdue spans ALL months, not just this one — see the plan's documented
  // interpretation at the top of this file.
  const allOverduePeriods = await prisma.billingPeriod.findMany({
    where: {
      status: { not: "PAID" },
      dueDate: { lt: normalizedToday },
      billingPlan: { clientService: { client: { organizationId } } },
    },
  });
  const overdueInPaise = allOverduePeriods.reduce((sum, p) => sum + p.amountInPaise, 0);

  const pendingInPaise = expectedInPaise - collectedInPaise - overdueThisMonthInPaise;

  return { expectedInPaise, collectedInPaise, pendingInPaise, overdueInPaise };
}
