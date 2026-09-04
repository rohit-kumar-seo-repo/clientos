"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClientAction } from "../actions";

export function ClientForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    const result = await createClientAction(formData);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.push(`/clients/${result.clientId}`);
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-lg font-semibold text-neutral-900">Add Client</h1>
      <form action={handleSubmit} className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Field name="businessName" label="Business name" required />
        <Field name="contactPerson" label="Contact person" />
        <Field name="phone" label="Phone" />
        <Field name="email" label="Email" type="email" />
        <Field name="website" label="Website" />
        <Field name="industry" label="Industry" />
        <Field name="location" label="Location" />
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Create client
        </button>
      </form>
    </div>
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
