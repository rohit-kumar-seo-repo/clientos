import { requireAdmin } from "@/lib/require-admin";
import { ClientForm } from "./ClientForm";

export default async function NewClientPage() {
  const admin = await requireAdmin();
  return <ClientForm organizationId={admin.organizationId} />;
}
