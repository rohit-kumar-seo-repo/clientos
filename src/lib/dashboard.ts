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
  recurring: {
    expectedInPaise: number;
    collectedInPaise: number;
    pendingInPaise: number;
    overdueInPaise: number;
  };
  projects: {
    expectedInPaise: number;  // total base amount of all non-cancelled projects
    collectedInPaise: number; // total collected across project lifetime
    pendingInPaise: number;
    overdueInPaise: number;
  };
  // Cross-cutting "this month" totals — feeds the Expected/Collected This
  // Month KPI cards.
  thisMonth: {
    expectedInPaise: number;  // recurring + project obligations due this month
    collectedInPaise: number; // recurring + project payments collected this month
    paymentCount: number;     // number of payment events this month
  };
};

export async function getMonthlySummary(
  organizationId: number,
  today: Date
): Promise<MonthlySummary> {
  const label = currentPeriodLabel(today);
  const normalizedToday = startOfUTCDay(today);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));

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

  // ── Project obligations (milestones + add-ons) ─────────────────────────────
  // Shared filter: exclude CANCELLED projects; scope to org via client.
  const projectFilter = {
    client: { organizationId },
    status: { not: "CANCELLED" as const },
  };

  // Single fetch per model (all non-cancelled-project obligations, any
  // status) — every aggregate below is derived from these two arrays so
  // they can never drift apart from separate queries with slightly
  // different filters.
  const [allProjects, allMilestones, allAddOns] = await Promise.all([
    prisma.project.findMany({
      where: projectFilter,
      select: { baseAmountInPaise: true },
    }),
    prisma.projectMilestone.findMany({
      where: { project: projectFilter },
      select: { amountInPaise: true, status: true, dueDate: true },
    }),
    prisma.projectAddOn.findMany({
      where: { project: projectFilter },
      select: { amountInPaise: true, status: true, dueDate: true },
    }),
  ]);

  const allObligations = [...allMilestones, ...allAddOns];
  const isThisMonth = (d: Date | null) => d !== null && d >= monthStart && d < monthEnd;

  // Expected: total contracted value of every active (non-cancelled) project —
  // not just obligations due this month. This is the project's base amount.
  const projectExpectedInPaise = allProjects.reduce((s, p) => s + p.baseAmountInPaise, 0);

  // This month's obligations (any status) — feeds the Expected This Month KPI.
  const projectExpectedThisMonthInPaise = allObligations
    .filter((o) => isThisMonth(o.dueDate))
    .reduce((s, o) => s + o.amountInPaise, 0);

  const paidObligations = allObligations.filter((o) => o.status === "PAID");

  // Collected: all payments received across the project's lifetime.
  const projectCollectedInPaise = paidObligations.reduce((s, o) => s + o.amountInPaise, 0);

  // This month's slice of collected — dueDate is set to paidAt when a payment
  // is recorded (see recordProjectPaymentAction), so this correctly reflects
  // when the money actually came in, not when the milestone was created.
  const projectCollectedThisMonthInPaise = paidObligations
    .filter((o) => isThisMonth(o.dueDate))
    .reduce((s, o) => s + o.amountInPaise, 0);
  const projectPaymentCountThisMonth = paidObligations.filter((o) =>
    isThisMonth(o.dueDate)
  ).length;

  // Overdue all time: feeds the Overdue card (same cross-month scope as recurring)
  const projectOverdueAllInPaise = allObligations
    .filter((o) => o.status === "PENDING" && o.dueDate !== null && o.dueDate < normalizedToday)
    .reduce((s, o) => s + o.amountInPaise, 0);

  return {
    recurring: {
      expectedInPaise,
      collectedInPaise,
      pendingInPaise: expectedInPaise - collectedInPaise - overdueThisMonthInPaise,
      overdueInPaise,
    },
    projects: {
      expectedInPaise: projectExpectedInPaise,
      collectedInPaise: projectCollectedInPaise,
      pendingInPaise: Math.max(
        0,
        projectExpectedInPaise - projectCollectedInPaise - projectOverdueAllInPaise
      ),
      overdueInPaise: projectOverdueAllInPaise,
    },
    thisMonth: {
      expectedInPaise: expectedInPaise + projectExpectedThisMonthInPaise,
      collectedInPaise: collectedInPaise + projectCollectedThisMonthInPaise,
      paymentCount: paidThisMonthPeriodIds.length + projectPaymentCountThisMonth,
    },
  };
}

