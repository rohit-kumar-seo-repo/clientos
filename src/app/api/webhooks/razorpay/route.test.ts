import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { createClientService } from "@/lib/services";

// revalidatePath reads Next's per-request store and throws when called
// outside a request scope, which is exactly where these tests run.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Real signature verification runs against RAZORPAY_WEBHOOK_SECRET from
// .env.test — only the Razorpay API re-fetch calls are mocked, since those
// would otherwise hit the real network.
vi.mock("@/lib/razorpay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/razorpay")>();
  return {
    ...actual,
    fetchPaymentLink: vi.fn(),
    fetchPayment: vi.fn(),
  };
});

import { fetchPaymentLink, fetchPayment } from "@/lib/razorpay";
import { POST } from "./route";

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET!;

function sign(rawBody: string): string {
  return crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
}

function buildRequest(bodyObj: unknown, signatureOverride?: string) {
  const rawBody = JSON.stringify(bodyObj);
  const signature = signatureOverride ?? sign(rawBody);
  return new NextRequest("https://os.rohitkumarseo.com/api/webhooks/razorpay", {
    method: "POST",
    headers: { "content-type": "application/json", "x-razorpay-signature": signature },
    body: rawBody,
  });
}

function paidEventBody(paymentLinkId: string, paymentId: string) {
  return {
    event: "payment_link.paid",
    contains: ["payment_link", "payment"],
    payload: {
      payment_link: { entity: { id: paymentLinkId } },
      payment: { entity: { id: paymentId } },
    },
  };
}

