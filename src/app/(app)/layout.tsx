import { requireAdmin } from "@/lib/require-admin";
import { Sidebar } from "@/components/shell/Sidebar";
import { Header } from "@/components/shell/Header";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  return (
    <div className="flex min-h-screen bg-neutral-50">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Header adminName={admin.email.split("@")[0]} />
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
