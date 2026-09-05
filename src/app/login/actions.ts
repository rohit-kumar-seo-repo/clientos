"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { createSession, SESSION_COOKIE_NAME } from "@/lib/session";

const GENERIC_ERROR = "Invalid email or password.";
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
    // Timing side-channel mitigation, same reasoning as the "no such admin"
    // branch above: without this, a locked-out account would respond
    // immediately while the other two failure paths (unknown email, wrong
    // password) both incur a bcrypt.compare(). Running the same dummy-hash
    // comparison here keeps all three failure paths the same cost.
    await verifyPassword(password, DUMMY_HASH);
    return { error: GENERIC_ERROR };
  }

  // Reaching here with a non-null lockedUntil means the lock has EXPIRED.
  // Clear the stale failure count before the password check: without this,
  // failedLoginAttempts stays at the threshold forever, so the very next
  // typo pushes it past MAX_FAILED_ATTEMPTS and re-locks the account for
  // another 15 minutes — indefinitely, for a legitimate user who keeps
  // mistyping. With a single admin and no other recovery path, that is a
  // real self-lockout risk. An expired lockout now genuinely starts over:
  // only 5 NEW consecutive failures can trigger the next one.
  if (admin.lockedUntil) {
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  const valid = await verifyPassword(password, admin.passwordHash);
  if (!valid) {
    // Atomic increment (via Prisma's `increment` operator) rather than
    // reading admin.failedLoginAttempts and writing back count+1: a plain
    // read-modify-write is a lost-update race under concurrent requests —
    // several parallel wrong-password attempts would each read the same
    // starting count and each write the same count+1, letting an attacker
    // who parallelizes guesses bypass the lockout entirely. The lockout
    // decision below is based on `updated.failedLoginAttempts`, the actual
    // post-increment count the database returns, not a stale in-memory value.
    const updated = await prisma.adminUser.update({
      where: { id: admin.id },
      data: { failedLoginAttempts: { increment: 1 } },
    });

    if (updated.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      await prisma.adminUser.update({
        where: { id: admin.id },
        data: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
      });
    }

    return { error: GENERIC_ERROR };
  }

  const { token, expiresAt } = await createSession(admin.id);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
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
