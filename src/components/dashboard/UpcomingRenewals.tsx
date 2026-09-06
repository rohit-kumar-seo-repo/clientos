import Link from "next/link";
import type { RankedService } from "@/lib/attention";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysUntil(endDate: Date, todayMs: number): number {
  const end = new Date(endDate);
  end.setUTCHours(0, 0, 0, 0);
  return Math.round((end.getTime() - todayMs) / MS_PER_DAY);
}

export function UpcomingRenewals({
  services,
  todayISO,
}: {
  services: RankedService[];
  todayISO: string;
}) {
  const todayMs = new Date(todayISO).setUTCHours(0, 0, 0, 0);

  // Show services with endDate within next 60 days (ordered soonest first)
  const renewals = services
    .filter((s) => {
      if (!s.endDate) return false;
      const days = daysUntil(s.endDate, todayMs);
      return days >= 0 && days <= 60;
    })
    .sort((a, b) => a.endDate!.getTime() - b.endDate!.getTime());

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-medium text-neutral-900">Upcoming Renewals</h2>
        <Link
          href="/services"
          className="text-xs text-neutral-500 hover:text-neutral-900 hover:underline"
        >
          View All →
        </Link>
      </div>

      {renewals.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-neutral-400">
          No renewals due in the next 60 days.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {renewals.map((s) => {
            const days = daysUntil(s.endDate!, todayMs);
            const urgencyClass =
              days <= 7
                ? "text-red-600"
                : days <= 14
                ? "text-amber-600"
                : "text-neutral-500";

            return (
              <li key={s.clientServiceId} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/clients/${s.clientId}`}
                    className="text-xs font-medium text-neutral-900 hover:underline"
                  >
                    {s.clientName}
                  </Link>
                  <p className="text-xs text-neutral-400">{s.serviceName}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-neutral-600">
                    {new Date(s.endDate!).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                  <p className={`text-xs font-medium ${urgencyClass}`}>
                    {days === 0 ? "Today" : `${days} ${days === 1 ? "day" : "days"}`}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
