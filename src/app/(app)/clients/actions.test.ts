import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";

vi.mock("@/lib/require-admin", () => ({
  requireAdmin: vi.fn(),
}));

// `revalidatePath` reads Next's per-request store and throws when called
// outside a request scope, which is exactly where these unit tests run.
// Mocking it also lets the tests below assert that each mutating action
// actually asks for the client page to be re-rendered.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/require-admin";
import { createClientAction, updateClientAction } from "@/app/(app)/clients/actions";

function mockAdmin(organizationId: number, adminId = 1) {
  vi.mocked(requireAdmin).mockResolvedValue({
    id: adminId,
    email: "admin@example.com",
    organizationId,
  });
}

describe("createClientAction", () => {
  let orgId: number;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    mockAdmin(orgId);
  });

  it("creates a client and returns its id", async () => {
    const form = new FormData();
    form.set("businessName", "ABC Interiors");
    form.set("contactPerson", "Rohit Sharma");
    form.set("email", "rohit@abcinteriors.in");

    const result = await createClientAction(form);

    expect("clientId" in result).toBe(true);
    const client = await prisma.client.findUnique({
      where: { id: (result as { clientId: number }).clientId },
    });
    expect(client?.businessName).toBe("ABC Interiors");
    expect(client?.status).toBe("ACTIVE");
  });

  it("writes a client.created activity row", async () => {
    const form = new FormData();
    form.set("businessName", "ABC Interiors");

    const result = await createClientAction(form);
    const clientId = (result as { clientId: number }).clientId;

    const activity = await prisma.clientActivity.findFirst({ where: { clientId } });
    expect(activity?.eventType).toBe("client.created");
  });

  it("rejects an empty business name", async () => {
    const form = new FormData();
    form.set("businessName", "  ");

    const result = await createClientAction(form);

    expect(result).toEqual({ error: "Business name is required." });
  });

  it("rejects an over-length phone instead of letting MySQL raise a 500", async () => {
    // `Client.phone` is VarChar(20) and local MySQL runs in strict mode, so
    // before this validation existed an ordinary long phone number (a number
    // plus an extension, say) reached the driver and threw an unhandled
    // error mid-request rather than coming back as a field error.
    const form = new FormData();
    form.set("businessName", "ABC Interiors");
    form.set("phone", "+91 98765 43210 ext. 4021"); // 25 chars, limit is 20

    const result = await createClientAction(form);

    expect(result).toEqual({ error: "Phone is too long (max 20 characters)." });
    // The write must be rejected before Prisma is touched at all.
    expect(await prisma.client.count()).toBe(0);
    expect(await prisma.clientActivity.count()).toBe(0);
  });

  it("rejects an over-length business name", async () => {
    const form = new FormData();
    form.set("businessName", "A".repeat(151)); // limit is 150

    const result = await createClientAction(form);

    expect(result).toEqual({
      error: "Business name is too long (max 150 characters).",
    });
    expect(await prisma.client.count()).toBe(0);
  });

  it("accepts a value exactly at the column limit", async () => {
    // Guards the boundary against an off-by-one that would reject valid input.
    const form = new FormData();
    form.set("businessName", "A".repeat(150));

    const result = await createClientAction(form);

    expect("clientId" in result).toBe(true);
  });

  it("derives organizationId from requireAdmin(), never from a caller-supplied value", async () => {
    // Regression test for a security bug: createClientAction used to accept
    // organizationId as a plain parameter, so anyone invoking this "use server"
    // action directly (bypassing the /clients/new UI) could pass an arbitrary
    // organizationId and create a Client + ClientActivity row inside an
    // organization they don't belong to. The fix derives organizationId
    // exclusively from requireAdmin() inside the action itself. This test
    // proves the created client's org tracks whatever requireAdmin() resolves
    // to — there is no other channel left for organizationId to come from.
    const otherOrg = await prisma.organization.create({ data: { name: "Other Org" } });
    mockAdmin(otherOrg.id);

    const form = new FormData();
    form.set("businessName", "Org-Scoped Client");

    const result = await createClientAction(form);
    const clientId = (result as { clientId: number }).clientId;

    const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
    expect(client.organizationId).toBe(otherOrg.id);
  });
});

