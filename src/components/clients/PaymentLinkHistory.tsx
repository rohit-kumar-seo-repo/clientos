"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PaymentLink } from "@/generated/prisma/client";
import { createCustomPaymentLinkAction, cancelPaymentLinkAction } from "@/app/(app)/clients/payment-link-actions";

// Mirrors SUPPORTED_CURRENCIES in src/lib/razorpay.ts — duplicated rather
// than imported, since that module is server-only (instantiates the
// Razorpay SDK at module scope) and must never reach a "use client" bundle.
const CUSTOM_LINK_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AUD", "CAD", "SGD", "AED", "CHF", "HKD", "JPY", "MYR", "NZD", "THB", "ZAR"];

const STATUS_STYLES: Record<string, string> = {
  CREATED: "bg-blue-50 text-blue-700",
  PARTIALLY_PAID: "bg-amber-50 text-amber-700",
  PAID: "bg-emerald-50 text-emerald-700",
  EXPIRED: "bg-neutral-100 text-neutral-500",
  CANCELLED: "bg-neutral-100 text-neutral-500",
};

const ACTIVE_STATUSES = new Set(["CREATED", "PARTIALLY_PAID"]);

export function PaymentLinkHistory({ clientId, paymentLinks }: { clientId: number; paymentLinks: PaymentLink[] }) {
  const router = useRouter();
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  async function handleCreateCustom(formData: FormData) {
    const result = await createCustomPaymentLinkAction(clientId, formData);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setShowCustomForm(false);
    router.refresh();
  }

  async function handleCancel(id: number) {
    await cancelPaymentLinkAction(id);
    router.refresh();
  }

  async function copyLink(id: number, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId((v) => (v === id ? null : v)), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — Open still works.
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-900">Payment Links</h2>
        <button
          type="button"
          onClick={() => setShowCustomForm((v) => !v)}
          className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
        >
          {showCustomForm ? "Close" : "+ Custom Link"}
        </button>
      </div>

      {showCustomForm && (
        <form
          action={handleCreateCustom}
          className="mb-4 space-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs"
        >
          {error && <p className="text-red-600">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-neutral-600">Amount</label>
              <input
                name="amountInRupees"
                type="number"
                min={0.01}
                step="0.01"
                required
                className="w-full rounded-lg border border-neutral-300 px-2 py-1"
              />
            </div>
            <div>
              <label className="mb-1 block text-neutral-600">Currency</label>
              <select name="currency" defaultValue="INR" className="w-full rounded-lg border border-neutral-300 px-2 py-1">
                {CUSTOM_LINK_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-neutral-600">Description</label>
            <input name="description" type="text" required className="w-full rounded-lg border border-neutral-300 px-2 py-1" />
          </div>
          <label className="flex items-center gap-2 text-neutral-700">
            <input type="checkbox" name="allowsPartialPayment" className="h-3.5 w-3.5 rounded border-neutral-300" />
            Allow partial payment
          </label>
          <div>
            <label className="mb-1 block text-neutral-600">Expires (optional)</label>
            <input name="expiresAt" type="date" className="rounded-lg border border-neutral-300 px-2 py-1" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="rounded-lg bg-neutral-900 px-3 py-1.5 font-medium text-white hover:bg-neutral-800">
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowCustomForm(false)}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <ul className="space-y-2 text-sm">
        {paymentLinks.map((link) => (
          <li key={link.id} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-100 p-3">
            <div className="min-w-0">
              <div className="truncate font-medium text-neutral-900">{link.description}</div>
              <div className="text-xs text-neutral-500">
                {link.currency} {(link.amountInPaise / 100).toLocaleString("en-IN")}
                {link.allowsPartialPayment && " · partial payment allowed"}
                {link.expiresAt && ` · expires ${new Date(link.expiresAt).toLocaleDateString("en-IN")}`}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[link.status] ?? ""}`}>
                {link.status.replace("_", " ")}
              </span>
              {ACTIVE_STATUSES.has(link.status) && (
                <>
                  <button type="button" onClick={() => copyLink(link.id, link.razorpayShortUrl)} className="text-xs text-neutral-500 hover:text-neutral-900">
                    {copiedId === link.id ? "Copied" : "Copy"}
                  </button>
                  <a
                    href={link.razorpayShortUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-neutral-500 hover:text-neutral-900"
                  >
                    Open
                  </a>
                  <button type="button" onClick={() => handleCancel(link.id)} className="text-xs text-neutral-500 hover:text-red-600">
                    Cancel
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
        {paymentLinks.length === 0 && <li className="text-sm text-neutral-400">No payment links yet.</li>}
      </ul>
    </section>
  );
}
