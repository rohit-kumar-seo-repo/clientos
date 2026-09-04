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
  const clients = await listClients(admin.organizationId, {
    search: params.q,
    status: parseStatus(params.status),
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

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Business</th>
              <th className="px-4 py-3 font-medium">Contact</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id} className="border-b border-neutral-100 last:border-0">
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
                <td className="px-4 py-3 text-neutral-600">{client.status}</td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-neutral-400">
                  No clients yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
