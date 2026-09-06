import type { RankedService } from "@/lib/attention";

function uniqueClients(services: RankedService[]): number {
  return new Set(services.map((s) => s.clientId)).size;
}

function totalAmount(services: RankedService[]): number {
  return services.reduce((sum, s) => sum + s.outstandingAmountInPaise, 0);
}

function fmt(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export function AttentionSummary({ services }: { services: RankedService[] }) {
  const overduePay = services.filter((s) => s.tier === "overdue_payment");
  const dueToday = services.filter((s) => s.tier === "due_today");
  const dueNext3 = services.filter((s) =>
    ["due_tomorrow", "due_within_3_days"].includes(s.tier)
  );
  const workAttention = services.filter((s) => s.tier === "overdue_work");
  const renewals = services.filter((s) => s.tier === "upcoming_renewal");

  return (
    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
      {/* Overdue Payments */}
      <div className="rounded-xl border border-red-100 bg-white p-4">
        <p className="mb-2 text-xs font-medium text-neutral-500">Overdue Payments</p>
        <p className="text-2xl font-semibold text-red-600">
          {overduePay.length > 0 ? fmt(totalAmount(overduePay)) : "₹0"}
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          {uniqueClients(overduePay)} {uniqueClients(overduePay) === 1 ? "client" : "clients"} &middot; {overduePay.length} {overduePay.length === 1 ? "service" : "services"}
        </p>
      </div>

      {/* Due Today */}
      <div className="rounded-xl border border-amber-100 bg-white p-4">
        <p className="mb-2 text-xs font-medium text-neutral-500">Due Today</p>
        <p className="text-2xl font-semibold text-amber-600">
          {dueToday.length > 0 ? fmt(totalAmount(dueToday)) : "₹0"}
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          {uniqueClients(dueToday)} {uniqueClients(dueToday) === 1 ? "client" : "clients"} &middot; {dueToday.length} {dueToday.length === 1 ? "service" : "services"}
        </p>
      </div>

      {/* Due Next 3 Days */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <p className="mb-2 text-xs font-medium text-neutral-500">Due Next 3 Days</p>
        <p className="text-2xl font-semibold text-amber-500">
          {dueNext3.length > 0 ? fmt(totalAmount(dueNext3)) : "₹0"}
        </p>
        <p className="mt-1 text-xs text-neutral-400">
          {uniqueClients(dueNext3)} {uniqueClients(dueNext3) === 1 ? "client" : "clients"} &middot; {dueNext3.length} {dueNext3.length === 1 ? "service" : "services"}
        </p>
      </div>

      {/* Work Needs Attention */}
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <p className="mb-2 text-xs font-medium text-neutral-500">Work Attention</p>
        <p className="text-2xl font-semibold text-indigo-600">{workAttention.length}</p>
        <p className="mt-1 text-xs text-neutral-400">
          {workAttention.length === 1 ? "service" : "services"} overdue
        </p>
      </div>

      {/* Upcoming Renewals */}
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
