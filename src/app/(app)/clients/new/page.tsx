import { requireAdmin } from "@/lib/require-admin";
import { ClientForm } from "./ClientForm";

export default async function NewClientPage() {
  await requireAdmin();
  return <ClientForm />;
}
