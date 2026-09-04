import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { hashPassword } from "@/lib/auth";
import * as authModule from "@/lib/auth";

const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string) => cookieStore.set(name, value),
    get: (name: string) =>
      cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

import { loginAction } from "@/app/login/actions";

const GENERIC_ERROR = "Invalid email or password.";

async function makeAdmin(email = "rohit@example.com", password = "hunter2") {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  return prisma.adminUser.create({
    data: { organizationId: org.id, email, passwordHash: await hashPassword(password) },
  });
}

function loginForm(email: string, password: string) {
  const form = new FormData();
  form.set("email", email);
  form.set("password", password);
  return form;
}

describe("loginAction", () => {
  beforeEach(async () => {
    await resetDb();
    cookieStore.clear();
    vi.clearAllMocks();
  });

  it("sets a session cookie and redirects on correct credentials", async () => {
    await makeAdmin();

    await expect(loginAction(loginForm("rohit@example.com", "hunter2"))).rejects.toThrow(
      "NEXT_REDIRECT"
    );

    expect(cookieStore.get("co_session")).toBeTruthy();
    const session = await prisma.adminSession.findFirst();
    expect(session?.token).toBe(cookieStore.get("co_session"));
  });

  it("returns an error and sets no cookie on wrong password", async () => {
    await makeAdmin();

    const result = await loginAction(loginForm("rohit@example.com", "wrong"));

    expect(result).toEqual({ error: GENERIC_ERROR });
    expect(cookieStore.has("co_session")).toBe(false);
  });

  it("returns the same generic error for an unknown email (no user enumeration)", async () => {
    const result = await loginAction(loginForm("nobody@example.com", "hunter2"));
    expect(result).toEqual({ error: GENERIC_ERROR });
  });

  it("increments failedLoginAttempts on a wrong password", async () => {
    const admin = await makeAdmin();

    await loginAction(loginForm("rohit@example.com", "wrong"));

    const updated = await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
    expect(updated.failedLoginAttempts).toBe(1);
  });

  it("locks the account after 5 failed attempts, rejecting even the correct password", async () => {
    await makeAdmin();

    for (let i = 0; i < 5; i++) {
      await loginAction(loginForm("rohit@example.com", "wrong"));
    }

    const result = await loginAction(loginForm("rohit@example.com", "hunter2"));

    expect(result).toEqual({ error: GENERIC_ERROR });
    expect(cookieStore.has("co_session")).toBe(false);
  });

  it("resets failedLoginAttempts and lockedUntil on a successful login", async () => {
    const admin = await makeAdmin();
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { failedLoginAttempts: 3 },
    });

    await expect(loginAction(loginForm("rohit@example.com", "hunter2"))).rejects.toThrow(
      "NEXT_REDIRECT"
    );

    const updated = await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
    expect(updated.failedLoginAttempts).toBe(0);
    expect(updated.lockedUntil).toBeNull();
  });

  it("allows login again once lockedUntil has passed", async () => {
    const admin = await makeAdmin();
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() - 1000) },
    });

    await expect(loginAction(loginForm("rohit@example.com", "hunter2"))).rejects.toThrow(
      "NEXT_REDIRECT"
    );
  });

  it("runs a bcrypt comparison even for an unknown email (timing side-channel mitigation)", async () => {
    // Closes the gap where the "unknown email" branch used to return
    // immediately while the "wrong password" branch always ran a slow
    // bcrypt.compare() — a timing difference an attacker could use to
    // distinguish the two cases despite the identical error message.
    const spy = vi.spyOn(authModule, "verifyPassword");

    await loginAction(loginForm("nobody@example.com", "hunter2"));

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
