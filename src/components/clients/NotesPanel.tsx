"use client";

import { useState } from "react";
import type { ClientNote } from "@/generated/prisma/client";
import { addNoteAction } from "@/app/(app)/clients/actions";

export function NotesPanel({
  clientId,
  notes,
}: {
  clientId: number;
  notes: ClientNote[];
}) {
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(formData: FormData) {
    const result = await addNoteAction(clientId, formData);
    setError("error" in result ? result.error : null);
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-medium text-neutral-900">Notes</h2>
      <ul className="mb-4 space-y-3">
        {notes.map((note) => (
          <li key={note.id} className="text-sm text-neutral-700">
            {note.body}
            <div className="text-xs text-neutral-400">
              {note.createdAt.toLocaleDateString("en-IN")}
            </div>
          </li>
        ))}
        {notes.length === 0 && (
          <li className="text-sm text-neutral-400">No notes yet.</li>
        )}
      </ul>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <form action={handleAdd} className="flex gap-2">
        <textarea
          name="body"
          placeholder="Add a note…"
          required
          rows={2}
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="self-end rounded-lg bg-neutral-100 px-3 py-1.5 text-sm hover:bg-neutral-200"
        >
          Add
        </button>
      </form>
    </section>
  );
}
