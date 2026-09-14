"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteClientAction } from "@/app/(app)/clients/actions";

export function DeleteClientButton({ clientId }: { clientId: number }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "confirm">("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    const result = await deleteClientAction(clientId);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.push("/clients");
    router.refresh();
  }

  if (mode === "idle") {
    return (
      <button
        type="button"
        onClick={() => setMode("confirm")}
        className="text-sm text-red-500 hover:text-red-700 hover:underline"
      >
        Delete
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2 text-sm">
      {error ? (
        <span className="max-w-sm text-xs text-red-600">{error}</span>
      ) : (
        <span className="text-neutral-700">Delete this client permanently?</span>
      )}
      {!error && (
        <button
          type="button"
          disabled={busy}
          onClick={handleDelete}
          className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Confirm"}
        </button>
      )}
      <button
        type="button"
        onClick={() => { setMode("idle"); setError(null); }}
        className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
      >
        Cancel
      </button>
    </span>
  );
}
