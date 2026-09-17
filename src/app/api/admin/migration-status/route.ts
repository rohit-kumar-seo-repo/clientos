import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { validateSession, SESSION_COOKIE_NAME } from "@/lib/session";

/**
 * TEMPORARY, read-only diagnostic for the one-time clientos_dev -> production
 * data migration. Deliberately does NOT use requireAdmin() (which redirects
 * on failure — wrong behavior for a JSON API route); it authenticates the
 * same session cookie manually and returns 401 instead.
 *
 * No writes anywhere in this file. Removed once the migration is verified
 * complete — this is not meant to be a permanent part of the app.
 */
export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const admin = token ? await validateSession(token) : null;

  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [
    organizationCount,
    adminUserCount,
    clientCount,
    serviceTemplateCount,
    clientServiceCount,
    billingPlanCount,
    billingPeriodCount,
    invoiceCount,
    invoiceLineItemCount,
    paymentCount,
    projectCount,
    projectMilestoneCount,
    clientActivityCount,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.adminUser.count(),
    prisma.client.count(),
    prisma.serviceTemplate.count(),
    prisma.clientService.count(),
    prisma.billingPlan.count(),
    prisma.billingPeriod.count(),
    prisma.invoice.count(),
    prisma.invoiceLineItem.count(),
    prisma.payment.count(),
    prisma.project.count(),
    prisma.projectMilestone.count(),
    prisma.clientActivity.count(),
  ]);

  // Full rows for tables expected to be near-empty — lets an unexpected
  // non-zero count (e.g. a stray ServiceTemplate) actually be inspected
  // instead of guessed at.
  const [organizations, adminUsers, serviceTemplates] = await Promise.all([
    prisma.organization.findMany(),
    prisma.adminUser.findMany({
      select: { id: true, organizationId: true, email: true, name: true, createdAt: true },
    }),
    prisma.serviceTemplate.findMany(),
  ]);

  return NextResponse.json({
    currentAdmin: {
      id: admin.id,
      email: admin.email,
      organizationId: admin.organizationId,
    },
    organizations,
    adminUsers,
    serviceTemplateRows: serviceTemplates,
    counts: {
      organizations: organizationCount,
      adminUsers: adminUserCount,
      clients: clientCount,
      serviceTemplates: serviceTemplateCount,
      clientServices: clientServiceCount,
      billingPlans: billingPlanCount,
      billingPeriods: billingPeriodCount,
      invoices: invoiceCount,
      invoiceLineItems: invoiceLineItemCount,
      payments: paymentCount,
      projects: projectCount,
      projectMilestones: projectMilestoneCount,
      clientActivity: clientActivityCount,
    },
  });
}
