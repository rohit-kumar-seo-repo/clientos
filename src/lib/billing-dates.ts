import type { BillingFrequency } from "@/generated/prisma/client";

const MONTHS_PER_FREQUENCY: Record<Exclude<BillingFrequency, "ONE_TIME">, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  HALF_YEARLY: 6,
  YEARLY: 12,
};

/** Parses "YYYY-MM" into { year, month } with month 0-indexed (0 = January). */
function parseLabel(label: string): { year: number; month: number } {
  const [yearStr, monthStr] = label.split("-");
  return { year: Number(yearStr), month: Number(monthStr) - 1 };
}

function formatLabel(year: number, month: number): string {
  // month may be >11 or <0 here before normalization — normalize via a
  // real Date so year-wrapping (month 12 -> next year, month -1 -> prior
  // year) is handled correctly rather than hand-rolled.
  const normalized = new Date(Date.UTC(year, month, 1));
  const y = normalized.getUTCFullYear();
  const m = String(normalized.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Number of days in a given UTC month (0-indexed month). */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the *next* month is the last day of *this* month.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * The due date for a given period, given the plan's billingDay.
 * Clamps to the target month's actual last day when billingDay doesn't
 * exist there (e.g. the 31st in a 30-day month) — never rolls over into
 * the next month.
 */
export function dueDateForPeriod(periodLabel: string, billingDay: number): Date {
  const { year, month } = parseLabel(periodLabel);
  const clampedDay = Math.min(billingDay, daysInMonth(year, month));
  return new Date(Date.UTC(year, month, clampedDay));
}

/**
 * The next period's label, or null for ONE_TIME (which never recurs).
 * Always advances from the CURRENT label's month — never from a
 * previously-clamped due date — so a clamped February doesn't cause
 * March's due date to drift down from the plan's real billingDay.
 */
export function nextPeriodLabel(
  currentLabel: string,
  frequency: BillingFrequency
): string | null {
  if (frequency === "ONE_TIME") {
    return null;
  }
  const { year, month } = parseLabel(currentLabel);
  const monthsToAdd = MONTHS_PER_FREQUENCY[frequency];
  return formatLabel(year, month + monthsToAdd);
}

/**
 * The label of a ClientService's very first billing period: the start
 * month itself if billingDay hasn't happened yet that month (relative to
 * startDate's own day-of-month), otherwise the following month.
 */
export function firstPeriodLabel(startDate: Date, billingDay: number): string {
  const year = startDate.getUTCFullYear();
  const month = startDate.getUTCMonth();
  const startDay = startDate.getUTCDate();

  if (startDay <= billingDay) {
    return formatLabel(year, month);
  }
  return formatLabel(year, month + 1);
}
