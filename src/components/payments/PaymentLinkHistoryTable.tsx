"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelPaymentLinkAction } from "@/app/(app)/clients/payment-link-actions";

export type PaymentLinkRow = {
  id: number;
  description: string;
  amountInPaise: number;
  currency: string;
  status: string;
  isUpiOnly: boolean;
  razorpayShortUrl: string;
  createdAt: Date;
  client: { id: number; businessName: string };
};

const STATUS_STYLES: Record<string, string> = {
  CREATED: "bg-blue-50 text-blue-700",
  PARTIALLY_PAID: "bg-amber-50 text-amber-700",
  PAID: "bg-emerald-50 text-emerald-700",
  EXPIRED: "bg-neutral-100 text-neutral-500",
  CANCELLED: "bg-neutral-100 text-neutral-500",
};

const ACTIVE_STATUSES = new Set(["CREATED", "PARTIALLY_PAID"]);

function fmtAmount(paise: number, currency: string) {
  const amount = (paise / 100).toLocaleString("en-IN");
  return currency === "INR" ? `₹${amount}` : `${currency} ${amount}`;
}

export function PaymentLinkHistoryTable({ links }: { links: PaymentLinkRow[] }) {
  const router = useRouter();
  const [copiedId, setCopiedId] = useState<number | null>(null);

  async function copyLink(id: number, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId((v) => (v === id ? null : v)), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — Open still works.
    }
  }

  async function handleCancel(id: number) {
    await cancelPaymentLinkAction(id);
    router.refresh();
  }

  if (links.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-400">
        No payment links created yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Client</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {links.map((link) => (
              <tr key={link.id} className="hover:bg-neutral-50">
                <td className="px-4 py-3 whitespace-nowrap text-neutral-600">
                  {new Date(link.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                </td>
                <td className="px-4 py-3 font-medium text-neutral-900">{link.client.businessName}</td>
                <td className="max-w-xs truncate px-4 py-3 text-neutral-700">{link.description}</td>
                <td className="px-4 py-3 whitespace-nowrap font-medium text-neutral-900">
                  {fmtAmount(link.amountInPaise, link.currency)}
                </td>
                <td className="px-4 py-3">
                  <span className="inline-block rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                    {link.isUpiOnly ? "UPI Link" : "Razorpay Link"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[link.status] ?? ""}`}>
                    {link.status.replace("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {ACTIVE_STATUSES.has(link.status) && (
                    <div className="flex justify-end gap-2 text-xs">
                      <button type="button" onClick={() => copyLink(link.id, link.razorpayShortUrl)} className="text-neutral-500 hover:text-neutral-900">
                        {copiedId === link.id ? "Copied" : "Copy"}
                      </button>
                      <a href={link.razorpayShortUrl} target="_blank" rel="noreferrer" className="text-neutral-500 hover:text-neutral-900">
                        Open
                      </a>
                      <button type="button" onClick={() => handleCancel(link.id)} className="text-neutral-500 hover:text-red-600">
                        Cancel
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
