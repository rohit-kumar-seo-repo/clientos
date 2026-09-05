import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { hashPassword } from "@/lib/auth";
import { createSession, validateSession, SESSION_COOKIE_NAME } from "@/lib/session";

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
import { logoutAction } from "@/app/(app)/logout/actions";

async function makeAdmin() {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  return prisma.adminUser.create({
    data: {
      organizationId: org.id,
      email: "rohit@example.com",
      passwordHash: await hashPassword("hunter2"),
    },
  });
}

describe("logoutAction", () => {
  beforeEach(async () => {
    await resetDb();
    cookieStore.clear();
    vi.clearAllMocks();
  });

  it("revokes the session server-side, clears the cookie, and redirects to /login", async () => {
    const admin = await makeAdmin();
    const { token } = await createSession(admin.id);
    cookieStore.set(SESSION_COOKIE_NAME, token);

    await expect(logoutAction()).rejects.toThrow("NEXT_REDIRECT");

    // Deleting the cookie alone would leave a still-valid token behind for
    // anyone who had captured it — the session row must be gone too.
    expect(await prisma.adminSession.count()).toBe(0);
    expect(await validateSession(token)).toBeNull();
    expect(cookieStore.has(SESSION_COOKIE_NAME)).toBe(false);
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("revokes only the signed-out session, leaving other sessions alone", async () => {
    const admin = await makeAdmin();
    const mine = await createSession(admin.id);
    const other = await createSession(admin.id); // e.g. the same admin on a phone
    cookieStore.set(SESSION_COOKIE_NAME, mine.token);

    await expect(logoutAction()).rejects.toThrow("NEXT_REDIRECT");

    expect(await validateSession(mine.token)).toBeNull();
    expect(await validateSession(other.token)).not.toBeNull();
  });

  it("still clears the cookie and redirects when no session cookie is present", async () => {
    await expect(logoutAction()).rejects.toThrow("NEXT_REDIRECT");

    expect(cookieStore.has(SESSION_COOKIE_NAME)).toBe(false);
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
