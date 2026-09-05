import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { getClientById } from "@/lib/clients";
import { ActivityTimeline } from "@/components/clients/ActivityTimeline";
import { ContactsPanel } from "@/components/clients/ContactsPanel";
import { NotesPanel } from "@/components/clients/NotesPanel";

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
      <div className="mb-1 flex items-center gap-3">
        <h1 className="text-lg font-semibold text-neutral-900">
          {client.businessName}
        </h1>
        <Link
          href={`/clients/${client.id}/edit`}
          className="text-sm text-neutral-500 hover:text-neutral-900 hover:underline"
        >
          Edit
        </Link>
      </div>
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

        <div className="col-span-2">
          <ContactsPanel clientId={client.id} contacts={client.contacts} />
        </div>

        <div className="col-span-2">
          <NotesPanel clientId={client.id} notes={client.notes} />
        </div>
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
