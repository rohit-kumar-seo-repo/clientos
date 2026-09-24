"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  getClientsForPaymentLinkAction,
  getClientObligationsForPaymentLinkAction,
  createPaymentLinkForBillingPeriodAction,
  createPaymentLinkForMilestoneAction,
  createPaymentLinkForAddOnAction,
  createCustomPaymentLinkAction,
  type PaymentLinkClientOption,
  type PaymentLinkSummary,
} from "@/app/(app)/clients/payment-link-actions";
import type { EligibleObligations } from "@/lib/payment-links";

// Mirrors SUPPORTED_CURRENCIES in src/lib/razorpay.ts — duplicated rather
// than imported, since that module is server-only (instantiates the
// Razorpay SDK at module scope) and must never reach a "use client" bundle.
const CUSTOM_LINK_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AUD", "CAD", "SGD", "AED", "CHF", "HKD", "JPY", "MYR", "NZD", "THB", "ZAR"];

type PaymentForKind = "billingPeriod" | "projectMilestone" | "projectAddOn" | "custom";

const EMPTY_OBLIGATIONS: EligibleObligations = { billingPeriods: [], milestones: [], addOns: [] };

function fmtAmount(paise: number, currency: string) {
  const amount = (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "INR" ? `₹${amount}` : `${currency} ${amount}`;
}

type ResultMeta = { customerLabel: string; paymentForLabel: string };

export function CreatePaymentLinkModal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [clients, setClients] = useState<PaymentLinkClientOption[] | null>(null);
  const [clientId, setClientId] = useState<string>("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerContact, setCustomerContact] = useState("");

  const [obligations, setObligations] = useState<EligibleObligations>(EMPTY_OBLIGATIONS);
  const [loadingObligations, setLoadingObligations] = useState(false);
  const [paymentFor, setPaymentFor] = useState<PaymentForKind>("billingPeriod");
  const [obligationId, setObligationId] = useState<string>("");

  const [customAmount, setCustomAmount] = useState("");
  const [customCurrency, setCustomCurrency] = useState("INR");
  const [customDescription, setCustomDescription] = useState("");

  const [paymentType, setPaymentType] = useState<"standard" | "upi">("standard");
  const [allowsPartialPayment, setAllowsPartialPayment] = useState(false);
  const [minPartialAmount, setMinPartialAmount] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const [result, setResult] = useState<{ summary: PaymentLinkSummary; meta: ResultMeta } | null>(null);

  function resetForm() {
    setClientId("");
    setCustomerName("");
    setCustomerEmail("");
    setCustomerContact("");
    setObligations(EMPTY_OBLIGATIONS);
    setPaymentFor("billingPeriod");
    setObligationId("");
    setCustomAmount("");
    setCustomCurrency("INR");
    setCustomDescription("");
    setPaymentType("standard");
    setAllowsPartialPayment(false);
    setMinPartialAmount("");
    setExpiresAt("");
    setError(null);
    setResult(null);
  }

  async function openModal() {
    setOpen(true);
    if (!clients) {
      const res = await getClientsForPaymentLinkAction();
      setClients(res.clients);
    }
  }

  function closeModal() {
    setOpen(false);
    resetForm();
  }

  async function handleClientChange(value: string) {
    setClientId(value);
    setObligationId("");
    setObligations(EMPTY_OBLIGATIONS);
    const client = clients?.find((c) => c.id === Number(value));
    setCustomerName(client?.contactPerson ?? client?.businessName ?? "");
    setCustomerEmail(client?.email ?? "");
    setCustomerContact(client?.phone ?? "");
    if (!value) return;
    setLoadingObligations(true);
    const res = await getClientObligationsForPaymentLinkAction(Number(value));
    setLoadingObligations(false);
    if (!("error" in res)) setObligations(res);
  }

  function commonFormData(): FormData {
    const fd = new FormData();
    fd.set("paymentType", paymentType);
    fd.set("customerName", customerName.trim());
    fd.set("customerEmail", customerEmail.trim());
    fd.set("customerContact", customerContact.trim());
    if (allowsPartialPayment) fd.set("allowsPartialPayment", "on");
    if (minPartialAmount.trim()) fd.set("minPartialAmountInRupees", minPartialAmount.trim());
    if (expiresAt) fd.set("expiresAt", expiresAt);
    return fd;
  }

  function currentObligationOptions(): { id: number; label: string; amountInPaise: number; currency: string }[] {
    if (paymentFor === "billingPeriod") return obligations.billingPeriods;
    if (paymentFor === "projectMilestone") return obligations.milestones.map((m) => ({ ...m, currency: "INR" }));
    if (paymentFor === "projectAddOn") return obligations.addOns.map((a) => ({ ...a, currency: "INR" }));
    return [];
  }

  function selectedObligationLabel(): { label: string; amountInPaise: number; currency: string } | null {
    const id = Number(obligationId);
    if (!id) return null;
    return currentObligationOptions().find((o) => o.id === id) ?? null;
  }

  const selectedObligation = selectedObligationLabel();
  const selectedClient = clients?.find((c) => c.id === Number(clientId)) ?? null;

  const canSubmit =
    Boolean(clientId) &&
    (paymentFor === "custom"
      ? Boolean(customAmount) && Number(customAmount) > 0 && Boolean(customDescription.trim())
      : Boolean(obligationId));

  async function handleSubmit() {
    if (!canSubmit || !selectedClient) return;
    setPending(true);
    setError(null);

    const fd = commonFormData();
    let res: { error: string } | { ok: true; paymentLink: PaymentLinkSummary };
    let paymentForLabel: string;

    if (paymentFor === "custom") {
      fd.set("amountInRupees", customAmount);
      fd.set("currency", customCurrency);
      fd.set("description", customDescription.trim());
      res = await createCustomPaymentLinkAction(Number(clientId), fd);
      paymentForLabel = `Custom — ${customDescription.trim()}`;
    } else {
      const id = Number(obligationId);
      paymentForLabel = selectedObligation?.label ?? "—";
      if (paymentFor === "billingPeriod") res = await createPaymentLinkForBillingPeriodAction(id, fd);
      else if (paymentFor === "projectMilestone") res = await createPaymentLinkForMilestoneAction(id, fd);
      else res = await createPaymentLinkForAddOnAction(id, fd);
    }

    setPending(false);
    if ("error" in res) {
      setError(res.error);
      return;
    }
    setResult({
      summary: res.paymentLink,
      meta: { customerLabel: customerName.trim() || selectedClient.businessName, paymentForLabel },
    });
    router.refresh();
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — Open still works.
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openModal}
        className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
      >
        + Create Payment Link
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
      >
        + Create Payment Link
      </button>

      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
          {result ? (
            <div className="space-y-4">
              <h2 className="text-base font-semibold text-neutral-900">Payment Link Created</h2>
              <dl className="space-y-2 text-sm">
                <Row label="Customer" value={result.meta.customerLabel} />
                <Row label="Payment For" value={result.meta.paymentForLabel} />
                <Row label="Amount" value={fmtAmount(result.summary.amountInPaise, result.summary.currency)} />
                <Row label="Currency" value={result.summary.currency} />
                <Row label="Payment Type" value={result.summary.isUpiOnly ? "UPI Payment Link" : "Standard Payment Link"} />
                <Row label="Status" value={result.summary.status.replace("_", " ")} />
                <Row
                  label="Expiry"
                  value={result.summary.expiresAt ? new Date(result.summary.expiresAt).toLocaleDateString("en-IN") : "No expiry"}
                />
                <Row label="Razorpay Link ID" value={result.summary.razorpayPaymentLinkId} mono />
                <Row label="Payment Link URL" value={result.summary.razorpayShortUrl} mono />
              </dl>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => copyLink(result.summary.razorpayShortUrl)}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  {copied ? "Copied" : "Copy Link"}
                </button>
                <a
                  href={result.summary.razorpayShortUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  Open Link
                </a>
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  Create Another
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className="ml-auto rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-neutral-900">Create Payment Link</h2>
                <button type="button" onClick={closeModal} className="text-sm text-neutral-400 hover:text-neutral-900">
                  ✕
                </button>
              </div>

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

              <Field label="Payment Method">
                <div className="flex gap-4 text-sm text-neutral-700">
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={paymentType === "standard"} onChange={() => setPaymentType("standard")} />
                    Standard Payment Link
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="radio" checked={paymentType === "upi"} onChange={() => setPaymentType("upi")} />
                    UPI Payment Link
                  </label>
                </div>
              </Field>

              <Field label="Client">
                <select
                  value={clientId}
                  onChange={(e) => handleClientChange(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                >
                  <option value="">{clients ? "Select a client…" : "Loading clients…"}</option>
                  {clients?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.businessName}
                    </option>
                  ))}
                </select>
              </Field>

              {clientId && (
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Customer Name">
                    <input
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                    />
                  </Field>
                  <Field label="Email">
                    <input
                      type="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                    />
                  </Field>
                  <Field label="Phone">
                    <input
                      value={customerContact}
                      onChange={(e) => setCustomerContact(e.target.value)}
                      className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                    />
                  </Field>
                </div>
              )}

              {clientId && (
                <Field label="Payment For">
                  <select
                    value={paymentFor}
                    onChange={(e) => {
                      setPaymentFor(e.target.value as PaymentForKind);
                      setObligationId("");
                    }}
                    className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                  >
                    <option value="billingPeriod">Existing Billing Period</option>
                    <option value="projectMilestone">Existing Project Milestone</option>
                    <option value="projectAddOn">Existing Project Add-on</option>
                    <option value="custom">Custom Payment</option>
                  </select>
                </Field>
              )}

              {clientId && paymentFor !== "custom" && (
                <Field label="Obligation">
                  <select
                    value={obligationId}
                    onChange={(e) => setObligationId(e.target.value)}
                    className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">{loadingObligations ? "Loading…" : "Select…"}</option>
                    {currentObligationOptions().map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label} — {fmtAmount(o.amountInPaise, o.currency)}
                      </option>
                    ))}
                  </select>
                  {!loadingObligations && obligationId === "" && currentObligationOptions().length === 0 && (
                    <p className="mt-1 text-xs text-neutral-400">No eligible items for this client.</p>
                  )}
                </Field>
              )}

              {clientId && paymentFor !== "custom" && selectedObligation && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Amount">
                    <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm text-neutral-700">
                      {fmtAmount(selectedObligation.amountInPaise, selectedObligation.currency)}
                    </p>
                  </Field>
                  <Field label="Currency">
                    <p className="rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-sm text-neutral-700">
                      {selectedObligation.currency}
                    </p>
                  </Field>
                </div>
              )}

              {clientId && paymentFor === "custom" && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Amount">
                      <input
                        type="number"
                        min={0.01}
                        step="0.01"
                        value={customAmount}
                        onChange={(e) => setCustomAmount(e.target.value)}
                        className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                      />
                    </Field>
                    <Field label="Currency">
                      <select
                        value={customCurrency}
                        onChange={(e) => setCustomCurrency(e.target.value)}
                        className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                      >
                        {CUSTOM_LINK_CURRENCIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <Field label="Description">
                    <input
                      value={customDescription}
                      onChange={(e) => setCustomDescription(e.target.value)}
                      placeholder="What is this payment for?"
                      className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                    />
                  </Field>
                </>
              )}

              {clientId && (
                <>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 text-sm text-neutral-700">
                      <input
                        type="checkbox"
                        checked={allowsPartialPayment}
                        onChange={(e) => setAllowsPartialPayment(e.target.checked)}
                      />
                      Allow partial payment
                    </label>
                    {allowsPartialPayment && (
                      <input
                        type="number"
                        min={0.01}
                        step="0.01"
                        placeholder="Min. amount (₹)"
                        value={minPartialAmount}
                        onChange={(e) => setMinPartialAmount(e.target.value)}
                        className="w-36 rounded-lg border border-neutral-300 px-2 py-1 text-sm"
                      />
                    )}
                  </div>

                  <Field label="Expiry (optional)">
                    <input
                      type="date"
                      value={expiresAt}
                      onChange={(e) => setExpiresAt(e.target.value)}
                      className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                    />
                  </Field>
                </>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!canSubmit || pending}
                  onClick={handleSubmit}
                  className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
                >
                  {pending ? "Creating…" : "Create Payment Link"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-neutral-600">{label}</label>
      {children}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-neutral-500">{label}</dt>
      <dd className={`text-right text-neutral-900 ${mono ? "break-all font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
