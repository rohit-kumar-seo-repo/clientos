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

async function requireClientInOwnOrg(clientId: number) {
  const admin = await requireAdmin();
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: admin.organizationId },
  });
  return { admin, client };
}

export async function addContactAction(
  clientId: number,
  formData: FormData
): Promise<{ error: string } | { ok: true }> {
  const { client } = await requireClientInOwnOrg(clientId);
  if (!client) {
    return { error: "Client not found." };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Contact name is required." };
  }

  await prisma.clientContact.create({
    data: {
      clientId,
      name,
      role: optionalString(formData, "role"),
      phone: optionalString(formData, "phone"),
      email: optionalString(formData, "email"),
    },
  });

  await prisma.clientActivity.create({
    data: {
      clientId,
      eventType: "contact.added",
      summary: `Added contact ${name}.`,
    },
  });

  return { ok: true };
}

export async function removeContactAction(
  clientId: number,
  contactId: number
): Promise<{ ok: true }> {
  const { client } = await requireClientInOwnOrg(clientId);
  if (!client) {
    // Silently no-op rather than error: matches the existing deleteMany's
    // own "no-op on no match" semantics, and avoids leaking whether a
    // clientId exists at all to a caller who isn't authorized for it.
    return { ok: true };
  }

  await prisma.clientContact.deleteMany({ where: { id: contactId, clientId } });
  return { ok: true };
}

export async function addNoteAction(
  clientId: number,
  formData: FormData
): Promise<{ error: string } | { ok: true }> {
  const { admin, client } = await requireClientInOwnOrg(clientId);
  if (!client) {
    return { error: "Client not found." };
  }

  const body = String(formData.get("body") ?? "").trim();
  if (!body) {
    return { error: "Note cannot be empty." };
  }

  await prisma.clientNote.create({
    data: { clientId, authorAdminId: admin.id, body },
  });

  await prisma.clientActivity.create({
    data: {
      clientId,
      eventType: "note.added",
      summary: "Note added.",
    },
  });

  return { ok: true };
}
