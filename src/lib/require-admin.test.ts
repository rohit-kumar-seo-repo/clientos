import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { hashPassword } from "@/lib/auth";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/session";

const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string) => cookieStore.set(name, value),
    get: (name: string) =>
      cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined,
    delete: (name: string) => cookieStore.delete(name),
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";

async function makeAdmin() {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  const admin = await prisma.adminUser.create({
    data: {
      organizationId: org.id,
      email: "rohit@example.com",
      passwordHash: await hashPassword("hunter2"),
    },
  });
  return { org, admin };
}

// Every other suite mocks `@/lib/require-admin` wholesale, so nothing else
// exercises the real gate. These tests drive the actual implementation
// against a real session row instead of a stubbed `validateSession`.
describe("requireAdmin", () => {
  beforeEach(async () => {
    await resetDb();
    cookieStore.clear();
    vi.clearAllMocks();
  });

  it("returns the admin identity for a valid session cookie", async () => {
    const { org, admin } = await makeAdmin();
    const { token } = await createSession(admin.id);
    cookieStore.set(SESSION_COOKIE_NAME, token);

    const result = await requireAdmin();

    expect(result).toEqual({
      id: admin.id,
      email: "rohit@example.com",
      organizationId: org.id,
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to /login when no session cookie is present", async () => {
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login for a token that matches no session", async () => {
    cookieStore.set(SESSION_COOKIE_NAME, "0".repeat(64));

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login for an expired session", async () => {
    const { admin } = await makeAdmin();
    const { token } = await createSession(admin.id);
    await prisma.adminSession.updateMany({
      where: { token },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    cookieStore.set(SESSION_COOKIE_NAME, token);

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login for a revoked session", async () => {
    const { admin } = await makeAdmin();
    const { token } = await createSession(admin.id);
    cookieStore.set(SESSION_COOKIE_NAME, token);
    await prisma.adminSession.deleteMany({ where: { token } });

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
