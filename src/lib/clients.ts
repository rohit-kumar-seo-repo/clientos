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