describe("updateClientAction", () => {
  let orgId: number;
  let clientId: number;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors", phone: "111" },
    });
    clientId = client.id;
    mockAdmin(orgId);
  });

  it("updates the client's fields", async () => {
    const form = new FormData();
    form.set("businessName", "ABC Interiors Pvt Ltd");
    form.set("phone", "222");

    const result = await updateClientAction(clientId, form);

    expect(result).toEqual({ ok: true });
    const updated = await prisma.client.findUnique({ where: { id: clientId } });
    expect(updated?.businessName).toBe("ABC Interiors Pvt Ltd");
    expect(updated?.phone).toBe("222");
  });

  it("writes a client.updated activity row naming the changed fields", async () => {
    const form = new FormData();
    form.set("businessName", "ABC Interiors Pvt Ltd");
    form.set("phone", "111"); // unchanged

    await updateClientAction(clientId, form);

    const activity = await prisma.clientActivity.findFirst({
      where: { clientId, eventType: "client.updated" },
    });
    expect(activity?.summary).toContain("businessName");
    expect(activity?.summary).not.toContain("phone");
  });

  it("rejects an empty business name", async () => {
    const form = new FormData();
    form.set("businessName", "");

    const result = await updateClientAction(clientId, form);

    expect(result).toEqual({ error: "Business name is required." });
  });

  it("rejects an over-length phone and leaves the stored client untouched", async () => {
    const form = new FormData();
    form.set("businessName", "ABC Interiors Pvt Ltd");
    form.set("phone", "+91 98765 43210 ext. 4021"); // 25 chars, limit is 20

    const result = await updateClientAction(clientId, form);

    expect(result).toEqual({ error: "Phone is too long (max 20 characters)." });
    const untouched = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
    expect(untouched.businessName).toBe("ABC Interiors"); // no partial write
    expect(untouched.phone).toBe("111");
    expect(
      await prisma.clientActivity.count({ where: { clientId } })
    ).toBe(0);
  });

  it("returns an error when the authenticated admin belongs to a different organization than the client", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    mockAdmin(otherOrg.id); // simulates an admin from a different org attempting the edit
    const form = new FormData();
    form.set("businessName", "Hijacked");

    const result = await updateClientAction(clientId, form);

    expect(result).toEqual({ error: "Client not found." });
    const untouched = await prisma.client.findUnique({ where: { id: clientId } });
    expect(untouched?.businessName).toBe("ABC Interiors"); // confirms nothing was written
  });
});

import { addContactAction, removeContactAction } from "@/app/(app)/clients/actions";

