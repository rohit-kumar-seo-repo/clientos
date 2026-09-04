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
