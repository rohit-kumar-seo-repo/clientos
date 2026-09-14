import { requireAdmin } from "@/lib/require-admin";
import {
  getAttentionData,
  getMonthlySummary,
  getProjectObligations,
  getRecentActivity,
  getWorkUpdates,
} from "@/lib/dashboard";
import { AttentionSummary } from "@/components/dashboard/AttentionSummary";
import { ClientAttentionList } from "@/components/dashboard/ClientAttentionList";
import { MonthlySummary } from "@/components/dashboard/MonthlySummary";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { WorkUpdates } from "@/components/dashboard/WorkUpdates";

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
  const todayISO = today.toISOString(); // safe to pass to client components

  const [services, summary, recentActivity, workUpdates, projectObligations] = await Promise.all([
    getAttentionData(admin.organizationId, today),
    getMonthlySummary(admin.organizationId, today),
    getRecentActivity(admin.organizationId, 6),
    getWorkUpdates(admin.organizationId, today),
    getProjectObligations(admin.organizationId, today),
  ]);

  return (
    <div>
      {/* Page header */}
      <div className="mb-7">
        <h1 className="text-xl font-semibold text-neutral-900">Overview</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Everything you need to keep your clients and services on track
        </p>
      </div>

      {/* Row 1 — Attention summary cards (5 KPIs) */}
      <AttentionSummary services={services} projectObligations={projectObligations} />

      {/* Row 2 — Attention list (left, wider) + Monthly summary (right) */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ClientAttentionList services={services} projectObligations={projectObligations} todayISO={todayISO} />
        </div>
        <div className="lg:col-span-2">
          <MonthlySummary summary={summary} />
        </div>
      </div>

      {/* Row 3 — Recent activity (left) + Work updates (right) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecentActivity items={recentActivity} />
        <WorkUpdates items={workUpdates} todayISO={todayISO} />
      </div>
    </div>
  );
}