describe("addContactAction / removeContactAction", () => {
  let orgId: number;
  let clientId: number;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    const client = await prisma.client.create({
      data: { organizationId: org.id, businessName: "ABC Interiors" },
    });
    clientId = client.id;
    mockAdmin(orgId);
  });

  it("adds a contact and logs activity", async () => {
    const form = new FormData();
    form.set("name", "Priya Mehta");
    form.set("role", "Marketing Manager");
    form.set("phone", "9999999999");

    const result = await addContactAction(clientId, form);

    expect(result).toEqual({ ok: true });
    const contact = await prisma.clientContact.findFirst({ where: { clientId } });
    expect(contact?.name).toBe("Priya Mehta");
    const activity = await prisma.clientActivity.findFirst({
      where: { clientId, eventType: "contact.added" },
    });
    expect(activity?.summary).toContain("Priya Mehta");
    // Without this the new contact and its activity row sit in the DB but
    // stay invisible until the user manually reloads the page.
    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${clientId}`);
  });

  it("rejects a contact with no name", async () => {
    const form = new FormData();
    form.set("name", " ");

    const result = await addContactAction(clientId, form);

    expect(result).toEqual({ error: "Contact name is required." });
  });

  it("rejects an over-length contact phone without writing the contact", async () => {
    const form = new FormData();
    form.set("name", "Priya Mehta");
    form.set("phone", "+91 98765 43210 ext. 4021"); // 25 chars, limit is 20

    const result = await addContactAction(clientId, form);

    expect(result).toEqual({ error: "Phone is too long (max 20 characters)." });
    expect(await prisma.clientContact.count({ where: { clientId } })).toBe(0);
    expect(await prisma.clientActivity.count({ where: { clientId } })).toBe(0);
  });

  it("rejects an over-length contact name", async () => {
    const form = new FormData();
    form.set("name", "P".repeat(121)); // limit is 120

    const result = await addContactAction(clientId, form);

    expect(result).toEqual({
      error: "Contact name is too long (max 120 characters).",
    });
    expect(await prisma.clientContact.count({ where: { clientId } })).toBe(0);
  });

  it("removes a contact", async () => {
    const contact = await prisma.clientContact.create({
      data: { clientId, name: "Priya Mehta" },
    });

    await removeContactAction(clientId, contact.id);

    expect(await prisma.clientContact.findUnique({ where: { id: contact.id } })).toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${clientId}`);
  });

  it("rejects adding a contact when the admin belongs to a different organization", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    mockAdmin(otherOrg.id);
    const form = new FormData();
    form.set("name", "Should Not Be Added");

    const result = await addContactAction(clientId, form);

    expect(result).toEqual({ error: "Client not found." });
    expect(await prisma.clientContact.findFirst({ where: { clientId } })).toBeNull();
  });

  it("rejects removing a contact when the admin belongs to a different organization", async () => {
    const contact = await prisma.clientContact.create({
      data: { clientId, name: "Priya Mehta" },
    });
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    mockAdmin(otherOrg.id);

    await removeContactAction(clientId, contact.id);

    // still there — the cross-org removal must not have taken effect
    expect(await prisma.clientContact.findUnique({ where: { id: contact.id } })).not.toBeNull();
  });
});

import { addNoteAction, deleteClientAction } from "@/app/(app)/clients/actions";

