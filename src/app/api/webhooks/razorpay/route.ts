import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import {
  verifyWebhookSignature,
  fetchPaymentLink,
  fetchPayment,
} from "@/lib/razorpay";
import {
  recordLinkPayment,
  recordLinkPaymentFailure,
  markLinkExpired,
  markLinkCancelledFromWebhook,
} from "@/lib/payment-links";

/**
 * Razorpay webhook receiver — Payment Links only (this integration never
 * creates Orders/Subscriptions, so no other event family is processed).
 *
 * Deliberately outside session-cookie auth: Razorpay authenticates via HMAC
 * signature, not our session. This is why src/middleware.ts excludes
 * `api/webhooks` from its redirect-to-login matcher — the ONE exception,
 * scoped to this path only.
 *
 * Never trusts the webhook payload's own numbers for the actual paid/failed
 * decision — every path re-fetches the authoritative entity from Razorpay's
 * API before writing anything (see fetchPaymentLink/fetchPayment calls
 * below), on top of the signature check.
 *
 * ASSUMPTION FLAGGED FOR THE TEST-MODE SMOKE TEST: Razorpay's webhook
 * payload shape for `contains` / the payment entity's link-reference field
 * is inferred from documentation, not a live payload inspected in this
 * codebase before now. Confirm against a real delivery and correct here if
 * the actual field names differ.
 */

type RazorpayWebhookBody = {
  event: string;
  contains?: string[];
  payload?: {
    payment_link?: { entity?: { id?: string } };
    payment?: { entity?: { id?: string; order_id?: string | null } };
  };
};

function buildEventKey(event: string, body: RazorpayWebhookBody): string | null {
  const entityId = body.payload?.payment?.entity?.id ?? body.payload?.payment_link?.entity?.id;
  if (!entityId) return null;
  return `${event}:${entityId}`;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");

  if (!signature || !verifyWebhookSignatureSafely(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let body: RazorpayWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const eventKey = buildEventKey(body.event, body);
  if (!eventKey) {
    // No entity id to key off of — nothing this integration can act on.
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  const paymentLinkId = body.payload?.payment_link?.entity?.id;
  if (!paymentLinkId) {
    // Not a Payment Link event (e.g. a bare payment.* with no link context)
    // — outside this integration's scope (Orders/Subscriptions aren't used).
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  // Resolve organization from OUR OWN database via the link, never from the
  // payload. Also doubles as the "do we even know this link" existence check.
  const ourLink = await prisma.paymentLink.findUnique({
    where: { razorpayPaymentLinkId: paymentLinkId },
    include: { client: true },
  });

  // Idempotency: insert-or-detect-duplicate up front, before any processing,
  // so a concurrent duplicate delivery loses the race cleanly (P2002) rather
  // than both proceeding to process the same event.
  //
  // On a P2002, the existing row's processedAt decides what "duplicate"
  // means: if it's set, this event was already fully handled — genuine
  // duplicate, no-op. If it's null, a prior attempt inserted the row and
  // then crashed/threw before finishing (a transient DB or Razorpay-API
  // error) — without this check, every one of Razorpay's automatic retries
  // would be swallowed as a false duplicate and the payment would never get
  // recorded. Reprocessing here is safe: recordLinkPayment/etc. all re-check
  // current state (already_fully_paid, status guards) before writing.
  let webhookEvent;
  try {
    webhookEvent = await prisma.webhookEvent.create({
      data: {
        organizationId: ourLink?.client.organizationId ?? (await getFallbackOrgId()),
        razorpayEventId: eventKey,
        eventType: body.event,
        payload: body as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.webhookEvent.findUniqueOrThrow({ where: { razorpayEventId: eventKey } });
      if (existing.processedAt) {
        return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
      }
      webhookEvent = existing;
    } else {
      throw err;
    }
  }

  if (!ourLink) {
    // A signature-valid webhook about a payment link we have no record of.
    // Genuine anomaly — preserved on the WebhookEvent row for investigation,
    // never silently dropped, but there is nothing further to act on.
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { processingError: "No matching PaymentLink found for this razorpayPaymentLinkId.", processedAt: new Date() },
    });
    return NextResponse.json({ ok: true, unmatched: true }, { status: 200 });
  }

  try {
    const outcome = await processEvent(body, ourLink.clientId, paymentLinkId);
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { processedAt: new Date(), processingError: outcome.anomaly ?? null },
    });

    if (outcome.clientId) {
      revalidatePath("/");
      revalidatePath("/calendar");
      revalidatePath("/payments");
      revalidatePath(`/clients/${outcome.clientId}`);
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    // P2034: a genuinely concurrent delivery of this same event is
    // mid-transaction on the same rows right now (the reprocess-a-stale-row
    // path above can race against it). That other request either already
    // committed or is about to — this one backs off rather than retrying
    // into the same conflict, exactly as if it had lost the idempotency
    // race outright. Any other error is a real failure: recorded and
    // re-thrown so the response is non-2xx and Razorpay retries later,
    // at which point processedAt correctly decides reprocess vs. duplicate.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") {
      return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    }
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { processingError: err instanceof Error ? err.message : "Unknown processing error" },
    });
    throw err;
  }
}