describe("POST /api/webhooks/razorpay", () => {
  let orgId: number;
  let clientId: number;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    const client = await prisma.client.create({ data: { organizationId: orgId, businessName: "ABC Interiors" } });
    clientId = client.id;
  });

  async function setupLinkForOpenPeriod(amountInPaise = 500000) {
    const service = await createClientService({
      clientId,
      serviceName: "Local SEO",
      feeInPaise: amountInPaise,
      frequency: "MONTHLY",
      billingDay: 5,
      startDate: new Date(Date.UTC(2026, 7, 3)),
      endDate: null,
    });
    const plan = await prisma.billingPlan.findUniqueOrThrow({ where: { clientServiceId: service.id } });
    const period = await prisma.billingPeriod.findFirstOrThrow({ where: { billingPlanId: plan.id } });
    const link = await prisma.paymentLink.create({
      data: {
        clientId,
        billingPeriodId: period.id,
        razorpayPaymentLinkId: `plink_${Math.random().toString(36).slice(2, 10)}`,
        razorpayShortUrl: "https://rzp.io/l/test",
        description: "test link",
        amountInPaise: period.amountInPaise,
        currency: "INR",
        status: "CREATED",
      },
    });
    return { period, link };
  }

  it("rejects an invalid signature with 400 and writes nothing", async () => {
    const { link } = await setupLinkForOpenPeriod();
    const body = paidEventBody(link.razorpayPaymentLinkId, "pay_bad_sig");
    const request = buildRequest(body, "0000invalidsignature0000");

    const response = await POST(request);

    expect(response.status).toBe(400);
    const events = await prisma.webhookEvent.findMany();
    expect(events).toHaveLength(0);
    const payments = await prisma.payment.findMany();
    expect(payments).toHaveLength(0);
  });

  it("processes a valid full payment end to end", async () => {
    const { period, link } = await setupLinkForOpenPeriod();
    vi.mocked(fetchPaymentLink).mockResolvedValue({ amount_paid: period.amountInPaise } as never);
    vi.mocked(fetchPayment).mockResolvedValue({
      status: "captured",
      amount: period.amountInPaise,
      currency: "INR",
      order_id: null,
    } as never);

    const response = await POST(buildRequest(paidEventBody(link.razorpayPaymentLinkId, "pay_ok1")));

    expect(response.status).toBe(200);
    const updatedPeriod = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(updatedPeriod.status).toBe("PAID");
    const payment = await prisma.payment.findFirstOrThrow({ where: { razorpayPaymentId: "pay_ok1" } });
    expect(payment.recordedByAdminId).toBeNull();
    const event = await prisma.webhookEvent.findFirstOrThrow({});
    expect(event.processedAt).not.toBeNull();
    expect(event.processingError).toBeNull();
  });

  it("does not re-fetch or re-process a payment status that isn't actually captured", async () => {
    const { period, link } = await setupLinkForOpenPeriod();
    vi.mocked(fetchPaymentLink).mockResolvedValue({ amount_paid: 0 } as never);
    vi.mocked(fetchPayment).mockResolvedValue({
      status: "failed",
      amount: period.amountInPaise,
      currency: "INR",
      order_id: null,
      error_description: "card declined",
    } as never);

    await POST(buildRequest(paidEventBody(link.razorpayPaymentLinkId, "pay_not_captured")));

    const untouchedPeriod = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(untouchedPeriod.status).not.toBe("PAID");
    const payments = await prisma.payment.findMany();
    expect(payments).toHaveLength(0);
  });

  it("deduplicates the exact same event delivered twice (retry-safe)", async () => {
    const { period, link } = await setupLinkForOpenPeriod();
    vi.mocked(fetchPaymentLink).mockResolvedValue({ amount_paid: period.amountInPaise } as never);
    vi.mocked(fetchPayment).mockResolvedValue({
      status: "captured",
      amount: period.amountInPaise,
      currency: "INR",
      order_id: null,
    } as never);
    const body = paidEventBody(link.razorpayPaymentLinkId, "pay_retry");

    const first = await POST(buildRequest(body));
    const second = await POST(buildRequest(body));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const secondJson = await second.json();
    expect(secondJson.duplicate).toBe(true);
    const events = await prisma.webhookEvent.findMany();
    expect(events).toHaveLength(1);
    const payments = await prisma.payment.findMany();
    expect(payments).toHaveLength(1);
  });

  it("handles two concurrent deliveries of the same event without double-processing", async () => {
    const { period, link } = await setupLinkForOpenPeriod();
    vi.mocked(fetchPaymentLink).mockResolvedValue({ amount_paid: period.amountInPaise } as never);
    vi.mocked(fetchPayment).mockResolvedValue({
      status: "captured",
      amount: period.amountInPaise,
      currency: "INR",
      order_id: null,
    } as never);
    const body = paidEventBody(link.razorpayPaymentLinkId, "pay_concurrent");

    await Promise.all([POST(buildRequest(body)), POST(buildRequest(body))]);

    const events = await prisma.webhookEvent.findMany();
    expect(events).toHaveLength(1);
    const payments = await prisma.payment.findMany({ where: { razorpayPaymentId: "pay_concurrent" } });
    expect(payments).toHaveLength(1);
  });

  it("preserves an unmatched-link event for investigation instead of dropping it silently", async () => {
    const body = paidEventBody("plink_unknown_to_us", "pay_unknown_link");

    const response = await POST(buildRequest(body));

    expect(response.status).toBe(200);
    const event = await prisma.webhookEvent.findFirstOrThrow({});
    expect(event.processingError).toContain("No matching PaymentLink");
    expect(fetchPaymentLink).not.toHaveBeenCalled();
  });

  it("records an amount-mismatch anomaly and does not mark the obligation paid", async () => {
    const { period, link } = await setupLinkForOpenPeriod();
    vi.mocked(fetchPaymentLink).mockResolvedValue({ amount_paid: period.amountInPaise + 500 } as never);
    vi.mocked(fetchPayment).mockResolvedValue({
      status: "captured",
      amount: period.amountInPaise + 500,
      currency: "INR",
      order_id: null,
    } as never);

    await POST(buildRequest(paidEventBody(link.razorpayPaymentLinkId, "pay_mismatch")));

    const untouchedPeriod = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(untouchedPeriod.status).not.toBe("PAID");
    const event = await prisma.webhookEvent.findFirstOrThrow({});
    expect(event.processingError).toContain("amount_mismatch");
    const anomalyActivity = await prisma.clientActivity.findFirst({ where: { eventType: "payment_link.anomaly" } });
    expect(anomalyActivity).not.toBeNull();
  });
});
