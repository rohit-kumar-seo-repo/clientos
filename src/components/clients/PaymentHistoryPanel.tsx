import type { Payment } from "@/generated/prisma/client";

export function PaymentHistoryPanel({ payments }: { payments: Payment[] }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-medium text-neutral-900">Payment History</h2>
      {payments.length === 0 ? (
        <p className="text-sm text-neutral-400">No payments recorded yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {payments.map((payment) => (
            <li key={payment.id} className="flex items-center justify-between">
              <span className="text-neutral-900">
                ₹{(payment.amountInPaise / 100).toLocaleString("en-IN")}
              </span>
              <span className="text-neutral-500">
                {payment.capturedAt
                  ? new Date(payment.capturedAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })
                  : "—"}
              </span>
              <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                {payment.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
