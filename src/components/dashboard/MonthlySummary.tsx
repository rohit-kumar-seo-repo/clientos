import type { MonthlySummary as MonthlySummaryData } from "@/lib/dashboard";

function fmt(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function Section({
  title,
  expected,
  collected,
  pending,
  overdue,
}: {
  title: string;
  expected: number;
  collected: number;
  pending: number;
  overdue: number;
}) {
  const progressPct =
    expected > 0 ? Math.min(100, Math.round((collected / expected) * 100)) : 0;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-xs text-neutral-500">Expected</p>
          <p className="mt-0.5 text-sm font-semibold text-neutral-900">{fmt(expected)}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-500">Collected</p>
          <p className="mt-0.5 text-sm font-semibold text-emerald-700">{fmt(collected)}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-500">Pending</p>
          <p className="mt-0.5 text-sm font-semibold text-amber-600">{fmt(pending)}</p>
        </div>
      </div>
      {expected > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-neutral-500">Progress</span>
            <span className="text-xs font-semibold text-neutral-700">{progressPct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}
      {overdue > 0 && (
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1.5 text-neutral-500">
            <span className="h-2 w-2 rounded-full bg-red-400" />
            Overdue (all months)
          </span>
          <span className="font-medium text-red-600">{fmt(overdue)}</span>
        </div>
      )}
    </div>
  );
}

export function MonthlySummary({ summary }: { summary: MonthlySummaryData }) {
  const { recurring, projects } = summary;

  const now = new Date();
  const monthLabel = now.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-medium text-neutral-900">Monthly Summary</h2>
        <span className="text-xs text-neutral-400">{monthLabel}</span>
      </div>

      <div className="divide-y divide-neutral-100 p-4">
        <div className="pb-4">
          <Section
            title="Recurring Services"
            expected={recurring.expectedInPaise}
            collected={recurring.collectedInPaise}
            pending={recurring.pendingInPaise}
            overdue={recurring.overdueInPaise}
          />
        </div>
        <div className="pt-4">
          <Section
            title="One-Time Projects"
            expected={projects.expectedInPaise}
            collected={projects.collectedInPaise}
            pending={projects.pendingInPaise}
            overdue={projects.overdueInPaise}
          />
        </div>
      </div>
    </div>
  );
}
