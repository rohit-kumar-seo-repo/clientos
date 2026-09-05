"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  ClientService,
  ServiceTemplate,
  BillingPlan,
  BillingPeriod,
} from "@/generated/prisma/client";
import { updateServiceStatusAction } from "@/app/(app)/clients/service-actions";
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

  const period = service.billingPlan?.billingPeriods[0];
  // Read the CURRENT price from billingPlan.amountInPaise, not
  // service.feeInPaise: Task 5's updateServiceAction only keeps
  // billingPlan.amountInPaise current on an edit (matching this plan's
  // "editing only affects BillingPlan and periods going forward" rule) —
  // service.feeInPaise stays frozen at whatever it was when the service
  // was first created. billingPlan is already the single source of truth
  // for frequency/billingDay for the same reason; treat price the same way.
  const feeInRupees = ((service.billingPlan?.amountInPaise ?? service.feeInPaise) / 100).toLocaleString(
    "en-IN"
  );

  function handleStatusChange(next: "ACTIVE" | "PAUSED" | "CANCELLED") {
    startTransition(async () => {
      await updateServiceStatusAction(service.id, next);
      router.refresh();
    });
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
            {" · Next due "}
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
        </div>
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
