"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/require-admin";
import { requireClientInOwnOrg } from "@/lib/authz";
import type { ClientStatus } from "@/generated/prisma/client";

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

  revalidatePath("/");
  revalidatePath("/clients");
  return { clientId: client.id };
}

// ---------------------------------------------------------------------------
// setClientStatusAction — Archive/Reactivate: the SAFE removal path
// ---------------------------------------------------------------------------

const VALID_CLIENT_STATUSES: ClientStatus[] = ["ACTIVE", "PAUSED", "CHURNED"];

/**
 * Sets a client's status without touching a single one of their records.
 * This is the recommended way to "remove" a client once they have financial
 * history — nothing is deleted, so Invoices/Payments/BillingPeriods/Projects
 * are all preserved exactly as-is. An archived (CHURNED) client still shows
 * up in Payments/reports; they're just no longer active work.
 */
export async function setClientStatusAction(
  clientId: number,
  status: ClientStatus
): Promise<{ error: string } | { ok: true }> {
  if (!Number.isInteger(clientId)) return { error: "Invalid client." };
  if (!VALID_CLIENT_STATUSES.includes(status)) return { error: "Invalid status." };

  const { client } = await requireClientInOwnOrg(clientId);
  if (!client) return { error: "Client not found." };

  if (client.status === status) return { ok: true }; // already there — no-op

  await prisma.$transaction(async (tx) => {
    await tx.client.update({ where: { id: clientId }, data: { status } });
    await tx.clientActivity.create({
      data: {
        clientId,
        eventType: "client.status_changed",
        summary: `Status changed from ${client.status} to ${status}.`,
      },
    });
  });

  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// deleteClientAction
// ---------------------------------------------------------------------------

/**
 * Deletes a client and all their records, provided no financial records
 * (payments) exist. If payments exist the operation is blocked — financial
 * history must be preserved. In that case, set the client status to CHURNED
 * to deactivate them instead.
 *
 * Cascade order (all in one transaction):
 *   1. reminder/notification side-tables
 *   2. billing-period + task rows (per service)
 *   3. billing plans + service categories + services
 *   4. projects (milestones + add-ons cascade via DB onDelete:Cascade)
 *   5. renewals, reminder rules, invoices (empty if no payments)
 *   6. activity, notes, contacts
 *   7. client row
 */
export async function deleteClientAction(
  clientId: number
): Promise<{ error: string; hasPayments?: boolean } | { ok: true }> {
  if (!Number.isInteger(clientId)) return { error: "Invalid client." };

  const { admin, client } = await requireClientInOwnOrg(clientId);
  if (!client) return { error: "Client not found." };

  // Block if any payments have been recorded for this client.
  const paymentCount = await prisma.invoiceLineItem.count({
    where: {
      OR: [
        { billingPeriod: { billingPlan: { clientService: { clientId } } } },
        { projectMilestone: { project: { clientId } } },
        { projectAddOn: { project: { clientId } } },
      ],
    },
  });

  if (paymentCount > 0) {
    return {
      error: `This client has ${paymentCount} payment record${paymentCount === 1 ? "" : "s"} that must be preserved. Permanent deletion is blocked to protect financial history. Set this client's status to CHURNED to deactivate them instead, or delete all payments first if this is test data.`,
      hasPayments: true,
    };
  }

  // Safe to cascade-delete. All records are deleted in dependency order so
  // no FK constraint fires mid-transaction.
  await prisma.$transaction(async (tx) => {
    const services = await tx.clientService.findMany({
      where: { clientId },
      select: { id: true },
    });
    const serviceIds = services.map((s) => s.id);

    const billingPlans = await tx.billingPlan.findMany({
      where: { clientServiceId: { in: serviceIds } },
      select: { id: true },
    });
    const billingPlanIds = billingPlans.map((p) => p.id);

    // Reminder side-tables (linked to billing periods or renewals)
    const reminderJobs = await tx.reminderJob.findMany({
      where: {
        OR: [
          { billingPeriod: { billingPlanId: { in: billingPlanIds } } },
          { renewal: { clientId } },
        ],
      },
      select: { id: true },
    });
    const reminderJobIds = reminderJobs.map((j) => j.id);
    if (reminderJobIds.length > 0) {
      await tx.notificationLog.deleteMany({ where: { reminderJobId: { in: reminderJobIds } } });
      await tx.reminderJob.deleteMany({ where: { id: { in: reminderJobIds } } });
    }

    // Billing periods and task instances
    await tx.billingPeriod.deleteMany({ where: { billingPlanId: { in: billingPlanIds } } });
    await tx.taskInstance.deleteMany({ where: { clientServiceId: { in: serviceIds } } });
    await tx.billingPlan.deleteMany({ where: { clientServiceId: { in: serviceIds } } });
    await tx.clientServiceCategory.deleteMany({ where: { clientServiceId: { in: serviceIds } } });
    await tx.clientService.deleteMany({ where: { clientId } });

    // Projects (ProjectMilestone and ProjectAddOn cascade via DB)
    await tx.project.deleteMany({ where: { clientId } });

    // Renewals and reminder rules
    await tx.renewal.deleteMany({ where: { clientId } });
    await tx.reminderRule.deleteMany({ where: { clientId } });

    // Invoices (empty because no payments, but delete for cleanliness)
    await tx.invoice.deleteMany({ where: { clientId } });

    // Client timeline and contacts
    await tx.clientActivity.deleteMany({ where: { clientId } });
    await tx.clientNote.deleteMany({ where: { clientId } });
    await tx.clientContact.deleteMany({ where: { clientId } });
    await tx.client.delete({ where: { id: clientId } });

    // Log the deletion to the admin's audit trail (org-level, not client-level)
    await tx.auditLog.create({
      data: {
        organizationId: admin.organizationId,
        adminUserId: admin.id,
        action: "client.deleted",
        entityType: "Client",
        entityId: String(clientId),
        metadata: { businessName: client.businessName },
      },
    });
  });

  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath("/calendar");
  revalidatePath("/payments");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// forceDeleteClientAction
// ---------------------------------------------------------------------------

/**
 * Like deleteClientAction but bypasses the payment-block by first deleting
 * all financial records (InvoiceLineItem → Payment → Invoice) before the
 * cascade. Intended only for test data cleanup.
 *
 * The deletion order respects FK constraints:
 *   1. Payments (reference Invoice)
 *   2. InvoiceLineItems (reference Invoice + billing/project rows)
 *   3. Invoices
 *   4. Then the same cascade order as deleteClientAction
 */
export async function forceDeleteClientAction(
  clientId: number
): Promise<{ error: string } | { ok: true }> {
  if (!Number.isInteger(clientId)) return { error: "Invalid client." };

  const { admin, client } = await requireClientInOwnOrg(clientId);
  if (!client) return { error: "Client not found." };

  await prisma.$transaction(async (tx) => {
    const services = await tx.clientService.findMany({
      where: { clientId },
      select: { id: true },
    });
    const serviceIds = services.map((s) => s.id);

    const billingPlans = await tx.billingPlan.findMany({
      where: { clientServiceId: { in: serviceIds } },
      select: { id: true },
    });
    const billingPlanIds = billingPlans.map((p) => p.id);

    // Collect all invoice ids for this client
    const invoices = await tx.invoice.findMany({
      where: { clientId },
      select: { id: true },
    });
    const invoiceIds = invoices.map((i) => i.id);

    // Delete payments first (they reference Invoice)
    if (invoiceIds.length > 0) {
      await tx.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      // Delete all line items (releases Restrict FKs on milestones/addons/periods)
      await tx.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }

    // Now proceed with the same cascade as deleteClientAction
    const reminderJobs = await tx.reminderJob.findMany({
      where: {
        OR: [
          { billingPeriod: { billingPlanId: { in: billingPlanIds } } },
          { renewal: { clientId } },
        ],
      },
      select: { id: true },
    });
    const reminderJobIds = reminderJobs.map((j) => j.id);
    if (reminderJobIds.length > 0) {
      await tx.notificationLog.deleteMany({ where: { reminderJobId: { in: reminderJobIds } } });
      await tx.reminderJob.deleteMany({ where: { id: { in: reminderJobIds } } });
    }

    await tx.billingPeriod.deleteMany({ where: { billingPlanId: { in: billingPlanIds } } });
    await tx.taskInstance.deleteMany({ where: { clientServiceId: { in: serviceIds } } });
    await tx.billingPlan.deleteMany({ where: { clientServiceId: { in: serviceIds } } });
    await tx.clientServiceCategory.deleteMany({ where: { clientServiceId: { in: serviceIds } } });
    await tx.clientService.deleteMany({ where: { clientId } });

    await tx.project.deleteMany({ where: { clientId } });

    await tx.renewal.deleteMany({ where: { clientId } });
    await tx.reminderRule.deleteMany({ where: { clientId } });

    await tx.clientActivity.deleteMany({ where: { clientId } });
    await tx.clientNote.deleteMany({ where: { clientId } });
    await tx.clientContact.deleteMany({ where: { clientId } });
    await tx.client.delete({ where: { id: clientId } });

    await tx.auditLog.create({
      data: {
        organizationId: admin.organizationId,
        adminUserId: admin.id,
        action: "client.force_deleted",
        entityType: "Client",
        entityId: String(clientId),
        metadata: { businessName: client.businessName },
      },
    });
  });

  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath("/calendar");
  revalidatePath("/payments");
  return { ok: true };
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

  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
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
