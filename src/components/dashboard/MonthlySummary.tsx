import type { MonthlySummary as MonthlySummaryData } from "@/lib/dashboard";

export function MonthlySummary({ summary }: { summary: MonthlySummaryData }) {
  const rows = [
    { label: "Expected", value: summary.expectedInPaise, tone: "neutral" as const },
    { label: "Collected", value: summary.collectedInPaise, tone: "green" as const },
    { label: "Pending", value: summary.pendingInPaise, tone: "amber" as const },
    { label: "Overdue", value: summary.overdueInPaise, tone: "red" as const },
  ];

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-medium text-neutral-900">This Month</h2>
      <dl className="grid grid-cols-4 gap-4">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="mb-1 text-xs text-neutral-500">{row.label}</dt>
            <dd className={`text-lg font-semibold ${toneClass(row.tone)}`}>
              ₹{(row.value / 100).toLocaleString("en-IN")}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function toneClass(tone: "neutral" | "green" | "amber" | "red"): string {
  return {
    neutral: "text-neutral-900",
    green: "text-emerald-700",
    amber: "text-amber-700",
    red: "text-red-600",
  }[tone];
}