function verifyWebhookSignatureSafely(rawBody: string, signature: string): boolean {
  try {
    return verifyWebhookSignature(rawBody, signature);
  } catch {
    return false;
  }
}

async function getFallbackOrgId(): Promise<number> {
  // V1 has exactly one Organization row (see prisma/schema.prisma's own
  // header comment). Used only for the "we don't recognize this link"
  // anomaly path above, so the required WebhookEvent.organizationId column
  // still has somewhere valid to point.
  const org = await prisma.organization.findFirstOrThrow();
  return org.id;
}

async function processEvent(
  body: RazorpayWebhookBody,
  linkClientId: number,
  razorpayPaymentLinkId: string
): Promise<{ clientId: number | null; anomaly?: string }> {
  switch (body.event) {
    case "payment_link.paid":
    case "payment_link.partially_paid": {
      const paymentId = body.payload?.payment?.entity?.id;
      if (!paymentId) return { clientId: null, anomaly: "payment_link.paid event missing payment entity id" };

      // Server-side re-verification — never trust the webhook payload's own
      // amount/currency/status fields.
      const [linkEntity, paymentEntity] = await Promise.all([
        fetchPaymentLink(razorpayPaymentLinkId),
        fetchPayment(paymentId),
      ]);

      if (paymentEntity.status !== "captured") {
        return { clientId: null, anomaly: `payment ${paymentId} re-fetched status was "${paymentEntity.status}", not captured — not recorded as paid` };
      }

      const result = await recordLinkPayment({
        razorpayPaymentLinkId,
        razorpayPaymentId: paymentId,
        razorpayOrderId: paymentEntity.order_id ?? null,
        amountInPaise: Number(paymentEntity.amount),
        currency: paymentEntity.currency,
        cumulativeAmountPaidInPaise: Number(linkEntity.amount_paid),
        capturedAt: new Date(),
      });

      if ("error" in result) {
        if (result.error === "already_fully_paid") return { clientId: linkClientId };
        const anomaly = `recordLinkPayment failed: ${JSON.stringify(result)}`;
        await prisma.clientActivity.create({
          data: {
            clientId: linkClientId,
            eventType: "payment_link.anomaly",
            summary: `Razorpay payment ${paymentId} did not match the expected amount/currency for this payment link — not marked paid. Needs manual review.`,
          },
        });
        return { clientId: linkClientId, anomaly };
      }

      await prisma.clientActivity.create({
        data: {
          clientId: linkClientId,
          eventType: "payment.recorded",
          summary: `Payment of ₹${(Number(paymentEntity.amount) / 100).toLocaleString("en-IN")} received via Razorpay for ${result.obligationLabel}${result.fullyPaid ? "" : " (partial)"}.`,
        },
      });
      return { clientId: linkClientId };
    }

    case "payment.failed": {
      const paymentId = body.payload?.payment?.entity?.id;
      if (!paymentId) return { clientId: null, anomaly: "payment.failed event missing payment entity id" };
      const paymentEntity = await fetchPayment(paymentId);
      const result = await recordLinkPaymentFailure({
        razorpayPaymentLinkId,
        razorpayPaymentId: paymentId,
        amountInPaise: Number(paymentEntity.amount),
        currency: paymentEntity.currency,
        failureReason: paymentEntity.error_description ?? null,
      });
      if ("error" in result) return { clientId: null, anomaly: "payment.failed: link not found" };
      await prisma.clientActivity.create({
        data: {
          clientId: result.clientId,
          eventType: "payment_link.payment_failed",
          summary: `A Razorpay payment attempt failed for this client's payment link.`,
        },
      });
      return { clientId: result.clientId };
    }

    case "payment_link.expired": {
      const result = await markLinkExpired(razorpayPaymentLinkId);
      if ("error" in result) return { clientId: null };
      await prisma.clientActivity.create({
        data: { clientId: result.clientId, eventType: "payment_link.expired", summary: "Payment link expired without full payment." },
      });
      return { clientId: result.clientId };
    }

    case "payment_link.cancelled": {
      const result = await markLinkCancelledFromWebhook(razorpayPaymentLinkId);
      if ("error" in result) return { clientId: null };
      return { clientId: result.clientId };
    }

    default:
      // Any other payment_link.* event (e.g. an intermediate created/updated
      // notification) — acknowledged, nothing to act on.
      return { clientId: null };
  }
}
