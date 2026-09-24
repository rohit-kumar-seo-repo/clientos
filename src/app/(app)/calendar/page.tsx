import { requireAdmin } from "@/lib/require-admin";
import { prisma } from "@/lib/db";
import { CalendarView, type CalendarEvent } from "@/components/calendar/CalendarView";

/** Convert a UTC Date to an IST date string "YYYY-MM-DD". */
function toISTDateStr(d: Date): string {
  return new Date(d.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const admin = await requireAdmin();
  const { year: yearParam, month: monthParam } = await searchParams;

  // Today in IST
  const now = new Date();
  const nowIST = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const todayStr = nowIST.toISOString().slice(0, 10);

  // Parse year/month from URL, default to IST current month
  const year =
    yearParam && /^\d{4}$/.test(yearParam)
      ? parseInt(yearParam, 10)
      : nowIST.getUTCFullYear();
  const month =
    monthParam && /^\d{1,2}$/.test(monthParam)
      ? Math.min(12, Math.max(1, parseInt(monthParam, 10)))
      : nowIST.getUTCMonth() + 1;

  // UTC window for the displayed calendar month
  const windowStart = new Date(Date.UTC(year, month - 1, 1));
  const windowEnd = new Date(Date.UTC(year, month, 1)); // exclusive

  const [payments, billingPeriods, milestones, addOns] = await Promise.all([
    // Captured payments this month — any type (recurring or project)
    prisma.payment.findMany({
      where: {
        status: "CAPTURED",
        capturedAt: { gte: windowStart, lt: windowEnd },
        // A client-less "new customer" payment has no invoice.client — org-
        // scope it via its PaymentLink instead (see payments/page.tsx).
        OR: [
          { invoice: { client: { organizationId: admin.organizationId } } },
          { paymentLink: { organizationId: admin.organizationId } },
        ],
      },
      include: {
        paymentLink: { select: { customerName: true } },
        invoice: {
          include: {
            client: true,
            lineItems: {
              include: {
                billingPeriod: {
                  include: {
                    billingPlan: {
                      include: {
                        clientService: { include: { serviceTemplate: true } },
                      },
                    },
                  },
                },
                projectMilestone: { include: { project: true } },
                projectAddOn: { include: { project: true } },
              },
            },
          },
        },
      },
    }),

    // Unpaid billing periods due in this month
    prisma.billingPeriod.findMany({
      where: {
        status: "UPCOMING",
        dueDate: { gte: windowStart, lt: windowEnd },
        billingPlan: {
          clientService: { client: { organizationId: admin.organizationId } },
        },
      },
      include: {
        billingPlan: {
          include: {
            clientService: {
              include: { serviceTemplate: true, client: true },
            },
          },
        },
      },
    }),

    // Unpaid project milestones due in this month
    prisma.projectMilestone.findMany({
      where: {
        status: "PENDING",
        dueDate: { gte: windowStart, lt: windowEnd },
        project: { client: { organizationId: admin.organizationId } },
      },
      include: { project: { include: { client: true } } },
    }),

    // Unpaid project add-ons due in this month
    prisma.projectAddOn.findMany({
      where: {
        status: "PENDING",
        dueDate: { gte: windowStart, lt: windowEnd },
        project: { client: { organizationId: admin.organizationId } },
      },
      include: { project: { include: { client: true } } },
    }),
  ]);

  const events: CalendarEvent[] = [];

  // ── Paid payments ──────────────────────────────────────────────────────────
  for (const p of payments) {
    if (!p.capturedAt) continue;
    const date = toISTDateStr(p.capturedAt);
    const item = p.invoice.lineItems[0];
    const clientName = p.invoice.client?.businessName ?? p.paymentLink?.customerName ?? "Unknown customer";
    let description = "Payment";
    let kind: CalendarEvent["kind"] = "recurring";

    if (item?.projectMilestone) {
      description = `${item.projectMilestone.project.title} — ${item.projectMilestone.label}`;
      kind = "milestone";
    } else if (item?.projectAddOn) {
      description = `${item.projectAddOn.project.title} — ${item.projectAddOn.description}`;
      kind = "addon";
    } else if (item?.billingPeriod) {
      description =
        item.billingPeriod.billingPlan.clientService.serviceTemplate.name;
    }

    events.push({
      date,
      type: "paid",
      kind,
      clientName,
      description,
      amountInPaise: p.amountInPaise,
      clientId: p.invoice.clientId,
    });
  }

  // ── Pending billing periods ────────────────────────────────────────────────
  for (const bp of billingPeriods) {
    const date = toISTDateStr(bp.dueDate);
    const cs = bp.billingPlan.clientService;
    events.push({
      date,
      type: date < todayStr ? "overdue" : "due",
      kind: "recurring",
      clientName: cs.client.businessName,
      description: cs.serviceTemplate.name,
      amountInPaise: bp.amountInPaise,
      clientId: cs.client.id,
    });
  }

  // ── Pending project milestones ─────────────────────────────────────────────
  for (const m of milestones) {
    if (!m.dueDate) continue; // guarded by WHERE; satisfies TypeScript
    const date = toISTDateStr(m.dueDate);
    events.push({
      date,
      type: date < todayStr ? "overdue" : "due",
      kind: "milestone",
      clientName: m.project.client.businessName,
      description: `${m.project.title} — ${m.label}`,
      amountInPaise: m.amountInPaise,
      clientId: m.project.client.id,
    });
  }

  // ── Pending project add-ons ────────────────────────────────────────────────
  for (const a of addOns) {
    if (!a.dueDate) continue; // guarded by WHERE; satisfies TypeScript
    const date = toISTDateStr(a.dueDate);
    events.push({
      date,
      type: date < todayStr ? "overdue" : "due",
      kind: "addon",
      clientName: a.project.client.businessName,
      description: `${a.project.title} — ${a.description}`,
      amountInPaise: a.amountInPaise,
      clientId: a.project.client.id,
    });
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-neutral-900">
          Payment Calendar
        </h1>
      </div>
      <CalendarView year={year} month={month} today={todayStr} events={events} />
    </div>
  );
}
