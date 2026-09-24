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
  clientId: number | null;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function fmtAmount(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

function collectedOn(dayEvents: CalendarEvent[]): number {
  return dayEvents
    .filter((e) => e.type === "paid")
    .reduce((sum, e) => sum + e.amountInPaise, 0);
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
  const selectedCollected = collectedOn(selectedEvents);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Left: calendar */}
      <div className="space-y-3 lg:col-span-2">
        {/* Month header with prev/next navigation */}
        <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3">
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
        <div className="flex items-center gap-4 px-1 text-xs text-neutral-500">
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
          <span className="ml-auto hidden text-neutral-400 italic sm:inline">
            Click a date for details →
          </span>
        </div>

        {/* Calendar grid */}
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 border-b border-neutral-200">
            {DAY_LABELS.map((d) => (
              <div
                key={d}
                className="px-1 py-1.5 text-center text-[11px] font-medium text-neutral-400"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 divide-x divide-y divide-neutral-100">
            {cells.map((day, idx) => {
              if (day === null) {
                return <div key={idx} className="h-14 bg-neutral-50" />;
              }

              const dateStr = ds(day);
              const dayEvents = byDate.get(dateStr) ?? [];
              const isToday = dateStr === today;
              const isSelected = dateStr === selectedDate;
              const hasPaid = dayEvents.some((e) => e.type === "paid");
              const hasDue = dayEvents.some((e) => e.type === "due");
              const hasOverdue = dayEvents.some((e) => e.type === "overdue");
              const collectedInPaise = collectedOn(dayEvents);

              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                  className={`h-14 w-full p-1 text-left transition-colors hover:bg-neutral-50 ${
                    isSelected ? "bg-neutral-100" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${
                        isToday ? "bg-neutral-900 text-white" : "text-neutral-700"
                      }`}
                    >
                      {day}
                    </span>
                    {dayEvents.length > 0 && (
                      <div className="flex flex-shrink-0 gap-0.5">
                        {hasPaid && (
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        )}
                        {hasDue && (
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
                        )}
                        {hasOverdue && (
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Amount actually collected that day (replaces old "N items" count) */}
                  {collectedInPaise > 0 && (
                    <p className="mt-1 truncate text-[11px] font-medium text-emerald-700">
                      {fmtAmount(collectedInPaise)}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Right: day detail panel — sticky, always visible */}
      <div className="lg:sticky lg:top-6 lg:col-span-1 lg:self-start">
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          {selectedDate ? (
            <>
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium text-neutral-900">
                    {new Date(selectedDate + "T00:00:00Z").toLocaleDateString("en-IN", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </h3>
                  {selectedCollected > 0 && (
                    <p className="mt-0.5 text-xs text-emerald-700">
                      {fmtAmount(selectedCollected)} collected
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setSelectedDate(null)}
                  className="flex-shrink-0 rounded-md px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              {selectedEvents.length === 0 ? (
                <p className="text-sm text-neutral-400">No payment activity on this date.</p>
              ) : (
                <div className="space-y-2.5">
                  {selectedEvents.map((e, i) => (
                    <div key={i} className="rounded-lg border border-neutral-100 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-neutral-900">
                            {e.clientName}
                          </p>
                          <p className="truncate text-xs text-neutral-500">{e.description}</p>
                        </div>
                        <span
                          className={`flex-shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${
                            e.type === "paid"
                              ? "bg-emerald-50 text-emerald-700"
                              : e.type === "overdue"
                              ? "bg-red-50 text-red-700"
                              : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {e.type === "paid" ? "Paid" : e.type === "overdue" ? "Overdue" : "Due"}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-neutral-900">
                          {fmtAmount(e.amountInPaise)}
                        </span>
                        {e.clientId && (
                          <Link
                            href={`/clients/${e.clientId}`}
                            className="text-xs text-neutral-400 hover:text-neutral-900 hover:underline"
                          >
                            View →
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="py-6 text-center text-sm text-neutral-400">
              Click a date on the calendar to see payment details.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
