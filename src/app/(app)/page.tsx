import { requireAdmin } from "@/lib/require-admin";
import { getAttentionData, getMonthlySummary } from "@/lib/dashboard";
import { AttentionSummary } from "@/components/dashboard/AttentionSummary";
import { ClientAttentionList } from "@/components/dashboard/ClientAttentionList";
import { MonthlySummary } from "@/components/dashboard/MonthlySummary";

// I5: Resolve today as the current IST calendar date. This app is India-only
// (₹-denominated, en-IN formatted). Between 00:00 and 05:30 IST, the UTC clock
// is still on the previous calendar day, so `new Date()` on a UTC-clock host
// would mislabel payment tiers and show last month's summary on the 1st of a
// new month. We extract the IST year/month/day via Intl.DateTimeFormat and
// construct a UTC midnight Date from those parts — startOfUTCDay() inside the
// data functions then works correctly without any change.
function todayInIST(): Date {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .split("-")
    .map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export default async function OverviewPage() {
  const admin = await requireAdmin();
  const today = todayInIST();

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
