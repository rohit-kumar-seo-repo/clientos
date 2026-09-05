"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";

/**
 * Maximum lengths for every bounded string column these actions write,
 * mirroring the `@db.VarChar(n)` annotations in prisma/schema.prisma.
 *
 * These are validated in the app rather than left to the database because
 * MySQL runs in strict mode here: an over-length value raises a driver error
 * (an unhandled 500 for the user) instead of silently truncating. A perfectly
 * ordinary input — a phone number written as "+91 98765 43210" is 16
 * characters against a 20-char column, but a longer one with an extension
 * overflows — should come back as a readable field error, not a crash.
 *
 * `ClientNote.body` is `@db.Text`, so it has no practical limit and is
 * deliberately absent from this table.
 */
type LengthLimit = { field: string; label: string; max: number };

const CLIENT_LIMITS: LengthLimit[] = [
  { field: "businessName", label: "Business name", max: 150 },
  { field: "contactPerson", label: "Contact person", max: 120 },
  { field: "phone", label: "Phone", max: 20 },
  { field: "email", label: "Email", max: 191 },
  { field: "website", label: "Website", max: 255 },
  { field: "industry", label: "Industry", max: 100 },
  { field: "location", label: "Location", max: 150 },
];

const CONTACT_LIMITS: LengthLimit[] = [
  { field: "name", label: "Contact name", max: 120 },
  { field: "role", label: "Role", max: 80 },
  { field: "phone", label: "Phone", max: 20 },
  { field: "email", label: "Email", max: 191 },
];

/**
 * Returns the first over-length field's error message, or null if every
 * value fits. Callers must check this BEFORE issuing any Prisma write.
 */
function findLengthError(
  values: Record<string, string | null>,
  limits: LengthLimit[]
): string | null {
  for (const { field, label, max } of limits) {
    const value = values[field];
    if (value && value.length > max) {
      return `${label} is too long (max ${max} characters).`;
    }
  }
  return null;
}

export async function createClientAction(
  formData: FormData
): Promise<{ error: string } | { clientId: number }> {
  const admin = await requireAdmin();

  const businessName = String(formData.get("businessName") ?? "").trim();
  if (!businessName) {
    return { error: "Business name is required." };
  }

  const values = {
    businessName,
    contactPerson: optionalString(formData, "contactPerson"),
    phone: optionalString(formData, "phone"),
    email: optionalString(formData, "email"),
    website: optionalString(formData, "website"),
    industry: optionalString(formData, "industry"),
    location: optionalString(formData, "location"),
  };

  const lengthError = findLengthError(values, CLIENT_LIMITS);
  if (lengthError) {
    return { error: lengthError };
  }

  // The client row and its activity row are written together: without the
  // transaction, a failure between the two `create` calls would leave a
  // client with no "created" entry in its own timeline.
  const client = await prisma.$transaction(async (tx) => {
    const created = await tx.client.create({
      data: { organizationId: admin.organizationId, ...values },
    });

    await tx.clientActivity.create({
      data: {
        clientId: created.id,
        eventType: "client.created",
        summary: `${businessName} added as a client.`,
      },
    });

    return created;
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
  const { admin, client: existing } = await requireClientInOwnOrg(clientId);
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

  const lengthError = findLengthError(nextValues, CLIENT_LIMITS);
  if (lengthError) {
    return { error: lengthError };
  }

  const changedFields = EDITABLE_FIELDS.filter(
    (field) => nextValues[field] !== (existing[field] ?? null)
  );

  // `updateMany` (not `update`) so the organizationId predicate rides along
  // with the write itself. The `findFirst` above is still the "Client not
  // found" UX check and the source of the field diff, but it is a separate
  // query from this one — keying the write on `id` alone would leave a
  // check-then-act window in which the client could move organizations
  // between the two. `updateMany` closes it by matching 0 rows instead.
  await prisma.client.updateMany({
    where: { id: clientId, organizationId: admin.organizationId },
    data: nextValues,
  });

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

export async function requireClientInOwnOrg(clientId: number) {
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

  const values = {
    name,
    role: optionalString(formData, "role"),
    phone: optionalString(formData, "phone"),
    email: optionalString(formData, "email"),
  };

  const lengthError = findLengthError(values, CONTACT_LIMITS);
  if (lengthError) {
    return { error: lengthError };
  }

  // Contact + activity row written together — see createClientAction.
  await prisma.$transaction(async (tx) => {
    const contact = await tx.clientContact.create({
      data: { clientId, ...values },
    });

    await tx.clientActivity.create({
      data: {
        clientId: contact.clientId,
        eventType: "contact.added",
        summary: `Added contact ${name}.`,
      },
    });
  });

  revalidatePath(`/clients/${clientId}`);
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

  revalidatePath(`/clients/${clientId}`);
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

  // Note + activity row written together — see createClientAction.
  await prisma.$transaction(async (tx) => {
    const note = await tx.clientNote.create({
      data: { clientId, authorAdminId: admin.id, body },
    });

    await tx.clientActivity.create({
      data: {
        clientId: note.clientId,
        eventType: "note.added",
        summary: "Note added.",
      },
    });
  });

  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}
