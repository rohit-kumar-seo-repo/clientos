import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";

vi.mock("@/lib/require-admin", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/require-admin";
import {
  createServiceAction,
  updateServiceAction,
  updateServiceStatusAction,
  updateWorkStatusAction,
} from "@/app/(app)/clients/service-actions";
import type { ServiceStatus } from "@/generated/prisma/client";

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

    expect(result).toEqual({
      error: "Price must be greater than zero and no more than ₹1,00,00,000.",
    });
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

  it("rejects a fee above the upper bound", async () => {
    const form = serviceForm({
      serviceName: "Local SEO",
      feeInRupees: "100000001",
      frequency: "MONTHLY",
      billingDay: "5",
      startDate: "2026-08-03",
    });

    const result = await createServiceAction(clientId, form);

    expect(result).toEqual({
      error: "Price must be greater than zero and no more than ₹1,00,00,000.",
    });
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

describe("updateServiceAction", () => {
  let orgId: number;
  let clientServiceId: number;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors" },
    });
    // createServiceAction (below) writes a ClientActivity row with a real
    // FK to admin_users — mockAdmin alone only stubs requireAdmin()'s
    // return value, it doesn't create a backing row, so a real AdminUser
    // is required here (same pattern as the existing addNoteAction block
    // in this file, and the fix Task 4's own review surfaced this gap
    // through).
    const admin = await prisma.adminUser.create({
      data: { organizationId: orgId, email: "admin@example.com", passwordHash: "x" },
    });
    mockAdmin(orgId, admin.id);
    const created = await createServiceAction(
      client.id,
      serviceForm({
        serviceName: "Local SEO",
        feeInRupees: "5000",
        frequency: "MONTHLY",
        billingDay: "5",
        startDate: "2026-08-03",
      })
    );
    clientServiceId = (created as { clientServiceId: number }).clientServiceId;
  });

  it("updates the fee going forward without touching the existing billing period", async () => {
    const before = await prisma.billingPeriod.findFirstOrThrow({
      where: { billingPlan: { clientServiceId } },
    });

    const form = new FormData();
    form.set("feeInRupees", "6000");
    form.set("frequency", "MONTHLY");
    form.set("billingDay", "5");
    const result = await updateServiceAction(clientServiceId, form);

    expect(result).toEqual({ ok: true });
    const plan = await prisma.billingPlan.findUniqueOrThrow({
      where: { clientServiceId },
    });
    expect(plan.amountInPaise).toBe(600000);

    const stillTheOriginalPeriod = await prisma.billingPeriod.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(stillTheOriginalPeriod.amountInPaise).toBe(500000); // unchanged
  });

  it("rejects a non-positive fee", async () => {
    const form = new FormData();
    form.set("feeInRupees", "-5");
    form.set("frequency", "MONTHLY");
    form.set("billingDay", "5");

    const result = await updateServiceAction(clientServiceId, form);

    expect(result).toEqual({
      error: "Price must be greater than zero and no more than ₹1,00,00,000.",
    });
  });

  it("rejects a fee above the upper bound", async () => {
    const form = new FormData();
    form.set("feeInRupees", "100000001");
    form.set("frequency", "MONTHLY");
    form.set("billingDay", "5");

    const result = await updateServiceAction(clientServiceId, form);

    expect(result).toEqual({
      error: "Price must be greater than zero and no more than ₹1,00,00,000.",
    });
  });

  it("logs a service.updated activity with the admin who made the change", async () => {
    const editor = await prisma.adminUser.create({
      data: { organizationId: orgId, email: "editor@example.com", passwordHash: "x" },
    });
    mockAdmin(orgId, editor.id);

    const form = new FormData();
    form.set("feeInRupees", "6000");
    form.set("frequency", "MONTHLY");
    form.set("billingDay", "5");
    await updateServiceAction(clientServiceId, form);

    const activity = await prisma.clientActivity.findFirstOrThrow({
      where: { eventType: "service.updated" },
      orderBy: { id: "desc" },
    });
    expect(activity.actorAdminId).toBe(editor.id);
    expect(activity.summary).toContain("6,000");
  });

  it("returns an error for a service in a different organization", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    mockAdmin(otherOrg.id);
    const form = new FormData();
    form.set("feeInRupees", "6000");
    form.set("frequency", "MONTHLY");
    form.set("billingDay", "5");

    const result = await updateServiceAction(clientServiceId, form);

    expect(result).toEqual({ error: "Service not found." });
  });
});

