"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RankedService } from "@/lib/attention";
import { markPaidAction } from "@/app/(app)/clients/payment-actions";

// Compute a specific issue label from tier + days data
function issueLabel(service: RankedService, todayMs: number): string {
  const { tier, daysOverdue, currentPeriod } = service;

  if (tier === "overdue_payment") {
    return `${daysOverdue} ${daysOverdue === 1 ? "day" : "days"} overdue`;
  }
  if (tier === "due_today") return "Due today";
  if (tier === "due_tomorrow") return "Due tomorrow";
  if (tier === "due_within_3_days" || tier === "due_within_7_days") {
    if (currentPeriod?.dueDate) {
      const daysLeft = Math.round(
        (new Date(currentPeriod.dueDate).setUTCHours(0, 0, 0, 0) - todayMs) /
          (24 * 60 * 60 * 1000)
      );
      return `Due in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`;
    }
    return "Due soon";
  }
  if (tier === "overdue_work") return "Work overdue";
  if (tier === "upcoming_renewal") return "Renewal soon";
  if (tier === "normal_upcoming_work") return "In progress";
  return "On track";
}

const TIER_BADGE_CLASS: Record<string, string> = {
  overdue_payment: "bg-red-50 text-red-600",
  due_today: "bg-amber-50 text-amber-700",
  due_tomorrow: "bg-amber-50 text-amber-700",
  due_within_3_days: "bg-amber-50 text-amber-700",
  due_within_7_days: "bg-amber-50 text-amber-700",
  overdue_work: "bg-indigo-50 text-indigo-600",
  upcoming_renewal: "bg-indigo-50 text-indigo-600",
  normal_upcoming_work: "bg-neutral-100 text-neutral-500",
  no_action_required: "bg-emerald-50 text-emerald-700",
};

