"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revokeSession, SESSION_COOKIE_NAME } from "@/lib/session";

/**
 * Signs the current admin out.
 *
 * Deletes the session row server-side as well as the cookie: the whole point
 * of DB-backed sessions (rather than a self-contained JWT) is that a token
 * can be revoked, so dropping only the cookie would leave a still-valid
 * token behind for anyone who had captured it.
 */
export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await revokeSession(token);
  }

  cookieStore.delete(SESSION_COOKIE_NAME);

  redirect("/login");
}
