import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { validateSession, SESSION_COOKIE_NAME } from "@/lib/session";

/**
 * TEMPORARY, one-time migration endpoint: imports the real clientos_dev
 * dataset (identified in the 2026-09-17 audit) into this production
 * database, preserving the existing bootstrap organization/admin rather
 * than replacing them. Removed once the migration is verified complete.
 *
 * Safety:
 * - Manual session check (not requireAdmin(), which redirects — wrong for
 *   a JSON API route) — 401 on no/invalid session.
 * - Requires an exact confirmation string in the body.
 * - Aborts before writing anything if this database already has ANY
 *   client rows — never runs twice, never duplicates.
 * - Everything happens in one $transaction — all-or-nothing.
 * - AdminUser/Organization/AdminSession are never created or modified here
 *   — every foreign key that pointed at the *local* admin/org is remapped
 *   to production's real, already-verified admin/org id instead.
 * - Every amount/status/date field is passed through byte-for-byte from
 *   the request body — nothing here computes or alters a financial value.
 */

const CONFIRM_TOKEN = "MIGRATE-CLIENTOS-DEV-DATA";

// ---------------------------------------------------------------------------
// Request body shape — mirrors the local audit read, one array per table.
// Dates arrive as ISO strings (JSON has no Date type) and are parsed below.
// ---------------------------------------------------------------------------
type Body = {
  confirm: string;
  productionOrganizationId: number;
  productionAdminId: number;
  serviceTemplates: Array<{
    localId: number;
    name: string;
    description: string | null;
    isActive: boolean;
    createdAt: string;
  }>;
  clients: Array<{
    localId: number;
    businessName: string;
    contactPerson: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    industry: string | null;
    location: string | null;
    status: "ACTIVE" | "PAUSED" | "CHURNED";
    createdAt: string;
  }>;
  clientContacts: Array<{
    localClientId: number;
    name: string;
    role: string | null;
    phone: string | null;
    email: string | null;
    isPrimary: boolean;
    createdAt: string;
  }>;
  clientNotes: Array<{
    localClientId: number;
    hadAuthorAdmin: boolean; // true if local authorAdminId was non-null
    body: string;
    createdAt: string;
  }>;
  clientServices: Array<{
    localId: number;
    localClientId: number;
    localServiceTemplateId: number;
    feeInPaise: number;
    startDate: string;
    status: "ACTIVE" | "PAUSED" | "CANCELLED";
    endDate: string | null;
    workStatus: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "ON_HOLD";
    progressPercent: number | null;
    workNote: string | null;
    nextActionNote: string | null;
    nextActionDate: string | null;
    createdAt: string;
  }>;
  clientServiceCategories: Array<{
    localClientServiceId: number;
    category: string;
    createdAt: string;
  }>;
  billingPlans: Array<{
    localId: number;
    localClientServiceId: number;
    amountInPaise: number;
    currency: string;
    frequency: "MONTHLY" | "QUARTERLY" | "HALF_YEARLY" | "YEARLY" | "ONE_TIME";
    billingDay: number;
    startDate: string;
    isActive: boolean;
    createdAt: string;
  }>;
  billingPeriods: Array<{
    localId: number;
    localBillingPlanId: number;
    periodLabel: string;
    amountInPaise: number;
    dueDate: string;
    status: "UPCOMING" | "DUE" | "DUE_TODAY" | "OVERDUE" | "PARTIALLY_PAID" | "PAID" | "FAILED" | "REFUNDED" | "CANCELLED";
    createdAt: string;
  }>;
  projects: Array<{
    localId: number;
    localClientId: number;
    title: string;
    description: string | null;
    status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "ON_HOLD" | "CANCELLED";
    baseAmountInPaise: number;
    startDate: string | null;
    endDate: string | null;
    workNote: string | null;
    nextActionNote: string | null;
    nextActionDate: string | null;
    createdAt: string;
  }>;
  projectMilestones: Array<{
    localId: number;
    localProjectId: number;
    label: string;
    amountInPaise: number;
    dueDate: string | null;
    status: "PENDING" | "PAID";
    paidAt: string | null;
    sortOrder: number;
    createdAt: string;
  }>;
  projectAddOns: Array<{
    localId: number;
    localProjectId: number;
    description: string;
    amountInPaise: number;
    dueDate: string | null;
    status: "PENDING" | "PAID";
    note: string | null;
    createdAt: string;
  }>;
  invoices: Array<{
    localId: number;
    localClientId: number;
    invoiceNumber: string;
    totalAmountInPaise: number;
    currency: string;
    status: "DUE" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "CANCELLED" | "REFUNDED";
    dueDate: string;
    createdAt: string;
  }>;
  invoiceLineItems: Array<{
    localInvoiceId: number;
    localBillingPeriodId: number | null;
    localProjectMilestoneId: number | null;
    localProjectAddOnId: number | null;
    description: string | null;
    amountInPaise: number;
    createdAt: string;
  }>;
  payments: Array<{
    localInvoiceId: number;
    hadRecordedByAdmin: boolean; // true if local recordedByAdminId was non-null
    razorpayOrderId: string | null;
    razorpayPaymentId: string | null;
    status: "CREATED" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "REFUNDED";
    amountInPaise: number;
    method: string | null;
    failureReason: string | null;
    capturedAt: string | null;
    createdAt: string;
  }>;
  renewals: Array<{
    localClientId: number;
    contractStart: string;
    contractDurationMonths: number | null;
    renewalDate: string;
    status: "ACTIVE" | "RENEWAL_UPCOMING" | "RENEWAL_DISCUSSION" | "RENEWED" | "CANCELLED" | "EXPIRED";
    notes: string | null;
    createdAt: string;
  }>;
  clientActivity: Array<{
    localClientId: number;
    hadActorAdmin: boolean; // true if local actorAdminId was non-null
    eventType: string;
    summary: string;
    createdAt: string;
  }>;
};

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const admin = token ? await validateSession(token) : null;

  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Body;

  if (body.confirm !== CONFIRM_TOKEN) {
    return NextResponse.json({ error: "Missing or incorrect confirmation token." }, { status: 400 });
  }

  // Idempotency / duplicate-run guard — the single most important safety
  // check in this file. Never runs if this database has ever seen a client.
  const existingClientCount = await prisma.client.count();
  if (existingClientCount > 0) {
    return NextResponse.json(
      { error: `Aborted: this database already has ${existingClientCount} client(s). Refusing to run twice.` },
      { status: 409 }
    );
  }

  // Confirm the caller-supplied production org/admin ids actually match
  // reality, rather than trusting the request body blindly.
  if (body.productionOrganizationId !== admin.organizationId) {
    return NextResponse.json(
      { error: `productionOrganizationId mismatch: body said ${body.productionOrganizationId}, session says ${admin.organizationId}.` },
      { status: 400 }
    );
  }
  if (body.productionAdminId !== admin.id) {
    return NextResponse.json(
      { error: `productionAdminId mismatch: body said ${body.productionAdminId}, session says ${admin.id}.` },
      { status: 400 }
    );
  }

  const orgId = admin.organizationId;
  const adminId = admin.id;
  const d = (s: string) => new Date(s);

  const result = await prisma.$transaction(async (tx) => {
    const serviceTemplateIdMap = new Map<number, number>();
    const clientIdMap = new Map<number, number>();
    const clientServiceIdMap = new Map<number, number>();
    const billingPlanIdMap = new Map<number, number>();
    const billingPeriodIdMap = new Map<number, number>();
    const projectIdMap = new Map<number, number>();
    const projectMilestoneIdMap = new Map<number, number>();
    const projectAddOnIdMap = new Map<number, number>();
    const invoiceIdMap = new Map<number, number>();

    // 1. Service templates (org-level catalog)
    for (const st of body.serviceTemplates) {
      const created = await tx.serviceTemplate.create({
        data: {
          organizationId: orgId,
          name: st.name,
          description: st.description,
          isActive: st.isActive,
          createdAt: d(st.createdAt),
        },
      });
      serviceTemplateIdMap.set(st.localId, created.id);
    }

    // 2. Clients
    for (const c of body.clients) {
      const created = await tx.client.create({
        data: {
          organizationId: orgId,
          businessName: c.businessName,
          contactPerson: c.contactPerson,
          phone: c.phone,
          email: c.email,
          website: c.website,
          industry: c.industry,
          location: c.location,
          status: c.status,
          createdAt: d(c.createdAt),
        },
      });
      clientIdMap.set(c.localId, created.id);
    }

    // 3. Client contacts
    for (const cc of body.clientContacts) {
      await tx.clientContact.create({
        data: {
          clientId: clientIdMap.get(cc.localClientId)!,
          name: cc.name,
          role: cc.role,
          phone: cc.phone,
          email: cc.email,
          isPrimary: cc.isPrimary,
          createdAt: d(cc.createdAt),
        },
      });
    }

    // 4. Client notes (authorAdminId -> production admin, if it had one locally)
    for (const cn of body.clientNotes) {
      await tx.clientNote.create({
        data: {
          clientId: clientIdMap.get(cn.localClientId)!,
          authorAdminId: cn.hadAuthorAdmin ? adminId : null,
          body: cn.body,
          createdAt: d(cn.createdAt),
        },
      });
    }

    // 5. Client services
    for (const cs of body.clientServices) {
      const created = await tx.clientService.create({
        data: {
          clientId: clientIdMap.get(cs.localClientId)!,
          serviceTemplateId: serviceTemplateIdMap.get(cs.localServiceTemplateId)!,
          feeInPaise: cs.feeInPaise,
          startDate: d(cs.startDate),
          status: cs.status,
          endDate: cs.endDate ? d(cs.endDate) : null,
          workStatus: cs.workStatus,
          progressPercent: cs.progressPercent,
          workNote: cs.workNote,
          nextActionNote: cs.nextActionNote,
          nextActionDate: cs.nextActionDate ? d(cs.nextActionDate) : null,
          createdAt: d(cs.createdAt),
        },
      });
      clientServiceIdMap.set(cs.localId, created.id);
    }

    // 6. Client service categories
    for (const cat of body.clientServiceCategories) {
      await tx.clientServiceCategory.create({
        data: {
          clientServiceId: clientServiceIdMap.get(cat.localClientServiceId)!,
          category: cat.category,
          createdAt: d(cat.createdAt),
        },
      });
    }

    // 7. Billing plans
    for (const bp of body.billingPlans) {
      const created = await tx.billingPlan.create({
        data: {
          clientServiceId: clientServiceIdMap.get(bp.localClientServiceId)!,
          amountInPaise: bp.amountInPaise,
          currency: bp.currency,
          frequency: bp.frequency,
          billingDay: bp.billingDay,
          startDate: d(bp.startDate),
          isActive: bp.isActive,
          createdAt: d(bp.createdAt),
        },
      });
      billingPlanIdMap.set(bp.localId, created.id);
    }

    // 8. Billing periods — exact copies, never generated. Preserves
    // requirement: no new recurring periods beyond what already existed.
    for (const period of body.billingPeriods) {
      const created = await tx.billingPeriod.create({
        data: {
          billingPlanId: billingPlanIdMap.get(period.localBillingPlanId)!,
          periodLabel: period.periodLabel,
          amountInPaise: period.amountInPaise,
          dueDate: d(period.dueDate),
          status: period.status,
          createdAt: d(period.createdAt),
        },
      });
      billingPeriodIdMap.set(period.localId, created.id);
    }

    // 9. Projects
    for (const p of body.projects) {
      const created = await tx.project.create({
        data: {
          clientId: clientIdMap.get(p.localClientId)!,
          title: p.title,
          description: p.description,
          status: p.status,
          baseAmountInPaise: p.baseAmountInPaise,
          startDate: p.startDate ? d(p.startDate) : null,
          endDate: p.endDate ? d(p.endDate) : null,
          workNote: p.workNote,
          nextActionNote: p.nextActionNote,
          nextActionDate: p.nextActionDate ? d(p.nextActionDate) : null,
          createdAt: d(p.createdAt),
        },
      });
      projectIdMap.set(p.localId, created.id);
    }

    // 10. Project milestones
    for (const m of body.projectMilestones) {
      const created = await tx.projectMilestone.create({
        data: {
          projectId: projectIdMap.get(m.localProjectId)!,
          label: m.label,
          amountInPaise: m.amountInPaise,
          dueDate: m.dueDate ? d(m.dueDate) : null,
          status: m.status,
          paidAt: m.paidAt ? d(m.paidAt) : null,
          sortOrder: m.sortOrder,
          createdAt: d(m.createdAt),
        },
      });
      projectMilestoneIdMap.set(m.localId, created.id);
    }

    // 11. Project add-ons (none in this dataset, loop kept for correctness)
    for (const a of body.projectAddOns) {
      const created = await tx.projectAddOn.create({
        data: {
          projectId: projectIdMap.get(a.localProjectId)!,
          description: a.description,
          amountInPaise: a.amountInPaise,
          dueDate: a.dueDate ? d(a.dueDate) : null,
          status: a.status,
          note: a.note,
          createdAt: d(a.createdAt),
        },
      });
      projectAddOnIdMap.set(a.localId, created.id);
    }

    // 12. Invoices
    for (const inv of body.invoices) {
      const created = await tx.invoice.create({
        data: {
          clientId: clientIdMap.get(inv.localClientId)!,
          invoiceNumber: inv.invoiceNumber,
          totalAmountInPaise: inv.totalAmountInPaise,
          currency: inv.currency,
          status: inv.status,
          dueDate: d(inv.dueDate),
          createdAt: d(inv.createdAt),
        },
      });
      invoiceIdMap.set(inv.localId, created.id);
    }

    // 13. Invoice line items — exactly one of the three obligation FKs set,
    // matching whichever was set locally.
    for (const li of body.invoiceLineItems) {
      await tx.invoiceLineItem.create({
        data: {
          invoiceId: invoiceIdMap.get(li.localInvoiceId)!,
          billingPeriodId: li.localBillingPeriodId != null ? billingPeriodIdMap.get(li.localBillingPeriodId)! : null,
          projectMilestoneId: li.localProjectMilestoneId != null ? projectMilestoneIdMap.get(li.localProjectMilestoneId)! : null,
          projectAddOnId: li.localProjectAddOnId != null ? projectAddOnIdMap.get(li.localProjectAddOnId)! : null,
          description: li.description,
          amountInPaise: li.amountInPaise,
          createdAt: d(li.createdAt),
        },
      });
    }

    // 14. Payments — amounts/status/dates preserved byte-for-byte.
    for (const pay of body.payments) {
      await tx.payment.create({
        data: {
          invoiceId: invoiceIdMap.get(pay.localInvoiceId)!,
          recordedByAdminId: pay.hadRecordedByAdmin ? adminId : null,
          razorpayOrderId: pay.razorpayOrderId,
          razorpayPaymentId: pay.razorpayPaymentId,
          status: pay.status,
          amountInPaise: pay.amountInPaise,
          method: pay.method,
          failureReason: pay.failureReason,
          capturedAt: pay.capturedAt ? d(pay.capturedAt) : null,
          createdAt: d(pay.createdAt),
        },
      });
    }

    // 15. Renewals (none in this dataset, loop kept for correctness)
    for (const r of body.renewals) {
      await tx.renewal.create({
        data: {
          clientId: clientIdMap.get(r.localClientId)!,
          contractStart: d(r.contractStart),
          contractDurationMonths: r.contractDurationMonths,
          renewalDate: d(r.renewalDate),
          status: r.status,
          notes: r.notes,
          createdAt: d(r.createdAt),
        },
      });
    }

    // 16. Client activity — chronological timeline, actorAdminId remapped.
    for (const ca of body.clientActivity) {
      await tx.clientActivity.create({
        data: {
          clientId: clientIdMap.get(ca.localClientId)!,
          actorAdminId: ca.hadActorAdmin ? adminId : null,
          eventType: ca.eventType,
          summary: ca.summary,
          createdAt: d(ca.createdAt),
        },
      });
    }

    return {
      serviceTemplates: serviceTemplateIdMap.size,
      clients: clientIdMap.size,
      clientContacts: body.clientContacts.length,
      clientNotes: body.clientNotes.length,
      clientServices: clientServiceIdMap.size,
      clientServiceCategories: body.clientServiceCategories.length,
      billingPlans: billingPlanIdMap.size,
      billingPeriods: billingPeriodIdMap.size,
      projects: projectIdMap.size,
      projectMilestones: projectMilestoneIdMap.size,
      projectAddOns: projectAddOnIdMap.size,
      invoices: invoiceIdMap.size,
      invoiceLineItems: body.invoiceLineItems.length,
      payments: body.payments.length,
      renewals: body.renewals.length,
      clientActivity: body.clientActivity.length,
      idMaps: {
        clients: Object.fromEntries(clientIdMap),
        projects: Object.fromEntries(projectIdMap),
        invoices: Object.fromEntries(invoiceIdMap),
      },
    };
  });

  return NextResponse.json({ ok: true, imported: result });
}
