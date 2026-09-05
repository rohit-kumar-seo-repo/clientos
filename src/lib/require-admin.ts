import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateSession, SESSION_COOKIE_NAME } from "@/lib/session";

export async function requireAdmin(): Promise<{
  id: number;
  email: string;
  organizationId: number;
}> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  const admin = token ? await validateSession(token) : null;
  if (!admin) {
    redirect("/login");
  }

  return admin;
}
