import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { createClientService } from "@/lib/services";

vi.mock("@/lib/razorpay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/razorpay")>();
  return {
    ...actual,
    createPaymentLink: vi.fn(),
    cancelPaymentLink: vi.fn(),
    fetchPaymentLink: vi.fn(),
    fetchPayment: vi.fn(),
  };
});

import { createPaymentLink, cancelPaymentLink } from "@/lib/razorpay";
import {
  createPaymentLinkForObligation,
  cancelPaymentLinkById,
  recordLinkPayment,
  recordLinkPaymentFailure,
  markLinkExpired,
  markLinkCancelledFromWebhook,
  getEligibleObligationsForClient,
  listPaymentLinksForOrg,
  MAX_PAYMENT_LINK_AMOUNT_IN_PAISE,
} from "@/lib/payment-links";

function mockRazorpayCreate() {
  // mockImplementation (not mockResolvedValue) so each call gets a fresh
  // random id — a static resolved value would make every created link
  // collide on the DB's razorpayPaymentLinkId unique constraint.
  vi.mocked(createPaymentLink).mockImplementation(async () => ({
    id: `plink_${Math.random().toString(36).slice(2, 10)}`,
    short_url: "https://rzp.io/l/fake",
  }) as never);
}

describe("payment-links", () => {
  let orgId: number;
  let clientId: number;
  let adminId: number;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors", email: "abc@example.com", phone: "9999999999" },
    });
    clientId = client.id;
    const admin = await prisma.adminUser.create({
      data: { organizationId: orgId, email: "rohit@example.com", passwordHash: "x" },
    });
    adminId = admin.id;
    mockRazorpayCreate();
  });

  async function setupOpenPeriod() {
    const service = await createClientService({
      clientId,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 5,
      startDate: new Date(Date.UTC(2026, 7, 3)),
      endDate: null,
    });
    const plan = await prisma.billingPlan.findUniqueOrThrow({ where: { clientServiceId: service.id } });
    return prisma.billingPeriod.findFirstOrThrow({ where: { billingPlanId: plan.id } });
  }

  async function setupProjectWithMilestoneAndAddOn() {
    const project = await prisma.project.create({
      data: { clientId, title: "Website Revamp", baseAmountInPaise: 5000000 },
    });
    const milestone = await prisma.projectMilestone.create({
      data: { projectId: project.id, label: "Advance", amountInPaise: 2500000 },
    });
    const addOn = await prisma.projectAddOn.create({
      data: { projectId: project.id, description: "Extra page", amountInPaise: 500000 },
    });
    return { project, milestone, addOn };
  }

  // ---------------------------------------------------------------------------
  // Creation — one per obligation kind
  // ---------------------------------------------------------------------------

  it("creates a link for a BillingPeriod", async () => {
    const period = await setupOpenPeriod();
    const result = await createPaymentLinkForObligation({
      kind: "billingPeriod",
      billingPeriodId: period.id,
      createdByAdminId: adminId,
      allowsPartialPayment: false,
    });
    expect("paymentLink" in result).toBe(true);
    if ("paymentLink" in result) {
      expect(result.paymentLink.amountInPaise).toBe(period.amountInPaise);
      expect(result.paymentLink.billingPeriodId).toBe(period.id);
      expect(result.paymentLink.status).toBe("CREATED");
    }
  });

  it("creates a link for a ProjectMilestone", async () => {
    const { milestone } = await setupProjectWithMilestoneAndAddOn();
    const result = await createPaymentLinkForObligation({
      kind: "projectMilestone",
      milestoneId: milestone.id,
      createdByAdminId: adminId,
      allowsPartialPayment: false,
    });
    expect("paymentLink" in result).toBe(true);
    if ("paymentLink" in result) {
      expect(result.paymentLink.amountInPaise).toBe(milestone.amountInPaise);
      expect(result.paymentLink.projectMilestoneId).toBe(milestone.id);
    }
  });

  it("creates a link for a ProjectAddOn", async () => {
    const { addOn } = await setupProjectWithMilestoneAndAddOn();
    const result = await createPaymentLinkForObligation({
      kind: "projectAddOn",
      addOnId: addOn.id,
      createdByAdminId: adminId,
      allowsPartialPayment: false,
    });
    expect("paymentLink" in result).toBe(true);
    if ("paymentLink" in result) {
      expect(result.paymentLink.amountInPaise).toBe(addOn.amountInPaise);
      expect(result.paymentLink.projectAddOnId).toBe(addOn.id);
    }
  });

  it("creates a custom link with no obligation", async () => {
    const result = await createPaymentLinkForObligation({
      kind: "custom",
      clientId,
      amountInPaise: 150000,
      currency: "USD",
      description: "Consulting fee",
      createdByAdminId: adminId,
      allowsPartialPayment: false,
    });
    expect("paymentLink" in result).toBe(true);
    if ("paymentLink" in result) {
      expect(result.paymentLink.currency).toBe("USD");
      expect(result.paymentLink.billingPeriodId).toBeNull();
      expect(result.paymentLink.projectMilestoneId).toBeNull();
      expect(result.paymentLink.projectAddOnId).toBeNull();
    }
  });

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  it("rejects an unsupported currency for a custom link", async () => {
    const result = await createPaymentLinkForObligation({
      kind: "custom",
      clientId,
      amountInPaise: 100000,
      currency: "XYZ",
      description: "Bad currency",
      createdByAdminId: adminId,
      allowsPartialPayment: false,
    });
    expect(result).toEqual({ error: "unsupported_currency" });
    expect(createPaymentLink).not.toHaveBeenCalled();
  });

  it("rejects an invalid (zero) amount for a custom link", async () => {
    const result = await createPaymentLinkForObligation({
      kind: "custom",
      clientId,
      amountInPaise: 0,
      currency: "INR",
      description: "Zero",
      createdByAdminId: adminId,
      allowsPartialPayment: false,
    });
    expect(result).toEqual({ error: "invalid_amount" });
  });

  it("rejects an amount above the maximum ceiling", async () => {
    const result = await createPaymentLinkForObligation({
      kind: "custom",
      clientId,
      amountInPaise: MAX_PAYMENT_LINK_AMOUNT_IN_PAISE + 1,
      currency: "INR",
      description: "Too big",
      createdByAdminId: adminId,
      allowsPartialPayment: false,
    });
    expect(result).toEqual({ error: "invalid_amount" });
  });

  it("rejects creating a link for an already-paid billing period", async () => {
    const period = await setupOpenPeriod();
    await prisma.billingPeriod.update({ where: { id: period.id }, data: { status: "PAID" } });
    const result = await createPaymentLinkForObligation({
      kind: "billingPeriod",
      billingPeriodId: period.id,
      createdByAdminId: adminId,
      allowsPartialPayment: false,
    });
    expect(result).toEqual({ error: "already_paid" });
  });

  it("rejects creating a link for an already-paid (manually) milestone", async () => {
    const { milestone } = await setupProjectWithMilestoneAndAddOn();
    await prisma.projectMilestone.update({ where: { id: milestone.id }, data: { status: "PAID", paidAt: new Date() } });
    const result = await createPaymentLinkForObligation({
      kind: "projectMilestone",
      milestoneId: milestone.id,
      createdByAdminId: adminId,
      allowsPartialPayment: false,
    });
    expect(result).toEqual({ error: "already_paid" });
  });

  it("rejects a duplicate active link for the same obligation", async () => {
    const period = await setupOpenPeriod();
    const first = await createPaymentLinkForObligation({
      kind: "billingPeriod",
      billingPeriodId: period.id,
      createdByAdminId: adminId,
      allowsPartialPayment: false,
    });
    expect("paymentLink" in first).toBe(true);

    const second = await createPaymentLinkForObligation({
      kind: "billingPeriod",
      billingPeriodId: period.id,
      createdByAdminId: adminId,
      allowsPartialPayment: false,
    });
    expect(second).toEqual({ error: "duplicate_active_link" });
  });

  it("allows a fresh link after the first was cancelled", async () => {
    const period = await setupOpenPeriod();
    const first = await createPaymentLinkForObligation({
      kind: "billingPeriod",
      billingPeriodId: period.id,
      createdByAdminId: adminId,
      allowsPartialPayment: false,
    });
    if (!("paymentLink" in first)) throw new Error("setup failed");
    vi.mocked(cancelPaymentLink).mockResolvedValue({} as never);
    await cancelPaymentLinkById(first.paymentLink.id);

    const second = await createPaymentLinkForObligation({
      kind: "billingPeriod",
      billingPeriodId: period.id,
      createdByAdminId: adminId,
      allowsPartialPayment: false,
    });
    expect("paymentLink" in second).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // New Customer (client-less) links
  // ---------------------------------------------------------------------------

  it("creates a client-less link when saveAsClient is false", async () => {
    const result = await createPaymentLinkForObligation({
      kind: "newCustomer",
      organizationId: orgId,
      saveAsClient: false,
      amountInPaise: 100000,
      currency: "INR",
      description: "New customer deposit",
      createdByAdminId: adminId,
      allowsPartialPayment: false,
      customerNameOverride: "Priya Sharma",
      customerEmailOverride: "priya@example.com",
      customerContactOverride: "9123456780",
    });
    expect("paymentLink" in result).toBe(true);
    if ("paymentLink" in result) {
      expect(result.paymentLink.clientId).toBeNull();
      expect(result.paymentLink.organizationId).toBe(orgId);
      expect(result.paymentLink.customerName).toBe("Priya Sharma");
      expect(result.clientId).toBeNull();
    }
    const clients = await prisma.client.findMany({ where: { organizationId: orgId } });
    expect(clients).toHaveLength(1); // only the one from beforeEach — no placeholder created
  });

  it("creates and links a Client atomically when saveAsClient is true", async () => {
    const result = await createPaymentLinkForObligation({
      kind: "newCustomer",
      organizationId: orgId,
      saveAsClient: true,
      amountInPaise: 100000,
      currency: "INR",
      description: "New customer deposit, saved",
      createdByAdminId: adminId,
      allowsPartialPayment: false,
      customerNameOverride: "Arjun Mehta",
      customerEmailOverride: "arjun@example.com",
      customerContactOverride: "9988776655",
    });
    expect("paymentLink" in result).toBe(true);
    if (!("paymentLink" in result)) throw new Error("setup failed");
    expect(result.paymentLink.clientId).not.toBeNull();
    const newClient = await prisma.client.findUniqueOrThrow({ where: { id: result.paymentLink.clientId! } });
    expect(newClient.businessName).toBe("Arjun Mehta");
    expect(newClient.organizationId).toBe(orgId);
  });

  it("never leaves an orphaned Client when Razorpay's API call fails for a new customer", async () => {
    vi.mocked(createPaymentLink).mockRejectedValueOnce(new Error("network error"));
    const result = await createPaymentLinkForObligation({
      kind: "newCustomer",
      organizationId: orgId,
      saveAsClient: true,
      amountInPaise: 100000,
      currency: "INR",
      description: "Should fail before any client is created",
      createdByAdminId: adminId,
      allowsPartialPayment: false,
      customerNameOverride: "Never Created",
    });
    expect(result).toMatchObject({ error: "razorpay_error" });
    const clients = await prisma.client.findMany({ where: { businessName: "Never Created" } });
    expect(clients).toHaveLength(0);
  });

  it("records a real webhook-driven payment correctly on a client-less link", async () => {
    const created = await createPaymentLinkForObligation({
      kind: "newCustomer",
      organizationId: orgId,
      saveAsClient: false,
      amountInPaise: 250000,
      currency: "INR",
      description: "Client-less payment",
      createdByAdminId: adminId,
      allowsPartialPayment: false,
      customerNameOverride: "Priya Sharma",
    });
    if (!("paymentLink" in created)) throw new Error("setup failed");
    const link = created.paymentLink;

    const result = await recordLinkPayment({
      razorpayPaymentLinkId: link.razorpayPaymentLinkId,
      razorpayPaymentId: "pay_no_client",
      razorpayOrderId: null,
      amountInPaise: link.amountInPaise,
      currency: link.currency,
      cumulativeAmountPaidInPaise: link.amountInPaise,
      capturedAt: new Date(),
    });

    expect(result).toMatchObject({ ok: true, fullyPaid: true, clientId: null });
    const payment = await prisma.payment.findFirstOrThrow({ where: { paymentLinkId: link.id } });
    expect(payment.status).toBe("CAPTURED");
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: payment.invoiceId } });
    expect(invoice.clientId).toBeNull();
    expect(invoice.status).toBe("PAID");
    const updatedLink = await prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(updatedLink.status).toBe("PAID");
  });

  // ---------------------------------------------------------------------------
  // recordLinkPayment — the webhook-driven success path
  // ---------------------------------------------------------------------------

  async function createLinkForPeriod(period: { id: number }) {
    const result = await createPaymentLinkForObligation({
      kind: "billingPeriod",
      billingPeriodId: period.id,
      createdByAdminId: adminId,
      allowsPartialPayment: true,
    });
    if (!("paymentLink" in result)) throw new Error("setup failed");
    return result.paymentLink;
  }

  it("records a full payment: obligation, invoice, and link all reach PAID", async () => {
    const period = await setupOpenPeriod();
    const link = await createLinkForPeriod(period);

    const result = await recordLinkPayment({
      razorpayPaymentLinkId: link.razorpayPaymentLinkId,
      razorpayPaymentId: "pay_full1",
      razorpayOrderId: null,
      amountInPaise: link.amountInPaise,
      currency: link.currency,
      cumulativeAmountPaidInPaise: link.amountInPaise,
      capturedAt: new Date(),
    });
    expect(result).toMatchObject({ ok: true, fullyPaid: true });

    const updatedPeriod = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(updatedPeriod.status).toBe("PAID");
    const updatedLink = await prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(updatedLink.status).toBe("PAID");
    const payment = await prisma.payment.findFirstOrThrow({ where: { paymentLinkId: link.id } });
    expect(payment.recordedByAdminId).toBeNull();
    expect(payment.method).toBe("razorpay");
    expect(payment.status).toBe("CAPTURED");
  });

  it("records a partial payment: link and invoice go PARTIALLY_PAID, obligation stays unpaid", async () => {
    const period = await setupOpenPeriod();
    const link = await createLinkForPeriod(period);
    const partialAmount = Math.floor(link.amountInPaise / 2);

    const result = await recordLinkPayment({
      razorpayPaymentLinkId: link.razorpayPaymentLinkId,
      razorpayPaymentId: "pay_partial1",
      razorpayOrderId: null,
      amountInPaise: partialAmount,
      currency: link.currency,
      cumulativeAmountPaidInPaise: partialAmount,
      capturedAt: new Date(),
    });
    expect(result).toMatchObject({ ok: true, fullyPaid: false });

    const updatedPeriod = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(updatedPeriod.status).toBe("PARTIALLY_PAID");
    const updatedLink = await prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(updatedLink.status).toBe("PARTIALLY_PAID");
  });

  it("does not create a duplicate financial obligation on a second partial payment reaching full amount", async () => {
    const period = await setupOpenPeriod();
    const link = await createLinkForPeriod(period);
    const half = Math.floor(link.amountInPaise / 2);

    await recordLinkPayment({
      razorpayPaymentLinkId: link.razorpayPaymentLinkId,
      razorpayPaymentId: "pay_p1",
      razorpayOrderId: null,
      amountInPaise: half,
      currency: link.currency,
      cumulativeAmountPaidInPaise: half,
      capturedAt: new Date(),
    });
    await recordLinkPayment({
      razorpayPaymentLinkId: link.razorpayPaymentLinkId,
      razorpayPaymentId: "pay_p2",
      razorpayOrderId: null,
      amountInPaise: link.amountInPaise - half,
      currency: link.currency,
      cumulativeAmountPaidInPaise: link.amountInPaise,
      capturedAt: new Date(),
    });

    const invoices = await prisma.invoice.findMany({ where: { clientId } });
    expect(invoices).toHaveLength(1);
    const payments = await prisma.payment.findMany({ where: { paymentLinkId: link.id } });
    expect(payments).toHaveLength(2);
    const finalPeriod = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(finalPeriod.status).toBe("PAID");
  });

  it("rejects an amount mismatch and does not mark anything paid", async () => {
    const period = await setupOpenPeriod();
    const link = await createLinkForPeriod(period);

    const result = await recordLinkPayment({
      razorpayPaymentLinkId: link.razorpayPaymentLinkId,
      razorpayPaymentId: "pay_over",
      razorpayOrderId: null,
      amountInPaise: link.amountInPaise + 100,
      currency: link.currency,
      cumulativeAmountPaidInPaise: link.amountInPaise + 100,
      capturedAt: new Date(),
    });
    expect(result).toMatchObject({ error: "amount_mismatch" });

    const untouchedPeriod = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(untouchedPeriod.status).not.toBe("PAID");
    const payments = await prisma.payment.findMany({ where: { paymentLinkId: link.id } });
    expect(payments).toHaveLength(0);
  });

  it("rejects a currency mismatch and does not mark anything paid", async () => {
    const period = await setupOpenPeriod();
    const link = await createLinkForPeriod(period);

    const result = await recordLinkPayment({
      razorpayPaymentLinkId: link.razorpayPaymentLinkId,
      razorpayPaymentId: "pay_wrong_ccy",
      razorpayOrderId: null,
      amountInPaise: link.amountInPaise,
      currency: "USD",
      cumulativeAmountPaidInPaise: link.amountInPaise,
      capturedAt: new Date(),
    });
    expect(result).toEqual({ error: "currency_mismatch", expected: "INR", got: "USD" });
    const payments = await prisma.payment.findMany({ where: { paymentLinkId: link.id } });
    expect(payments).toHaveLength(0);
  });

  it("is a no-op when the link is already fully paid (idempotency belt-and-braces)", async () => {
    const period = await setupOpenPeriod();
    const link = await createLinkForPeriod(period);
    await recordLinkPayment({
      razorpayPaymentLinkId: link.razorpayPaymentLinkId,
      razorpayPaymentId: "pay_first",
      razorpayOrderId: null,
      amountInPaise: link.amountInPaise,
      currency: link.currency,
      cumulativeAmountPaidInPaise: link.amountInPaise,
      capturedAt: new Date(),
    });

    const second = await recordLinkPayment({
      razorpayPaymentLinkId: link.razorpayPaymentLinkId,
      razorpayPaymentId: "pay_second_retry",
      razorpayOrderId: null,
      amountInPaise: link.amountInPaise,
      currency: link.currency,
      cumulativeAmountPaidInPaise: link.amountInPaise,
      capturedAt: new Date(),
    });
    expect(second).toEqual({ error: "already_fully_paid" });
    const payments = await prisma.payment.findMany({ where: { paymentLinkId: link.id } });
    expect(payments).toHaveLength(1);
  });

  it("does not mark a manually-already-paid obligation paid again via a late webhook", async () => {
    const period = await setupOpenPeriod();
    const link = await createLinkForPeriod(period);
    // Admin marks it paid manually before the webhook arrives.
    await prisma.billingPeriod.update({ where: { id: period.id }, data: { status: "PAID" } });

    const result = await recordLinkPayment({
      razorpayPaymentLinkId: link.razorpayPaymentLinkId,
      razorpayPaymentId: "pay_late",
      razorpayOrderId: null,
      amountInPaise: link.amountInPaise,
      currency: link.currency,
      cumulativeAmountPaidInPaise: link.amountInPaise,
      capturedAt: new Date(),
    });
    // The link itself is still CREATED (never paid through Razorpay), so this
    // does proceed and record a Payment — but it must never double-bill the
    // period, which the atomic updateMany({status: {not: "PAID"}}) below guards.
    expect("ok" in result).toBe(true);
    const finalPeriod = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(finalPeriod.status).toBe("PAID");
  });

  // ---------------------------------------------------------------------------
  // Failures / expiry / cancellation
  // ---------------------------------------------------------------------------

  it("records a failed payment attempt when a prior successful payment already created an invoice", async () => {
    const period = await setupOpenPeriod();
    const link = await createLinkForPeriod(period);
    const half = Math.floor(link.amountInPaise / 2);
    await recordLinkPayment({
      razorpayPaymentLinkId: link.razorpayPaymentLinkId,
      razorpayPaymentId: "pay_ok",
      razorpayOrderId: null,
      amountInPaise: half,
      currency: link.currency,
      cumulativeAmountPaidInPaise: half,
      capturedAt: new Date(),
    });

    const result = await recordLinkPaymentFailure({
      razorpayPaymentLinkId: link.razorpayPaymentLinkId,
      razorpayPaymentId: "pay_failed",
      amountInPaise: half,
      currency: link.currency,
      failureReason: "card_declined",
    });
    expect(result).toMatchObject({ ok: true, recorded: true });
    const failedPayment = await prisma.payment.findFirstOrThrow({ where: { razorpayPaymentId: "pay_failed" } });
    expect(failedPayment.status).toBe("FAILED");
    expect(failedPayment.failureReason).toBe("card_declined");

    // The successful partial payment's obligation state must be untouched.
    const untouchedPeriod = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(untouchedPeriod.status).toBe("PARTIALLY_PAID");
  });

  it("does not incorrectly mark an obligation paid on a failed first attempt", async () => {
    const period = await setupOpenPeriod();
    const link = await createLinkForPeriod(period);
    const result = await recordLinkPaymentFailure({
      razorpayPaymentLinkId: link.razorpayPaymentLinkId,
      razorpayPaymentId: "pay_first_failed",
      amountInPaise: link.amountInPaise,
      currency: link.currency,
      failureReason: "insufficient_funds",
    });
    expect(result).toMatchObject({ ok: true, recorded: false });
    const untouchedPeriod = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(untouchedPeriod.status).not.toBe("PAID");
  });

  it("marks a link expired without touching the obligation", async () => {
    const period = await setupOpenPeriod();
    const link = await createLinkForPeriod(period);
    const result = await markLinkExpired(link.razorpayPaymentLinkId);
    expect(result).toMatchObject({ ok: true });
    const updated = await prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(updated.status).toBe("EXPIRED");
    const untouchedPeriod = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(untouchedPeriod.status).not.toBe("PAID");
  });

  it("marks a link cancelled from a webhook without touching the obligation", async () => {
    const period = await setupOpenPeriod();
    const link = await createLinkForPeriod(period);
    const result = await markLinkCancelledFromWebhook(link.razorpayPaymentLinkId);
    expect(result).toMatchObject({ ok: true });
    const updated = await prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(updated.status).toBe("CANCELLED");
  });

  // ---------------------------------------------------------------------------
  // Cancellation
  // ---------------------------------------------------------------------------

  it("cancels an active link via Razorpay and locally", async () => {
    const period = await setupOpenPeriod();
    const link = await createLinkForPeriod(period);
    vi.mocked(cancelPaymentLink).mockResolvedValue({} as never);

    const result = await cancelPaymentLinkById(link.id);
    expect("paymentLink" in result).toBe(true);
    expect(cancelPaymentLink).toHaveBeenCalledWith(link.razorpayPaymentLinkId);
    const updated = await prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(updated.status).toBe("CANCELLED");
  });

  it("refuses to cancel a link that is already fully paid", async () => {
    const period = await setupOpenPeriod();
    const link = await createLinkForPeriod(period);
    await recordLinkPayment({
      razorpayPaymentLinkId: link.razorpayPaymentLinkId,
      razorpayPaymentId: "pay_done",
      razorpayOrderId: null,
      amountInPaise: link.amountInPaise,
      currency: link.currency,
      cumulativeAmountPaidInPaise: link.amountInPaise,
      capturedAt: new Date(),
    });
    const result = await cancelPaymentLinkById(link.id);
    expect(result).toEqual({ error: "not_cancellable" });
  });

  // ---------------------------------------------------------------------------
  // Read models for the Payments-page "Create Payment Link" workflow
  // ---------------------------------------------------------------------------

  it("lists eligible obligations across all three kinds, each with the right amount/currency", async () => {
    const period = await setupOpenPeriod();
    const { milestone, addOn } = await setupProjectWithMilestoneAndAddOn();

    const result = await getEligibleObligationsForClient(clientId);

    expect(result.billingPeriods.map((p) => p.id)).toContain(period.id);
    expect(result.billingPeriods.find((p) => p.id === period.id)?.currency).toBe("INR");
    expect(result.milestones.map((m) => m.id)).toContain(milestone.id);
    expect(result.addOns.map((a) => a.id)).toContain(addOn.id);
  });

  it("excludes obligations that are already fully paid from the eligible list", async () => {
    const period = await setupOpenPeriod();
    await prisma.billingPeriod.update({ where: { id: period.id }, data: { status: "PAID" } });

    const result = await getEligibleObligationsForClient(clientId);

    expect(result.billingPeriods.map((p) => p.id)).not.toContain(period.id);
  });

  it("excludes an obligation with an active link, but includes one whose link was cancelled", async () => {
    const { milestone } = await setupProjectWithMilestoneAndAddOn();
    const created = await createPaymentLinkForObligation({
      kind: "projectMilestone",
      milestoneId: milestone.id,
      createdByAdminId: adminId,
      allowsPartialPayment: false,
    });
    if (!("paymentLink" in created)) throw new Error("setup failed");

    const withActiveLink = await getEligibleObligationsForClient(clientId);
    expect(withActiveLink.milestones.map((m) => m.id)).not.toContain(milestone.id);

    vi.mocked(cancelPaymentLink).mockResolvedValue({} as never);
    await cancelPaymentLinkById(created.paymentLink.id);

    const afterCancel = await getEligibleObligationsForClient(clientId);
    expect(afterCancel.milestones.map((m) => m.id)).toContain(milestone.id);
  });

  it("lists payment links across the org, newest first, scoped away from other orgs", async () => {
    const period = await setupOpenPeriod();
    await createLinkForPeriod(period);
    const otherOrg = await prisma.organization.create({ data: { name: "Other Org" } });
    const otherClient = await prisma.client.create({ data: { organizationId: otherOrg.id, businessName: "Other Client" } });
    await prisma.paymentLink.create({
      data: {
        organizationId: otherOrg.id,
        clientId: otherClient.id,
        razorpayPaymentLinkId: "plink_other_org",
        razorpayShortUrl: "https://rzp.io/l/other",
        description: "Other org link",
        amountInPaise: 10000,
        createdByAdminId: adminId,
      },
    });

    const result = await listPaymentLinksForOrg(orgId);

    expect(result).toHaveLength(1);
    expect(result[0].client?.id).toBe(clientId);
  });
});
