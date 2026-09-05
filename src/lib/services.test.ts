// src/lib/services.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import {
  findOrCreateServiceTemplate,
  createClientService,
  getServicesForClient,
} from "@/lib/services";

describe("findOrCreateServiceTemplate", () => {
  let orgId: number;

  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
  });

  it("creates a new template when none exists", async () => {
    const template = await findOrCreateServiceTemplate(orgId, "Local SEO");
    expect(template.name).toBe("Local SEO");
    expect(template.organizationId).toBe(orgId);
  });

  it("reuses an existing template with an exact name match", async () => {
    const first = await findOrCreateServiceTemplate(orgId, "Local SEO");
    const second = await findOrCreateServiceTemplate(orgId, "Local SEO");
    expect(second.id).toBe(first.id);
    const count = await prisma.serviceTemplate.count();
    expect(count).toBe(1);
  });

  it("reuses an existing template case-insensitively", async () => {
    const first = await findOrCreateServiceTemplate(orgId, "Local SEO");
    const second = await findOrCreateServiceTemplate(orgId, "local seo");
    expect(second.id).toBe(first.id);
  });

  it("does not reuse a template from a different organization", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    await findOrCreateServiceTemplate(otherOrg.id, "Local SEO");

    const template = await findOrCreateServiceTemplate(orgId, "Local SEO");

    const count = await prisma.serviceTemplate.count();
    expect(count).toBe(2);
    expect(template.organizationId).toBe(orgId);
  });
});

describe("createClientService", () => {
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

  it("creates the service, its billing plan, and its first billing period", async () => {
    const service = await createClientService({
      clientId,
      serviceName: "Local SEO",
      feeInPaise: 500000, // ₹5,000
      frequency: "MONTHLY",
      billingDay: 5,
      startDate: new Date(Date.UTC(2026, 7, 3)), // Aug 3 2026 — billing day not yet passed
      endDate: null,
    });

    expect(service.feeInPaise).toBe(500000);
    expect(service.workStatus).toBe("NOT_STARTED");

    const plan = await prisma.billingPlan.findUniqueOrThrow({
      where: { clientServiceId: service.id },
    });
    expect(plan.amountInPaise).toBe(500000);
    expect(plan.frequency).toBe("MONTHLY");
    expect(plan.billingDay).toBe(5);

    const period = await prisma.billingPeriod.findFirstOrThrow({
      where: { billingPlanId: plan.id },
    });
    expect(period.periodLabel).toBe("2026-08");
    expect(period.amountInPaise).toBe(500000);
    expect(period.status).toBe("UPCOMING");
    expect(period.dueDate.getUTCDate()).toBe(5);
    expect(period.dueDate.getUTCMonth()).toBe(7); // August
  });

  it("reuses a service template across two different clients", async () => {
    const otherClient = await prisma.client.create({
      data: { organizationId: orgId, businessName: "XYZ Salon" },
    });

    await createClientService({
      clientId,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 5,
      startDate: new Date(Date.UTC(2026, 7, 3)),
      endDate: null,
    });
    await createClientService({
      clientId: otherClient.id,
      serviceName: "Local SEO",
      feeInPaise: 300000,
      frequency: "MONTHLY",
      billingDay: 10,
      startDate: new Date(Date.UTC(2026, 7, 3)),
      endDate: null,
    });

    const templateCount = await prisma.serviceTemplate.count();
    expect(templateCount).toBe(1);
  });

  it("creates a one-time service with no next-period expectation (billing plan still created)", async () => {
    const service = await createClientService({
      clientId,
      serviceName: "Website Build",
      feeInPaise: 1500000,
      frequency: "ONE_TIME",
      billingDay: 1,
      startDate: new Date(Date.UTC(2026, 7, 1)),
      endDate: null,
    });

    const plan = await prisma.billingPlan.findUniqueOrThrow({
      where: { clientServiceId: service.id },
    });
    expect(plan.frequency).toBe("ONE_TIME");
    const periodCount = await prisma.billingPeriod.count({
      where: { billingPlanId: plan.id },
    });
    expect(periodCount).toBe(1); // exactly one period ever, for a one-time fee
  });

  it("stores an optional endDate", async () => {
    const endDate = new Date(Date.UTC(2027, 7, 3));
    const service = await createClientService({
      clientId,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 5,
      startDate: new Date(Date.UTC(2026, 7, 3)),
      endDate,
    });
    expect(service.endDate?.getTime()).toBe(endDate.getTime());
  });
});

describe("getServicesForClient", () => {
  it("returns services with their billing plan and periods included", async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    const client = await prisma.client.create({
      data: { organizationId: org.id, businessName: "ABC Interiors" },
    });
    await createClientService({
      clientId: client.id,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 5,
      startDate: new Date(Date.UTC(2026, 7, 3)),
      endDate: null,
    });

    const services = await getServicesForClient(client.id);

    expect(services).toHaveLength(1);
    expect(services[0].billingPlan?.billingPeriods).toHaveLength(1);
    expect(services[0].serviceTemplate.name).toBe("Local SEO");
  });
});
