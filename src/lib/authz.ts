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

/**
 * Resolves a projectId to its owning project + client, scoped to the
 * authenticated admin's organization. Never throws; callers check
 * `project === null`.
 */
export async function requireProjectInOwnOrg(projectId: number) {
  const admin = await requireAdmin();
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      client: { organizationId: admin.organizationId },
    },
    include: { client: true },
  });
  return { admin, project };
}

/**
 * Resolves a milestoneId → project → client, scoped to the org.
 * Returns the milestone with its parent project (and client) if found.
 */
export async function requireMilestoneInOwnOrg(milestoneId: number) {
  const admin = await requireAdmin();
  const milestone = await prisma.projectMilestone.findFirst({
    where: {
      id: milestoneId,
      project: { client: { organizationId: admin.organizationId } },
    },
    include: { project: { include: { client: true } } },
  });
  return { admin, milestone };
}

/**
 * Resolves an addOnId → project → client, scoped to the org.
 */
export async function requireAddOnInOwnOrg(addOnId: number) {
  const admin = await requireAdmin();
  const addOn = await prisma.projectAddOn.findFirst({
    where: {
      id: addOnId,
      project: { client: { organizationId: admin.organizationId } },
    },
    include: { project: { include: { client: true } } },
  });
  return { admin, addOn };
}

/**
 * Resolves a paymentLinkId to its owning client, scoped to the org — the
 * payment-link counterpart to requireClientInOwnOrg. Never throws for a
 * missing/wrong-org id; callers check `paymentLink === null`.
 */
export async function requirePaymentLinkInOwnOrg(paymentLinkId: number) {
  const admin = await requireAdmin();
  const paymentLink = await prisma.paymentLink.findFirst({
    where: {
      id: paymentLinkId,
      organizationId: admin.organizationId,
    },
    include: { client: true },
  });
  return { admin, paymentLink };
}
