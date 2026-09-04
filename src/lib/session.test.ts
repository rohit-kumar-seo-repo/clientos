import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { hashPassword } from "@/lib/auth";
import { createSession, validateSession, revokeSession } from "@/lib/session";

async function makeAdmin() {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  const admin = await prisma.adminUser.create({
    data: {
      organizationId: org.id,
      email: "rohit@example.com",
      passwordHash: await hashPassword("hunter2"),
      name: "Rohit",
    },
  });
  return admin;
}

describe("createSession / validateSession", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates a session that validates back to the same admin", async () => {
    const admin = await makeAdmin();
    const { token } = await createSession(admin.id);

    const result = await validateSession(token);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(admin.id);
    expect(result!.email).toBe("rohit@example.com");
  });

  it("returns null for an unknown token", async () => {
    const result = await validateSession("0".repeat(64));
    expect(result).toBeNull();
  });

  it("returns null for an expired session", async () => {
    const admin = await makeAdmin();
    const { token } = await createSession(admin.id);
    await prisma.adminSession.updateMany({
      where: { token },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await validateSession(token);

    expect(result).toBeNull();
  });
});

describe("revokeSession", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("makes a previously-valid token invalid", async () => {
    const admin = await makeAdmin();
    const { token } = await createSession(admin.id);

    await revokeSession(token);

    expect(await validateSession(token)).toBeNull();
  });
});
