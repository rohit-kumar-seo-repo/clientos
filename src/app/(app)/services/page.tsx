import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { prisma } from "@/lib/db";

const FREQUENCY_LABELS: Record<string, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  HALF_YEARLY: "Half-yearly",
  YEARLY: "Yearly",
  ONE_TIME: "One-time",
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  PAUSED: "bg-amber-50 text-amber-700",
  CANCELLED: "bg-neutral-100 text-neutral-500",
};

export default async function ServicesPage() {
  const admin = await requireAdmin();

  const services = await prisma.clientService.findMany({
    where: { client: { organizationId: admin.organizationId } },
    include: {
      client: true,
      serviceTemplate: true,
      billingPlan: {
        include: {
          billingPeriods: {
            where: { status: { not: "PAID" } },
            orderBy: { periodLabel: "desc" },
            take: 1,
          },
        },
      },
    },
    orderBy: [{ status: "asc" }, { client: { businessName: "asc" } }],
  });

  const active = services.filter((s) => s.status === "ACTIVE");
  const paused = services.filter((s) => s.status === "PAUSED");
  const cancelled = services.filter((s) => s.status === "CANCELLED");

  const groups = [
    { label: "Active", items: active },
    { label: "Paused", items: paused },
    { label: "Cancelled", items: cancelled },
  ].filter((g) => g.items.length > 0);

  function nextDue(svc: (typeof services)[number]): string {
    const period = svc.billingPlan?.billingPeriods[0];
    if (!period) return "—";
    return new Date(period.dueDate).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <div>
      <h1 className="mb-6 text-lg font-semibold text-neutral-900">Services</h1>

      {services.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-400">
          No services yet.{" "}
          <Link href="/clients" className="text-neutral-900 underline underline-offset-2">
            Open a client
          </Link>{" "}
          to add a service.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.label} className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <div className="border-b border-neutral-200 px-4 py-3">
                <h2 className="text-sm font-medium text-neutral-900">
                  {group.label}{" "}
                  <span className="ml-1 text-neutral-400">({group.items.length})</span>
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-neutral-200 text-left text-neutral-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Client</th>
                      <th className="px-4 py-3 font-medium">Service</th>
                      <th className="px-4 py-3 font-medium">Fee</th>
                      <th className="px-4 py-3 font-medium">Frequency</th>
                      <th className="px-4 py-3 font-medium">Next Due</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {group.items.map((svc) => (
                      <tr key={svc.id} className="hover:bg-neutral-50">
                        <td className="px-4 py-3 font-medium text-neutral-900">
                          {svc.client.businessName}
                        </td>
                        <td className="px-4 py-3 text-neutral-700">
                          {svc.serviceTemplate.name}
                        </td>
                        <td className="px-4 py-3 text-neutral-900">
                          ₹{(svc.feeInPaise / 100).toLocaleString("en-IN")}
                        </td>
                        <td className="px-4 py-3 text-neutral-600">
                          {FREQUENCY_LABELS[svc.billingPlan?.frequency ?? ""] ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-neutral-600">
                          {svc.status === "CANCELLED" ? "—" : nextDue(svc)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[svc.status] ?? "bg-neutral-100 text-neutral-600"}`}
                          >
                            {svc.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/clients/${svc.clientId}`}
                            className="text-xs text-neutral-500 hover:text-neutral-900 hover:underline"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
