import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateSession } from "@/lib/session";

const SESSION_COOKIE = "co_session";

export async function requireAdmin(): Promise<{
  id: number;
  email: string;
  organizationId: number;
}> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  const admin = token ? await validateSession(token) : null;
  if (!admin) {
    redirect("/login");
  }

  return admin;
}
