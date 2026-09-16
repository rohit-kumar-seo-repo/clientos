import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";

vi.mock("@/lib/require-admin", () => ({
  requireAdmin: vi.fn(),
}));

// `revalidatePath` reads Next's per-request store and throws when called
// outside a request scope, which is exactly where these unit tests run.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { requireAdmin } from "@/lib/require-admin";
import {
  createProjectAction,
  updateProjectAction,
  addMilestoneAction,
  addAddOnAction,
  markMilestonePaidAction,
  markAddOnPaidAction,
  updateMilestoneAction,
  deleteMilestoneAction,
} from "@/app/(app)/clients/project-actions";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function mockAdmin(organizationId: number, adminId: number) {
  vi.mocked(requireAdmin).mockResolvedValue({
    id: adminId,
    email: "admin@example.com",
    organizationId,
  });
}

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function setup() {
  await resetDb();
  vi.clearAllMocks();
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  const admin = await prisma.adminUser.create({
    data: { organizationId: org.id, email: "admin@example.com", passwordHash: "x" },
  });
  const client = await prisma.client.create({
    data: { organizationId: org.id, businessName: "Acme Corp" },
  });
  mockAdmin(org.id, admin.id);
  return { org, admin, client };
}

// ---------------------------------------------------------------------------
// createProjectAction
// ---------------------------------------------------------------------------