describe("addNoteAction", () => {
  let orgId: number;
  let clientId: number;
  let adminId: number;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    const client = await prisma.client.create({
      data: { organizationId: org.id, businessName: "ABC Interiors" },
    });
    clientId = client.id;
    const admin = await prisma.adminUser.create({
      data: { organizationId: org.id, email: "rohit@example.com", passwordHash: "x" },
    });
    adminId = admin.id;
    mockAdmin(orgId, adminId);
  });

  it("adds a note and logs activity", async () => {
    const form = new FormData();
    form.set("body", "Client wants to pause Google Ads for a month.");

    const result = await addNoteAction(clientId, form);

    expect(result).toEqual({ ok: true });
    const note = await prisma.clientNote.findFirst({ where: { clientId } });
    expect(note?.body).toBe("Client wants to pause Google Ads for a month.");
    expect(note?.authorAdminId).toBe(adminId);
    const activity = await prisma.clientActivity.findFirst({
      where: { clientId, eventType: "note.added" },
    });
    expect(activity).not.toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith(`/clients/${clientId}`);
  });

  it("rejects an empty note", async () => {
    const form = new FormData();
    form.set("body", "   ");

    const result = await addNoteAction(clientId, form);

    expect(result).toEqual({ error: "Note cannot be empty." });
  });

  it("rejects adding a note when the admin belongs to a different organization", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    const otherAdmin = await prisma.adminUser.create({
      data: { organizationId: otherOrg.id, email: "other@example.com", passwordHash: "x" },
    });
    mockAdmin(otherOrg.id, otherAdmin.id);
    const form = new FormData();
    form.set("body", "Should not be added.");

    const result = await addNoteAction(clientId, form);

    expect(result).toEqual({ error: "Client not found." });
    expect(await prisma.clientNote.findFirst({ where: { clientId } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deleteClientAction
// ---------------------------------------------------------------------------

describe("deleteClientAction", () => {
  let orgId: number;
  let adminId: number;
  let clientId: number;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    const admin = await prisma.adminUser.create({
      data: { organizationId: org.id, email: "admin@example.com", passwordHash: "x" },
    });
    adminId = admin.id;
    const client = await prisma.client.create({
      data: { organizationId: org.id, businessName: "Delete Me Corp" },
    });
    clientId = client.id;
    mockAdmin(orgId, adminId);
  });

  it("deletes a client with no payments and returns ok", async () => {
    const result = await deleteClientAction(clientId);
    expect(result).toEqual({ ok: true });
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    expect(client).toBeNull();
  });

  it("cascade-removes contacts, notes, activity and projects", async () => {
    await prisma.clientContact.create({ data: { clientId, name: "Test Contact" } });
    await prisma.clientNote.create({ data: { clientId, authorAdminId: adminId, body: "Note" } });
    await prisma.project.create({ data: { clientId, title: "P1", baseAmountInPaise: 100_000 } });

    await deleteClientAction(clientId);

    expect(await prisma.clientContact.count({ where: { clientId } })).toBe(0);
    expect(await prisma.clientNote.count({ where: { clientId } })).toBe(0);
    expect(await prisma.project.count({ where: { clientId } })).toBe(0);
  });

  it("writes an auditLog entry for the deletion", async () => {
    await deleteClientAction(clientId);
    const log = await prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: "client.deleted" },
    });
    expect(log).not.toBeNull();
    expect(log?.entityType).toBe("Client");
    expect(log?.entityId).toBe(String(clientId));
  });

  it("blocks deletion and returns hasPayments=true when payments exist", async () => {
    // Create a service → billing plan → period → invoice → payment chain
    const { createClientService } = await import("@/lib/services");
    const { markBillingPeriodPaid } = await import("@/lib/payments");
    const service = await createClientService({
      clientId,
      serviceName: "Local SEO",
      feeInPaise: 500_000,
      frequency: "MONTHLY",
      billingDay: 1,
      startDate: new Date(Date.UTC(2026, 7, 1)),
      endDate: null,
    });
    const plan = await prisma.billingPlan.findUniqueOrThrow({ where: { clientServiceId: service.id } });
    const period = await prisma.billingPeriod.findFirstOrThrow({ where: { billingPlanId: plan.id } });
    await markBillingPeriodPaid({ billingPeriodId: period.id, amountInPaise: 500_000, paidAt: new Date(), recordedByAdminId: adminId });

    const result = await deleteClientAction(clientId);
    expect("error" in result).toBe(true);
    expect((result as { error: string; hasPayments?: boolean }).hasPayments).toBe(true);
    // Client must still exist
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    expect(client).not.toBeNull();
  });

  it("blocks deletion when a project milestone has been paid", async () => {
    const { markMilestonePaid } = await import("@/lib/project-payments");
    const project = await prisma.project.create({
      data: { clientId, title: "Paid Project", baseAmountInPaise: 1_000_000 },
    });
    const milestone = await prisma.projectMilestone.create({
      data: { projectId: project.id, label: "Advance", amountInPaise: 500_000, sortOrder: 0 },
    });
    await markMilestonePaid({ milestoneId: milestone.id, paidAt: new Date(), recordedByAdminId: adminId });

    const result = await deleteClientAction(clientId);
    expect("error" in result).toBe(true);
    expect((result as { error: string; hasPayments?: boolean }).hasPayments).toBe(true);
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    expect(client).not.toBeNull();
  });

  it("rejects deletion when the admin belongs to a different organization", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    const otherAdmin = await prisma.adminUser.create({
      data: { organizationId: otherOrg.id, email: "other@example.com", passwordHash: "x" },
    });
    mockAdmin(otherOrg.id, otherAdmin.id);

    const result = await deleteClientAction(clientId);
    expect("error" in result).toBe(true);
    // Client must still exist
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    expect(client).not.toBeNull();
  });
});
