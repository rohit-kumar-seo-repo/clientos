"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createServiceAction } from "@/app/(app)/clients/service-actions";

export const SERVICE_CATEGORIES = [
  "Google Ads",
  "Local SEO",
  "Website SEO",
  "Social Media Management",
  "Website Development",
  "Automation",
  "Other/Custom",
] as const;

const FREQUENCY_OPTIONS = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "HALF_YEARLY", label: "Half-yearly" },
  { value: "YEARLY", label: "Yearly" },
  { value: "ONE_TIME", label: "One-time" },
];

export function AddServiceForm({ clientId }: { clientId: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function handleSubmit(formData: FormData) {
    const result = await createServiceAction(clientId, formData);
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
        className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
      >
        Add Service
      </button>
    );
  }

  return (
    <form action={handleSubmit} className="space-y-3 rounded-lg border border-neutral-200 p-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field name="serviceName" label="Service name" required />
        <Field name="feeInRupees" label="Price (₹)" type="number" required />
        <div>
          <label className="mb-1 block text-sm text-neutral-600" htmlFor="frequency">
            Billing frequency
          </label>
          <select
            id="frequency"
            name="frequency"
            required
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          >
            {FREQUENCY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <Field name="billingDay" label="Billing day (1-28)" type="number" required />
        <Field name="startDate" label="Start date" type="date" required />
        <Field name="endDate" label="End date (optional)" type="date" />
      </div>

      {/* Services Included — multi-select checkboxes */}
      <div>
        <p className="mb-2 text-sm text-neutral-600">
          Services Included{" "}
          <span className="text-neutral-400">(select all that apply)</span>
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {SERVICE_CATEGORIES.map((cat) => (
            <label key={cat} className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
              <input
                type="checkbox"
                name="categories"
                value={cat}
                className="h-4 w-4 rounded border-neutral-300 accent-neutral-900"
              />
              {cat}
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Add Service
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  type = "text",
  required = false,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm text-neutral-600" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
      />
    </div>
  );
}