describe("createProjectAction", () => {
  it("creates a project and returns projectId", async () => {
    const { client } = await setup();
    const result = await createProjectAction(
      client.id,
      form({ title: "Website Redesign", baseAmountInRupees: "30000" })
    );
    expect("projectId" in result).toBe(true);
    const p = await prisma.project.findUniqueOrThrow({
      where: { id: (result as { projectId: number }).projectId },
    });
    expect(p.baseAmountInPaise).toBe(3_000_000);
    expect(p.status).toBe("NOT_STARTED");
  });

  it("creates two default 50/50 milestones by default", async () => {
    const { client } = await setup();
    const result = await createProjectAction(
      client.id,
      form({ title: "SEO Package", baseAmountInRupees: "10000" })
    );
    const { projectId } = result as { projectId: number };
    const milestones = await prisma.projectMilestone.findMany({
      where: { projectId },
      orderBy: { sortOrder: "asc" },
    });
    expect(milestones).toHaveLength(2);
    expect(milestones[0].label).toBe("50% Advance");
    expect(milestones[0].amountInPaise).toBe(500_000);
    expect(milestones[1].label).toBe("50% on Completion");
    expect(milestones[1].amountInPaise).toBe(500_000);
    // Together they must equal the base amount — odd-paise safety
    expect(milestones[0].amountInPaise + milestones[1].amountInPaise).toBe(1_000_000);
  });

  it("milestone amounts sum to base even for odd-paise amounts", async () => {
    const { client } = await setup();
    // ₹10001 → 1,000,100 paise. floor(1000100/2) = 500050 + 500050 = 1000100 ✓
    // Actually 1000100 / 2 = 500050 exactly — use ₹10001.01 for a true odd case
    const result = await createProjectAction(
      client.id,
      form({ title: "Odd Amount", baseAmountInRupees: "10001.01" })
    );
    const { projectId } = result as { projectId: number };
    const ms = await prisma.projectMilestone.findMany({ where: { projectId } });
    const base = (await prisma.project.findUniqueOrThrow({ where: { id: projectId } })).baseAmountInPaise;
    const sum = ms.reduce((t, m) => t + m.amountInPaise, 0);
    expect(sum).toBe(base);
  });

  it("skips default milestones when defaultMilestones=false", async () => {
    const { client } = await setup();
    const result = await createProjectAction(
      client.id,
      form({ title: "No Milestones", baseAmountInRupees: "5000", defaultMilestones: "false" })
    );
    const { projectId } = result as { projectId: number };
    const ms = await prisma.projectMilestone.findMany({ where: { projectId } });
    expect(ms).toHaveLength(0);
  });

  it("writes a project.created activity row", async () => {
    const { client } = await setup();
    await createProjectAction(
      client.id,
      form({ title: "Activity Test", baseAmountInRupees: "1000" })
    );
    const act = await prisma.clientActivity.findFirst({
      where: { clientId: client.id, eventType: "project.created" },
    });
    expect(act).not.toBeNull();
    expect(act?.summary).toContain("Activity Test");
  });

  it("rejects a wrong-org clientId", async () => {
    await setup();
    // Create a second org and client; mock remains scoped to first org
    const org2 = await prisma.organization.create({ data: { name: "Other Org" } });
    const client2 = await prisma.client.create({
      data: { organizationId: org2.id, businessName: "Other Client" },
    });
    const result = await createProjectAction(
      client2.id,
      form({ title: "Sneaky Project", baseAmountInRupees: "1000" })
    );
    expect("error" in result).toBe(true);
  });

  it("rejects a zero or negative amount", async () => {
    const { client } = await setup();
    const r1 = await createProjectAction(client.id, form({ title: "T", baseAmountInRupees: "0" }));
    expect("error" in r1).toBe(true);
    const r2 = await createProjectAction(client.id, form({ title: "T", baseAmountInRupees: "-500" }));
    expect("error" in r2).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addMilestoneAction
// ---------------------------------------------------------------------------

describe("addMilestoneAction", () => {
  async function setupWithProject() {
    const { admin, client, org } = await setup();
    const project = await prisma.project.create({
      data: { clientId: client.id, title: "Test Project", baseAmountInPaise: 1_000_000 },
    });
    return { admin, client, org, project };
  }

  it("adds a milestone to a project", async () => {
    const { project } = await setupWithProject();
    const result = await addMilestoneAction(
      project.id,
      form({ label: "Phase 1", amountInRupees: "5000" })
    );
    expect("milestoneId" in result).toBe(true);
    const m = await prisma.projectMilestone.findUniqueOrThrow({
      where: { id: (result as { milestoneId: number }).milestoneId },
    });
    expect(m.amountInPaise).toBe(500_000);
    expect(m.status).toBe("PENDING");
  });

  it("rejects milestone on a CANCELLED project", async () => {
    const { project } = await setupWithProject();
    await prisma.project.update({ where: { id: project.id }, data: { status: "CANCELLED" } });
    const result = await addMilestoneAction(
      project.id,
      form({ label: "Phase 2", amountInRupees: "1000" })
    );
    expect("error" in result).toBe(true);
    expect((result as { error: string }).error).toMatch(/cancelled/i);
  });

  it("rejects wrong-org projectId", async () => {
    await setupWithProject();
    const org2 = await prisma.organization.create({ data: { name: "Org 2" } });
    const c2 = await prisma.client.create({ data: { organizationId: org2.id, businessName: "C2" } });
    const p2 = await prisma.project.create({ data: { clientId: c2.id, title: "P2", baseAmountInPaise: 100 } });
    const result = await addMilestoneAction(p2.id, form({ label: "X", amountInRupees: "100" }));
    expect("error" in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addAddOnAction
// ---------------------------------------------------------------------------

describe("addAddOnAction", () => {
  async function setupWithProject() {
    const { client } = await setup();
    const project = await prisma.project.create({
      data: { clientId: client.id, title: "Test Project", baseAmountInPaise: 1_000_000 },
    });
    return { client, project };
  }

  it("adds an add-on to a project", async () => {
    const { project } = await setupWithProject();
    const result = await addAddOnAction(
      project.id,
      form({ description: "Extra Landing Page", amountInRupees: "3000" })
    );
    expect("addOnId" in result).toBe(true);
    const a = await prisma.projectAddOn.findUniqueOrThrow({
      where: { id: (result as { addOnId: number }).addOnId },
    });
    expect(a.amountInPaise).toBe(300_000);
    expect(a.status).toBe("PENDING");
  });

  it("rejects add-on on a CANCELLED project", async () => {
    const { project } = await setupWithProject();
    await prisma.project.update({ where: { id: project.id }, data: { status: "CANCELLED" } });
    const result = await addAddOnAction(
      project.id,
      form({ description: "X", amountInRupees: "1000" })
    );
    expect("error" in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// markMilestonePaidAction
// ---------------------------------------------------------------------------

describe("markMilestonePaidAction", () => {
  async function setupWithMilestone(amountInPaise = 500_000) {
    const { admin, client } = await setup();
    const project = await prisma.project.create({
      data: { clientId: client.id, title: "Milestone Project", baseAmountInPaise: 1_000_000 },
    });
    const milestone = await prisma.projectMilestone.create({
      data: { projectId: project.id, label: "50% Advance", amountInPaise, sortOrder: 0 },
    });
    return { admin, client, project, milestone };
  }

  it("creates an invoice, line item, and captured payment", async () => {
    const { milestone } = await setupWithMilestone();
    const result = await markMilestonePaidAction(
      milestone.id,
      form({ paidAt: "2026-09-14" })
    );
    expect(result).toEqual({ ok: true });

    const lineItem = await prisma.invoiceLineItem.findUnique({
      where: { projectMilestoneId: milestone.id },
      include: { invoice: { include: { payments: true } } },
    });
    expect(lineItem).not.toBeNull();
    expect(lineItem!.amountInPaise).toBe(500_000);
    expect(lineItem!.invoice.status).toBe("PAID");
    expect(lineItem!.invoice.payments).toHaveLength(1);
    expect(lineItem!.invoice.payments[0].amountInPaise).toBe(500_000);
    expect(lineItem!.invoice.payments[0].status).toBe("CAPTURED");
  });

  it("marks the milestone PAID and sets paidAt", async () => {
    const { milestone } = await setupWithMilestone();
    await markMilestonePaidAction(milestone.id, form({ paidAt: "2026-09-14" }));
    const m = await prisma.projectMilestone.findUniqueOrThrow({ where: { id: milestone.id } });
    expect(m.status).toBe("PAID");
    expect(m.paidAt).not.toBeNull();
  });

  it("obligation amount === line-item amount === payment amount", async () => {
    const { milestone } = await setupWithMilestone(750_000);
    await markMilestonePaidAction(milestone.id, form({ paidAt: "2026-09-14" }));
    const li = await prisma.invoiceLineItem.findUniqueOrThrow({
      where: { projectMilestoneId: milestone.id },
      include: { invoice: { include: { payments: true } } },
    });
    expect(li.amountInPaise).toBe(750_000);
    expect(li.invoice.totalAmountInPaise).toBe(750_000);
    expect(li.invoice.payments[0].amountInPaise).toBe(750_000);
  });

  it("is idempotent — second call returns already-paid error", async () => {
    const { milestone } = await setupWithMilestone();
    await markMilestonePaidAction(milestone.id, form({ paidAt: "2026-09-14" }));
    const result2 = await markMilestonePaidAction(milestone.id, form({ paidAt: "2026-09-14" }));
    expect("error" in result2).toBe(true);
    // Only one invoice line item should exist
    const count = await prisma.invoiceLineItem.count({ where: { projectMilestoneId: milestone.id } });
    expect(count).toBe(1);
  });

  it("writes a payment.recorded activity row", async () => {
    const { milestone, client } = await setupWithMilestone();
    await markMilestonePaidAction(milestone.id, form({ paidAt: "2026-09-14" }));
    const act = await prisma.clientActivity.findFirst({
      where: { clientId: client.id, eventType: "payment.recorded" },
    });
    expect(act).not.toBeNull();
    expect(act?.summary).toContain("50% Advance");
  });

  it("rejects a wrong-org milestoneId", async () => {
    await setupWithMilestone();
    const org2 = await prisma.organization.create({ data: { name: "Org 2" } });
    const c2 = await prisma.client.create({ data: { organizationId: org2.id, businessName: "C2" } });
    const p2 = await prisma.project.create({ data: { clientId: c2.id, title: "P2", baseAmountInPaise: 100 } });
    const m2 = await prisma.projectMilestone.create({
      data: { projectId: p2.id, label: "X", amountInPaise: 100, sortOrder: 0 },
    });
    const result = await markMilestonePaidAction(m2.id, form({ paidAt: "2026-09-14" }));
    expect("error" in result).toBe(true);
    // Ensure nothing was created
    const li = await prisma.invoiceLineItem.findUnique({ where: { projectMilestoneId: m2.id } });
    expect(li).toBeNull();
  });

  it("does not affect recurring billing periods or existing payments", async () => {
    const { milestone } = await setupWithMilestone();
    const before = await prisma.billingPeriod.count();
    const paymentsBefore = await prisma.payment.count();
    await markMilestonePaidAction(milestone.id, form({ paidAt: "2026-09-14" }));
    expect(await prisma.billingPeriod.count()).toBe(before);
    expect(await prisma.payment.count()).toBe(paymentsBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// markAddOnPaidAction
// ---------------------------------------------------------------------------

describe("markAddOnPaidAction", () => {
  async function setupWithAddOn(amountInPaise = 300_000) {
    const { admin, client } = await setup();
    const project = await prisma.project.create({
      data: { clientId: client.id, title: "AddOn Project", baseAmountInPaise: 1_000_000 },
    });
    const addOn = await prisma.projectAddOn.create({
      data: { projectId: project.id, description: "Extra Landing Page", amountInPaise },
    });
    return { admin, client, project, addOn };
  }

  it("creates an invoice and payment for the add-on", async () => {
    const { addOn } = await setupWithAddOn();
    const result = await markAddOnPaidAction(addOn.id, form({ paidAt: "2026-09-14" }));
    expect(result).toEqual({ ok: true });
    const li = await prisma.invoiceLineItem.findUnique({
      where: { projectAddOnId: addOn.id },
      include: { invoice: { include: { payments: true } } },
    });
    expect(li).not.toBeNull();
    expect(li!.amountInPaise).toBe(300_000);
    expect(li!.invoice.payments[0].amountInPaise).toBe(300_000);
  });

  it("is idempotent — second call returns already-paid error", async () => {
    const { addOn } = await setupWithAddOn();
    await markAddOnPaidAction(addOn.id, form({ paidAt: "2026-09-14" }));
    const result2 = await markAddOnPaidAction(addOn.id, form({ paidAt: "2026-09-14" }));
    expect("error" in result2).toBe(true);
    const count = await prisma.invoiceLineItem.count({ where: { projectAddOnId: addOn.id } });
    expect(count).toBe(1);
  });

  it("rejects wrong-org addOnId", async () => {
    await setupWithAddOn();
    const org2 = await prisma.organization.create({ data: { name: "Org 2" } });
    const c2 = await prisma.client.create({ data: { organizationId: org2.id, businessName: "C2" } });
    const p2 = await prisma.project.create({ data: { clientId: c2.id, title: "P2", baseAmountInPaise: 100 } });
    const a2 = await prisma.projectAddOn.create({
      data: { projectId: p2.id, description: "X", amountInPaise: 100 },
    });
    const result = await markAddOnPaidAction(a2.id, form({ paidAt: "2026-09-14" }));
    expect("error" in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateProjectAction
// ---------------------------------------------------------------------------

describe("updateProjectAction", () => {
  it("updates status and writes an activity entry", async () => {
    const { client } = await setup();
    const project = await prisma.project.create({
      data: { clientId: client.id, title: "Update Me", baseAmountInPaise: 100_000 },
    });
    const result = await updateProjectAction(project.id, form({ status: "IN_PROGRESS" }));
    expect(result).toEqual({ ok: true });
    const p = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(p.status).toBe("IN_PROGRESS");
    const act = await prisma.clientActivity.findFirst({
      where: { clientId: client.id, eventType: "project.updated" },
    });
    expect(act).not.toBeNull();
  });

  it("rejects an invalid status value", async () => {
    const { client } = await setup();
    const project = await prisma.project.create({
      data: { clientId: client.id, title: "Bad Status", baseAmountInPaise: 100_000 },
    });
    const result = await updateProjectAction(project.id, form({ status: "FLYING" }));
    expect("error" in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateMilestoneAction
// ---------------------------------------------------------------------------

describe("updateMilestoneAction", () => {
  async function setupWithMilestone() {
    const { admin, client } = await setup();
    const project = await prisma.project.create({
      data: { clientId: client.id, title: "Edit Project", baseAmountInPaise: 1_000_000 },
    });
    const milestone = await prisma.projectMilestone.create({
      data: { projectId: project.id, label: "Original Label", amountInPaise: 500_000, sortOrder: 0 },
    });
    return { admin, client, project, milestone };
  }

  it("edits label, amount, and dueDate on an unpaid milestone", async () => {
    const { milestone } = await setupWithMilestone();
    const result = await updateMilestoneAction(
      milestone.id,
      form({ label: "New Label", amountInRupees: "7500", dueDate: "2026-12-01" })
    );
    expect(result).toEqual({ ok: true });
    const m = await prisma.projectMilestone.findUniqueOrThrow({ where: { id: milestone.id } });
    expect(m.label).toBe("New Label");
    expect(m.amountInPaise).toBe(750_000);
    expect(m.dueDate).not.toBeNull();
  });

  it("editing an unpaid milestone does NOT create a Payment or InvoiceLineItem", async () => {
    const { milestone } = await setupWithMilestone();
    const paymentsBefore = await prisma.payment.count();
    await updateMilestoneAction(milestone.id, form({ label: "Updated", amountInRupees: "6000" }));
    expect(await prisma.payment.count()).toBe(paymentsBefore);
    const li = await prisma.invoiceLineItem.findUnique({ where: { projectMilestoneId: milestone.id } });
    expect(li).toBeNull();
  });

  it("allows editing label and dueDate on a PAID milestone", async () => {
    const { milestone } = await setupWithMilestone();
    // mark paid
    await markMilestonePaidAction(milestone.id, form({ paidAt: "2026-09-14" }));
    const result = await updateMilestoneAction(
      milestone.id,
      form({ label: "Paid Label Changed", dueDate: "2026-10-01" })
    );
    expect(result).toEqual({ ok: true });
    const m = await prisma.projectMilestone.findUniqueOrThrow({ where: { id: milestone.id } });
    expect(m.label).toBe("Paid Label Changed");
    // amount must stay unchanged
    expect(m.amountInPaise).toBe(500_000);
  });

  it("blocks amount change on a PAID milestone", async () => {
    const { milestone } = await setupWithMilestone();
    await markMilestonePaidAction(milestone.id, form({ paidAt: "2026-09-14" }));
    const result = await updateMilestoneAction(
      milestone.id,
      form({ label: "Same", amountInRupees: "9999" })
    );
    expect("error" in result).toBe(true);
    // Payment record untouched
    const li = await prisma.invoiceLineItem.findUniqueOrThrow({ where: { projectMilestoneId: milestone.id } });
    expect(li.amountInPaise).toBe(500_000);
  });

  it("rejects wrong-org milestoneId", async () => {
    await setupWithMilestone();
    const org2 = await prisma.organization.create({ data: { name: "Org 2" } });
    const c2 = await prisma.client.create({ data: { organizationId: org2.id, businessName: "C2" } });
    const p2 = await prisma.project.create({ data: { clientId: c2.id, title: "P2", baseAmountInPaise: 100 } });
    const m2 = await prisma.projectMilestone.create({
      data: { projectId: p2.id, label: "X", amountInPaise: 100, sortOrder: 0 },
    });
    const result = await updateMilestoneAction(m2.id, form({ label: "Hacked" }));
    expect("error" in result).toBe(true);
    // label must be unchanged
    const m = await prisma.projectMilestone.findUniqueOrThrow({ where: { id: m2.id } });
    expect(m.label).toBe("X");
  });

  it("writes a project.updated activity entry", async () => {
    const { milestone, client } = await setupWithMilestone();
    await updateMilestoneAction(milestone.id, form({ label: "Activity Check" }));
    const act = await prisma.clientActivity.findFirst({
      where: { clientId: client.id, eventType: "project.updated" },
    });
    expect(act).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deleteMilestoneAction
// ---------------------------------------------------------------------------

describe("deleteMilestoneAction", () => {
  async function setupWithMilestone() {
    const { admin, client } = await setup();
    const project = await prisma.project.create({
      data: { clientId: client.id, title: "Delete Project", baseAmountInPaise: 1_000_000 },
    });
    const milestone = await prisma.projectMilestone.create({
      data: { projectId: project.id, label: "Pending Milestone", amountInPaise: 500_000, sortOrder: 0 },
    });
    return { admin, client, project, milestone };
  }

  it("deletes a PENDING milestone", async () => {
    const { milestone } = await setupWithMilestone();
    const result = await deleteMilestoneAction(milestone.id);
    expect(result).toEqual({ ok: true });
    const m = await prisma.projectMilestone.findUnique({ where: { id: milestone.id } });
    expect(m).toBeNull();
  });

  it("writes a project.updated activity after deletion", async () => {
    const { milestone, client } = await setupWithMilestone();
    await deleteMilestoneAction(milestone.id);
    const act = await prisma.clientActivity.findFirst({
      where: { clientId: client.id, eventType: "project.updated" },
    });
    expect(act).not.toBeNull();
    expect(act?.summary).toContain("Pending Milestone");
  });

  it("blocks deletion of a PAID milestone", async () => {
    const { milestone } = await setupWithMilestone();
    await markMilestonePaidAction(milestone.id, form({ paidAt: "2026-09-14" }));
    const result = await deleteMilestoneAction(milestone.id);
    expect("error" in result).toBe(true);
    // Milestone still exists
    const m = await prisma.projectMilestone.findUnique({ where: { id: milestone.id } });
    expect(m).not.toBeNull();
    // Payment record untouched
    const li = await prisma.invoiceLineItem.findUnique({ where: { projectMilestoneId: milestone.id } });
    expect(li).not.toBeNull();
  });

  it("rejects wrong-org milestoneId", async () => {
    await setupWithMilestone();
    const org2 = await prisma.organization.create({ data: { name: "Org 2" } });
    const c2 = await prisma.client.create({ data: { organizationId: org2.id, businessName: "C2" } });
    const p2 = await prisma.project.create({ data: { clientId: c2.id, title: "P2", baseAmountInPaise: 100 } });
    const m2 = await prisma.projectMilestone.create({
      data: { projectId: p2.id, label: "X", amountInPaise: 100, sortOrder: 0 },
    });
    const result = await deleteMilestoneAction(m2.id);
    expect("error" in result).toBe(true);
    // Milestone still exists
    const m = await prisma.projectMilestone.findUnique({ where: { id: m2.id } });
    expect(m).not.toBeNull();
  });
});
