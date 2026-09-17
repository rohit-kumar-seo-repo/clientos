import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";

/**
 * Runs on every container start (see docker-entrypoint.sh) — safe to leave
 * there permanently. Unlike prisma/seed.ts (which always upserts, meant for
 * repeatable local dev setup), this ONLY ever acts once: it does nothing at
 * all if any AdminUser already exists, so it can never silently overwrite a
 * password you've since changed just because SEED_ADMIN_* is still set in
 * the environment.
 */
async function main() {
  const existingCount = await prisma.adminUser.count();
  if (existingCount > 0) {
    console.log(`Admin bootstrap: ${existingCount} admin user(s) already exist — skipping.`);
    return;
  }

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const orgName = process.env.SEED_ORG_NAME ?? "Rohit Kumar SEO";

  if (!email || !password) {
    console.log(
      "Admin bootstrap: no admin users exist yet, and SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD " +
        "are not set — skipping. Set them to create the first admin account on next restart."
    );
    return;
  }

  const org = await prisma.organization.upsert({
    where: { id: 1 },
    update: {},
    create: { name: orgName },
  });

  await prisma.organizationSettings.upsert({
    where: { organizationId: org.id },
    update: {},
    create: { organizationId: org.id, automaticClientCommunicationEnabled: false },
  });

  const passwordHash = await hashPassword(password);
  const admin = await prisma.adminUser.create({
    data: { organizationId: org.id, email, passwordHash, name: "Rohit" },
  });

  console.log(`Admin bootstrap: created organization "${org.name}" and admin user ${admin.email}.`);
}

main()
  .catch((err) => {
    console.error("Admin bootstrap failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