export function ClientAttentionList({
  services,
  todayISO,
}: {
  services: RankedService[];
  todayISO: string;
}) {
  const todayMs = new Date(todayISO).setUTCHours(0, 0, 0, 0);
  const visible = services.filter((s) => s.tier !== "no_action_required");

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-neutral-900">Client Attention List</h2>
          <p className="mt-0.5 text-xs text-neutral-400">
            Clients and services that need your attention, prioritised by urgency
          </p>
        </div>
        <Link
          href="/clients"
          className="text-xs text-neutral-500 hover:text-neutral-900 hover:underline"
        >
          View All Clients →
        </Link>
      </div>

      <div className="overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            {/* #=5% Client=19% Service=21% Issue=16% Amount=12% DueDate=14% Action=13% */}
            <col style={{ width: "5%" }} />
            <col style={{ width: "19%" }} />
            <col style={{ width: "21%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "13%" }} />
          </colgroup>
          <thead className="border-b border-neutral-200 text-left text-neutral-500">
            <tr>
              <th className="px-3 py-2.5 font-medium text-xs">#</th>
              <th className="px-3 py-2.5 font-medium text-xs">Client</th>
              <th className="px-3 py-2.5 font-medium text-xs">Service</th>
              <th className="px-3 py-2.5 font-medium text-xs">Issue</th>
              <th className="px-3 py-2.5 font-medium text-xs">Amount</th>
              <th className="px-3 py-2.5 font-medium text-xs whitespace-nowrap">Due Date</th>
              <th className="px-3 py-2.5 font-medium text-xs">Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((service, idx) => (
              <AttentionRow
                key={service.clientServiceId}
                service={service}
                rowNum={idx + 1}
                todayMs={todayMs}
              />
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-neutral-400 text-xs">
                  Nothing needs attention right now.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AttentionRow({
  service,
  rowNum,
  todayMs,
}: {
  service: RankedService;
  rowNum: number;
  todayMs: number;
}) {
  const router = useRouter();
  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const period = service.currentPeriod;
  const label = issueLabel(service, todayMs);
  const badgeClass = TIER_BADGE_CLASS[service.tier] ?? "bg-neutral-100 text-neutral-500";

  const hasPaymentAction =
    period && period.status !== "PAID" &&
    ["overdue_payment", "due_today", "due_tomorrow", "due_within_3_days", "due_within_7_days"].includes(
      service.tier
    );

  async function handleMarkPaid(formData: FormData) {
    if (!period) return;
    const result = await markPaidAction(period.id, formData);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setShowMarkPaid(false);
    router.refresh();
  }

  return (
    <>
      {/* ── Data row — always fixed height, never distorted ── */}
      <tr className={`border-b ${showMarkPaid ? "border-neutral-200" : "border-neutral-100 last:border-0"} hover:bg-neutral-50`}>
        <td className="px-3 py-3 text-xs text-neutral-400">{rowNum}</td>
        <td className="px-3 py-3 font-medium text-neutral-900 truncate">
          <Link href={`/clients/${service.clientId}`} className="hover:underline" title={service.clientName}>
            {service.clientName}
          </Link>
        </td>
        <td className="px-3 py-3 text-neutral-700 truncate" title={service.serviceName}>{service.serviceName}</td>
        <td className="px-3 py-3">
          <span className={`inline-block rounded-md px-2 py-0.5 text-xs ${badgeClass}`}>
            {label}
          </span>
        </td>
        <td className="px-3 py-3 text-neutral-900 font-medium">
          {service.outstandingAmountInPaise > 0
            ? `₹${(service.outstandingAmountInPaise / 100).toLocaleString("en-IN")}`
            : <span className="text-neutral-400">—</span>}
        </td>
        <td className="px-3 py-3 text-neutral-600 whitespace-nowrap">
          {period
            ? new Date(period.dueDate).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            : <span className="text-neutral-400">—</span>}
        </td>
        <td className="px-3 py-3">
          <div className="flex items-center gap-1.5">
            {hasPaymentAction && (
              <button
                type="button"
                onClick={() => setShowMarkPaid((v) => !v)}
                className={`rounded-lg px-3 py-1.5 text-xs text-white ${showMarkPaid ? "bg-neutral-500 hover:bg-neutral-600" : "bg-neutral-900 hover:bg-neutral-700"}`}
              >
                {showMarkPaid ? "Cancel" : "Mark Paid"}
              </button>
            )}
            {!hasPaymentAction && (
              <Link
                href={`/clients/${service.clientId}`}
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
              >
                Update
              </Link>
            )}
            {hasPaymentAction && !showMarkPaid && (
              <Link
                href={`/clients/${service.clientId}`}
                className="text-xs text-neutral-400 hover:text-neutral-900"
              >
                View
              </Link>
            )}
          </div>
        </td>
      </tr>

      {/* ── Form row — spans all columns, no layout distortion ── */}
      {showMarkPaid && (
        <tr className="border-b border-neutral-100 last:border-0 bg-neutral-50">
          <td colSpan={7} className="px-4 py-3">
            <MarkPaidInlineForm
              clientServiceId={service.clientServiceId}
              amountInPaise={period?.amountInPaise ?? 0}
              onSubmit={handleMarkPaid}
              error={error}
              onCancel={() => setShowMarkPaid(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function MarkPaidInlineForm({
  amountInPaise,
  onSubmit,
  error,
  onCancel,
}: {
  clientServiceId: number;
  amountInPaise: number;
  onSubmit: (formData: FormData) => void;
  error: string | null;
  onCancel: () => void;
}) {
  return (
    <form
      action={onSubmit}
      className="flex items-end gap-4"
    >
      {error && <p className="text-xs text-red-600">{error}</p>}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-neutral-500">Amount (₹)</span>
        <input
          name="amountInRupees"
          type="number"
          defaultValue={amountInPaise / 100}
          required
          className="w-28 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-neutral-500">Payment date</span>
        <input
          name="paidAt"
          type="date"
          defaultValue={new Date().toISOString().slice(0, 10)}
          required
          className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
        />
      </label>
      <button
        type="submit"
        className="rounded-lg bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
      >
        Confirm Payment
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-xs text-neutral-400 hover:text-neutral-900"
      >
        Cancel
      </button>
    </form>
  );
}
