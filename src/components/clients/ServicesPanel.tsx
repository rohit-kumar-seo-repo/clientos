"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ClientService,
  ServiceTemplate,
  BillingPlan,
  BillingPeriod,
} from "@/generated/prisma/client";
import { updateServiceStatusAction } from "@/app/(app)/clients/service-actions";
import { markPaidAction } from "@/app/(app)/clients/payment-actions";
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
    <li className="rounded-lg border border-neutral-100 p-3 text-sm">
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
      <div className="mt-1 text-neutral-500">
        Work: {service.workStatus.replace("_", " ")}
        {service.progressPercent != null && ` — ${service.progressPercent}%`}
      </div>
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
