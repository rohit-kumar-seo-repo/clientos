import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { listClients, getClientById, getPaymentHistoryForClient } from "@/lib/clients";
import { createClientService } from "@/lib/services";
import { markBillingPeriodPaid } from "@/lib/payments";

describe("listClients", () => {
  let orgId: number;

  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    await prisma.client.createMany({
      data: [
        { organizationId: orgId, businessName: "ABC Interiors", status: "ACTIVE" },
        { organizationId: orgId, businessName: "XYZ Salon", status: "ACTIVE" },
        { organizationId: orgId, businessName: "Old Client Co", status: "CHURNED" },
      ],
    });
  });

  it("returns all clients for the organization by default", async () => {
    const result = await listClients(orgId);
    expect(result).toHaveLength(3);
  });

  it("filters by search substring on businessName (case-insensitive)", async () => {
    const result = await listClients(orgId, { search: "abc" });
    expect(result).toHaveLength(1);
    expect(result[0].businessName).toBe("ABC Interiors");
  });

  it("filters by status", async () => {
    const result = await listClients(orgId, { status: "CHURNED" });
    expect(result).toHaveLength(1);
    expect(result[0].businessName).toBe("Old Client Co");
  });

  it("never returns another organization's clients", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    await prisma.client.create({
      data: { organizationId: otherOrg.id, businessName: "Should Not Appear" },
    });

    const result = await listClients(orgId);

    expect(result.map((c) => c.businessName)).not.toContain("Should Not Appear");
  });
});

describe("getClientById", () => {
  let orgId: number;

  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
  });

  it("returns the client with contacts, notes, and activity", async () => {
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors" },
    });
    await prisma.clientActivity.create({
      data: { clientId: client.id, eventType: "client.created", summary: "Created." },
    });

    const result = await getClientById(orgId, client.id);

    expect(result?.businessName).toBe("ABC Interiors");
    expect(result?.activity).toHaveLength(1);
  });

  it("returns null for a client in a different organization", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    const client = await prisma.client.create({
      data: { organizationId: otherOrg.id, businessName: "Not Mine" },
    });

    const result = await getClientById(orgId, client.id);

    expect(result).toBeNull();
  });

  it("returns null for a nonexistent id", async () => {
    const result = await getClientById(orgId, 999999);
    expect(result).toBeNull();
  });
});

describe("getClientById with services", () => {
  it("includes services with their template and current billing period", async () => {
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

    const result = await getClientById(org.id, client.id);

    expect(result?.services).toHaveLength(1);
    expect(result?.services[0].serviceTemplate.name).toBe("Local SEO");
    expect(result?.services[0].billingPlan?.billingPeriods).toHaveLength(1);
  });
});

describe("getPaymentHistoryForClient", () => {
  it("returns payments newest-first, scoped to the client's own services", async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    const client = await prisma.client.create({
      data: { organizationId: org.id, businessName: "ABC Interiors" },
    });
    const admin = await prisma.adminUser.create({
      data: { organizationId: org.id, email: "a@example.com", passwordHash: "x" },
    });
    const service = await createClientService({
      clientId: client.id,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 1,
      startDate: new Date(Date.UTC(2026, 6, 1)),
      endDate: null,
    });
    const plan = await prisma.billingPlan.findUniqueOrThrow({ where: { clientServiceId: service.id } });
    const period = await prisma.billingPeriod.findFirstOrThrow({ where: { billingPlanId: plan.id } });
    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(Date.UTC(2026, 6, 3)),
      recordedByAdminId: admin.id,
    });

    const history = await getPaymentHistoryForClient(org.id, client.id);

    expect(history).toHaveLength(1);
    expect(history[0].amountInPaise).toBe(500000);
    expect(history[0].status).toBe("CAPTURED");
  });

  it("returns an empty list for a client with no payments yet", async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    const client = await prisma.client.create({
      data: { organizationId: org.id, businessName: "ABC Interiors" },
    });

    const history = await getPaymentHistoryForClient(org.id, client.id);

    expect(history).toEqual([]);
  });

  it("does not return another organization's payments", async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    const otherOrg = await prisma.organization.create({ data: { name: "Other Org" } });
    const client = await prisma.client.create({
      data: { organizationId: org.id, businessName: "ABC Interiors" },
    });
    const admin = await prisma.adminUser.create({
      data: { organizationId: org.id, email: "a@example.com", passwordHash: "x" },
    });
    const service = await createClientService({
      clientId: client.id,
      serviceName: "Local SEO",
      feeInPaise: 500000,
      frequency: "MONTHLY",
      billingDay: 1,
      startDate: new Date(Date.UTC(2026, 6, 1)),
      endDate: null,
    });
    const plan = await prisma.billingPlan.findUniqueOrThrow({ where: { clientServiceId: service.id } });
    const period = await prisma.billingPeriod.findFirstOrThrow({ where: { billingPlanId: plan.id } });
    await markBillingPeriodPaid({
      billingPeriodId: period.id,
      amountInPaise: 500000,
      paidAt: new Date(Date.UTC(2026, 6, 3)),
      recordedByAdminId: admin.id,
    });

    // querying from a different org should return nothing
    const history = await getPaymentHistoryForClient(otherOrg.id, client.id);

    expect(history).toEqual([]);
  });
});
