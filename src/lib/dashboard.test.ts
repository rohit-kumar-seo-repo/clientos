// src/lib/dashboard.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { createClientService } from "@/lib/services";
import { markBillingPeriodPaid } from "@/lib/payments";
import { getAttentionData, getMonthlySummary } from "@/lib/dashboard";

const TODAY = new Date(Date.UTC(2026, 8, 10)); // Sep 10, 2026

describe("getAttentionData", () => {
  let orgId: number;

  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
  });

  it("returns one ranked row per active client service, correctly ranked", async () => {
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors" },
    });
    // Overdue: started long enough ago that its Sep 1 period is now overdue.
    await createClientService({
      clientId: client.id,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 1,
      startDate: new Date(Date.UTC(2026, 7, 1)),
      endDate: null,
    });

    const ranked = await getAttentionData(orgId, TODAY);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].tier).toBe("overdue_payment");
    expect(ranked[0].clientName).toBe("ABC Interiors");
    expect(ranked[0].serviceName).toBe("Local SEO");
  });

  it("excludes CANCELLED services", async () => {
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors" },
    });
    const service = await createClientService({
      clientId: client.id,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 1,
      startDate: new Date(Date.UTC(2026, 7, 1)),
      endDate: null,
    });
    await prisma.clientService.update({
      where: { id: service.id },
      data: { status: "CANCELLED" },
    });

    const ranked = await getAttentionData(orgId, TODAY);

    expect(ranked).toHaveLength(0);
  });

  it("never returns another organization's services", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    const otherClient = await prisma.client.create({
      data: { organizationId: otherOrg.id, businessName: "Should Not Appear" },
    });
    await createClientService({
      clientId: otherClient.id,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 1,
      startDate: new Date(Date.UTC(2026, 7, 1)),
      endDate: null,
    });

    const ranked = await getAttentionData(orgId, TODAY);

    expect(ranked).toHaveLength(0);
  });

  it("reflects a PAID period correctly (no longer an urgent payment tier)", async () => {
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors" },
    });
    const service = await createClientService({
      clientId: client.id,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 10, // matches TODAY's day-of-month so this period is paid
                      // right on time — see the note below on why that matters
      startDate: new Date(Date.UTC(2026, 8, 1)), // Sep 1 -> first period "2026-09", due Sep 10
      endDate: null,
    });
    const plan = await prisma.billingPlan.findUniqueOrThrow({ where: { clientServiceId: service.id } });
    const period = await prisma.billingPeriod.findFirstOrThrow({ where: { billingPlanId: plan.id } });
    const admin = await prisma.adminUser.create({
      data: { organizationId: orgId, email: "a@example.com", passwordHash: "x" },
    });
    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: TODAY, // paid exactly on its Sep 10 due date
      recordedByAdminId: admin.id,
    });

    const ranked = await getAttentionData(orgId, TODAY);

    // The just-generated next period is "2026-10", due Oct 10 — 30 days
    // from TODAY (Sep 10), comfortably more than 7 days out. (Using
    // billingDay 1 here instead would generate a next period due Sep 1,
    // which is BEFORE TODAY — i.e. already overdue at the moment it's
    // created, the opposite of what this test needs to check. The billing
    // day has to land on/after TODAY relative to the paid period for the
    // next cycle to land safely in the future.) ->
    // normal_upcoming_work, not one of the urgent payment tiers.
    expect(ranked[0].tier).toBe("normal_upcoming_work");
  });
});

describe("getMonthlySummary", () => {
  let orgId: number;
  let clientId: number;

  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors" },
    });
    clientId = client.id;
  });

  it("computes expected as the sum of this month's periods regardless of status", async () => {
    await createClientService({
      clientId,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 5,
      startDate: new Date(Date.UTC(2026, 8, 1)), // creates the Sep period directly
      endDate: null,
    });

    const summary = await getMonthlySummary(orgId, TODAY);

    expect(summary.expectedInPaise).toBe(500000);
  });

  it("computes collected as payments captured against this month's periods", async () => {
    const service = await createClientService({
      clientId,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 5,
      startDate: new Date(Date.UTC(2026, 8, 1)),
      endDate: null,
    });
    const plan = await prisma.billingPlan.findUniqueOrThrow({ where: { clientServiceId: service.id } });
    const period = await prisma.billingPeriod.findFirstOrThrow({ where: { billingPlanId: plan.id } });
    const admin = await prisma.adminUser.create({
      data: { organizationId: orgId, email: "a@example.com", passwordHash: "x" },
    });
    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: TODAY,
      recordedByAdminId: admin.id,
    });

    const summary = await getMonthlySummary(orgId, TODAY);

    expect(summary.collectedInPaise).toBe(500000);
  });

  it("counts overdue money regardless of which month the period belongs to", async () => {
    // A service whose period is from a prior month and still unpaid.
    await createClientService({
      clientId,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 1,
      startDate: new Date(Date.UTC(2026, 6, 1)), // July -> period is well overdue by Sep 10
      endDate: null,
    });

    const summary = await getMonthlySummary(orgId, TODAY);

    expect(summary.overdueInPaise).toBeGreaterThanOrEqual(500000);
  });

  it("pending excludes both collected and overdue amounts", async () => {
    await createClientService({
      clientId,
      serviceName: "Website SEO",
      feeInPaise: 700000,
      frequency: "MONTHLY",
      billingDay: 25, // due later this month, not yet overdue, unpaid
      startDate: new Date(Date.UTC(2026, 8, 1)),
      endDate: null,
    });

    const summary = await getMonthlySummary(orgId, TODAY);

    expect(summary.pendingInPaise).toBe(700000);
    expect(summary.overdueInPaise).toBe(0);
    expect(summary.collectedInPaise).toBe(0);
  });

  it("never includes another organization's numbers", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    const otherClient = await prisma.client.create({
      data: { organizationId: otherOrg.id, businessName: "Other Client" },
    });
    await createClientService({
      clientId: otherClient.id,
      serviceName: "Local SEO",
      feeInPaise: 999999,
      frequency: "MONTHLY",
      billingDay: 5,
      startDate: new Date(Date.UTC(2026, 8, 1)),
      endDate: null,
    });

    const summary = await getMonthlySummary(orgId, TODAY);

    expect(summary.expectedInPaise).toBe(0);
  });
});
