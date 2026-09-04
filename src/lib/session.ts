import { prisma } from "@/lib/db";
import { generateSessionToken } from "@/lib/auth";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function createSession(
  adminUserId: number
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.adminSession.create({
    data: { token, adminUserId, expiresAt },
  });

  return { token, expiresAt };
}

export async function validateSession(
  token: string
): Promise<{ id: number; email: string; organizationId: number } | null> {
  const session = await prisma.adminSession.findUnique({
    where: { token },
    include: { adminUser: true },
  });

  if (!session || session.expiresAt < new Date() || !session.adminUser.isActive) {
    return null;
  }

  // Use updateMany to avoid TOCTOU race: if revokeSession deletes the row between
  // the read and this write, updateMany silently updates 0 rows instead of throwing.
  await prisma.adminSession.updateMany({
    where: { token },
    data: { lastSeenAt: new Date() },
  });

  return {
    id: session.adminUser.id,
    email: session.adminUser.email,
    organizationId: session.adminUser.organizationId,
  };
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.adminSession.deleteMany({ where: { token } });
}
