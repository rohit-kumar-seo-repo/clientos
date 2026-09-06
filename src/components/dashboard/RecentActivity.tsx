import Link from "next/link";
import type { RecentActivityItem } from "@/lib/dashboard";

const EVENT_LABELS: Record<string, string> = {
  payment_recorded: "Payment recorded",
  work_status_updated: "Work status updated",
  service_created: "Service created",
  service_paused: "Service paused",
  service_reactivated: "Service reactivated",
  service_cancelled: "Service cancelled",
  client_created: "Client created",
  service_edited: "Service edited",
};

const EVENT_DOT_CLASS: Record<string, string> = {
  payment_recorded: "bg-emerald-500",
  work_status_updated: "bg-blue-400",
  service_created: "bg-indigo-400",
  service_paused: "bg-amber-400",
  service_reactivated: "bg-emerald-400",
  service_cancelled: "bg-neutral-400",
  client_created: "bg-neutral-700",
  service_edited: "bg-neutral-400",
};

function timeAgo(date: Date): string {
  const now = Date.now();
  const diffMs = now - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins} min ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? "hour" : "hours"} ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} ${diffDays === 1 ? "day" : "days"} ago`;
  return new Date(date).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

export function RecentActivity({ items }: { items: RecentActivityItem[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-medium text-neutral-900">Recent Activity</h2>
        <Link
          href="/clients"
          className="text-xs text-neutral-500 hover:text-neutral-900 hover:underline"
        >
          View All →
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-xs text-neutral-400">
          No activity yet. Activity is recorded as you use ClientOS.
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {items.map((item) => {
            const dotClass =
              EVENT_DOT_CLASS[item.eventType] ?? "bg-neutral-300";
            const label =
              EVENT_LABELS[item.eventType] ??
              item.eventType.replace(/_/g, " ");
            return (
              <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                <span
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-neutral-900">{label}</p>
                  <Link
                    href={`/clients/${item.clientId}`}
                    className="text-xs text-neutral-500 hover:underline"
                  >
                    {item.clientName}
                  </Link>
                  {item.summary && (
                    <p className="mt-0.5 truncate text-xs text-neutral-400">{item.summary}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-neutral-400">{timeAgo(item.createdAt)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
