import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { listClients } from "@/lib/clients";
import type { ClientStatus } from "@/generated/prisma/client";

const VALID_STATUSES: ClientStatus[] = ["ACTIVE", "PAUSED", "CHURNED"];

function parseStatus(value: string | undefined): ClientStatus | undefined {
  return VALID_STATUSES.includes(value as ClientStatus)
    ? (value as ClientStatus)
    : undefined;
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const activeStatus = parseStatus(params.status);
  const clients = await listClients(admin.organizationId, {
    search: params.q,
    status: activeStatus,
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Clients</h1>
        <Link
          href="/clients/new"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Add Client
        </Link>
      </div>

      {/*
        A plain GET form: the browser's own navigation writes `q` and `status`
        into the query string, which this Server Component already reads back
        out of `searchParams`. No client component and no onSubmit handler are
        needed, and the resulting URL stays shareable and back-button-friendly.
        `defaultValue` reflects the *parsed* status so a junk `?status=` value
        in the URL falls back to "All" rather than showing a phantom selection.
      */}
      <form method="get" className="mb-4 flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search business name"
          aria-label="Search clients by business name"
          className="w-64 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
        />
        <select
          name="status"
          defaultValue={activeStatus ?? ""}
          aria-label="Filter clients by status"
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
        >
          <option value="">All</option>
          {VALID_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          Search
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            {/* Business=22% Contact=15% Phone=12% Email=23% Location=18% Status=10% */}
            <col style={{ width: "22%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "23%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
          <thead className="border-b border-neutral-200 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Business</th>
              <th className="px-4 py-3 font-medium">Contact</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">Phone</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/clients/${client.id}`}
                    className="font-medium text-neutral-900 hover:underline"
                  >
                    {client.businessName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-neutral-600">
                  {client.contactPerson ?? "—"}
                </td>
                <td className="px-4 py-3 text-neutral-600 whitespace-nowrap">
                  {client.phone ?? "—"}
                </td>
                <td className="px-4 py-3 text-neutral-600 truncate" title={client.email ?? undefined}>
                  {client.email ?? "—"}
                </td>
                <td className="px-4 py-3 text-neutral-600">
                  {client.location ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${
                      client.status === "ACTIVE"
                        ? "bg-emerald-50 text-emerald-700"
                        : client.status === "PAUSED"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {client.status}
                  </span>
                </td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                  {params.q || activeStatus
                    ? "No clients match this search."
                    : "No clients yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
