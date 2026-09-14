"use client";

import Link from "next/link";
import { useState } from "react";

export type CalendarEvent = {
  date: string;          // "YYYY-MM-DD" in IST
  type: "paid" | "due" | "overdue";
  kind: "recurring" | "milestone" | "addon";
  clientName: string;
  description: string;
  amountInPaise: number;
  clientId: number;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtAmount(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export function CalendarView({
  year,
  month,
  today,
  events,
}: {
  year: number;
  month: number;
  today: string;
  events: CalendarEvent[];
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Month navigation — correct across year boundaries
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  // Calendar grid (Monday-first)
  const firstDOW = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=Sun
  const adjustedFirst = (firstDOW + 6) % 7; // 0=Mon, 6=Sun
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array<null>(adjustedFirst).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  // Group events by date string
  const byDate = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const arr = byDate.get(e.date) ?? [];
    arr.push(e);
    byDate.set(e.date, arr);
  }

  function ds(day: number): string {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const selectedEvents = selectedDate ? (byDate.get(selectedDate) ?? []) : [];

  return (
    <div className="space-y-4">
      {/* Month header with prev/next navigation */}
      <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-5 py-4">
        <Link
          href={`/calendar?year=${prevYear}&month=${prevMonth}`}
          className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
        >
          ← Prev
        </Link>
        <span className="text-sm font-semibold text-neutral-900">{monthLabel}</span>
        <Link
          href={`/calendar?year=${nextYear}&month=${nextMonth}`}
          className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100"
        >
          Next →
        </Link>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 px-1 text-xs text-neutral-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          Paid
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
          Due
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
          Overdue
        </span>
        <span className="ml-auto text-neutral-400 italic">Click a date to see details</span>
      </div>

      {/* Calendar grid */}
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 border-b border-neutral-200">
          {DAY_LABELS.map((d) => (
            <div
              key={d}
              className="px-2 py-2 text-center text-xs font-medium text-neutral-400"
            >
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 divide-x divide-y divide-neutral-100">
          {cells.map((day, idx) => {
            if (day === null) {
              return <div key={idx} className="h-20 bg-neutral-50" />;
            }

            const dateStr = ds(day);
            const dayEvents = byDate.get(dateStr) ?? [];
            const isToday = dateStr === today;
            const isSelected = dateStr === selectedDate;
            const hasPaid = dayEvents.some((e) => e.type === "paid");
            const hasDue = dayEvents.some((e) => e.type === "due");
            const hasOverdue = dayEvents.some((e) => e.type === "overdue");

            return (
              <button
                key={dateStr}
                onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                className={`h-20 w-full p-2 text-left transition-colors hover:bg-neutral-50 ${
                  isSelected ? "bg-neutral-100" : ""
                }`}
              >
                {/* Day number */}
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    isToday
                      ? "bg-neutral-900 text-white"
                      : "text-neutral-700"
                  }`}
                >
                  {day}
                </span>

                {/* Dot indicators */}
                {dayEvents.length > 0 && (
                  <div className="mt-1 flex gap-1">
                    {hasPaid && (
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                    )}
                    {hasDue && (
                      <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
                    )}
                    {hasOverdue && (
                      <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
                    )}
                  </div>
                )}

                {/* Item count */}
                {dayEvents.length > 0 && (
                  <p className="mt-0.5 text-xs text-neutral-400">
                    {dayEvents.length} item{dayEvents.length !== 1 ? "s" : ""}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Day detail panel — shown when a date is selected */}
      {selectedDate && (
        <div className="rounded-xl border border-neutral-200 bg-white p-6">
          <h3 className="mb-4 text-sm font-medium text-neutral-900">
            {new Date(selectedDate + "T00:00:00Z").toLocaleDateString("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            })}
          </h3>

          {selectedEvents.length === 0 ? (
            <p className="text-sm text-neutral-400">
              No payment activity on this date.
            </p>
          ) : (
            <div className="divide-y divide-neutral-100">
              {selectedEvents.map((e, i) => (
                <div key={i} className="flex items-center justify-between py-3">
                  {/* Left: dot + client/description */}
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                        e.type === "paid"
                          ? "bg-emerald-500"
                          : e.type === "overdue"
                          ? "bg-red-500"
                          : "bg-amber-400"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-neutral-900">
                        {e.clientName}
                      </p>
                      <p className="truncate text-xs text-neutral-500">
                        {e.description}
                      </p>
                    </div>
                  </div>

                  {/* Right: status badge + amount + view link */}
                  <div className="ml-4 flex flex-shrink-0 items-center gap-3">
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                        e.type === "paid"
                          ? "bg-emerald-50 text-emerald-700"
                          : e.type === "overdue"
                          ? "bg-red-50 text-red-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {e.type === "paid"
                        ? "Paid"
                        : e.type === "overdue"
                        ? "Overdue"
                        : "Due"}
                    </span>
                    <span className="text-sm font-medium text-neutral-900">
                      {fmtAmount(e.amountInPaise)}
                    </span>
                    <Link
                      href={`/clients/${e.clientId}`}
                      className="text-xs text-neutral-400 hover:text-neutral-900 hover:underline"
                    >
                      View
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
