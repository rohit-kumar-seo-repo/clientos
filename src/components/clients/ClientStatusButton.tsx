"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setClientStatusAction } from "@/app/(app)/clients/actions";
import type { ClientStatus } from "@/generated/prisma/client";

const BADGE: Record<ClientStatus, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  PAUSED: "bg-amber-50 text-amber-700",
  CHURNED: "bg-neutral-100 text-neutral-500",
};

export function ClientStatusButton({
  clientId,
  status,
}: {
  clientId: number;
  status: ClientStatus;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isArchived = status === "CHURNED";
  // Archiving is the safe removal path — this is the only transition this
  // control exposes. PAUSED remains a valid DB value (e.g. set elsewhere)
  // but isn't a state this button drives toward.
  const targetStatus: ClientStatus = isArchived ? "ACTIVE" : "CHURNED";
  const actionLabel = isArchived ? "Reactivate" : "Archive";

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    const result = await setClientStatusAction(clientId, targetStatus);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return (
    <span className="flex items-center gap-2 text-sm">
      <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${BADGE[status]}`}>
        {status}
      </span>

      {confirming ? (
        <span className="flex items-center gap-2">
          {error ? (
            <span className="text-xs text-red-600">{error}</span>
          ) : (
            <span className="text-xs text-neutral-500">
              {isArchived
                ? "Reactivate this client?"
                : "Archive this client? No records are deleted — this only hides them from active work."}
            </span>
          )}
          {!error && (
            <button
              type="button"
              disabled={busy}
              onClick={handleConfirm}
              className="rounded-md bg-neutral-900 px-2 py-0.5 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Confirm"}
            </button>
          )}
          <button
            type="button"
            onClick={() => { setConfirming(false); setError(null); }}
            className="text-xs text-neutral-400 hover:text-neutral-700 hover:underline"
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-xs text-neutral-400 hover:text-neutral-700 hover:underline"
        >
          {actionLabel}
        </button>
      )}
    </span>
  );
}
