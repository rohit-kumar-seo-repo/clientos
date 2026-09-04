import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { getClientById } from "@/lib/clients";
import { ActivityTimeline } from "@/components/clients/ActivityTimeline";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdmin();
  const { id } = await params;
  const client = await getClientById(admin.organizationId, Number(id));

  if (!client) {
    notFound();
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-neutral-900">
        {client.businessName}
      </h1>
      <p className="mb-6 text-sm text-neutral-500">{client.status}</p>

      <div className="grid grid-cols-2 gap-6">
        <section className="rounded-xl border border-neutral-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-medium text-neutral-900">Overview</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Contact person" value={client.contactPerson} />
            <Row label="Phone" value={client.phone} />
            <Row label="Email" value={client.email} />
            <Row label="Website" value={client.website} />
            <Row label="Industry" value={client.industry} />
            <Row label="Location" value={client.location} />
          </dl>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-medium text-neutral-900">Activity</h2>
          <ActivityTimeline activity={client.activity} />
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-neutral-900">{value ?? "—"}</dd>
    </div>
  );
}
