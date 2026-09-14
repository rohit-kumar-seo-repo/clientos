// src/lib/dashboard.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { createClientService } from "@/lib/services";
import { markBillingPeriodPaid } from "@/lib/payments";
import { getAttentionData, getMonthlySummary, getProjectObligations } from "@/lib/dashboard";

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

    expect(summary.recurring.expectedInPaise).toBe(500000);
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

    expect(summary.recurring.collectedInPaise).toBe(500000);
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

    expect(summary.recurring.overdueInPaise).toBeGreaterThanOrEqual(500000);
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

    expect(summary.recurring.pendingInPaise).toBe(700000);
    expect(summary.recurring.overdueInPaise).toBe(0);
    expect(summary.recurring.collectedInPaise).toBe(0);
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

    expect(summary.recurring.expectedInPaise).toBe(0);
  });

  it("includes this month's project milestone in expectedInPaise", async () => {
    const project = await prisma.project.create({
      data: { clientId, title: "Website Redesign", status: "IN_PROGRESS", baseAmountInPaise: 1000000 },
    });
    await prisma.projectMilestone.create({
      data: {
        projectId: project.id,
        label: "Design",
        amountInPaise: 300000,
        dueDate: new Date(Date.UTC(2026, 8, 15)), // Sep 15 — this month, not yet overdue
        status: "PENDING",
      },
    });

    const summary = await getMonthlySummary(orgId, TODAY);

    expect(summary.projects.expectedInPaise).toBe(300000);
    expect(summary.projects.pendingInPaise).toBe(300000);
  });

  it("includes paid project milestone in collectedInPaise", async () => {
    const project = await prisma.project.create({
      data: { clientId, title: "Website Redesign", status: "IN_PROGRESS", baseAmountInPaise: 1000000 },
    });
    await prisma.projectMilestone.create({
      data: {
        projectId: project.id,
        label: "Design",
        amountInPaise: 300000,
        dueDate: new Date(Date.UTC(2026, 8, 5)), // Sep 5 — this month, PAID
        status: "PAID",
      },
    });

    const summary = await getMonthlySummary(orgId, TODAY);

    expect(summary.projects.collectedInPaise).toBe(300000);
  });

  it("includes overdue project milestone in overdueInPaise", async () => {
    const project = await prisma.project.create({
      data: { clientId, title: "Website Redesign", status: "IN_PROGRESS", baseAmountInPaise: 1000000 },
    });
    await prisma.projectMilestone.create({
      data: {
        projectId: project.id,
        label: "Design",
        amountInPaise: 150000,
        dueDate: new Date(Date.UTC(2026, 7, 15)), // Aug 15 — prior month, PENDING → overdue
        status: "PENDING",
      },
    });

    const summary = await getMonthlySummary(orgId, TODAY);

    expect(summary.projects.overdueInPaise).toBe(150000);
  });

  it("excludes CANCELLED project from getMonthlySummary", async () => {
    const project = await prisma.project.create({
      data: { clientId, title: "Cancelled Project", status: "CANCELLED", baseAmountInPaise: 999999 },
    });
    await prisma.projectMilestone.create({
      data: {
        projectId: project.id,
        label: "Design",
        amountInPaise: 999999,
        dueDate: new Date(Date.UTC(2026, 8, 15)), // Sep 15 — this month
        status: "PENDING",
      },
    });

    const summary = await getMonthlySummary(orgId, TODAY);

    expect(summary.projects.expectedInPaise).toBe(0);
  });
});

describe("getProjectObligations", () => {
  let orgId: number;
  let clientId: number;
  let projectId: number;

  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors" },
    });
    clientId = client.id;
    const project = await prisma.project.create({
      data: { clientId, title: "Website Redesign", status: "IN_PROGRESS", baseAmountInPaise: 1_000_000 },
    });
    projectId = project.id;
  });

  it("returns overdue milestone with correct tier and daysOverdue", async () => {
    await prisma.projectMilestone.create({
      data: {
        projectId,
        label: "Design mockups",
        amountInPaise: 200000,
        dueDate: new Date(Date.UTC(2026, 8, 5)), // Sep 5 — 5 days before TODAY
        status: "PENDING",
      },
    });

    const items = await getProjectObligations(orgId, TODAY);

    expect(items).toHaveLength(1);
    expect(items[0].tier).toBe("overdue_payment");
    expect(items[0].daysOverdue).toBe(5);
    expect(items[0].kind).toBe("milestone");
    expect(items[0].amountInPaise).toBe(200000);
  });

  it("excludes milestone due more than 7 days away", async () => {
    await prisma.projectMilestone.create({
      data: {
        projectId,
        label: "Launch",
        amountInPaise: 300000,
        dueDate: new Date(Date.UTC(2026, 8, 20)), // Sep 20 — 10 days away
        status: "PENDING",
      },
    });

    const items = await getProjectObligations(orgId, TODAY);

    expect(items).toHaveLength(0);
  });

  it("excludes obligations from CANCELLED projects", async () => {
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "CANCELLED" },
    });
    await prisma.projectMilestone.create({
      data: {
        projectId,
        label: "Design mockups",
        amountInPaise: 200000,
        dueDate: new Date(Date.UTC(2026, 8, 10)), // today
        status: "PENDING",
      },
    });

    const items = await getProjectObligations(orgId, TODAY);

    expect(items).toHaveLength(0);
  });

  it("returns add-on due within 3 days with correct tier", async () => {
    await prisma.projectAddOn.create({
      data: {
        projectId,
        description: "Extra revisions",
        amountInPaise: 50000,
        dueDate: new Date(Date.UTC(2026, 8, 12)), // Sep 12 — 2 days away
        status: "PENDING",
      },
    });

    const items = await getProjectObligations(orgId, TODAY);

    expect(items).toHaveLength(1);
    expect(items[0].tier).toBe("due_within_3_days");
    expect(items[0].kind).toBe("addon");
    expect(items[0].daysOverdue).toBe(0);
  });

  it("never returns another organization's project obligations", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    const otherClient = await prisma.client.create({
      data: { organizationId: otherOrg.id, businessName: "Other Client" },
    });
    const otherProject = await prisma.project.create({
      data: { clientId: otherClient.id, title: "Other Project", status: "IN_PROGRESS", baseAmountInPaise: 100 },
    });
    await prisma.projectMilestone.create({
      data: {
        projectId: otherProject.id,
        label: "Design mockups",
        amountInPaise: 999999,
        dueDate: new Date(Date.UTC(2026, 8, 10)), // today
        status: "PENDING",
      },
    });

    const items = await getProjectObligations(orgId, TODAY);

    expect(items).toHaveLength(0);
  });
});