describe("updateServiceStatusAction", () => {
  let orgId: number;
  let clientServiceId: number;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors" },
    });
    // Both createServiceAction (below) and updateServiceStatusAction
    // (called by every test in this block) write a ClientActivity row
    // with a real FK to admin_users — see the note in the
    // updateServiceAction block above for why a real row is required.
    const admin = await prisma.adminUser.create({
      data: { organizationId: orgId, email: "admin@example.com", passwordHash: "x" },
    });
    mockAdmin(orgId, admin.id);
    const created = await createServiceAction(
      client.id,
      serviceForm({
        serviceName: "Local SEO",
        feeInRupees: "5000",
        frequency: "MONTHLY",
        billingDay: "5",
        startDate: "2026-08-03",
      })
    );
    clientServiceId = (created as { clientServiceId: number }).clientServiceId;
  });

  it("pauses a service and logs activity", async () => {
    const result = await updateServiceStatusAction(clientServiceId, "PAUSED");

    expect(result).toEqual({ ok: true });
    const service = await prisma.clientService.findUniqueOrThrow({
      where: { id: clientServiceId },
    });
    expect(service.status).toBe("PAUSED");
    const activity = await prisma.clientActivity.findFirstOrThrow({
      where: { eventType: "service.status_changed" },
    });
    expect(activity.summary).toContain("PAUSED");
  });

  it("rejects an invalid status value", async () => {
    const result = await updateServiceStatusAction(
      clientServiceId,
      "DELETED" as unknown as ServiceStatus
    );

    expect(result).toEqual({ error: "Invalid status." });
    const service = await prisma.clientService.findUniqueOrThrow({
      where: { id: clientServiceId },
    });
    expect(service.status).toBe("ACTIVE"); // untouched
  });

  it("rejects a status change for a service in a different organization", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    mockAdmin(otherOrg.id);

    const result = await updateServiceStatusAction(clientServiceId, "CANCELLED");

    expect(result).toEqual({ error: "Service not found." });
    const service = await prisma.clientService.findUniqueOrThrow({
      where: { id: clientServiceId },
    });
    expect(service.status).toBe("ACTIVE"); // untouched
  });

  it("leaves the existing billing period completely unchanged when pausing", async () => {
    const before = await prisma.billingPeriod.findFirstOrThrow({
      where: { billingPlan: { clientServiceId } },
    });

    await updateServiceStatusAction(clientServiceId, "PAUSED");

    const after = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.amountInPaise).toBe(before.amountInPaise);
    expect(after.dueDate.getTime()).toBe(before.dueDate.getTime());
    expect(after.status).toBe(before.status);
    expect(after.periodLabel).toBe(before.periodLabel);
    const periodCount = await prisma.billingPeriod.count({
      where: { billingPlan: { clientServiceId } },
    });
    expect(periodCount).toBe(1); // pausing does not spawn or remove periods
  });

  it("leaves the existing billing period completely unchanged when cancelling", async () => {
    const before = await prisma.billingPeriod.findFirstOrThrow({
      where: { billingPlan: { clientServiceId } },
    });

    await updateServiceStatusAction(clientServiceId, "CANCELLED");

    const after = await prisma.billingPeriod.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.amountInPaise).toBe(before.amountInPaise);
    expect(after.dueDate.getTime()).toBe(before.dueDate.getTime());
    expect(after.status).toBe(before.status);
  });
});

