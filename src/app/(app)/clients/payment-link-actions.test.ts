import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { createClientService } from "@/lib/services";

vi.mock("@/lib/require-admin", () => ({
  requireAdmin: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/razorpay", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/razorpay")>();
  return {
    ...actual,
    createPaymentLink: vi.fn().mockResolvedValue({ id: "plink_test123", short_url: "https://rzp.io/l/test123" }),
    cancelPaymentLink: vi.fn().mockResolvedValue({}),
  };
});

import { requireAdmin } from "@/lib/require-admin";
import { createPaymentLink } from "@/lib/razorpay";
import {
  createPaymentLinkForBillingPeriodAction,
  createCustomPaymentLinkAction,
  cancelPaymentLinkAction,
  getClientsForPaymentLinkAction,
  getClientObligationsForPaymentLinkAction,
} from "@/app/(app)/clients/payment-link-actions";

function mockAdmin(organizationId: number, adminId = 1) {
  vi.mocked(requireAdmin).mockResolvedValue({ id: adminId, email: "admin@example.com", organizationId });
}

describe("payment-link-actions", () => {
  let orgId: number;
  let clientId: number;
  let adminId: number;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    const client = await prisma.client.create({ data: { organizationId: orgId, businessName: "ABC Interiors" } });
    clientId = client.id;
    const admin = await prisma.adminUser.create({
      data: { organizationId: orgId, email: "rohit@example.com", passwordHash: "x" },
    });
    adminId = admin.id;
    mockAdmin(orgId, adminId);
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

  it("creates a payment link for a billing period and writes ClientActivity", async () => {
    const period = await setupOpenPeriod();
    const form = new FormData();

    const result = await createPaymentLinkForBillingPeriodAction(period.id, form);

    expect(result).toMatchObject({
      ok: true,
      paymentLink: { razorpayPaymentLinkId: "plink_test123", razorpayShortUrl: "https://rzp.io/l/test123", status: "CREATED" },
    });
    const activity = await prisma.clientActivity.findFirstOrThrow({
      where: { clientId, eventType: "payment_link.created" },
    });
    expect(activity.actorAdminId).toBe(adminId);
  });

  it("creates a custom payment link with a valid amount and currency", async () => {
    const form = new FormData();
    form.set("amountInRupees", "1500");
    form.set("currency", "USD");
    form.set("description", "Consulting");

    const result = await createCustomPaymentLinkAction(clientId, form);

    expect(result).toMatchObject({ ok: true, paymentLink: { currency: "USD", amountInPaise: 150000 } });
    const link = await prisma.paymentLink.findFirstOrThrow({ where: { clientId } });
    expect(link.currency).toBe("USD");
    expect(link.amountInPaise).toBe(150000);
  });

  it("rejects a custom link with an invalid amount", async () => {
    const form = new FormData();
    form.set("amountInRupees", "-5");
    form.set("currency", "INR");
    form.set("description", "Bad");

    const result = await createCustomPaymentLinkAction(clientId, form);
    expect(result).toEqual({ error: "Amount must be between ₹0.01 and ₹1,00,00,000." });
  });

  it("rejects a custom link with an unsupported currency", async () => {
    const form = new FormData();
    form.set("amountInRupees", "100");
    form.set("currency", "ZZZ");
    form.set("description", "Bad currency");

    const result = await createCustomPaymentLinkAction(clientId, form);
    expect(result).toEqual({ error: "That currency isn't supported." });
  });

  it("cancels an active payment link", async () => {
    const form = new FormData();
    form.set("amountInRupees", "500");
    form.set("currency", "INR");
    form.set("description", "Deposit");
    await createCustomPaymentLinkAction(clientId, form);
    const link = await prisma.paymentLink.findFirstOrThrow({ where: { clientId } });

    const result = await cancelPaymentLinkAction(link.id);

    expect(result).toEqual({ ok: true });
    const updated = await prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(updated.status).toBe("CANCELLED");
  });

  it("enforces organization isolation on create — a billing period in another org is not found", async () => {
    const period = await setupOpenPeriod();
    const otherOrg = await prisma.organization.create({ data: { name: "Other Org" } });
    mockAdmin(otherOrg.id);

    const result = await createPaymentLinkForBillingPeriodAction(period.id, new FormData());

    expect(result).toEqual({ error: "Payment period not found." });
    const links = await prisma.paymentLink.findMany({ where: { billingPeriodId: period.id } });
    expect(links).toHaveLength(0);
  });

  it("enforces organization isolation on cancel — a link in another org is not found", async () => {
    const form = new FormData();
    form.set("amountInRupees", "500");
    form.set("currency", "INR");
    form.set("description", "Deposit");
    await createCustomPaymentLinkAction(clientId, form);
    const link = await prisma.paymentLink.findFirstOrThrow({ where: { clientId } });

    const otherOrg = await prisma.organization.create({ data: { name: "Other Org" } });
    mockAdmin(otherOrg.id);

    const result = await cancelPaymentLinkAction(link.id);

    expect(result).toEqual({ error: "Payment link not found." });
    const untouched = await prisma.paymentLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(untouched.status).toBe("CREATED");
  });

  it("propagates an unauthorized (no session) failure rather than silently proceeding", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Unauthorized"));
    const form = new FormData();
    form.set("amountInRupees", "500");
    form.set("currency", "INR");
    form.set("description", "Deposit");

    await expect(createCustomPaymentLinkAction(clientId, form)).rejects.toThrow("Unauthorized");
    const links = await prisma.paymentLink.findMany({ where: { clientId } });
    expect(links).toHaveLength(0);
  });

  it("never creates a Payment record at link-creation time", async () => {
    const form = new FormData();
    form.set("amountInRupees", "500");
    form.set("currency", "INR");
    form.set("description", "Deposit");

    const result = await createCustomPaymentLinkAction(clientId, form);
    if (!("paymentLink" in result)) throw new Error("setup failed");

    const payments = await prisma.payment.findMany({ where: { paymentLinkId: result.paymentLink.id } });
    expect(payments).toHaveLength(0);
  });

  it("rejects a duplicate active link for the same billing period, with a friendly message", async () => {
    const period = await setupOpenPeriod();
    await createPaymentLinkForBillingPeriodAction(period.id, new FormData());

    const second = await createPaymentLinkForBillingPeriodAction(period.id, new FormData());

    expect(second).toEqual({ error: "An active payment link already exists for this. Cancel it first to issue a new one." });
  });

  it("sets isUpiOnly and requests a UPI-only link from Razorpay when paymentType=upi", async () => {
    const form = new FormData();
    form.set("amountInRupees", "500");
    form.set("currency", "INR");
    form.set("description", "UPI test");
    form.set("paymentType", "upi");

    const result = await createCustomPaymentLinkAction(clientId, form);

    expect(result).toMatchObject({ ok: true, paymentLink: { isUpiOnly: true } });
    expect(createPaymentLink).toHaveBeenCalledWith(expect.objectContaining({ upiOnly: true }));
  });

  it("defaults to a standard (non-UPI) link when paymentType is omitted", async () => {
    const form = new FormData();
    form.set("amountInRupees", "500");
    form.set("currency", "INR");
    form.set("description", "Standard test");

    const result = await createCustomPaymentLinkAction(clientId, form);

    expect(result).toMatchObject({ ok: true, paymentLink: { isUpiOnly: false } });
    expect(createPaymentLink).toHaveBeenCalledWith(expect.objectContaining({ upiOnly: false }));
  });

  it("sends customer name/email/contact overrides to Razorpay without touching the Client record", async () => {
    await prisma.client.update({
      where: { id: clientId },
      data: { contactPerson: "Original Contact", email: "original@example.com", phone: "9000000000" },
    });
    const form = new FormData();
    form.set("amountInRupees", "500");
    form.set("currency", "INR");
    form.set("description", "Override test");
    form.set("customerName", "Override Name");
    form.set("customerEmail", "override@example.com");
    form.set("customerContact", "9111111111");

    await createCustomPaymentLinkAction(clientId, form);

    expect(createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: "Override Name",
        customerEmail: "override@example.com",
        customerContact: "9111111111",
      })
    );
    const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
    expect(client.contactPerson).toBe("Original Contact");
    expect(client.email).toBe("original@example.com");
    expect(client.phone).toBe("9000000000");
  });

  it("rejects a minimum partial amount when partial payment is not enabled", async () => {
    const form = new FormData();
    form.set("amountInRupees", "500");
    form.set("currency", "INR");
    form.set("description", "Bad partial config");
    form.set("minPartialAmountInRupees", "100");

    const result = await createCustomPaymentLinkAction(clientId, form);
    expect(result).toEqual({ error: "A minimum partial amount requires partial payment to be enabled." });
  });

  it("rejects an expiry date in the past", async () => {
    const form = new FormData();
    form.set("amountInRupees", "500");
    form.set("currency", "INR");
    form.set("description", "Bad expiry");
    form.set("expiresAt", "2020-01-01");

    const result = await createCustomPaymentLinkAction(clientId, form);
    expect(result).toEqual({ error: "Expiry must be in the future." });
  });

  it("lists only the caller's own org clients for the create-link picker", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other Org" } });
    await prisma.client.create({ data: { organizationId: otherOrg.id, businessName: "Not Mine" } });

    const result = await getClientsForPaymentLinkAction();

    expect(result.clients.map((c) => c.businessName)).toEqual(["ABC Interiors"]);
  });

  it("returns eligible obligations for an owned client", async () => {
    const period = await setupOpenPeriod();

    const result = await getClientObligationsForPaymentLinkAction(clientId);

    if ("error" in result) throw new Error("expected obligations");
    expect(result.billingPeriods.map((p) => p.id)).toContain(period.id);
  });

  it("excludes an obligation that already has an active payment link from the eligible list", async () => {
    const period = await setupOpenPeriod();
    await createPaymentLinkForBillingPeriodAction(period.id, new FormData());

    const result = await getClientObligationsForPaymentLinkAction(clientId);

    if ("error" in result) throw new Error("expected obligations");
    expect(result.billingPeriods.map((p) => p.id)).not.toContain(period.id);
  });

  it("rejects fetching obligations for a client in another org", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other Org" } });
    mockAdmin(otherOrg.id);

    const result = await getClientObligationsForPaymentLinkAction(clientId);

    expect(result).toEqual({ error: "Client not found." });
  });
});
