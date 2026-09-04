import { prisma } from "@/lib/db";

// All application tables, in no particular order — FK checks are disabled
// around the truncation so order doesn't matter. Keep this list in sync
// with prisma/schema.prisma's @@map names.
const TABLES = [
  "admin_sessions",
  "admin_users",
  "audit_logs",
  "billing_periods",
  "billing_plans",
  "client_activity",
  "client_contacts",
  "client_notes",
  "client_services",
  "clients",
  "invoice_line_items",
  "invoices",
  "notification_logs",
  "organization_settings",
  "organizations",
  "payments",
  "refunds",
  "reminder_jobs",
  "reminder_rules",
  "renewals",
  "service_template_tasks",
  "service_templates",
  "task_instances",
  "webhook_events",
];

/**
 * Truncates every application table. Call in `beforeEach` for any test
 * that touches the database, so tests never depend on leftover state from
 * a previous test or a previous run.
 */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of TABLES) {
    await prisma.$executeRawUnsafe(`DELETE FROM \`${table}\``);
  }
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
}
