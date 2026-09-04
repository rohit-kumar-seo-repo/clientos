import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { listClients, getClientById } from "@/lib/clients";

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
