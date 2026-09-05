import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { getClientById } from "@/lib/clients";
import { EditClientForm } from "./EditClientForm";

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdmin();
  const { id } = await params;

  // See the detail page: a non-numeric or non-integer segment must 404,
  // not reach Prisma as NaN and throw.
  const clientId = Number(id);
  if (!Number.isInteger(clientId)) notFound();

  const client = await getClientById(admin.organizationId, clientId);
  if (!client) notFound();

  return <EditClientForm client={client} />;
}
