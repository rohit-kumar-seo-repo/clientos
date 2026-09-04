import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const orgName = process.env.SEED_ORG_NAME ?? "Rohit Kumar SEO";

  if (!email || !password) {
    throw new Error(
      "Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD before running the seed script, e.g.:\n" +
        "SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='...' npm run db:seed"
    );
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
  const admin = await prisma.adminUser.upsert({
    where: { email },
    update: { passwordHash },
    create: { organizationId: org.id, email, passwordHash, name: "Rohit" },
  });

  console.log(`Seeded organization "${org.name}" and admin user ${admin.email}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
