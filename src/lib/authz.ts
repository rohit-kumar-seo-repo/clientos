import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";

/**
 * Resolves a clientId to its owning client, scoped to the authenticated
 * admin's organization. Never throws for a missing/wrong-org id — callers
 * check `client === null`.
 *
 * Lives in a plain module (no "use server") deliberately: every export of
 * a "use server" file becomes an independently network-callable Server
 * Action. This is an authorization primitive, not an action in its own
 * right, and must never be reachable as one.
 */
export async function requireClientInOwnOrg(clientId: number) {
  const admin = await requireAdmin();
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: admin.organizationId },
  });
  return { admin, client };
}

/**
 * Resolves a clientServiceId to its owning client, scoped to the
 * authenticated admin's organization — the service-level counterpart to
 * requireClientInOwnOrg. Never throws for a missing/wrong-org id; callers
 * check `clientService === null`.
 */
export async function requireClientServiceInOwnOrg(clientServiceId: number) {
  const admin = await requireAdmin();
  const clientService = await prisma.clientService.findFirst({
    where: {
      id: clientServiceId,
      client: { organizationId: admin.organizationId },
    },
    include: { client: true },
  });
  return { admin, clientService };
}
