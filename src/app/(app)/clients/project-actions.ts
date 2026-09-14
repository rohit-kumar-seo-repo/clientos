"use server";

import { prisma } from "@/lib/db";
import { requireClientInOwnOrg, requireProjectInOwnOrg, requireMilestoneInOwnOrg, requireAddOnInOwnOrg } from "@/lib/authz";
import { markMilestonePaid, markAddOnPaid, MAX_PROJECT_AMOUNT_IN_PAISE } from "@/lib/project-payments";
import { Prisma, ProjectStatus } from "@/generated/prisma/client";

// ₹1,00,00,000 in paise — same ceiling as service-actions.ts
const MAX_AMOUNT = MAX_PROJECT_AMOUNT_IN_PAISE;

const VALID_STATUSES: ProjectStatus[] = Object.values(ProjectStatus);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseRupees(raw: FormDataEntryValue | null): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalDate(raw: FormDataEntryValue | null): Date | null {
  if (!raw) return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// createProjectAction
// ---------------------------------------------------------------------------

/**
 * Creates a one-time Project for the given client.
 *
 * If defaultMilestones is true (the default) the action also creates two
 * 50/50 milestones: "50% Advance" (sortOrder 0) and "50% on Completion"
 * (sortOrder 1). The amounts are rounded so they always sum to the base
 * amount even with odd-paise bases.
 */
export async function createProjectAction(
  clientId: number,
  formData: FormData
): Promise<{ error: string } | { projectId: number }> {
  if (!Number.isInteger(clientId)) return { error: "Invalid client." };

  const { admin, client } = await requireClientInOwnOrg(clientId);
  if (!client) return { error: "Client not found." };

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Project title is required." };
  if (title.length > 200) return { error: "Title must be 200 characters or fewer." };

  const baseAmountRupees = parseRupees(formData.get("baseAmountInRupees"));
  if (baseAmountRupees === null || baseAmountRupees <= 0) {
    return { error: "Base amount must be greater than zero." };
  }
  const baseAmountInPaise = Math.round(baseAmountRupees * 100);
  if (baseAmountInPaise > MAX_AMOUNT) {
    return { error: "Amount must be ₹1,00,00,000 or less." };
  }

  const description = String(formData.get("description") ?? "").trim() || null;
  const startDate = parseOptionalDate(formData.get("startDate"));
  const endDate = parseOptionalDate(formData.get("endDate"));
  if (startDate && endDate && endDate <= startDate) {
    return { error: "End date must be after start date." };
  }

  const withDefaultMilestones = formData.get("defaultMilestones") !== "false";

  const project = await prisma.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: {
        clientId,
        title,
        description,
        baseAmountInPaise,
        startDate,
        endDate,
      },
    });

    if (withDefaultMilestones) {
      const half = Math.floor(baseAmountInPaise / 2);
      const remainder = baseAmountInPaise - half; // absorbs odd-paise rounding
      await tx.projectMilestone.createMany({
        data: [
          { projectId: p.id, label: "50% Advance", amountInPaise: half, sortOrder: 0 },
          { projectId: p.id, label: "50% on Completion", amountInPaise: remainder, sortOrder: 1 },
        ],
      });
    }

    await tx.clientActivity.create({
      data: {
        clientId,
        actorAdminId: admin.id,
        eventType: "project.created",
        summary: `Project "${title}" created (₹${baseAmountRupees.toLocaleString("en-IN")}).`,
      },
    });

    return p;
  });

  return { projectId: project.id };
}

// ---------------------------------------------------------------------------
// updateProjectAction
// ---------------------------------------------------------------------------

export async function updateProjectAction(
  projectId: number,
  formData: FormData
): Promise<{ error: string } | { ok: true }> {
  if (!Number.isInteger(projectId)) return { error: "Invalid project." };

  const { admin, project } = await requireProjectInOwnOrg(projectId);
  if (!project) return { error: "Project not found." };

  const title = String(formData.get("title") ?? "").trim();
  if (title && title.length > 200) return { error: "Title must be 200 characters or fewer." };

  const statusRaw = formData.get("status");
  const status = statusRaw ? String(statusRaw) as ProjectStatus : undefined;
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return { error: "Invalid project status." };
  }

  const startDate = parseOptionalDate(formData.get("startDate"));
  const endDate = parseOptionalDate(formData.get("endDate"));
  if (startDate && endDate && endDate <= startDate) {
    return { error: "End date must be after start date." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: projectId },
      data: {
        ...(title ? { title } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(formData.has("description") ? { description: String(formData.get("description") ?? "").trim() || null } : {}),
        ...(formData.has("workNote") ? { workNote: String(formData.get("workNote") ?? "").trim() || null } : {}),
        ...(formData.has("nextActionNote") ? { nextActionNote: String(formData.get("nextActionNote") ?? "").trim() || null } : {}),
        ...(formData.has("nextActionDate") ? { nextActionDate: parseOptionalDate(formData.get("nextActionDate")) } : {}),
        ...(formData.has("startDate") ? { startDate } : {}),
        ...(formData.has("endDate") ? { endDate } : {}),
      },
    });

    await tx.clientActivity.create({
      data: {
        clientId: project.clientId,
        actorAdminId: admin.id,
        eventType: "project.updated",
        summary: `Project "${project.title}" updated${status ? ` → ${status}` : ""}.`,
      },
    });
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// addMilestoneAction
// ---------------------------------------------------------------------------

