import type { RankedService } from "@/lib/attention";

export function AttentionSummary({ services }: { services: RankedService[] }) {
  const overdueCount = services.filter((s) => s.tier === "overdue_payment").length;
  const dueTodayCount = services.filter((s) => s.tier === "due_today").length;
  const dueSoonCount = services.filter((s) =>
    ["due_tomorrow", "due_within_3_days", "due_within_7_days"].includes(s.tier)
  ).length;
  const workCount = services.filter((s) => s.tier === "overdue_work").length;
  const renewalCount = services.filter((s) => s.tier === "upcoming_renewal").length;

  // I3: totalAttention must match exactly what ClientAttentionList renders —
  // that component shows all tiers except no_action_required (tier 9).
  // Excluding tiers 7 (upcoming_renewal) and 8 (normal_upcoming_work) from the
  // count while the list shows them caused the headline to read "0 items" above
  // a populated table.
  const totalAttention = services.filter((s) => s.tier !== "no_action_required").length;

  const cards = [
    { label: "Overdue Payments", value: overdueCount, tone: "red" as const },
    { label: "Due Today", value: dueTodayCount, tone: "amber" as const },
    { label: "Due Soon", value: dueSoonCount, tone: "amber" as const },
    { label: "Work Requiring Attention", value: workCount, tone: "indigo" as const },
    ...(renewalCount > 0
      ? [{ label: "Upcoming Renewals", value: renewalCount, tone: "indigo" as const }]
      : []),
  ];

  return (
    <div className="mb-6">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-lg font-semibold text-neutral-900">Attention</h1>
        <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
          {totalAttention}
        </span>
        <span className="text-sm text-neutral-500">items require your attention</span>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-neutral-200 bg-white p-4"
          >
            <p className="mb-1 text-xs text-neutral-500">{card.label}</p>
            <p className={`text-2xl font-semibold ${toneTextClass(card.tone)}`}>
              {card.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function toneTextClass(tone: "red" | "amber" | "indigo"): string {
  return { red: "text-red-600", amber: "text-amber-600", indigo: "text-indigo-600" }[tone];
}
