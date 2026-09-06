export type AttentionTier =
  | "overdue_payment"
  | "due_today"
  | "due_tomorrow"
  | "due_within_3_days"
  | "due_within_7_days"
  | "overdue_work"
  | "upcoming_renewal"
  | "normal_upcoming_work"
  | "no_action_required";

const TIER_RANK: Record<AttentionTier, number> = {
  overdue_payment: 1,
  due_today: 2,
  due_tomorrow: 3,
  due_within_3_days: 4,
  due_within_7_days: 5,
  overdue_work: 6,
  upcoming_renewal: 7,
  normal_upcoming_work: 8,
  no_action_required: 9,
};

export type AttentionPeriodSignal = {
  id: number; // the BillingPeriod's own id — carried through purely so
              // callers (the dashboard's Mark Paid button) can act on
              // the period without a second lookup; the engine itself
              // never reads this field
  dueDate: Date;
  amountInPaise: number;
  status: "UPCOMING" | "PAID";
} | null;

export type AttentionInput = {
  clientServiceId: number;
  clientId: number;
  clientName: string;
  serviceName: string;
  workStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "ON_HOLD";
  nextActionDate: Date | null;
  endDate: Date | null;
  currentPeriod: AttentionPeriodSignal;
};

export type RankedService = AttentionInput & {
  tier: AttentionTier;
  tierRank: number;      // 1-9, lower = more urgent
  daysOverdue: number;   // 0 unless tier is "overdue_payment"
  outstandingAmountInPaise: number; // 0 unless a payment is owed
};

/** Truncates to UTC midnight so day-difference math never depends on time-of-day. */
export function startOfUTCDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Positive when `date` is in the future relative to `today`, negative if in the past. */
function daysUntil(date: Date, today: Date): number {
  return Math.round((startOfUTCDay(date).getTime() - startOfUTCDay(today).getTime()) / MS_PER_DAY);
}

export function computeServiceTier(
  input: AttentionInput,
  today: Date
): Pick<RankedService, "tier" | "tierRank" | "daysOverdue" | "outstandingAmountInPaise"> {
  const period = input.currentPeriod;
  const isUnpaidObligation = period !== null && period.status !== "PAID";

  if (isUnpaidObligation) {
    const daysToDue = daysUntil(period!.dueDate, today);

    if (daysToDue < 0) {
      return {
        tier: "overdue_payment",
        tierRank: TIER_RANK.overdue_payment,
        daysOverdue: -daysToDue,
        outstandingAmountInPaise: period!.amountInPaise,
      };
    }
    if (daysToDue === 0) {
      return {
        tier: "due_today",
        tierRank: TIER_RANK.due_today,
        daysOverdue: 0,
        outstandingAmountInPaise: period!.amountInPaise,
      };
    }
    if (daysToDue === 1) {
      return {
        tier: "due_tomorrow",
        tierRank: TIER_RANK.due_tomorrow,
        daysOverdue: 0,
        outstandingAmountInPaise: period!.amountInPaise,
      };
    }
    // daysToDue is 2 or 3 here — 0 and 1 are already claimed above, so this
    // tier's real range is 2-3 days even though it's named "within 3 days."
    if (daysToDue <= 3) {
      return {
        tier: "due_within_3_days",
        tierRank: TIER_RANK.due_within_3_days,
        daysOverdue: 0,
        outstandingAmountInPaise: period!.amountInPaise,
      };
    }
    // Similarly this is really "4-7 days" — 1-3 are already claimed.
    if (daysToDue <= 7) {
      return {
        tier: "due_within_7_days",
        tierRank: TIER_RANK.due_within_7_days,
        daysOverdue: 0,
        outstandingAmountInPaise: period!.amountInPaise,
      };
    }
  }

  // Not in tiers 1-5 (either fully paid/no obligation, or unpaid but more
  // than 7 days out). ON_HOLD is deliberately NOT checked here — it never
  // independently creates urgency (confirmed with Rohit 2026-09-05).
  if (input.nextActionDate && daysUntil(input.nextActionDate, today) < 0) {
    return {
      tier: "overdue_work",
      tierRank: TIER_RANK.overdue_work,
      daysOverdue: 0,
      outstandingAmountInPaise: 0,
    };
  }

  if (input.endDate) {
    const daysToRenewal = daysUntil(input.endDate, today);
    if (daysToRenewal >= 0 && daysToRenewal <= 30) {
      return {
        tier: "upcoming_renewal",
        tierRank: TIER_RANK.upcoming_renewal,
        daysOverdue: 0,
        outstandingAmountInPaise: 0,
      };
    }
  }

  const hasUnpaidObligationFarOut = isUnpaidObligation; // implies >7 days out, having fallen through tiers 1-5
  const hasOngoingWork = input.workStatus !== "COMPLETED";
  if (hasUnpaidObligationFarOut || hasOngoingWork) {
    return {
      tier: "normal_upcoming_work",
      tierRank: TIER_RANK.normal_upcoming_work,
      daysOverdue: 0,
      outstandingAmountInPaise: hasUnpaidObligationFarOut ? period!.amountInPaise : 0,
    };
  }

  return {
    tier: "no_action_required",
    tierRank: TIER_RANK.no_action_required,
    daysOverdue: 0,
    outstandingAmountInPaise: 0,
  };
}

function compareRanked(a: RankedService, b: RankedService): number {
  if (a.tierRank !== b.tierRank) return a.tierRank - b.tierRank;
  if (a.daysOverdue !== b.daysOverdue) return b.daysOverdue - a.daysOverdue; // longest overdue first
  if (a.outstandingAmountInPaise !== b.outstandingAmountInPaise) {
    return b.outstandingAmountInPaise - a.outstandingAmountInPaise; // highest amount first
  }
  const aDue = a.currentPeriod?.dueDate.getTime() ?? Infinity;
  const bDue = b.currentPeriod?.dueDate.getTime() ?? Infinity;
  if (aDue !== bDue) return aDue - bDue; // nearest due date first

  // Not specified by the brief — alphabetical fallback so output order is
  // deterministic and reproducible, rather than depending on input order.
  return (
    a.clientName.localeCompare(b.clientName) ||
    a.serviceName.localeCompare(b.serviceName)
  );
}

export function rankServicesForAttention(
  inputs: AttentionInput[],
  today: Date
): RankedService[] {
  const ranked = inputs.map((input) => ({
    ...input,
    ...computeServiceTier(input, today),
  }));
  return ranked.sort(compareRanked);
}
