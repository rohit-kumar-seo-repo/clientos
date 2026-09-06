"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ClientService,
  ServiceTemplate,
  BillingPlan,
  BillingPeriod,
} from "@/generated/prisma/client";
import { updateServiceStatusAction, updateWorkStatusAction } from "@/app/(app)/clients/service-actions";
import { markPaidAction } from "@/app/(app)/clients/payment-actions";
import { startOfUTCDay } from "@/lib/attention";
import { AddServiceForm } from "./AddServiceForm";

type ServiceWithBilling = ClientService & {
  serviceTemplate: ServiceTemplate;
  billingPlan:
    | (BillingPlan & { billingPeriods: BillingPeriod[] })
    | null;
};

const FREQUENCY_LABELS: Record<string, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  HALF_YEARLY: "Half-yearly",
  YEARLY: "Yearly",
  ONE_TIME: "One-time",
};

// I4: Use startOfUTCDay for both operands so this helper agrees with the
// attention engine's daysUntil(), which also normalizes to UTC midnight.
// A raw wall-clock diff against new Date() would cause the renewal badge to
// disagree with the dashboard tier depending on the time of day the page loads.
function isWithin30Days(date: Date): boolean {
  const todayUTC = startOfUTCDay(new Date());
  const dateUTC = startOfUTCDay(new Date(date));
  const diffDays = (dateUTC.getTime() - todayUTC.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 30;
}

export function ServicesPanel({
  clientId,
  services,
}: {
  clientId: number;
  services: ServiceWithBilling[];
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-900">Services</h2>
        <AddServiceForm clientId={clientId} />
      </div>
      <ul className="space-y-3">
        {services.map((service) => (
          <ServiceRow key={service.id} service={service} />
        ))}
        {services.length === 0 && (
          <li className="text-sm text-neutral-400">No services yet.</li>
        )}
      </ul>
    </section>
  );
}

function ServiceRow({ service }: { service: ServiceWithBilling }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showMarkPaid, setShowMarkPaid] = useState(false);
  const [markPaidError, setMarkPaidError] = useState<string | null>(null);
  const [showWorkForm, setShowWorkForm] = useState(false);
  const [workError, setWorkError] = useState<string | null>(null);

  const period = service.billingPlan?.billingPeriods[0];
  // billingPlan.amountInPaise is the current-price source of truth (see
  // Plan 1's Task 6 for why service.feeInPaise goes stale after an edit)
  // — this is display text only, not the Mark Paid form's default amount,
  // which correctly comes from the specific period being paid below.
  const feeInRupees = ((service.billingPlan?.amountInPaise ?? service.feeInPaise) / 100).toLocaleString(
    "en-IN"
  );
  const isPaid = period?.status === "PAID";

  function handleStatusChange(next: "ACTIVE" | "PAUSED" | "CANCELLED") {
    startTransition(async () => {
      await updateServiceStatusAction(service.id, next);
      router.refresh();
    });
  }

  async function handleWorkUpdate(formData: FormData) {
    const result = await updateWorkStatusAction(service.id, formData);
    if ("error" in result) {
      setWorkError(result.error);
      return;
    }
    setWorkError(null);
    setShowWorkForm(false);
    router.refresh();
  }

  async function handleMarkPaid(formData: FormData) {
    if (!period) return;
    const result = await markPaidAction(period.id, formData);
    if ("error" in result) {
      setMarkPaidError(result.error);
      return;
    }
    setMarkPaidError(null);
    setShowMarkPaid(false);
    router.refresh();
  }

  return (
    <li id={`service-${service.id}`} className="rounded-lg border border-neutral-100 p-3 text-sm scroll-mt-4">
      <div className="flex items-center justify-between">
        <span className="font-medium text-neutral-900">
          {service.serviceTemplate.name}
        </span>
        <StatusBadge status={service.status} />
      </div>
      <div className="mt-1 text-neutral-600">
        ₹{feeInRupees} — {FREQUENCY_LABELS[service.billingPlan?.frequency ?? ""]}
        {period && (
          <>
            {" · "}
            {isPaid ? "Paid" : "Next due"}{" "}
            {new Date(period.dueDate).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </>
        )}
      </div>
      {service.endDate && (
        <div className="mt-1 text-neutral-500">
          {isWithin30Days(service.endDate) ? (
            <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">
              Renewal due {new Date(service.endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            </span>
          ) : (
            <>Ends {new Date(service.endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</>
          )}
        </div>
      )}
      {/* Work status row — read-only summary + Update Work button */}
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <WorkStatusBadge status={service.workStatus} />
        {service.progressPercent != null && (
          <span className="text-xs text-neutral-500">{service.progressPercent}%</span>
        )}
        {service.nextActionNote && (
          <span className="text-xs text-neutral-400 truncate max-w-[180px]" title={service.nextActionNote}>
            → {service.nextActionNote}
          </span>
        )}
        <button
          type="button"
          onClick={() => setShowWorkForm((v) => !v)}
          className="ml-auto rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
        >
          {showWorkForm ? "Close" : "Update Work"}
        </button>
      </div>
      {showWorkForm && (
        <form
          action={handleWorkUpdate}
          className="mt-2 space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
        >
          {workError && <p className="text-xs text-red-600">{workError}</p>}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-neutral-600" htmlFor={`status-${service.id}`}>
                Status
              </label>
              <select
                id={`status-${service.id}`}
                name="workStatus"
                defaultValue={service.workStatus}
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              >
                <option value="NOT_STARTED">Not Started</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="COMPLETED">Completed</option>
                <option value="ON_HOLD">On Hold</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-600" htmlFor={`progress-${service.id}`}>
                Progress %
              </label>
              <input
                id={`progress-${service.id}`}
                name="progressPercent"
                type="number"
                min={0}
                max={100}
                defaultValue={service.progressPercent ?? ""}
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-600" htmlFor={`note-${service.id}`}>
              Current note
            </label>
            <input
              id={`note-${service.id}`}
              name="workNote"
              type="text"
              defaultValue={service.workNote ?? ""}
              className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-neutral-600" htmlFor={`next-note-${service.id}`}>
                Next action
              </label>
              <input
                id={`next-note-${service.id}`}
                name="nextActionNote"
                type="text"
                defaultValue={service.nextActionNote ?? ""}
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-neutral-600" htmlFor={`next-date-${service.id}`}>
                Next action date
              </label>
              <input
                id={`next-date-${service.id}`}
                name="nextActionDate"
                type="date"
                defaultValue={service.nextActionDate ? new Date(service.nextActionDate).toISOString().slice(0, 10) : ""}
                className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setShowWorkForm(false)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {service.status !== "CANCELLED" && (
        <div className="mt-2 flex gap-3 text-xs">
          {service.status === "ACTIVE" ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleStatusChange("PAUSED")}
              className="text-neutral-500 hover:text-neutral-900"
            >
              Pause
            </button>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleStatusChange("ACTIVE")}
              className="text-neutral-500 hover:text-neutral-900"
            >
              Reactivate
            </button>
          )}
          <button
            type="button"
            disabled={isPending}
            onClick={() => handleStatusChange("CANCELLED")}
            className="text-neutral-500 hover:text-red-600"
          >
            Cancel
          </button>
          {period && !isPaid && (
            <button
              type="button"
              onClick={() => setShowMarkPaid((v) => !v)}
              className="rounded-md bg-neutral-900 px-2 py-1 text-white hover:bg-neutral-800"
            >
              Mark Paid
            </button>
          )}
        </div>
      )}
      {showMarkPaid && period && (
        <form
          action={handleMarkPaid}
          className="mt-3 flex items-end gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
        >
          {markPaidError && (
            <p className="w-full text-xs text-red-600">{markPaidError}</p>
          )}
          <div>
            <label className="mb-1 block text-xs text-neutral-600" htmlFor={`amount-${period.id}`}>
              Amount (₹)
            </label>
            <input
              id={`amount-${period.id}`}
              name="amountInRupees"
              type="number"
              defaultValue={period.amountInPaise / 100}
              required
              className="w-28 rounded-lg border border-neutral-300 px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-600" htmlFor={`paidAt-${period.id}`}>
              Date
            </label>
            <input
              id={`paidAt-${period.id}`}
              name="paidAt"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
              className="rounded-lg border border-neutral-300 px-2 py-1 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setShowMarkPaid(false)}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Cancel
          </button>
        </form>
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-emerald-50 text-emerald-700",
    PAUSED: "bg-amber-50 text-amber-700",
    CANCELLED: "bg-neutral-100 text-neutral-500",
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs ${styles[status] ?? styles.CANCELLED}`}>
      {status}
    </span>
  );
}

function WorkStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    NOT_STARTED: "bg-neutral-100 text-neutral-600",
    IN_PROGRESS: "bg-blue-50 text-blue-700",
    COMPLETED: "bg-emerald-50 text-emerald-700",
    ON_HOLD: "bg-amber-50 text-amber-700",
  };
  const labels: Record<string, string> = {
    NOT_STARTED: "Not Started",
    IN_PROGRESS: "In Progress",
    COMPLETED: "Completed",
    ON_HOLD: "On Hold",
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${styles[status] ?? styles.NOT_STARTED}`}>
      {labels[status] ?? status}
    </span>
  );
}
