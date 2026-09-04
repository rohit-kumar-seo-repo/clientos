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
    },
  });
  return client;
}
