import type { ReactNode } from "react";
import type { RankedService } from "@/lib/attention";
import type { MonthlySummary, ProjectObligationItem } from "@/lib/dashboard";

function fmt(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function uniqueClientCount(serviceClientIds: number[], projClientIds: number[]): number {
  return new Set([...serviceClientIds, ...projClientIds]).size;
}

function serviceTotal(services: RankedService[]): number {
  return services.reduce((sum, s) => sum + s.outstandingAmountInPaise, 0);
}

function projTotal(items: ProjectObligationItem[]): number {
  return items.reduce((sum, p) => sum + p.amountInPaise, 0);
}

// ── Small inline icon set — no icon library needed for five glyphs ─────────
function iconProps(className: string) {
  return {
    className,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

function CalendarIcon({ className }: { className: string }) {
  return (
    <svg {...iconProps(className)}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className: string }) {
  return (
    <svg {...iconProps(className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.5 2.5 5-5" />
    </svg>
  );
}

function AlertTriangleIcon({ className }: { className: string }) {
  return (
    <svg {...iconProps(className)}>
      <path d="M12 3.5 21 19H3l9-15.5Z" />
      <line x1="12" y1="9.5" x2="12" y2="13.5" />
      <line x1="12" y1="16.5" x2="12.01" y2="16.5" />
    </svg>
  );
}

function ClockIcon({ className }: { className: string }) {
  return (
    <svg {...iconProps(className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

function WrenchIcon({ className }: { className: string }) {
  return (
    <svg {...iconProps(className)}>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2.8-.5-.5-2.8 2.3-2.3Z" />
    </svg>
  );
}

// ── Shared card shell — one visual language for all five KPIs ──────────────
type KpiColor = "blue" | "emerald" | "red" | "amber" | "indigo" | "neutral";

const KPI_THEME: Record<
  KpiColor,
  { border: string; chipBg: string; chipText: string; value: string }
> = {
  blue: { border: "border-blue-100", chipBg: "bg-blue-50", chipText: "text-blue-600", value: "text-blue-600" },
  emerald: { border: "border-emerald-100", chipBg: "bg-emerald-50", chipText: "text-emerald-600", value: "text-emerald-600" },
  red: { border: "border-red-100", chipBg: "bg-red-50", chipText: "text-red-600", value: "text-red-600" },
  amber: { border: "border-amber-100", chipBg: "bg-amber-50", chipText: "text-amber-600", value: "text-amber-600" },
  indigo: { border: "border-indigo-100", chipBg: "bg-indigo-50", chipText: "text-indigo-600", value: "text-indigo-600" },
  neutral: { border: "border-neutral-200", chipBg: "bg-neutral-100", chipText: "text-neutral-400", value: "text-neutral-400" },
};

function KpiCard({
  label,
  value,
  caption,
  icon,
  color,
}: {
  label: string;
  value: string;
  caption: ReactNode;
  icon: ReactNode;
  color: KpiColor;
}) {
  const t = KPI_THEME[color];
  return (
    <div className={`rounded-xl border ${t.border} bg-white p-4 shadow-sm`}>
      <div className="mb-2 flex items-center gap-2">
        <span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${t.chipBg} ${t.chipText}`}>
          {icon}
        </span>
        <p className="text-xs font-medium text-neutral-500">{label}</p>
      </div>
      <p className={`text-2xl font-semibold ${t.value}`}>{value}</p>
      <p className="mt-1 text-xs text-neutral-400">{caption}</p>
    </div>
  );
}

export function AttentionSummary({
  services,
  projectObligations,
  summary,
}: {
  services: RankedService[];
  projectObligations: ProjectObligationItem[];
  summary: MonthlySummary;
}) {
  const overduePay = services.filter((s) => s.tier === "overdue_payment");
  const overduePayProj = projectObligations.filter((p) => p.tier === "overdue_payment");
  const overdueCount = overduePay.length + overduePayProj.length;

  const dueToday = services.filter((s) => s.tier === "due_today");
  const dueTodayProj = projectObligations.filter((p) => p.tier === "due_today");
  const dueTodayCount = dueToday.length + dueTodayProj.length;

  const workAttention = services.filter((s) => s.tier === "overdue_work");

  const icon18 = "h-3.5 w-3.5";

  return (
    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
      {/* 1. Expected This Month — recurring (this month) + one-time projects
             (full contract value). Always == recurring.expected + projects.expected,
             so it can never disagree with the two cards in Monthly Summary. */}
      <KpiCard
        label="Expected This Month"
        value={fmt(summary.totals.expectedInPaise)}
        caption="recurring + one-time projects"
        icon={<CalendarIcon className={icon18} />}
        color="blue"
      />

      {/* 2. Total Collected Payment — recurring collected this month + all
             project payments ever collected. Always == recurring.collected +
             projects.collected, same guarantee as the card above. */}
      <KpiCard
        label="Total Collected Payment"
        value={fmt(summary.totals.collectedInPaise)}
        caption={
          <>
            {summary.totals.paymentCount} {summary.totals.paymentCount === 1 ? "payment" : "payments"} · recurring + one-time projects
          </>
        }
        icon={<CheckCircleIcon className={icon18} />}
        color="emerald"
      />

      {/* 3. Overdue Payments — calm neutral styling when the count is zero so
             "nothing overdue" doesn't visually shout the way an alert does. */}
      <KpiCard
        label="Overdue Payments"
        value={overdueCount > 0 ? fmt(serviceTotal(overduePay) + projTotal(overduePayProj)) : "₹0"}
        caption={
          overdueCount > 0 ? (
            <>
              {uniqueClientCount(overduePay.map((s) => s.clientId), overduePayProj.map((p) => p.clientId))}{" "}
              clients &middot; {overdueCount} items
            </>
          ) : (
            "Nothing overdue — all clear"
          )
        }
        icon={
          overdueCount > 0 ? (
            <AlertTriangleIcon className={icon18} />
          ) : (
            <CheckCircleIcon className={icon18} />
          )
        }
        color={overdueCount > 0 ? "red" : "neutral"}
      />

      {/* 4. Due Today — same calm-zero-state treatment as Overdue Payments. */}
      <KpiCard
        label="Due Today"
        value={dueTodayCount > 0 ? fmt(serviceTotal(dueToday) + projTotal(dueTodayProj)) : "₹0"}
        caption={
          dueTodayCount > 0 ? (
            <>
              {uniqueClientCount(dueToday.map((s) => s.clientId), dueTodayProj.map((p) => p.clientId))}{" "}
              clients &middot; {dueTodayCount} items
            </>
          ) : (
            "Nothing due today"
          )
        }
        icon={
          dueTodayCount > 0 ? <ClockIcon className={icon18} /> : <CheckCircleIcon className={icon18} />
        }
        color={dueTodayCount > 0 ? "amber" : "neutral"}
      />

      {/* 5. Work Attention — indigo accent now matches the number, consistent
             with every other card (previously the only plain-neutral one). */}
      <KpiCard
        label="Work Attention"
        value={String(workAttention.length)}
        caption={`${workAttention.length === 1 ? "service" : "services"} need attention`}
        icon={<WrenchIcon className={icon18} />}
        color="indigo"
      />
    </div>
  );
}
