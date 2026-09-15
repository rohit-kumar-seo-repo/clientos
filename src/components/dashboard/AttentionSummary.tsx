import type { RankedService } from "@/lib/attention";
import type { MonthlySummary, ProjectObligationItem } from "@/lib/dashboard";

function fmt(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function uniqueClientCount(serviceClientIds: number[], projClientIds: number[]): number {
  return new Set([...serviceClientIds, ...projClientIds]).size;
}

function serviceTotal(services: RankedService[]): number {
  return services.reduce((sum, s) => sum + s.outstandingAmountInPaise, 0);
}

function projTotal(items: ProjectObligationItem[]): number {
  return items.reduce((sum, p) => sum + p.amountInPaise, 0);
}

export function AttentionSummary({
  services,
  projectObligations,
  summary,
}: {
  services: RankedService[];
  projectObligations: ProjectObligationItem[];
  summary: MonthlySummary;
}) {
  const overduePay = services.filter((s) => s.tier === "overdue_payment");
  const overduePayProj = projectObligations.filter((p) => p.tier === "overdue_payment");

  const dueToday = services.filter((s) => s.tier === "due_today");
  const dueTodayProj = projectObligations.filter((p) => p.tier === "due_today");

  const workAttention = services.filter((s) => s.tier === "overdue_work");

  return (
    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
      {/* 1. Expected This Month — recurring + projects due this month */}
      <div className="rounded-xl border border-blue-100 bg-white p-4">
        <p className="mb-2 text-xs font-medium text-neutral-500">Expected This Month</p>
        <p className="text-2xl font-semibold text-blue-600">
          {fmt(summary.thisMonth.expectedInPaise)}
        </p>
        <p className="mt-1 text-xs text-neutral-400">recurring + one-time projects</p>
      </div>

      {/* 2. Total Collected Payment — this month, recurring + projects */}
      <div className="rounded-xl border border-emerald-100 bg-white p-4">
        <p className="mb-2 text-xs font-medium text-neutral-500">Total Collected Payment</p>
        <p className="text-2xl font-semibold text-emerald-600">
          {fmt(summary.thisMonth.collectedInPaise)}
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          {summary.thisMonth.paymentCount} {summary.thisMonth.paymentCount === 1 ? "payment" : "payments"} this month
        </p>
      </div>

      {/* 3. Overdue Payments */}
      <div className="rounded-xl border border-red-100 bg-white p-4">
        <p className="mb-2 text-xs font-medium text-neutral-500">Overdue Payments</p>
        <p className="text-2xl font-semibold text-red-600">
          {overduePay.length + overduePayProj.length > 0
            ? fmt(serviceTotal(overduePay) + projTotal(overduePayProj))
            : "₹0"}
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          {uniqueClientCount(overduePay.map(s => s.clientId), overduePayProj.map(p => p.clientId))}{" "}
          clients &middot;{" "}
          {overduePay.length + overduePayProj.length} items
        </p>
      </div>

      {/* 4. Due Today */}
      <div className="rounded-xl border border-amber-100 bg-white p-4">
        <p className="mb-2 text-xs font-medium text-neutral-500">Due Today</p>
        <p className="text-2xl font-semibold text-amber-600">
          {dueToday.length + dueTodayProj.length > 0
            ? fmt(serviceTotal(dueToday) + projTotal(dueTodayProj))
            : "₹0"}
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          {uniqueClientCount(dueToday.map(s => s.clientId), dueTodayProj.map(p => p.clientId))}{" "}
          clients &middot;{" "}
          {dueToday.length + dueTodayProj.length} items
        </p>
      </div>

      {/* 5. Work Needs Attention — recurring only, no change */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <p className="mb-2 text-xs font-medium text-neutral-500">Work Attention</p>
        <p className="text-2xl font-semibold text-indigo-600">{workAttention.length}</p>
        <p className="mt-1 text-xs text-neutral-400">
          {workAttention.length === 1 ? "service" : "services"} need attention
        </p>
      </div>
    </div>
  );
}
