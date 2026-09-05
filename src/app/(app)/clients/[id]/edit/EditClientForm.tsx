"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Client } from "@/generated/prisma/client";
import { updateClientAction } from "../../actions";

export function EditClientForm({ client }: { client: Client }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    const result = await updateClientAction(client.id, formData);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.push(`/clients/${client.id}`);
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-lg font-semibold text-neutral-900">Edit Client</h1>
      <form action={handleSubmit} className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Field name="businessName" label="Business name" defaultValue={client.businessName} required />
        <Field name="contactPerson" label="Contact person" defaultValue={client.contactPerson ?? ""} />
        <Field name="phone" label="Phone" defaultValue={client.phone ?? ""} />
        <Field name="email" label="Email" type="email" defaultValue={client.email ?? ""} />
        <Field name="website" label="Website" defaultValue={client.website ?? ""} />
        <Field name="industry" label="Industry" defaultValue={client.industry ?? ""} />
        <Field name="location" label="Location" defaultValue={client.location ?? ""} />
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Save changes
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
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
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
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
      />
    </div>
  );
}
