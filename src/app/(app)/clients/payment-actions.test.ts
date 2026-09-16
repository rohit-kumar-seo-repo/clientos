import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { createClientService } from "@/lib/services";

vi.mock("@/lib/require-admin", () => ({
  requireAdmin: vi.fn(),
}));

// `revalidatePath` reads Next's per-request store and throws when called
// outside a request scope, which is exactly where these unit tests run.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { requireAdmin } from "@/lib/require-admin";
import { markPaidAction } from "@/app/(app)/clients/payment-actions";

function mockAdmin(organizationId: number, adminId = 1) {
  vi.mocked(requireAdmin).mockResolvedValue({
    id: adminId,
    email: "admin@example.com",
    organizationId,
  });
}

async function setupOpenPeriod(organizationId: number, clientId: number) {
  const service = await createClientService({
    clientId,
    serviceName: "Local SEO",
    feeInPaise: 500000,
    frequency: "MONTHLY",
    billingDay: 5,
    startDate: new Date(Date.UTC(2026, 7, 3)),
    endDate: null,
  });
  const plan = await prisma.billingPlan.findUniqueOrThrow({
    where: { clientServiceId: service.id },
  });
  return prisma.billingPeriod.findFirstOrThrow({ where: { billingPlanId: plan.id } });
}

describe("markPaidAction", () => {
  let orgId: number;
  let clientId: number;
  let adminId: number;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors" },
    });
    clientId = client.id;
    const admin = await prisma.adminUser.create({
      data: { organizationId: orgId, email: "rohit@example.com", passwordHash: "x" },
    });
    adminId = admin.id;
    mockAdmin(orgId, adminId);
  });

  it("marks the period paid and returns ok", async () => {
    const period = await setupOpenPeriod(orgId, clientId);
    const form = new FormData();
    form.set("amountInRupees", "5000");
    form.set("paidAt", "2026-08-04");

    const result = await markPaidAction(period.id, form);

    expect(result).toEqual({ ok: true });
    const updated = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(updated.status).toBe("PAID");
  });

  it("writes a payment.recorded activity row against the client", async () => {
    const period = await setupOpenPeriod(orgId, clientId);
    const form = new FormData();
    form.set("amountInRupees", "5000");
    form.set("paidAt", "2026-08-04");

    await markPaidAction(period.id, form);

    const activity = await prisma.clientActivity.findFirstOrThrow({
      where: { clientId, eventType: "payment.recorded" },
    });
    expect(activity.summary).toContain("5,000");
    expect(activity.actorAdminId).toBe(adminId);
  });

  it("rejects a non-positive amount", async () => {
    const period = await setupOpenPeriod(orgId, clientId);
    const form = new FormData();
    form.set("amountInRupees", "0");
    form.set("paidAt", "2026-08-04");

    const result = await markPaidAction(period.id, form);

    expect(result).toEqual({ error: "Amount must be between ₹0.01 and ₹1,00,00,000." });
  });

  it("rejects an invalid date", async () => {
    const period = await setupOpenPeriod(orgId, clientId);
    const form = new FormData();
    form.set("amountInRupees", "5000");
    form.set("paidAt", "not-a-date");

    const result = await markPaidAction(period.id, form);

    expect(result).toEqual({ error: "A valid payment date is required." });
  });

  it("returns a friendly error for an already-paid period", async () => {
    const period = await setupOpenPeriod(orgId, clientId);
    const form = new FormData();
    form.set("amountInRupees", "5000");
    form.set("paidAt", "2026-08-04");
    await markPaidAction(period.id, form);

    const secondForm = new FormData();
    secondForm.set("amountInRupees", "5000");
    secondForm.set("paidAt", "2026-08-05");
    const result = await markPaidAction(period.id, secondForm);

    expect(result).toEqual({ error: "This payment has already been recorded." });
  });

  it("returns an error for a billing period in a different organization", async () => {
    const period = await setupOpenPeriod(orgId, clientId);
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    mockAdmin(otherOrg.id);
    const form = new FormData();
    form.set("amountInRupees", "5000");
    form.set("paidAt", "2026-08-04");

    const result = await markPaidAction(period.id, form);

    expect(result).toEqual({ error: "Payment period not found." });
    const untouched = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(untouched.status).toBe("UPCOMING");
  });
});
