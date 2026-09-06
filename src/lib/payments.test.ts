import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { createClientService } from "@/lib/services";
import { markBillingPeriodPaid } from "@/lib/payments";

async function setupServiceWithOpenPeriod(overrides?: {
  frequency?: "MONTHLY" | "QUARTERLY" | "ONE_TIME";
  billingDay?: number;
  feeInPaise?: number;
}) {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  const client = await prisma.client.create({
    data: { organizationId: org.id, businessName: "ABC Interiors" },
  });
  const admin = await prisma.adminUser.create({
    data: { organizationId: org.id, email: "rohit@example.com", passwordHash: "x" },
  });
  const service = await createClientService({
    clientId: client.id,
    serviceName: "Local SEO",
    feeInPaise: overrides?.feeInPaise ?? 500000,
    frequency: overrides?.frequency ?? "MONTHLY",
    billingDay: overrides?.billingDay ?? 5,
    startDate: new Date(Date.UTC(2026, 7, 3)), // Aug 3 -> first period Aug
    endDate: null,
  });
  const plan = await prisma.billingPlan.findUniqueOrThrow({
    where: { clientServiceId: service.id },
  });
  const period = await prisma.billingPeriod.findFirstOrThrow({
    where: { billingPlanId: plan.id },
  });
  return { org, client, admin, service, plan, period };
}

describe("markBillingPeriodPaid", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates an invoice and a captured payment", async () => {
    const { admin, period } = await setupServiceWithOpenPeriod();

    const result = await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(Date.UTC(2026, 7, 4)),
      recordedByAdminId: admin.id,
    });

    expect("error" in result).toBe(false);
    const invoice = (result as { invoice: { id: number } }).invoice;
    const payment = await prisma.payment.findFirstOrThrow({
      where: { invoiceId: invoice.id },
    });
    expect(payment.status).toBe("CAPTURED");
    expect(payment.method).toBe("manual");
    expect(payment.amountInPaise).toBe(500000);
    expect(payment.recordedByAdminId).toBe(admin.id);
  });

  it("marks the invoice and the billing period PAID", async () => {
    const { admin, period } = await setupServiceWithOpenPeriod();

    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });

    const updatedPeriod = await prisma.billingPeriod.findUniqueOrThrow({
      where: { id: period.id },
    });
    expect(updatedPeriod.status).toBe("PAID");

    const lineItem = await prisma.invoiceLineItem.findUniqueOrThrow({
      where: { billingPeriodId: period.id },
      include: { invoice: true },
    });
    expect(lineItem.invoice.status).toBe("PAID");
  });

  it("generates the next billing period with the correct label, due date, and amount", async () => {
    const { plan, period } = await setupServiceWithOpenPeriod();
    const admin = await prisma.adminUser.findFirstOrThrow();

    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });

    const periods = await prisma.billingPeriod.findMany({
      where: { billingPlanId: plan.id },
      orderBy: { periodLabel: "asc" },
    });
    expect(periods).toHaveLength(2);
    expect(periods[0].periodLabel).toBe("2026-08");
    expect(periods[1].periodLabel).toBe("2026-09");
    expect(periods[1].status).toBe("UPCOMING");
    expect(periods[1].dueDate.getUTCDate()).toBe(5);
    expect(periods[1].dueDate.getUTCMonth()).toBe(8); // September
    expect(periods[1].amountInPaise).toBe(500000);
  });

  it("does not generate a next period for a ONE_TIME service", async () => {
    const { plan, period } = await setupServiceWithOpenPeriod({ frequency: "ONE_TIME" });
    const admin = await prisma.adminUser.findFirstOrThrow();

    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });

    const count = await prisma.billingPeriod.count({ where: { billingPlanId: plan.id } });
    expect(count).toBe(1);
  });

  it("uses the CURRENT plan amount for the next period, not the just-paid period's amount", async () => {
    const { plan, period } = await setupServiceWithOpenPeriod();
    const admin = await prisma.adminUser.findFirstOrThrow();

    // Simulate a fee change made between period creation and payment —
    // Plan 1's updateServiceAction would do this in real usage.
    await prisma.billingPlan.update({
      where: { id: plan.id },
      data: { amountInPaise: 600000 },
    });

    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000, // the OLD amount was what was actually paid
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });

    const paidPeriod = await prisma.billingPeriod.findUniqueOrThrow({
      where: { id: period.id },
    });
    expect(paidPeriod.amountInPaise).toBe(500000); // untouched, historical

    const nextPeriod = await prisma.billingPeriod.findFirstOrThrow({
      where: { billingPlanId: plan.id, periodLabel: "2026-09" },
    });
    expect(nextPeriod.amountInPaise).toBe(600000); // reflects the new fee
  });

  it("is idempotent: marking an already-PAID period paid again returns an error and creates nothing new", async () => {
    const { period } = await setupServiceWithOpenPeriod();
    const admin = await prisma.adminUser.findFirstOrThrow();

    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });
    const paymentCountAfterFirst = await prisma.payment.count();
    const periodCountAfterFirst = await prisma.billingPeriod.count();

    const secondResult = await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });

    expect(secondResult).toEqual({ error: "already_paid" });
    expect(await prisma.payment.count()).toBe(paymentCountAfterFirst);
    expect(await prisma.billingPeriod.count()).toBe(periodCountAfterFirst);
  });

  it("records the admin-entered amount even when it differs from the period's own amount", async () => {
    const { period } = await setupServiceWithOpenPeriod();
    const admin = await prisma.adminUser.findFirstOrThrow();

    const result = await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 450000, // admin recorded a different amount than expected
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });

    const invoice = (result as { invoice: { id: number } }).invoice;
    const payment = await prisma.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    expect(payment.amountInPaise).toBe(450000);
    // V1 does not reconcile partial/over payments — whatever was recorded
    // is trusted, and the period is still marked fully PAID.
    const updatedPeriod = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(updatedPeriod.status).toBe("PAID");
  });

  it("does not generate a next period when the service is PAUSED", async () => {
    const { plan, period, service } = await setupServiceWithOpenPeriod();
    const admin = await prisma.adminUser.findFirstOrThrow();
    await prisma.clientService.update({ where: { id: service.id }, data: { status: "PAUSED" } });

    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });

    const count = await prisma.billingPeriod.count({ where: { billingPlanId: plan.id } });
    expect(count).toBe(1); // only the one period being paid — no next one
    const paidPeriod = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(paidPeriod.status).toBe("PAID"); // the payment itself still goes through
  });

  it("does not generate a next period when the service is CANCELLED", async () => {
    const { plan, period, service } = await setupServiceWithOpenPeriod();
    const admin = await prisma.adminUser.findFirstOrThrow();
    await prisma.clientService.update({ where: { id: service.id }, data: { status: "CANCELLED" } });

    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });

    const count = await prisma.billingPeriod.count({ where: { billingPlanId: plan.id } });
    expect(count).toBe(1);
  });

  it("resumes generating future periods once a paused service is reactivated", async () => {
    const { plan, period, service } = await setupServiceWithOpenPeriod();
    const admin = await prisma.adminUser.findFirstOrThrow();
    await prisma.clientService.update({ where: { id: service.id }, data: { status: "PAUSED" } });
    await prisma.clientService.update({ where: { id: service.id }, data: { status: "ACTIVE" } }); // reactivated before payment

    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(),
      recordedByAdminId: admin.id,
    });

    const count = await prisma.billingPeriod.count({ where: { billingPlanId: plan.id } });
    expect(count).toBe(2); // normal generation resumes once ACTIVE again
  });
});
