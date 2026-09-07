import Link from "next/link";
import type { WorkUpdateItem } from "@/lib/dashboard";

const WORK_STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  ON_HOLD: "On Hold",
};

const WORK_STATUS_COLORS: Record<string, string> = {
  NOT_STARTED: "bg-neutral-100 text-neutral-500",
  IN_PROGRESS: "bg-blue-50 text-blue-700",
  ON_HOLD: "bg-amber-50 text-amber-700",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysDiff(date: Date, todayMs: number): number {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return Math.round((d.getTime() - todayMs) / MS_PER_DAY);
}

export function WorkUpdates({
  items,
  todayISO,
}: {
  items: WorkUpdateItem[];
  todayISO: string;
}) {
  const todayMs = new Date(todayISO).setUTCHours(0, 0, 0, 0);

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-neutral-900">Work Updates</h2>
          <p className="mt-0.5 text-xs text-neutral-400">Active services ranked by next action date</p>
        </div>
        <Link
          href="/work"
          className="text-xs text-neutral-500 hover:text-neutral-900 hover:underline"
        >
          View All →
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-neutral-400">
          No active work items to display.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {items.map((item) => {
            const diff = item.nextActionDate ? daysDiff(item.nextActionDate, todayMs) : null;
            const isOverdue = diff !== null && diff < 0;
            const isDueToday = diff === 0;
            const isDueSoon = diff !== null && diff > 0 && diff <= 3;

            // Urgency indicator dot
            const dotColor = isOverdue
              ? "bg-red-500"
              : isDueToday
              ? "bg-amber-500"
              : isDueSoon
              ? "bg-amber-300"
              : item.workStatus === "ON_HOLD"
              ? "bg-neutral-300"
              : "bg-neutral-200";

            // Date label
            let dateLabel = "";
            let dateColor = "text-neutral-400";
            if (diff !== null) {
              if (isOverdue) {
                dateLabel = `${Math.abs(diff)}d overdue`;
                dateColor = "text-red-600 font-medium";
              } else if (isDueToday) {
                dateLabel = "Due today";
                dateColor = "text-amber-600 font-medium";
              } else if (diff === 1) {
                dateLabel = "Due tomorrow";
                dateColor = "text-amber-600";
              } else {
                dateLabel = `In ${diff} days`;
                dateColor = "text-neutral-500";
              }
            } else {
              dateLabel = new Date(item.updatedAt).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
              });
              dateColor = "text-neutral-400";
            }

            return (
              <li key={item.clientServiceId} className="flex items-start gap-3 px-4 py-3">
                {/* Urgency dot */}
                <div className="mt-1.5 shrink-0">
                  <span className={`block h-1.5 w-1.5 rounded-full ${dotColor}`} />
                </div>

                {/* Main content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/clients/${item.clientId}`}
                      className="text-xs font-medium text-neutral-900 hover:underline truncate"
                    >
                      {item.clientName}
                    </Link>
                    <span
                      className={`shrink-0 inline-block rounded-md px-1.5 py-0.5 text-xs ${WORK_STATUS_COLORS[item.workStatus] ?? "bg-neutral-100 text-neutral-500"}`}
                    >
                      {WORK_STATUS_LABELS[item.workStatus] ?? item.workStatus}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-400 truncate">{item.serviceName}</p>
                  {item.nextActionNote && (
                    <p className="mt-0.5 text-xs text-neutral-600 truncate" title={item.nextActionNote}>
                      → {item.nextActionNote}
                    </p>
                  )}
                </div>

                {/* Date */}
                <div className="shrink-0 text-right">
                  <p className={`text-xs ${dateColor}`}>{dateLabel}</p>
                  {item.nextActionDate && (
                    <p className="text-xs text-neutral-400">
                      {new Date(item.nextActionDate).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
