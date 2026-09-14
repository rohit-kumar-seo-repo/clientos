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
  "project_add_ons",
  "project_milestones",
  "projects",
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
 * Truncates every application table and resets AUTO_INCREMENT counters.
 * Executes within a transaction to ensure all statements run on the same
 * database connection — critical because the Prisma adapter uses a connection
 * pool (connectionLimit: 5), and session variables like FOREIGN_KEY_CHECKS
 * are per-connection. Without a transaction, multiple TRUNCATE calls could
 * land on different connections and see different FK check settings.
 *
 * Call in `beforeEach` for any test that touches the database, so tests never
 * depend on leftover state from a previous test or a previous run.
 */
export async function resetDb(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) {
      await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
    }
    await tx.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
  });
}
