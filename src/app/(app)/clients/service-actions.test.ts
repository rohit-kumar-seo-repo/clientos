import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";

vi.mock("@/lib/require-admin", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/require-admin";
import { createServiceAction } from "@/app/(app)/clients/service-actions";

function mockAdmin(organizationId: number, adminId = 1) {
  vi.mocked(requireAdmin).mockResolvedValue({
    id: adminId,
    email: "admin@example.com",
    organizationId,
  });
}

function serviceForm(fields: Record<string, string>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  return form;
}

describe("createServiceAction", () => {
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
    // createServiceAction always writes a ClientActivity row with
    // actorAdminId: admin.id, and that column has a real FK to admin_users
    // (added in Task 1's migration). A mocked requireAdmin() return value
    // alone doesn't satisfy it, so — matching the addNoteAction test block
    // in ./actions.test.ts — an actual AdminUser row is required here too.
    const admin = await prisma.adminUser.create({
      data: { organizationId: orgId, email: "admin@example.com", passwordHash: "x" },
    });
    adminId = admin.id;
    mockAdmin(orgId, adminId);
  });

  it("creates a service and returns its id", async () => {
    const form = serviceForm({
      serviceName: "Local SEO",
      feeInRupees: "5000",
      frequency: "MONTHLY",
      billingDay: "5",
      startDate: "2026-08-03",
    });

    const result = await createServiceAction(clientId, form);

    expect("clientServiceId" in result).toBe(true);
    const service = await prisma.clientService.findUniqueOrThrow({
      where: { id: (result as { clientServiceId: number }).clientServiceId },
    });
    expect(service.feeInPaise).toBe(500000);
  });

  it("writes a service.added activity row naming the service", async () => {
    const form = serviceForm({
      serviceName: "Local SEO",
      feeInRupees: "5000",
      frequency: "MONTHLY",
      billingDay: "5",
      startDate: "2026-08-03",
    });

    await createServiceAction(clientId, form);

    const activity = await prisma.clientActivity.findFirstOrThrow({
      where: { clientId, eventType: "service.added" },
    });
    expect(activity.summary).toContain("Local SEO");
    expect(activity.actorAdminId).toBe(adminId);
  });

  it("rejects a missing service name", async () => {
    const form = serviceForm({
      serviceName: "  ",
      feeInRupees: "5000",
      frequency: "MONTHLY",
      billingDay: "5",
      startDate: "2026-08-03",
    });

    const result = await createServiceAction(clientId, form);

    expect(result).toEqual({ error: "Service name is required." });
  });

  it("rejects a non-positive fee", async () => {
    const form = serviceForm({
      serviceName: "Local SEO",
      feeInRupees: "0",
      frequency: "MONTHLY",
      billingDay: "5",
      startDate: "2026-08-03",
    });

    const result = await createServiceAction(clientId, form);

    expect(result).toEqual({ error: "Price must be greater than zero." });
  });

  it("rejects a billing day outside 1-28", async () => {
    const form = serviceForm({
      serviceName: "Local SEO",
      feeInRupees: "5000",
      frequency: "MONTHLY",
      billingDay: "30",
      startDate: "2026-08-03",
    });

    const result = await createServiceAction(clientId, form);

    expect(result).toEqual({ error: "Billing day must be between 1 and 28." });
  });

  it("rejects an invalid frequency value", async () => {
    const form = serviceForm({
      serviceName: "Local SEO",
      feeInRupees: "5000",
      frequency: "FORTNIGHTLY",
      billingDay: "5",
      startDate: "2026-08-03",
    });

    const result = await createServiceAction(clientId, form);

    expect(result).toEqual({ error: "Invalid billing frequency." });
  });

  it("returns an error when the client belongs to a different organization", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    mockAdmin(otherOrg.id);
    const form = serviceForm({
      serviceName: "Local SEO",
      feeInRupees: "5000",
      frequency: "MONTHLY",
      billingDay: "5",
      startDate: "2026-08-03",
    });

    const result = await createServiceAction(clientId, form);

    expect(result).toEqual({ error: "Client not found." });
    const count = await prisma.clientService.count();
    expect(count).toBe(0);
  });
});
