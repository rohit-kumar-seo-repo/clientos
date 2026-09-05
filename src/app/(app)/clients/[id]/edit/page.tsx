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
  const client = await getClientById(admin.organizationId, Number(id));
  if (!client) notFound();

  return <EditClientForm client={client} />;
}