describe("updateWorkStatusAction", () => {
  let orgId: number;
  let clientServiceId: number;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors" },
    });
    // createServiceAction (below) writes a ClientActivity row under a real
    // FK to admin_users (added in Plan 1's Task 1 migration), and this
    // block's own updateWorkStatusAction calls do too whenever workStatus
    // actually changes — mockAdmin alone only stubs requireAdmin()'s
    // return value, it doesn't create a backing row. A real AdminUser is
    // required here (Plan 1's Task 4 review surfaced this exact gap —
    // same fix applied consistently wherever a mocked admin authors an
    // activity row).
    const admin = await prisma.adminUser.create({
      data: { organizationId: orgId, email: "admin@example.com", passwordHash: "x" },
    });
    mockAdmin(orgId, admin.id);
    const created = await createServiceAction(
      client.id,
      serviceForm({
        serviceName: "Local SEO",
        feeInRupees: "5000",
        frequency: "MONTHLY",
        billingDay: "5",
        startDate: "2026-08-03",
      })
    );
    clientServiceId = (created as { clientServiceId: number }).clientServiceId;
  });

  it("updates work status, progress, note, and next action", async () => {
    const form = new FormData();
    form.set("workStatus", "IN_PROGRESS");
    form.set("progressPercent", "70");
    form.set("workNote", "Backlinks in progress");
    form.set("nextActionNote", "Send monthly report");
    form.set("nextActionDate", "2026-09-01");

    const result = await updateWorkStatusAction(clientServiceId, form);

    expect(result).toEqual({ ok: true });
    const service = await prisma.clientService.findUniqueOrThrow({
      where: { id: clientServiceId },
    });
    expect(service.workStatus).toBe("IN_PROGRESS");
    expect(service.progressPercent).toBe(70);
    expect(service.workNote).toBe("Backlinks in progress");
    expect(service.nextActionNote).toBe("Send monthly report");
    expect(service.nextActionDate?.toISOString().slice(0, 10)).toBe("2026-09-01");
  });

  it("allows clearing optional fields by submitting them empty", async () => {
    const form = new FormData();
    form.set("workStatus", "COMPLETED");
    form.set("progressPercent", "100");
    form.set("workNote", "");
    form.set("nextActionNote", "");
    form.set("nextActionDate", "");

    const result = await updateWorkStatusAction(clientServiceId, form);

    expect(result).toEqual({ ok: true });
    const service = await prisma.clientService.findUniqueOrThrow({
      where: { id: clientServiceId },
    });
    expect(service.workNote).toBeNull();
    expect(service.nextActionDate).toBeNull();
  });

  it("rejects an invalid work status", async () => {
    const form = new FormData();
    form.set("workStatus", "BLOCKED");
    form.set("progressPercent", "50");

    const result = await updateWorkStatusAction(clientServiceId, form);

    expect(result).toEqual({ error: "Invalid work status." });
  });

  it("rejects a progress percent outside 0-100", async () => {
    const form = new FormData();
    form.set("workStatus", "IN_PROGRESS");
    form.set("progressPercent", "150");

    const result = await updateWorkStatusAction(clientServiceId, form);

    expect(result).toEqual({ error: "Progress must be between 0 and 100." });
  });

  it("allows an empty progress percent (it is optional)", async () => {
    const form = new FormData();
    form.set("workStatus", "NOT_STARTED");
    form.set("progressPercent", "");

    const result = await updateWorkStatusAction(clientServiceId, form);

    expect(result).toEqual({ ok: true });
    const service = await prisma.clientService.findUniqueOrThrow({
      where: { id: clientServiceId },
    });
    expect(service.progressPercent).toBeNull();
  });

  it("returns an error for a service in a different organization", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    mockAdmin(otherOrg.id);
    const form = new FormData();
    form.set("workStatus", "IN_PROGRESS");
    form.set("progressPercent", "50");

    const result = await updateWorkStatusAction(clientServiceId, form);

    expect(result).toEqual({ error: "Service not found." });
  });

  it("logs activity when the work status actually changes", async () => {
    const form = new FormData();
    form.set("workStatus", "IN_PROGRESS"); // service starts at NOT_STARTED
    form.set("progressPercent", "10");

    await updateWorkStatusAction(clientServiceId, form);

    const activity = await prisma.clientActivity.findFirstOrThrow({
      where: { eventType: "service.work_updated" },
    });
    expect(activity.summary.toLowerCase()).toContain("in progress");
  });

  it("does not log activity when the work status is unchanged (only progress/notes updated)", async () => {
    const firstForm = new FormData();
    firstForm.set("workStatus", "IN_PROGRESS");
    firstForm.set("progressPercent", "10");
    await updateWorkStatusAction(clientServiceId, firstForm);
    const countAfterFirst = await prisma.clientActivity.count({
      where: { eventType: "service.work_updated" },
    });

    const secondForm = new FormData();
    secondForm.set("workStatus", "IN_PROGRESS"); // same status as before
    secondForm.set("progressPercent", "40"); // only progress changes
    await updateWorkStatusAction(clientServiceId, secondForm);

    const countAfterSecond = await prisma.clientActivity.count({
      where: { eventType: "service.work_updated" },
    });
    expect(countAfterSecond).toBe(countAfterFirst); // no new entry
  });
});
