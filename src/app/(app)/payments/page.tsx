import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { prisma } from "@/lib/db";

export default async function PaymentsPage() {
  const admin = await requireAdmin();

  const payments = await prisma.payment.findMany({
    where: {
      invoice: { client: { organizationId: admin.organizationId } },
    },
    include: {
      invoice: {
        include: {
          client: true,
          lineItems: {
            include: {
              billingPeriod: {
                include: {
                  billingPlan: {
                    include: {
                      clientService: { include: { serviceTemplate: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Derive a human-readable period label from the first line item, if any
  function periodLabel(payment: (typeof payments)[number]): string {
    const period = payment.invoice.lineItems[0]?.billingPeriod;
    if (!period) return "—";
    const [y, m] = period.periodLabel.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", {
      month: "short",
      year: "numeric",
    });
  }

  function serviceName(payment: (typeof payments)[number]): string {
    return (
      payment.invoice.lineItems[0]?.billingPeriod.billingPlan.clientService
        .serviceTemplate.name ?? "—"
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-lg font-semibold text-neutral-900">Payments</h1>

      {payments.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-400">
          No payments recorded yet. Use{" "}
          <Link href="/clients" className="text-neutral-900 underline underline-offset-2">
            Mark Paid
          </Link>{" "}
          on a client&apos;s service to record a payment.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 text-left text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Service</th>
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 text-neutral-600">
                      {payment.capturedAt
                        ? new Date(payment.capturedAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : new Date(payment.createdAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                    </td>
                    <td className="px-4 py-3 font-medium text-neutral-900">
                      {payment.invoice.client.businessName}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      {serviceName(payment)}
                    </td>
                    <td className="px-4 py-3 text-neutral-600">
                      {periodLabel(payment)}
                    </td>
                    <td className="px-4 py-3 font-medium text-neutral-900">
                      ₹{(payment.amountInPaise / 100).toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-block rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                        {payment.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/clients/${payment.invoice.clientId}`}
                        className="text-xs text-neutral-500 hover:text-neutral-900 hover:underline"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
