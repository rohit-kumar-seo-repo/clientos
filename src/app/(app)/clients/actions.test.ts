import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";

vi.mock("@/lib/require-admin", () => ({
  requireAdmin: vi.fn(),
}));

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
  });

  it("rejects a contact with no name", async () => {
    const form = new FormData();
    form.set("name", " ");

    const result = await addContactAction(clientId, form);

    expect(result).toEqual({ error: "Contact name is required." });
  });

  it("removes a contact", async () => {
    const contact = await prisma.clientContact.create({
      data: { clientId, name: "Priya Mehta" },
    });

    await removeContactAction(clientId, contact.id);

    expect(await prisma.clientContact.findUnique({ where: { id: contact.id } })).toBeNull();
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

import { addNoteAction } from "@/app/(app)/clients/actions";

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
