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

  // I1: scope to ACTIVE services only — mirrors getAttentionData's filter so the
  // Monthly Summary's Overdue figure can never contradict the Attention section's
  // Overdue card. Without this, a paused/cancelled service carrying a stranded
  // unpaid period would inflate Overdue here while being invisible to Attention.
  const thisMonthPeriods = await prisma.billingPeriod.findMany({
    where: {
      periodLabel: label,
      billingPlan: {
        clientService: { status: "ACTIVE", client: { organizationId } },
      },
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

  // Overdue spans ALL months, not just this one — consistent with getAttentionData
  // which also uses a cross-month view for the Attention section's Overdue card.
  // I1: same ACTIVE filter as thisMonthPeriods above so the two figures agree.
  //
  // I2: NOTE on "Expected" — a client in arrears (last month unpaid) has no
  // current-month BillingPeriod row until the prior one is marked PAID (by
  // design: periods are generated lazily on payment). So Expected legitimately
  // reads ₹0 for such clients; Overdue captures the outstanding obligation.
  // This is the correct interpretation of the plan's "how much business is
  // billed this cycle" definition; it is not a bug.
  const allOverduePeriods = await prisma.billingPeriod.findMany({
    where: {
      status: { not: "PAID" },
      dueDate: { lt: normalizedToday },
      billingPlan: {
        clientService: { status: "ACTIVE", client: { organizationId } },
      },
    },
  });
  const overdueInPaise = allOverduePeriods.reduce((sum, p) => sum + p.amountInPaise, 0);

  const pendingInPaise = expectedInPaise - collectedInPaise - overdueThisMonthInPaise;

  return { expectedInPaise, collectedInPaise, pendingInPaise, overdueInPaise };
}

// ---------------------------------------------------------------------------
// Work updates — active services needing work attention, ranked by next action
// ---------------------------------------------------------------------------

export type WorkUpdateItem = {
  clientServiceId: number;
  clientId: number;
  clientName: string;
  serviceName: string;
  workStatus: string;
  progressPercent: number | null;
  nextActionNote: string | null;
  nextActionDate: Date | null;
  updatedAt: Date;
};

export async function getWorkUpdates(
  organizationId: number,
  today: Date,
  limit = 8
): Promise<WorkUpdateItem[]> {
  const todayStart = startOfUTCDay(today);

  // Fetch all active, non-completed services with work data
  const services = await prisma.clientService.findMany({
    where: {
      status: "ACTIVE",
      workStatus: { not: "COMPLETED" },
      client: { organizationId },
    },
    include: {
      client: { select: { id: true, businessName: true } },
      serviceTemplate: { select: { name: true } },
    },
    orderBy: [
      // Rows with a nextActionDate come before those without
      { nextActionDate: "asc" },
      // Then most recently updated
      { updatedAt: "desc" },
    ],
    take: limit * 2, // fetch extra so we can re-sort in JS
  });

  // Re-rank: overdue/due-today first, then future dates, then no date
  const overdue: typeof services = [];
  const upcoming: typeof services = [];
  const noDate: typeof services = [];

  for (const s of services) {
    if (s.nextActionDate) {
      const dateMs = new Date(s.nextActionDate).setUTCHours(0, 0, 0, 0);
      if (dateMs <= todayStart.getTime()) {
        overdue.push(s);
      } else {
        upcoming.push(s);
      }
    } else {
      noDate.push(s);
    }
  }

  const ranked = [...overdue, ...upcoming, ...noDate].slice(0, limit);

  return ranked.map((s) => ({
    clientServiceId: s.id,
    clientId: s.client.id,
    clientName: s.client.businessName,
    serviceName: s.serviceTemplate.name,
    workStatus: s.workStatus,
    progressPercent: s.progressPercent,
    nextActionNote: s.nextActionNote,
    nextActionDate: s.nextActionDate,
    updatedAt: s.updatedAt,
  }));
}

// ---------------------------------------------------------------------------
// Recent activity — org-scoped, newest first
// ---------------------------------------------------------------------------

export type RecentActivityItem = {
  id: number;
  clientId: number;
  clientName: string;
  eventType: string;
  summary: string;
  createdAt: Date;
};

export async function getRecentActivity(
  organizationId: number,
  limit = 6
): Promise<RecentActivityItem[]> {
  const rows = await prisma.clientActivity.findMany({
    where: { client: { organizationId } },
    include: { client: { select: { id: true, businessName: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    clientId: r.client.id,
    clientName: r.client.businessName,
    eventType: r.eventType,
    summary: r.summary,
    createdAt: r.createdAt,
  }));
}
