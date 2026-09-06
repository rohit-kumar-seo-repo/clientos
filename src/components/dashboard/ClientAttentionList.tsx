"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RankedService } from "@/lib/attention";
import { markPaidAction } from "@/app/(app)/clients/payment-actions";

const TIER_LABELS: Record<string, string> = {
  overdue_payment: "Overdue",
  due_today: "Due Today",
  due_tomorrow: "Due Tomorrow",
  due_within_3_days: "Due Soon",
  due_within_7_days: "Due Soon",
  overdue_work: "Work Overdue",
  upcoming_renewal: "Renewal Upcoming",
  normal_upcoming_work: "In Progress",
  no_action_required: "On Track",
};

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

export function ClientAttentionList({ services }: { services: RankedService[] }) {
  const visible = services.filter((s) => s.tier !== "no_action_required");

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-medium text-neutral-900">Clients Requiring Attention</h2>
        <span className="text-xs text-neutral-400">Sorted by priority</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Service</th>
              <th className="px-4 py-3 font-medium">Payment</th>
              <th className="px-4 py-3 font-medium">Work Status</th>
              <th className="px-4 py-3 font-medium">Due Date</th>
              <th className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((service) => (
              <AttentionRow key={service.clientServiceId} service={service} />
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
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

function AttentionRow({ service }: { service: RankedService }) {
  const router = useRouter();
  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const period = service.currentPeriod;

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
    <tr className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
      <td className="px-4 py-3 font-medium text-neutral-900">
        <Link href={`/clients/${service.clientId}`} className="hover:underline">
          {service.clientName}
        </Link>
      </td>
      <td className="px-4 py-3 text-neutral-700">{service.serviceName}</td>
      <td className="px-4 py-3">
        <span className={`rounded-md px-2 py-0.5 text-xs ${TIER_BADGE_CLASS[service.tier]}`}>
          {TIER_LABELS[service.tier]}
        </span>
        {period && (
          <span className="ml-2 text-neutral-600">
            ₹{(period.amountInPaise / 100).toLocaleString("en-IN")}
            {service.daysOverdue > 0 && ` — ${service.daysOverdue} days overdue`}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-neutral-600">
        {service.workStatus.replace("_", " ")}
      </td>
      <td className="px-4 py-3 text-neutral-600">
        {period
          ? new Date(period.dueDate).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
            })
          : "—"}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {period && period.status !== "PAID" && (
            <button
              type="button"
              onClick={() => setShowMarkPaid((v) => !v)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
            >
              Mark Paid
            </button>
          )}
          <Link
            href={`/clients/${service.clientId}`}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
          >
            View
          </Link>
        </div>
        {showMarkPaid && (
          <MarkPaidInlineForm
            clientServiceId={service.clientServiceId}
            amountInPaise={period?.amountInPaise ?? 0}
            onSubmit={handleMarkPaid}
            error={error}
            onCancel={() => setShowMarkPaid(false)}
          />
        )}
      </td>
    </tr>
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
    <form action={onSubmit} className="mt-2 flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-neutral-500">Amount (₹)</span>
        <input
          name="amountInRupees"
          type="number"
          defaultValue={amountInPaise / 100}
          required
          className="w-24 rounded border border-neutral-300 px-2 py-1 text-xs"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-neutral-500">Date</span>
        <input
          name="paidAt"
          type="date"
          defaultValue={new Date().toISOString().slice(0, 10)}
          required
          className="rounded border border-neutral-300 px-2 py-1 text-xs"
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" className="rounded bg-neutral-900 px-2 py-1 text-xs text-white">
          Confirm
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-neutral-300 px-2 py-1 text-xs">
          Cancel
        </button>
      </div>
    </form>
  );
}
