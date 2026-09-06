import type { MonthlySummary as MonthlySummaryData } from "@/lib/dashboard";

function fmt(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export function MonthlySummary({ summary }: { summary: MonthlySummaryData }) {
  const { expectedInPaise, collectedInPaise, pendingInPaise, overdueInPaise } = summary;

  // Collection progress: what fraction of this month's expected billing is collected
  const progressPct =
    expectedInPaise > 0
      ? Math.min(100, Math.round((collectedInPaise / expectedInPaise) * 100))
      : 0;

  // Current month label
  const now = new Date();
  const monthLabel = now.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-medium text-neutral-900">Monthly Summary</h2>
        <span className="text-xs text-neutral-400">{monthLabel}</span>
      </div>

      <div className="p-4">
        {/* Three top figures */}
        <div className="mb-5 grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-neutral-500">Expected</p>
            <p className="mt-1 text-lg font-semibold text-neutral-900">{fmt(expectedInPaise)}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-500">Collected</p>
            <p className="mt-1 text-lg font-semibold text-emerald-700">{fmt(collectedInPaise)}</p>
          </div>
          <div>
            <p className="text-xs text-neutral-500">Pending</p>
            <p className="mt-1 text-lg font-semibold text-amber-600">{fmt(pendingInPaise)}</p>
          </div>
        </div>

        {/* Collection progress bar */}
        <div className="mb-5">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-neutral-700">Collection Progress</p>
            <span className="text-xs font-semibold text-neutral-900">{progressPct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Breakdown */}
        <div>
          <p className="mb-2 text-xs font-medium text-neutral-700">Breakdown</p>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-neutral-600">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                Overdue (all months)
              </span>
              <span className="font-medium text-red-600">{fmt(overdueInPaise)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-neutral-600">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                Due this month
              </span>
              <span className="font-medium text-amber-700">{fmt(pendingInPaise)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-neutral-600">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Collected this month
              </span>
              <span className="font-medium text-emerald-700">{fmt(collectedInPaise)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
