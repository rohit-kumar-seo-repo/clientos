"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteClientAction, forceDeleteClientAction } from "@/app/(app)/clients/actions";

export function DeleteClientButton({ clientId }: { clientId: number }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "confirm" | "forceConfirm">("idle");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasPayments, setHasPayments] = useState(false);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    const result = await deleteClientAction(clientId);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      if (result.hasPayments) setHasPayments(true);
      return;
    }
    router.push("/clients");
    router.refresh();
  }

  async function handleForceDelete() {
    setBusy(true);
    setError(null);
    const result = await forceDeleteClientAction(clientId);
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

  if (mode === "forceConfirm") {
    return (
      <span className="flex items-center gap-2 text-sm">
        <span className="text-xs text-red-700 font-medium">
          This will permanently delete ALL payment records. Cannot be undone.
        </span>
        {error && <span className="text-xs text-red-600">{error}</span>}
        <button
          type="button"
          disabled={busy}
          onClick={handleForceDelete}
          className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Force Delete"}
        </button>
        <button
          type="button"
          onClick={() => { setMode("idle"); setError(null); setHasPayments(false); }}
          className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
        >
          Cancel
        </button>
      </span>
    );
  }

  // mode === "confirm"
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
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
      {hasPayments && (
        <button
          type="button"
          onClick={() => { setMode("forceConfirm"); setError(null); }}
          className="rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
        >
          Force Delete (incl. payments)
        </button>
      )}
      <button
        type="button"
        onClick={() => { setMode("idle"); setError(null); setHasPayments(false); }}
        className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
      >
        Cancel
      </button>
    </span>
  );
}
