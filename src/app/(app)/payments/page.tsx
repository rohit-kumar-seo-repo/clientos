import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { prisma } from "@/lib/db";

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const admin = await requireAdmin();
  const { month } = await searchParams;

  // Validate month param: must be YYYY-MM. Reject anything else.
  const selectedMonth =
    month && /^\d{4}-\d{2}$/.test(month) ? month : null;

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
              // Stage 4: include project obligation relations so their labels
              // are available in the description/detail helpers below.
              projectMilestone: { include: { project: true } },
              projectAddOn: { include: { project: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // ---------------------------------------------------------------------------
  // Helpers — derive display values from first line item (always exactly one)
  // ---------------------------------------------------------------------------

  type Payment = (typeof payments)[number];

  // The name of the service/project associated with this payment.
  function paymentName(p: Payment): string {
    const item = p.invoice.lineItems[0];
    if (!item) return "—";
    if (item.projectMilestone) return item.projectMilestone.project.title;
    if (item.projectAddOn) return item.projectAddOn.project.title;
    return (
      item.billingPeriod?.billingPlan?.clientService?.serviceTemplate.name ??
      "—"
    );
  }

  // The detail label: billing period month for recurring, obligation label
  // for project payments.
  function paymentDetail(p: Payment): string {
    const item = p.invoice.lineItems[0];
    if (!item) return "—";
    if (item.projectMilestone) return item.projectMilestone.label;
    if (item.projectAddOn) return item.projectAddOn.description;
    if (item.billingPeriod) {
      const [y, m] = item.billingPeriod.periodLabel.split("-");
      return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(
        "en-IN",
        { month: "short", year: "numeric" }
      );
    }
    return "—";
  }

  // Recurring vs Project type label.
  function paymentType(p: Payment): "Recurring" | "Project" {
    const item = p.invoice.lineItems[0];
    if (item?.projectMilestone || item?.projectAddOn) return "Project";
    return "Recurring";
  }

  // ---------------------------------------------------------------------------
  // Month filtering (UTC — consistent with DB storage)
  // ---------------------------------------------------------------------------

  function paymentMonth(p: Payment): string {
    const d = new Date(p.capturedAt ?? p.createdAt);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  const displayed = selectedMonth
    ? payments.filter((p) => paymentMonth(p) === selectedMonth)
    : payments;

  // ---------------------------------------------------------------------------
  // Summary stats
  // ---------------------------------------------------------------------------

  const now = new Date();
  const curMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastMonth = `${lastMonthDate.getUTCFullYear()}-${String(lastMonthDate.getUTCMonth() + 1).padStart(2, "0")}`;

  const thisMonthPayments = payments.filter((p) => paymentMonth(p) === curMonth);
  const thisMonthTotal = thisMonthPayments.reduce(
    (s, p) => s + p.amountInPaise,
    0
  );

  const lastMonthPayments = payments.filter((p) => paymentMonth(p) === lastMonth);
  const lastMonthTotal = lastMonthPayments.reduce(
    (s, p) => s + p.amountInPaise,
    0
  );

  const allTimeTotal = payments.reduce((s, p) => s + p.amountInPaise, 0);

  function fmtAmount(paise: number) {
    return `₹${(paise / 100).toLocaleString("en-IN")}`;
  }

  function fmtMonthLabel(ym: string) {
    const [y, m] = ym.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Payments</h1>

        {/* Month filter */}
        <form method="GET" className="flex items-center gap-2">
          <input
            type="month"
            name="month"
            defaultValue={selectedMonth ?? ""}
            className="rounded-lg border border-neutral-300 px-2 py-1 text-sm text-neutral-700"
          />
          <button
            type="submit"
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Filter
          </button>
          {selectedMonth && (
            <Link
              href="/payments"
              className="text-sm text-neutral-500 hover:text-neutral-900 hover:underline"
            >
              Clear
            </Link>
          )}
        </form>
      </div>

      {/* Summary bar — fixed totals, independent of the month filter below */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-neutral-200 bg-white px-5 py-4">
          <p className="text-xs text-neutral-500">This Month Collected Payment</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {fmtAmount(thisMonthTotal)}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {thisMonthPayments.length} payment
            {thisMonthPayments.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white px-5 py-4">
          <p className="text-xs text-neutral-500">Last Month Collected Payment</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {fmtAmount(lastMonthTotal)}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {lastMonthPayments.length} payment
            {lastMonthPayments.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white px-5 py-4">
          <p className="text-xs text-neutral-500">All Time</p>
          <p className="mt-1 text-xl font-semibold text-neutral-900">
            {fmtAmount(allTimeTotal)}
          </p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {payments.length} payment{payments.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {displayed.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-400">
          {selectedMonth ? (
            <>
              No payments in {fmtMonthLabel(selectedMonth)}.{" "}
              <Link
                href="/payments"
                className="text-neutral-900 underline underline-offset-2"
              >
                View all
              </Link>
            </>
          ) : (
            <>
              No payments recorded yet. Use{" "}
              <Link
                href="/clients"
                className="text-neutral-900 underline underline-offset-2"
              >
                Mark Paid
              </Link>{" "}
              on a service or project milestone to record a payment.
            </>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 text-left text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Description</th>
                  <th className="px-4 py-3 font-medium">Detail</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {displayed.map((payment) => {
                  const type = paymentType(payment);
                  return (
                    <tr key={payment.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 text-neutral-600">
                        {new Date(
                          payment.capturedAt ?? payment.createdAt
                        ).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3 font-medium text-neutral-900">
                        {payment.invoice.client.businessName}
                      </td>
                      <td className="px-4 py-3 text-neutral-700">
                        {paymentName(payment)}
                      </td>
                      <td className="px-4 py-3 text-neutral-600">
                        {paymentDetail(payment)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${
                            type === "Project"
                              ? "bg-blue-50 text-blue-700"
                              : "bg-neutral-100 text-neutral-600"
                          }`}
                        >
                          {type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-neutral-900">
                        {fmtAmount(payment.amountInPaise)}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
