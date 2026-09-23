/**
 * Server-only Razorpay SDK wrapper. Never import this from a "use client"
 * component — it reads RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET/
 * RAZORPAY_WEBHOOK_SECRET from process.env and instantiates the SDK client.
 *
 * Every function here is a thin pass-through to the `razorpay` package;
 * business logic (obligation resolution, amount/currency checks, DB writes)
 * lives in payment-links.ts, never here.
 */
import Razorpay from "razorpay";

type RazorpayClient = InstanceType<typeof Razorpay>;

// Hand-written rather than derived via ReturnType<RazorpayClient["paymentLink"]["create"]>:
// the SDK's methods are overloaded (a Promise-returning form and a
// callback-returning `void` form), and ReturnType/Parameters on an
// overloaded signature always resolves to the LAST overload — which here is
// the `void` one. Only the fields this codebase actually reads are declared.
export type RazorpayPaymentLinkEntity = {
  id: string;
  short_url: string;
  status: "created" | "partially_paid" | "expired" | "cancelled" | "paid";
  amount_paid: number;
};

export type RazorpayPaymentEntity = {
  id: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  amount: number | string;
  currency: string;
  order_id: string | null;
  error_description: string | null;
};

// Curated from Razorpay's documented international-currency list. Not
// guaranteed exhaustive or current — Razorpay's own API is the final
// authority and will reject a currency this allowlist missed or one not
// actually enabled on the account; this is a fast, cheap pre-check only.
export const SUPPORTED_CURRENCIES = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "SGD",
  "AED",
  "CHF",
  "HKD",
  "JPY",
  "MYR",
  "NZD",
  "THB",
  "ZAR",
] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(currency: string): currency is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(currency.toUpperCase());
}

let cachedClient: RazorpayClient | null = null;

function getClient(): RazorpayClient {
  if (cachedClient) return cachedClient;
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) {
    throw new Error("Razorpay is not configured: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set.");
  }
  cachedClient = new Razorpay({ key_id, key_secret });
  return cachedClient;
}

export function isRazorpayConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

/**
 * TEST/LIVE inferred from Razorpay's own key-id prefix convention
 * (`rzp_test_...` / `rzp_live_...`). Never reads the secret.
 */
export function getRazorpayMode(): "test" | "live" | "unconfigured" {
  const keyId = process.env.RAZORPAY_KEY_ID;
  if (!keyId) return "unconfigured";
  return keyId.startsWith("rzp_live_") ? "live" : "test";
}

export type CreatePaymentLinkParams = {
  amountInPaise: number;
  currency: string;
  description: string;
  customerName: string;
  customerEmail?: string | null;
  customerContact?: string | null;
  acceptPartial: boolean;
  firstMinPartialAmountInPaise?: number | null;
  expireBy?: Date | null;
  referenceId?: string;
};

export async function createPaymentLink(
  params: CreatePaymentLinkParams
): Promise<RazorpayPaymentLinkEntity> {
  const client = getClient();
  return client.paymentLink.create({
    amount: params.amountInPaise,
    currency: params.currency,
    description: params.description,
    customer: {
      name: params.customerName,
      ...(params.customerEmail ? { email: params.customerEmail } : {}),
      ...(params.customerContact ? { contact: params.customerContact } : {}),
    },
    accept_partial: params.acceptPartial,
    ...(params.firstMinPartialAmountInPaise
      ? { first_min_partial_amount: params.firstMinPartialAmountInPaise }
      : {}),
    ...(params.expireBy ? { expire_by: Math.floor(params.expireBy.getTime() / 1000) } : {}),
    ...(params.referenceId ? { reference_id: params.referenceId } : {}),
    notify: { email: Boolean(params.customerEmail), sms: Boolean(params.customerContact) },
  });
}

export async function cancelPaymentLink(razorpayPaymentLinkId: string): Promise<RazorpayPaymentLinkEntity> {
  const client = getClient();
  return client.paymentLink.cancel(razorpayPaymentLinkId);
}

/**
 * Server-side re-fetch of a Payment Link's real state from Razorpay's API —
 * used by the webhook handler to never trust the webhook payload alone.
 */
export async function fetchPaymentLink(razorpayPaymentLinkId: string): Promise<RazorpayPaymentLinkEntity> {
  const client = getClient();
  return client.paymentLink.fetch(razorpayPaymentLinkId);
}

/**
 * Server-side re-fetch of a Payment's real state from Razorpay's API — used
 * by the webhook handler to independently confirm status/amount/currency
 * rather than trusting the webhook payload alone.
 */
export async function fetchPayment(razorpayPaymentId: string): Promise<RazorpayPaymentEntity> {
  const client = getClient();
  return client.payments.fetch(razorpayPaymentId);
}

/**
 * HMAC-SHA256 verification of a webhook delivery. `rawBody` must be the
 * exact, unparsed request body text — signing is byte-sensitive, so this
 * breaks silently if called with a re-serialized JSON object instead.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("Razorpay is not configured: RAZORPAY_WEBHOOK_SECRET is not set.");
  }
  return Razorpay.validateWebhookSignature(rawBody, signature, secret);
}
