import { requireAdmin } from "@/lib/require-admin";
import { isRazorpayConfigured, getRazorpayMode } from "@/lib/razorpay";

export default async function Page() {
  await requireAdmin();
  const configured = isRazorpayConfigured();
  const mode = getRazorpayMode();

  return (
    <div className="max-w-lg">
      <h1 className="text-xl font-semibold text-gray-900">Razorpay</h1>
      <p className="mt-1 text-sm text-gray-500">
        Read-only status. Keys are set via server environment variables, never entered here.
      </p>

      <dl className="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center justify-between px-4 py-3">
          <dt className="text-sm text-gray-600">Configured</dt>
          <dd className="text-sm font-medium text-gray-900">{configured ? "Yes" : "No"}</dd>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <dt className="text-sm text-gray-600">Mode</dt>
          <dd className="text-sm font-medium text-gray-900">
            {mode === "unconfigured" ? "—" : mode === "live" ? "LIVE" : "TEST"}
          </dd>
        </div>
      </dl>

      {!configured && (
        <p className="mt-4 text-sm text-gray-500">
          Set <code className="rounded bg-gray-100 px-1 py-0.5">RAZORPAY_KEY_ID</code>,{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">RAZORPAY_KEY_SECRET</code>, and{" "}
          <code className="rounded bg-gray-100 px-1 py-0.5">RAZORPAY_WEBHOOK_SECRET</code> in the
          server environment to enable Payment Links.
        </p>
      )}
      {configured && mode === "live" && (
        <p className="mt-4 text-sm font-medium text-red-600">
          LIVE credentials are configured. Real payments will be processed.
        </p>
      )}
    </div>
  );
}
