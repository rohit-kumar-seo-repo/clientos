import { prisma } from "@/lib/db";
import type { Client, ClientStatus } from "@/generated/prisma/client";

export async function listClients(
  organizationId: number,
  opts?: { search?: string; status?: ClientStatus }
): Promise<Client[]> {
  return prisma.client.findMany({
    where: {
      organizationId,
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.search
        ? { businessName: { contains: opts.search } }
        : {}),
    },
    orderBy: { businessName: "asc" },
  });
}

export async function getClientById(organizationId: number, clientId: number) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId },
    include: {
      contacts: { orderBy: { isPrimary: "desc" } },
      notes: { orderBy: { createdAt: "desc" } },
      activity: { orderBy: { createdAt: "desc" } },
      services: {
        orderBy: { createdAt: "asc" },
        include: {
          serviceTemplate: true,
          serviceCategories: true,
          billingPlan: {
            include: {
              billingPeriods: { orderBy: { periodLabel: "desc" }, take: 1 },
            },
          },
        },
      },
    },
  });
  return client;
}

// I6: Takes organizationId as its first argument to follow this module's
// convention (listClients, getClientById both scope to organizationId in the
// query itself). Without the scope, correctness depended solely on the caller
// verifying ownership before calling — a guarantee held by statement ordering,
// not by the query. Adding it here makes the function safe to call from any
// future context without a prior ownership check.
export async function getPaymentHistoryForClient(organizationId: number, clientId: number) {
  return prisma.payment.findMany({
    where: { invoice: { clientId, client: { organizationId } } },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Returns all projects for a client, scoped to the org.
 * Milestones are ordered by sortOrder; add-ons by createdAt.
 * Paid status and paidAt come from the milestone/addon row — no payment
 * join needed here since status is stored on the obligation itself.
 */
export async function getProjectsForClient(organizationId: number, clientId: number) {
  return prisma.project.findMany({
    where: { clientId, client: { organizationId } },
    include: {
      milestones: { orderBy: { sortOrder: "asc" } },
      addOns: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
}
