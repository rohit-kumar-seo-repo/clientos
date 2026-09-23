"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createPaymentLinkForBillingPeriodAction,
  createPaymentLinkForMilestoneAction,
  createPaymentLinkForAddOnAction,
} from "@/app/(app)/clients/payment-link-actions";

type Kind = "billingPeriod" | "projectMilestone" | "projectAddOn";
type ActionResult = { error: string } | { ok: true };

const ACTIONS: Record<Kind, (id: number, formData: FormData) => Promise<ActionResult>> = {
  billingPeriod: createPaymentLinkForBillingPeriodAction,
  projectMilestone: createPaymentLinkForMilestoneAction,
  projectAddOn: createPaymentLinkForAddOnAction,
};

/**
 * "Create Razorpay Payment Link" action for an existing obligation
 * (BillingPeriod / ProjectMilestone / ProjectAddOn). Amount is fixed to the
 * obligation's own amount — only partial-payment and expiry are
 * admin-configurable here, matching the currency/amount invariants in
 * payment-links.ts (obligation-backed links never redefine the amount).
 */
export function PaymentLinkButton({ kind, id, amountInPaise }: { kind: Kind; id: number; amountInPaise: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    const result = await ACTIONS[kind](id, formData);
    setPending(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs text-indigo-700 hover:bg-indigo-100"
      >
        Create Payment Link
      </button>
    );
  }

  return (
    <form
      action={handleSubmit}
      className="mt-3 w-full space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 text-xs"
    >
      {error && <p className="text-red-600">{error}</p>}
      <p className="text-neutral-600">
        Razorpay Payment Link for ₹{(amountInPaise / 100).toLocaleString("en-IN")}
      </p>
      <label className="flex items-center gap-2 text-neutral-700">
        <input type="checkbox" name="allowsPartialPayment" className="h-3.5 w-3.5 rounded border-neutral-300" />
        Allow partial payment
      </label>
      <div className="flex flex-wrap gap-2">
        <div>
          <label className="mb-1 block text-neutral-600">Min. first payment (₹, optional)</label>
          <input
            name="minPartialAmountInRupees"
            type="number"
            min={0.01}
            step="0.01"
            className="w-32 rounded-lg border border-neutral-300 px-2 py-1"
          />
        </div>
        <div>
          <label className="mb-1 block text-neutral-600">Expires (optional)</label>
          <input name="expiresAt" type="date" className="rounded-lg border border-neutral-300 px-2 py-1" />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create Link"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-neutral-700 hover:bg-neutral-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
