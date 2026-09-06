import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { prisma } from "@/lib/db";

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

export default async function WorkPage() {
  const admin = await requireAdmin();

  const services = await prisma.clientService.findMany({
    where: {
      status: { not: "CANCELLED" },
      client: { organizationId: admin.organizationId },
    },
    include: {
      client: true,
      serviceTemplate: true,
    },
    orderBy: [{ workStatus: "asc" }, { client: { businessName: "asc" } }],
  });

  return (
    <div>
      <h1 className="mb-6 text-lg font-semibold text-neutral-900">Work</h1>

      {services.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-400">
          No active services yet.{" "}
          <Link href="/clients" className="text-neutral-900 underline underline-offset-2">
            Add a client
          </Link>{" "}
          to get started.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="overflow-hidden">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                {/* Client=13% Service=22% Status=11% Progress=7% Note=13% NextAction=13% NextActionDate=13% Action=8% */}
                <col style={{ width: "13%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "13%" }} />
                <col style={{ width: "8%" }} />
              </colgroup>
              <thead className="border-b border-neutral-200 text-left text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Service</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Progress</th>
                  <th className="px-4 py-3 font-medium">Note</th>
                  <th className="px-4 py-3 font-medium">Next Action</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">Next Action Date</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {services.map((svc) => (
                  <tr key={svc.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-medium text-neutral-900">
                      {svc.client.businessName}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      {svc.serviceTemplate.name}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${WORK_STATUS_COLORS[svc.workStatus] ?? "bg-neutral-100 text-neutral-600"}`}
                      >
                        {WORK_STATUS_LABELS[svc.workStatus] ?? svc.workStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {svc.progressPercent != null ? `${svc.progressPercent}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {svc.workNote ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {svc.nextActionNote ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-600 whitespace-nowrap">
                      {svc.nextActionDate
                        ? new Date(svc.nextActionDate).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/clients/${svc.clientId}#service-${svc.id}`}
                        className="whitespace-nowrap rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                      >
                        Edit Work
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
