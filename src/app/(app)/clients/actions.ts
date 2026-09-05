"use server";

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";

export async function createClientAction(
  formData: FormData
): Promise<{ error: string } | { clientId: number }> {
  const admin = await requireAdmin();

  const businessName = String(formData.get("businessName") ?? "").trim();
  if (!businessName) {
    return { error: "Business name is required." };
  }

  const contactPerson = optionalString(formData, "contactPerson");
  const phone = optionalString(formData, "phone");
  const email = optionalString(formData, "email");
  const website = optionalString(formData, "website");
  const industry = optionalString(formData, "industry");
  const location = optionalString(formData, "location");

  const client = await prisma.client.create({
    data: {
      organizationId: admin.organizationId,
      businessName,
      contactPerson,
      phone,
      email,
      website,
      industry,
      location,
    },
  });

  await prisma.clientActivity.create({
    data: {
      clientId: client.id,
      eventType: "client.created",
      summary: `${businessName} added as a client.`,
    },
  });

  return { clientId: client.id };
}

function optionalString(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value.length > 0 ? value : null;
}

const EDITABLE_FIELDS = [
  "businessName",
  "contactPerson",
  "phone",
  "email",
  "website",
  "industry",
  "location",
] as const;

export async function updateClientAction(
  clientId: number,
  formData: FormData
): Promise<{ error: string } | { ok: true }> {
  const admin = await requireAdmin();

  const existing = await prisma.client.findFirst({
    where: { id: clientId, organizationId: admin.organizationId },
  });
  if (!existing) {
    return { error: "Client not found." };
  }

  const businessName = String(formData.get("businessName") ?? "").trim();
  if (!businessName) {
    return { error: "Business name is required." };
  }

  const nextValues: Record<string, string | null> = { businessName };
  for (const field of EDITABLE_FIELDS) {
    if (field === "businessName") continue;
    nextValues[field] = optionalString(formData, field);
  }

  const changedFields = EDITABLE_FIELDS.filter(
    (field) => nextValues[field] !== (existing[field] ?? null)
  );

  await prisma.client.update({ where: { id: clientId }, data: nextValues });

  if (changedFields.length > 0) {
    await prisma.clientActivity.create({
      data: {
        clientId,
        eventType: "client.updated",
        summary: `Updated: ${changedFields.join(", ")}.`,
      },
    });
  }

  return { ok: true };
}
