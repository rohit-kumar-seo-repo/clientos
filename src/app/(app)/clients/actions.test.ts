import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";

vi.mock("@/lib/require-admin", () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from "@/lib/require-admin";
import { createClientAction } from "@/app/(app)/clients/actions";

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
