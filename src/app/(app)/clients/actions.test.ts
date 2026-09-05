import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";

vi.mock("@/lib/require-admin", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/require-admin";
import { createClientAction, updateClientAction } from "@/app/(app)/clients/actions";

function mockAdmin(organizationId: number) {
  vi.mocked(requireAdmin).mockResolvedValue({
    id: 1,
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