export async function addMilestoneAction(
  projectId: number,
  formData: FormData
): Promise<{ error: string } | { milestoneId: number }> {
  if (!Number.isInteger(projectId)) return { error: "Invalid project." };

  const { admin, project } = await requireProjectInOwnOrg(projectId);
  if (!project) return { error: "Project not found." };

  // Do not add new obligations to cancelled projects.
  if (project.status === "CANCELLED") {
    return { error: "Cannot add milestones to a cancelled project." };
  }

  const label = String(formData.get("label") ?? "").trim();
  if (!label) return { error: "Milestone label is required." };
  if (label.length > 150) return { error: "Label must be 150 characters or fewer." };

  const amountRupees = parseRupees(formData.get("amountInRupees"));
  if (amountRupees === null || amountRupees <= 0) {
    return { error: "Amount must be greater than zero." };
  }
  const amountInPaise = Math.round(amountRupees * 100);
  if (amountInPaise > MAX_AMOUNT) {
    return { error: "Amount must be ₹1,00,00,000 or less." };
  }

  const dueDate = parseOptionalDate(formData.get("dueDate"));

  // sortOrder = current max + 1 so new milestones always appear last.
  const maxSort = await prisma.projectMilestone.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

  const milestone = await prisma.$transaction(async (tx) => {
    const m = await tx.projectMilestone.create({
      data: { projectId, label, amountInPaise, dueDate, sortOrder },
    });
    await tx.clientActivity.create({
      data: {
        clientId: project.clientId,
        actorAdminId: admin.id,
        eventType: "project.milestone.added",
        summary: `Milestone "${label}" (₹${amountRupees.toLocaleString("en-IN")}) added to "${project.title}".`,
      },
    });
    return m;
  });

  return { milestoneId: milestone.id };
}

// ---------------------------------------------------------------------------
// addAddOnAction
// ---------------------------------------------------------------------------

export async function addAddOnAction(
  projectId: number,
  formData: FormData
): Promise<{ error: string } | { addOnId: number }> {
  if (!Number.isInteger(projectId)) return { error: "Invalid project." };

  const { admin, project } = await requireProjectInOwnOrg(projectId);
  if (!project) return { error: "Project not found." };

  if (project.status === "CANCELLED") {
    return { error: "Cannot add charges to a cancelled project." };
  }

  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { error: "Add-on description is required." };
  if (description.length > 255) return { error: "Description must be 255 characters or fewer." };

  const amountRupees = parseRupees(formData.get("amountInRupees"));
  if (amountRupees === null || amountRupees <= 0) {
    return { error: "Amount must be greater than zero." };
  }
  const amountInPaise = Math.round(amountRupees * 100);
  if (amountInPaise > MAX_AMOUNT) {
    return { error: "Amount must be ₹1,00,00,000 or less." };
  }

  const dueDate = parseOptionalDate(formData.get("dueDate"));
  const note = String(formData.get("note") ?? "").trim() || null;

  const addOn = await prisma.$transaction(async (tx) => {
    const a = await tx.projectAddOn.create({
      data: { projectId, description, amountInPaise, dueDate, note },
    });
    await tx.clientActivity.create({
      data: {
        clientId: project.clientId,
        actorAdminId: admin.id,
        eventType: "project.addon.added",
        summary: `Add-on "${description}" (₹${amountRupees.toLocaleString("en-IN")}) added to "${project.title}".`,
      },
    });
    return a;
  });

  return { addOnId: addOn.id };
}

// ---------------------------------------------------------------------------
// updateMilestoneAction
// ---------------------------------------------------------------------------

