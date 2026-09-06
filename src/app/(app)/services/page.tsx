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

const WORK_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  ON_HOLD: "On Hold",
};

const WORK_STATUS_COLORS: Record<string, string> = {
  NOT_STARTED: "bg-neutral-100 text-neutral-600",
  IN_PROGRESS: "bg-blue-50 text-blue-700",
  COMPLETED: "bg-emerald-50 text-emerald-700",
  ON_HOLD: "bg-amber-50 text-amber-700",
};

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>;
}) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const filterTemplateId = params.service ? parseInt(params.service, 10) : null;

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

  function nextDue(svc: (typeof services)[number]): string {
    const period = svc.billingPlan?.billingPeriods[0];
    if (!period) return "—";
    return new Date(period.dueDate).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function feeDisplay(svc: (typeof services)[number]): string {
    const paise = svc.billingPlan?.amountInPaise ?? svc.feeInPaise;
    return `₹${(paise / 100).toLocaleString("en-IN")}`;
  }

  // ── Filtered single-service view ─────────────────────────────────────────
  if (filterTemplateId && !isNaN(filterTemplateId)) {
    const filtered = active.filter(
      (s) => s.serviceTemplate.id === filterTemplateId
    );
    const templateName =
      filtered[0]?.serviceTemplate.name ??
      services.find((s) => s.serviceTemplate.id === filterTemplateId)
        ?.serviceTemplate.name ??
      "Service";

    return (
      <div>
        <div className="mb-6 flex items-center gap-3">
          <Link
            href="/services"
            className="text-sm text-neutral-400 hover:text-neutral-900"
          >
            ← All Services
          </Link>
          <span className="text-neutral-300">/</span>
          <h1 className="text-lg font-semibold text-neutral-900">
            {templateName}
          </h1>
          <span className="text-sm text-neutral-400">
            ({filtered.length} active)
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-400">
            No active clients for this service.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                {/* Client=20% Service=18% Price=10% Freq=11% WorkStatus=12% NextAction=16% NextActionDate=13% */}
                <col style={{ width: "20%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "13%" }} />
              </colgroup>
              <thead className="border-b border-neutral-200 text-left text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Service</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Frequency</th>
                  <th className="px-4 py-3 font-medium">Work Status</th>
                  <th className="px-4 py-3 font-medium">Next Action</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">
                    Next Action Date
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filtered.map((svc) => (
                  <tr key={svc.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-medium text-neutral-900">
                      <Link
                        href={`/clients/${svc.clientId}`}
                        className="hover:underline"
                      >
                        {svc.client.businessName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      {svc.serviceTemplate.name}
                    </td>
                    <td className="px-4 py-3 text-neutral-900 whitespace-nowrap">
                      {feeDisplay(svc)}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {FREQUENCY_LABELS[svc.billingPlan?.frequency ?? ""] ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${WORK_STATUS_COLORS[svc.workStatus] ?? WORK_STATUS_COLORS.NOT_STARTED}`}
                      >
                        {WORK_STATUS_LABELS[svc.workStatus] ?? svc.workStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {svc.nextActionNote ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-600 whitespace-nowrap">
                      {svc.nextActionDate
                        ? new Date(svc.nextActionDate).toLocaleDateString(
                            "en-IN",
                            { day: "numeric", month: "short", year: "numeric" }
                          )
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // ── Default view ─────────────────────────────────────────────────────────

  // Group active services by template, sorted descending by count
  type TemplateSummary = { id: number; name: string; count: number };
  const byTemplate = Object.values(
    active.reduce<Record<number, TemplateSummary>>((acc, s) => {
      const id = s.serviceTemplate.id;
      if (!acc[id])
        acc[id] = { id, name: s.serviceTemplate.name, count: 0 };
      acc[id].count++;
      return acc;
    }, {})
  ).sort((a, b) => b.count - a.count);

  const groups = [
    { label: "Active", items: active },
    { label: "Paused", items: paused },
    { label: "Cancelled", items: cancelled },
  ].filter((g) => g.items.length > 0);

  return (
    <div>
      <h1 className="mb-6 text-lg font-semibold text-neutral-900">Services</h1>

      {services.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-400">
          No services yet.{" "}
          <Link
            href="/clients"
            className="text-neutral-900 underline underline-offset-2"
          >
            Open a client
          </Link>{" "}
          to add a service.
        </div>
      ) : (
        <div className="space-y-6">
          {/* ── Active clients by service summary ── */}
          {byTemplate.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <div className="border-b border-neutral-200 px-4 py-3">
                <h2 className="text-sm font-medium text-neutral-900">
                  Active Clients by Service
                </h2>
                <p className="mt-0.5 text-xs text-neutral-400">
                  ACTIVE services only · click a row to see client details
                </p>
              </div>
              <ul className="divide-y divide-neutral-100">
                {byTemplate.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/services?service=${t.id}`}
                      className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50"
                    >
                      <span className="text-sm font-medium text-neutral-900">
                        {t.name}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-sm text-neutral-600">
                          {t.count}{" "}
                          {t.count === 1 ? "client" : "clients"}
                        </span>
                        <span className="text-xs text-neutral-300">→</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {/* Total active */}
              <div className="border-t border-neutral-100 px-4 py-2.5">
                <p className="text-xs text-neutral-400">
                  {active.length} active service{active.length !== 1 ? "s" : ""} across{" "}
                  {new Set(active.map((s) => s.clientId)).size} client
                  {new Set(active.map((s) => s.clientId)).size !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          )}

          {/* ── Existing Active / Paused / Cancelled groups ── */}
          {groups.map((group) => (
            <div
              key={group.label}
              className="overflow-hidden rounded-xl border border-neutral-200 bg-white"
            >
              <div className="border-b border-neutral-200 px-4 py-3">
                <h2 className="text-sm font-medium text-neutral-900">
                  {group.label}{" "}
                  <span className="ml-1 text-neutral-400">
                    ({group.items.length})
                  </span>
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
