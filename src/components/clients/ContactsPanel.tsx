"use client";

import { useState } from "react";
import type { ClientContact } from "@/generated/prisma/client";
import { addContactAction, removeContactAction } from "@/app/(app)/clients/actions";

export function ContactsPanel({
  clientId,
  contacts,
}: {
  clientId: number;
  contacts: ClientContact[];
}) {
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(formData: FormData) {
    const result = await addContactAction(clientId, formData);
    if ("error" in result) {
      setError(result.error);
    } else {
      setError(null);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-medium text-neutral-900">Contacts</h2>
      <ul className="mb-4 space-y-2">
        {contacts.map((contact) => (
          <li key={contact.id} className="flex items-center justify-between text-sm">
            <span>
              {contact.name}
              {contact.role && <span className="text-neutral-400"> · {contact.role}</span>}
            </span>
            <form
              action={async () => {
                await removeContactAction(clientId, contact.id);
              }}
            >
              <button type="submit" className="text-neutral-400 hover:text-red-600">
                Remove
              </button>
            </form>
          </li>
        ))}
        {contacts.length === 0 && (
          <li className="text-sm text-neutral-400">No additional contacts.</li>
        )}
      </ul>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <form action={handleAdd} className="flex gap-2">
        <input
          name="name"
          placeholder="Name"
          required
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <input
          name="role"
          placeholder="Role"
          className="w-32 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm hover:bg-neutral-200"
        >
          Add
        </button>
      </form>
    </section>
  );
}
