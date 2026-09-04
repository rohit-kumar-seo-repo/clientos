"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { createSession } from "@/lib/session";

const GENERIC_ERROR = "Invalid email or password.";
const SESSION_COOKIE = "co_session";
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// A precomputed bcrypt hash (12 rounds, matching hashPassword's cost factor)
// of an arbitrary placeholder string, used only to give the "no such admin"
// branch a bcrypt.compare() call of its own (see below). Never used to
// authenticate anything — it doesn't correspond to any real account or
// password, and never verifies true against any input.
const DUMMY_HASH =
  "$2b$12$mj8epJl/2j3fWQaTyiAyDO5DfLfpzISBN2UbbBKxMCd0CZu.neaym";

export async function loginAction(
  formData: FormData
): Promise<{ error: string } | void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: GENERIC_ERROR };
  }

  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin || !admin.isActive) {
    // Timing side-channel mitigation: the "wrong password" branch below always
    // runs a slow bcrypt.compare() before returning. If this branch returned
    // immediately, an attacker could distinguish "this email doesn't exist"
    // from "this email exists but the password is wrong" purely by how fast
    // the response comes back, even though both return the identical error
    // message. Running bcrypt.compare() against a dummy hash here costs the
    // same CPU time as a real comparison, without touching any real account.
    await verifyPassword(password, DUMMY_HASH);
    return { error: GENERIC_ERROR };
  }

  // Checked before the password comparison, and returns the exact same
  // generic error as a wrong password — an attacker can't tell a locked
  // account apart from a wrong password or a nonexistent email.
  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    return { error: GENERIC_ERROR };
  }

  const valid = await verifyPassword(password, admin.passwordHash);
  if (!valid) {
    const failedLoginAttempts = admin.failedLoginAttempts + 1;
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        failedLoginAttempts,
        lockedUntil:
          failedLoginAttempts >= MAX_FAILED_ATTEMPTS
            ? new Date(Date.now() + LOCKOUT_DURATION_MS)
            : admin.lockedUntil,
      },
    });
    return { error: GENERIC_ERROR };
  }

  const { token, expiresAt } = await createSession(admin.id);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
  });

  redirect("/");
}
