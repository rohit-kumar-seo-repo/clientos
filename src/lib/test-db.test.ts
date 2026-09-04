import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";

describe("resetDb", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("leaves the organizations table empty", async () => {
    const count = await prisma.organization.count();
    expect(count).toBe(0);
  });

  it("allows inserting after a reset", async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Org" },
    });
    expect(org.id).toBeGreaterThan(0);
  });
});
