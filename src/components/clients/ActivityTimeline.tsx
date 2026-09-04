import type { ClientActivity } from "@/generated/prisma/client";

export function ActivityTimeline({ activity }: { activity: ClientActivity[] }) {
  if (activity.length === 0) {
    return <p className="text-sm text-neutral-400">No activity yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {activity.map((event) => (
        <li key={event.id} className="text-sm">
          <span className="text-neutral-900">{event.summary}</span>
          <span className="ml-2 text-neutral-400">
            {event.createdAt.toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}