/**
 * Edits a project milestone.
 *
 * UNPAID milestones: label, amount, and dueDate are all editable.
 * PAID milestones: only label and dueDate can change — the amount is locked
 * because an InvoiceLineItem already records that exact figure against a
 * Payment. Changing it would create a discrepancy between the milestone and
 * its historical payment record.
 */
export async function updateMilestoneAction(
  milestoneId: number,
  formData: FormData
): Promise<{ error: string } | { ok: true }> {
  if (!Number.isInteger(milestoneId)) return { error: "Milestone not found." };

  const { admin, milestone } = await requireMilestoneInOwnOrg(milestoneId);
  if (!milestone) return { error: "Milestone not found." };

  const isPaid = milestone.status === "PAID";

  const label = String(formData.get("label") ?? "").trim();
  if (label.length > 150) return { error: "Label must be 150 characters or fewer." };

  // Paid milestones: reject any attempt to change the amount
  if (isPaid && formData.has("amountInRupees")) {
    const submitted = parseRupees(formData.get("amountInRupees"));
    const current = milestone.amountInPaise / 100;
    if (submitted !== null && Math.round(submitted * 100) !== milestone.amountInPaise) {
      return { error: `Cannot change the amount of a paid milestone (currently ₹${current.toLocaleString("en-IN")}). The payment record must be preserved.` };
    }
  }

  let amountInPaise: number | undefined;
  if (!isPaid && formData.has("amountInRupees")) {
    const amountRupees = parseRupees(formData.get("amountInRupees"));
    if (amountRupees === null || amountRupees <= 0) {
      return { error: "Amount must be greater than zero." };
    }
    amountInPaise = Math.round(amountRupees * 100);
    if (amountInPaise > MAX_AMOUNT) {
      return { error: "Amount must be ₹1,00,00,000 or less." };
    }
  }

  const dueDate = formData.has("dueDate")
    ? parseOptionalDate(formData.get("dueDate"))
    : undefined;

  await prisma.$transaction(async (tx) => {
    await tx.projectMilestone.update({
      where: { id: milestoneId },
      data: {
        ...(label ? { label } : {}),
        ...(amountInPaise !== undefined ? { amountInPaise } : {}),
        ...(formData.has("dueDate") ? { dueDate } : {}),
      },
    });
    await tx.clientActivity.create({
      data: {
        clientId: milestone.project.clientId,
        actorAdminId: admin.id,
        eventType: "project.updated",
        summary: `Milestone "${label || milestone.label}" updated.`,
      },
    });
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// deleteMilestoneAction
// ---------------------------------------------------------------------------

/**
 * Deletes a PENDING milestone.
 *
 * A PAID milestone cannot be deleted — its InvoiceLineItem and Payment
 * records are financial history that must be preserved.
 */
export async function deleteMilestoneAction(
  milestoneId: number
): Promise<{ error: string } | { ok: true }> {
  if (!Number.isInteger(milestoneId)) return { error: "Milestone not found." };

  const { admin, milestone } = await requireMilestoneInOwnOrg(milestoneId);
  if (!milestone) return { error: "Milestone not found." };

  if (milestone.status === "PAID") {
    return { error: "Cannot delete a paid milestone — its payment record must be preserved." };
  }

  // Verify no InvoiceLineItem references this milestone (should be impossible
  // for a PENDING milestone, but guard explicitly to be safe).
  const lineItem = await prisma.invoiceLineItem.findFirst({
    where: { projectMilestoneId: milestoneId },
  });
  if (lineItem) {
    return { error: "This milestone has an associated payment record and cannot be deleted." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.projectMilestone.delete({ where: { id: milestoneId } });
    await tx.clientActivity.create({
      data: {
        clientId: milestone.project.clientId,
        actorAdminId: admin.id,
        eventType: "project.updated",
        summary: `Milestone "${milestone.label}" deleted from "${milestone.project.title}".`,
      },
    });
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// markMilestonePaidAction
// ---------------------------------------------------------------------------

export async function markMilestonePaidAction(
  milestoneId: number,
  formData: FormData
): Promise<{ error: string } | { ok: true }> {
  if (!Number.isInteger(milestoneId)) return { error: "Milestone not found." };

  const { admin, milestone } = await requireMilestoneInOwnOrg(milestoneId);
  if (!milestone) return { error: "Milestone not found." };

  const paidAt = parseOptionalDate(formData.get("paidAt")) ?? new Date();

  let result;
  try {
    result = await markMilestonePaid({
      milestoneId,
      paidAt,
      recordedByAdminId: admin.id,
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === "P2002" || err.code === "P2034")
    ) {
      return { error: "This payment has already been recorded." };
    }
    throw err;
  }

  if ("error" in result) {
    return { error: "This payment has already been recorded." };
  }

  const amountInRupees = milestone.amountInPaise / 100;
  await prisma.clientActivity.create({
    data: {
      clientId: milestone.project.clientId,
      actorAdminId: admin.id,
      eventType: "payment.recorded",
      summary: `Milestone "${milestone.label}" paid — ₹${amountInRupees.toLocaleString("en-IN")} for "${milestone.project.title}".`,
    },
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// markAddOnPaidAction
// ---------------------------------------------------------------------------

export async function markAddOnPaidAction(
  addOnId: number,
  formData: FormData
): Promise<{ error: string } | { ok: true }> {
  if (!Number.isInteger(addOnId)) return { error: "Add-on not found." };

  const { admin, addOn } = await requireAddOnInOwnOrg(addOnId);
  if (!addOn) return { error: "Add-on not found." };

  const paidAt = parseOptionalDate(formData.get("paidAt")) ?? new Date();

  let result;
  try {
    result = await markAddOnPaid({
      addOnId,
      paidAt,
      recordedByAdminId: admin.id,
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === "P2002" || err.code === "P2034")
    ) {
      return { error: "This payment has already been recorded." };
    }
    throw err;
  }

  if ("error" in result) {
    return { error: "This payment has already been recorded." };
  }

  const amountInRupees = addOn.amountInPaise / 100;
  await prisma.clientActivity.create({
    data: {
      clientId: addOn.project.clientId,
      actorAdminId: admin.id,
      eventType: "payment.recorded",
      summary: `Add-on "${addOn.description}" paid — ₹${amountInRupees.toLocaleString("en-IN")} for "${addOn.project.title}".`,
    },
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// recordProjectPaymentAction
// ---------------------------------------------------------------------------

/**
 * Records an ad-hoc payment against a project.
 *
 * Unlike addMilestoneAction + markMilestonePaidAction (two-step flow),
 * this creates a milestone and immediately marks it PAID in a single
 * transaction. Use this when the client has already paid — you're
 * recording money that already arrived.
 *
 * The balance shown on the project is:
 *   baseAmountInPaise − sum(paid milestones) − sum(paid add-ons)
 */
export async function recordProjectPaymentAction(
  projectId: number,
  formData: FormData
): Promise<{ error: string } | { ok: true }> {
  if (!Number.isInteger(projectId)) return { error: "Invalid project." };

  const { admin, project } = await requireProjectInOwnOrg(projectId);
  if (!project) return { error: "Project not found." };

  if (project.status === "CANCELLED") {
    return { error: "Cannot record payments on a cancelled project." };
  }

  const label = String(formData.get("label") ?? "").trim() || "Payment";
  if (label.length > 150) return { error: "Label must be 150 characters or fewer." };

  const amountRupees = parseRupees(formData.get("amountInRupees"));
  if (amountRupees === null || amountRupees <= 0) {
    return { error: "Amount must be greater than zero." };
  }
  const amountInPaise = Math.round(amountRupees * 100);
  if (amountInPaise > MAX_AMOUNT) {
    return { error: "Amount must be ₹1,00,00,000 or less." };
  }

  const paidAt = parseOptionalDate(formData.get("paidAt")) ?? new Date();

  // sortOrder = current max + 1 so this appears last in the list
  const maxSort = await prisma.projectMilestone.aggregate({
    where: { projectId },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

  // Create the milestone then immediately mark it paid (two sequential
  // transactions). The milestone is briefly PENDING between the two, but
  // since it was just created only this call knows about it — no race.
  const milestone = await prisma.projectMilestone.create({
    data: {
      projectId,
      label,
      amountInPaise,
      sortOrder,
      // dueDate = paidAt so the payment lands in the correct month on dashboard
      dueDate: paidAt,
    },
  });

  const result = await markMilestonePaid({
    milestoneId: milestone.id,
    paidAt,
    recordedByAdminId: admin.id,
  });

  if ("error" in result) {
    return { error: "Failed to record payment. Please try again." };
  }

  await prisma.clientActivity.create({
    data: {
      clientId: project.clientId,
      actorAdminId: admin.id,
      eventType: "payment.recorded",
      summary: `Payment "${label}" — ₹${amountRupees.toLocaleString("en-IN")} received for "${project.title}".`,
    },
  });

  return { ok: true };
}