// ---------------------------------------------------------------------------
// Project obligations — PENDING milestones/add-ons due within 7 days or overdue
// ---------------------------------------------------------------------------

type PaymentTier =
  | "overdue_payment"
  | "due_today"
  | "due_tomorrow"
  | "due_within_3_days"
  | "due_within_7_days";

export type ProjectObligationItem = {
  id: number;
  kind: "milestone" | "addon";
  clientId: number;
  clientName: string;
  projectTitle: string;
  label: string;        // milestone.label or addon.description
  amountInPaise: number;
  dueDate: Date;
  tier: PaymentTier;
  daysOverdue: number;  // positive when overdue, 0 otherwise
};

function paymentTierForDays(daysToDue: number): PaymentTier | null {
  if (daysToDue < 0) return "overdue_payment";
  if (daysToDue === 0) return "due_today";
  if (daysToDue === 1) return "due_tomorrow";
  if (daysToDue <= 3) return "due_within_3_days";
  if (daysToDue <= 7) return "due_within_7_days";
  return null; // > 7 days: not attention-worthy for payment
}

const OBLIGATION_TIER_RANK: Record<string, number> = {
  overdue_payment: 1,
  due_today: 2,
  due_tomorrow: 3,
  due_within_3_days: 4,
  due_within_7_days: 5,
};

export async function getProjectObligations(
  organizationId: number,
  today: Date
): Promise<ProjectObligationItem[]> {
  const todayMs = startOfUTCDay(today).getTime();
  const projectFilter = {
    client: { organizationId },
    status: { not: "CANCELLED" as const },
  };

  const [milestones, addOns] = await Promise.all([
    prisma.projectMilestone.findMany({
      where: { status: "PENDING", dueDate: { not: null }, project: projectFilter },
      include: {
        project: { include: { client: { select: { id: true, businessName: true } } } },
      },
    }),
    prisma.projectAddOn.findMany({
      where: { status: "PENDING", dueDate: { not: null }, project: projectFilter },
      include: {
        project: { include: { client: { select: { id: true, businessName: true } } } },
      },
    }),
  ]);

  const items: ProjectObligationItem[] = [];

  for (const m of milestones) {
    const dueDate = m.dueDate;
    if (!dueDate) continue;
    const daysToDue = Math.round(
      (new Date(dueDate).setUTCHours(0, 0, 0, 0) - todayMs) / 86_400_000
    );
    const tier = paymentTierForDays(daysToDue);
    if (!tier) continue;
    items.push({
      id: m.id,
      kind: "milestone",
      clientId: m.project.client.id,
      clientName: m.project.client.businessName,
      projectTitle: m.project.title,
      label: m.label,
      amountInPaise: m.amountInPaise,
      dueDate,
      tier,
      daysOverdue: daysToDue < 0 ? -daysToDue : 0,
    });
  }

  for (const a of addOns) {
    const dueDate = a.dueDate;
    if (!dueDate) continue;
    const daysToDue = Math.round(
      (new Date(dueDate).setUTCHours(0, 0, 0, 0) - todayMs) / 86_400_000
    );
    const tier = paymentTierForDays(daysToDue);
    if (!tier) continue;
    items.push({
      id: a.id,
      kind: "addon",
      clientId: a.project.client.id,
      clientName: a.project.client.businessName,
      projectTitle: a.project.title,
      label: a.description,
      amountInPaise: a.amountInPaise,
      dueDate,
      tier,
      daysOverdue: daysToDue < 0 ? -daysToDue : 0,
    });
  }

  items.sort((a, b) => {
    const ra = OBLIGATION_TIER_RANK[a.tier] ?? 9;
    const rb = OBLIGATION_TIER_RANK[b.tier] ?? 9;
    if (ra !== rb) return ra - rb;
    if (a.daysOverdue !== b.daysOverdue) return b.daysOverdue - a.daysOverdue;
    if (a.amountInPaise !== b.amountInPaise) return b.amountInPaise - a.amountInPaise;
    return a.dueDate.getTime() - b.dueDate.getTime();
  });

  return items;
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
