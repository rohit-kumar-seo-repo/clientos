import { requireAdmin } from "@/lib/require-admin";
import { getAttentionData, getMonthlySummary } from "@/lib/dashboard";
import { AttentionSummary } from "@/components/dashboard/AttentionSummary";
import { ClientAttentionList } from "@/components/dashboard/ClientAttentionList";
import { MonthlySummary } from "@/components/dashboard/MonthlySummary";

export default async function OverviewPage() {
  const admin = await requireAdmin();
  const today = new Date();

  const [services, summary] = await Promise.all([
    getAttentionData(admin.organizationId, today),
    getMonthlySummary(admin.organizationId, today),
  ]);

  return (
    <div>
      <AttentionSummary services={services} />
      <ClientAttentionList services={services} />
      <MonthlySummary summary={summary} />
    </div>
  );
}
