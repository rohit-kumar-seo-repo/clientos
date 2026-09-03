import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Single shared Prisma Client instance.
 *
 * Prisma 7 requires an explicit driver adapter — DATABASE_URL is no longer
 * read automatically by PrismaClient itself, so we parse it once here and
 * hand discrete connection fields to the MariaDB/MySQL adapter (this same
 * driver works against Hostinger's shared MySQL hosting and local MySQL).
 *
 * The globalThis cache prevents Next.js dev-mode hot-reload from opening a
 * fresh connection pool on every file change.
 */

function buildAdapter() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and configure it."
    );
  }

  const parsed = new URL(url);

  return new PrismaMariaDb({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ""),
    ssl: parsed.searchParams.get("ssl") === "false" ? undefined : {},
    connectionLimit: 5,
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: buildAdapter(),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
