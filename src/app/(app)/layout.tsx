import { requireAdmin } from "@/lib/require-admin";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return <div className="min-h-screen bg-neutral-50">{children}</div>;
}
