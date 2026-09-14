import type { RankedService } from "@/lib/attention";
import type { ProjectObligationItem } from "@/lib/dashboard";

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
}: {
  services: RankedService[];
  projectObligations: ProjectObligationItem[];
}) {
  const overduePay = services.filter((s) => s.tier === "overdue_payment");
  const overduePayProj = projectObligations.filter((p) => p.tier === "overdue_payment");

  const dueToday = services.filter((s) => s.tier === "due_today");
  const dueTodayProj = projectObligations.filter((p) => p.tier === "due_today");

  const dueNext3 = services.filter((s) =>
    ["due_tomorrow", "due_within_3_days"].includes(s.tier)
  );
  const dueNext3Proj = projectObligations.filter((p) =>
    ["due_tomorrow", "due_within_3_days"].includes(p.tier)
  );

  const workAttention = services.filter((s) => s.tier === "overdue_work");
  const renewals = services.filter((s) => s.tier === "upcoming_renewal");

  return (
    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
      {/* Overdue Payments */}
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

      {/* Due Today */}
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

      {/* Due Next 3 Days */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <p className="mb-2 text-xs font-medium text-neutral-500">Due Next 3 Days</p>
        <p className="text-2xl font-semibold text-amber-500">
          {dueNext3.length + dueNext3Proj.length > 0
            ? fmt(serviceTotal(dueNext3) + projTotal(dueNext3Proj))
            : "₹0"}
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          {uniqueClientCount(dueNext3.map(s => s.clientId), dueNext3Proj.map(p => p.clientId))}{" "}
          clients &middot;{" "}
          {dueNext3.length + dueNext3Proj.length} items
        </p>
      </div>

      {/* Work Needs Attention — recurring only, no change */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <p className="mb-2 text-xs font-medium text-neutral-500">Work Attention</p>
        <p className="text-2xl font-semibold text-indigo-600">{workAttention.length}</p>
        <p className="mt-1 text-xs text-neutral-400">
          {workAttention.length === 1 ? "service" : "services"} need attention
        </p>
      </div>

      {/* Upcoming Renewals — recurring only, no change */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <p className="mb-2 text-xs font-medium text-neutral-500">Upcoming Renewals</p>
        <p className="text-2xl font-semibold text-neutral-700">{renewals.length}</p>
        <p className="mt-1 text-xs text-neutral-400">
          {renewals.length === 1 ? "client" : "clients"} &middot; next 30 days
        </p>
      </div>
    </div>
  );
}
