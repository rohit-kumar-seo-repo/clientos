# ClientOS Foundation — Auth, App Shell, Client Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single admin (Rohit) can log in to ClientOS and fully manage the client roster — create, list, search, view, edit, add contacts/notes to clients — with every change recorded on the client's activity timeline. No billing, services, or reminders yet — those are later plans.

**Architecture:** Next.js 16 App Router with Server Components + Server Actions (no separate REST/API layer for internal CRUD — matches the brief's "Next.js server-side architecture" preference). DB-backed opaque-token sessions (not JWT) so a session is server-revocable. Middleware does a cheap cookie-presence redirect only; the authoritative session check happens in the authenticated route group's layout via a Node-runtime `requireAdmin()` call, because the MySQL driver (`@prisma/adapter-mariadb`) cannot run in Next.js's Edge middleware runtime.

**Tech Stack:** Next.js 16, TypeScript, Tailwind 4, Prisma 7 / MySQL, bcryptjs, Vitest (new — no test framework existed in this project yet).

**Spec:** `docs/superpowers/specs/2026-09-03-clientos-design.md`

## Global Constraints

- Every DB-backed table already carries `organizationId` (multi-tenant-ready schema) — V1 code hardcodes single-organization lookup (`prisma.organization.findFirstOrThrow()`), no org-switcher UI.
- Sessions are DB-backed opaque tokens (`AdminSession.token`, 64 hex chars from `crypto.randomBytes(32)`), never JWTs — a session must be revocable server-side (spec: Org/Auth).
- No secrets in committed code. `ADMIN_SESSION_SECRET` in `.env` is reserved for a future CSRF/signing use, not needed by this plan's cookie-token approach (the token itself is the secret, same as `AdminSession` in the digital-products-bundle sibling project).
- Every meaningful client mutation writes a `ClientActivity` row (`eventType` as a free string, e.g. `"client.created"`, `"client.updated"`, `"note.added"`, `"contact.added"`) — this is the audit trail the dashboard/detail page reads (spec §7/§20).
- Historical records are never silently rewritten — `ClientActivity` rows are append-only, never edited or deleted by application code.
- TDD throughout: pure-logic tasks (password hashing, token generation) get unit tests with no DB; DB-backed tasks get integration tests against a dedicated `clientos_test` database, never against `clientos_dev`.
- Run `npm run build` and `npm run lint` at the end of every task — both must pass clean before moving to the next task.
- `AuditLog` (the generic, non-client-scoped admin action trail) is deliberately **not** written to by this plan — every action here is client-scoped and already lands on `ClientActivity`, which is the right table for it per the spec. `AuditLog` gets its first writer once a later plan adds actions that aren't about one client (e.g. settings/reminder-rule changes) — the table exists in the schema now so that plan doesn't need a migration.

---

## Task 1: Test infrastructure (Vitest + dedicated test database)

**Files:**
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `src/lib/test-db.ts`
- Create: `.env.test.example`
- Modify: `package.json` (add `vitest`, `test`/`test:watch` scripts)
- Modify: `.gitignore` (add `.env.test`)

**Interfaces:**
- Produces: `resetDb(): Promise<void>` from `src/lib/test-db.ts` — truncates every application table (FK checks disabled around the truncation, since MySQL enforces FK order otherwise) so each test starts from an empty database. Every later task's integration tests call this in `beforeEach`.

- [ ] **Step 1: Create the local test database**

Run:
```bash
mysql -u root -e "CREATE DATABASE IF NOT EXISTS clientos_test;"
```
Expected: command succeeds silently (or database already exists).

- [ ] **Step 2: Add test env file and install Vitest**

```bash
cat > .env.test.example << 'EOF'
# Copy to .env.test for local test runs. Points at a SEPARATE database from
# .env's clientos_dev — tests truncate all tables between runs, never point
# this at clientos_dev.
DATABASE_URL="mysql://root:@localhost:3306/clientos_test?ssl=false"
EOF
cp .env.test.example .env.test
npm install --save-dev vitest
```

Add `.env.test` to `.gitignore` alongside the existing `.env*` / `!.env.example` lines:
```
.env*
!.env.example
!.env.test.example
```

- [ ] **Step 3: Migrate the test database**

Run:
```bash
DATABASE_URL="mysql://root:@localhost:3306/clientos_test?ssl=false" npx prisma migrate deploy
```
Expected: all existing migrations (`init`, `add_invoice_layer`) apply cleanly with "All migrations have been successfully applied."

- [ ] **Step 4: Write `src/lib/test-db.ts`**

```typescript
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
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${table}\``);
  }
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
}
```

- [ ] **Step 5: Write `vitest.config.ts` and `vitest.setup.ts`**

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

```typescript
// vitest.setup.ts
import "dotenv/config";
import { config } from "dotenv";

// Load .env.test AFTER dotenv/config's default .env load, so it overrides
// DATABASE_URL to point at clientos_test instead of clientos_dev.
config({ path: ".env.test", override: true });
```

- [ ] **Step 6: Add test scripts to `package.json`**

Add under `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 7: Write a smoke test to prove the harness works**

Create `src/lib/test-db.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";

describe("resetDb", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("leaves the organizations table empty", async () => {
    const count = await prisma.organization.count();
    expect(count).toBe(0);
  });

  it("allows inserting after a reset", async () => {
    const org = await prisma.organization.create({
      data: { name: "Test Org" },
    });
    expect(org.id).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 8: Run the test and verify it passes**

Run: `npm test`
Expected: `2 passed` for `src/lib/test-db.test.ts`, using `clientos_test` (confirm no new rows appear in `clientos_dev` via `mysql -u root clientos_dev -e "SELECT COUNT(*) FROM organizations;"` returning the same count as before this task).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "test: add Vitest + dedicated clientos_test database with resetDb helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Password hashing and session token utilities (pure, no DB)

**Files:**
- Create: `src/lib/auth.ts`
- Test: `src/lib/auth.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, `bcryptjs` only)
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, hash: string): Promise<boolean>`, `generateSessionToken(): string` (64 lowercase hex chars) — Task 3 uses all three.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/auth.test.ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, generateSessionToken } from "@/lib/auth";

describe("hashPassword / verifyPassword", () => {
  it("produces a hash that verifies correctly", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("never returns the plaintext as the hash", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash).not.toBe("hunter2");
  });
});

describe("generateSessionToken", () => {
  it("returns a 64-character lowercase hex string", () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns a different token on each call", () => {
    expect(generateSessionToken()).not.toBe(generateSessionToken());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- auth.test`
Expected: FAIL — `Cannot find module '@/lib/auth'`.

- [ ] **Step 3: Implement `src/lib/auth.ts`**

```typescript
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** 64 lowercase hex characters — matches AdminSession.token's VarChar(64). */
export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- auth.test`
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add password hashing and session token utilities

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Session persistence + admin seed script

**Files:**
- Create: `src/lib/session.ts`
- Test: `src/lib/session.test.ts`
- Create: `prisma/seed.ts`

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword`, `generateSessionToken` from Task 2; `prisma` from `src/lib/db.ts`.
- Produces: `createSession(adminUserId: number): Promise<{ token: string; expiresAt: Date }>`, `validateSession(token: string): Promise<{ id: number; email: string; organizationId: number } | null>` (returns `null` for a missing or expired token — never throws), `revokeSession(token: string): Promise<void>`. Task 4/5 use all three.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/session.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { hashPassword } from "@/lib/auth";
import { createSession, validateSession, revokeSession } from "@/lib/session";

async function makeAdmin() {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  const admin = await prisma.adminUser.create({
    data: {
      organizationId: org.id,
      email: "rohit@example.com",
      passwordHash: await hashPassword("hunter2"),
      name: "Rohit",
    },
  });
  return admin;
}

describe("createSession / validateSession", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates a session that validates back to the same admin", async () => {
    const admin = await makeAdmin();
    const { token } = await createSession(admin.id);

    const result = await validateSession(token);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(admin.id);
    expect(result!.email).toBe("rohit@example.com");
  });

  it("returns null for an unknown token", async () => {
    const result = await validateSession("0".repeat(64));
    expect(result).toBeNull();
  });

  it("returns null for an expired session", async () => {
    const admin = await makeAdmin();
    const { token } = await createSession(admin.id);
    await prisma.adminSession.updateMany({
      where: { token },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const result = await validateSession(token);

    expect(result).toBeNull();
  });
});

describe("revokeSession", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("makes a previously-valid token invalid", async () => {
    const admin = await makeAdmin();
    const { token } = await createSession(admin.id);

    await revokeSession(token);

    expect(await validateSession(token)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- session.test`
Expected: FAIL — `Cannot find module '@/lib/session'`.

- [ ] **Step 3: Implement `src/lib/session.ts`**

```typescript
import { prisma } from "@/lib/db";
import { generateSessionToken } from "@/lib/auth";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function createSession(
  adminUserId: number
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.adminSession.create({
    data: { token, adminUserId, expiresAt },
  });

  return { token, expiresAt };
}

export async function validateSession(
  token: string
): Promise<{ id: number; email: string; organizationId: number } | null> {
  const session = await prisma.adminSession.findUnique({
    where: { token },
    include: { adminUser: true },
  });

  if (!session || session.expiresAt < new Date() || !session.adminUser.isActive) {
    return null;
  }

  await prisma.adminSession.update({
    where: { token },
    data: { lastSeenAt: new Date() },
  });

  return {
    id: session.adminUser.id,
    email: session.adminUser.email,
    organizationId: session.adminUser.organizationId,
  };
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.adminSession.deleteMany({ where: { token } });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- session.test`
Expected: `4 passed`.

- [ ] **Step 5: Write the seed script `prisma/seed.ts`**

Reads credentials from env vars rather than hardcoding them — never commit real values, only ever pass them inline on the command line for a one-off local run.

```typescript
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
```

- [ ] **Step 6: Run the seed script against local dev and verify**

Run:
```bash
SEED_ADMIN_EMAIL=rohit@rohitkumarseo.com SEED_ADMIN_PASSWORD='change-me-locally' npm run db:seed
mysql -u root clientos_dev -e "SELECT email FROM admin_users;"
```
Expected: prints the seeded email, and the query returns exactly that one row. (Use a real password of your choosing here — it stays local, never committed.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add session persistence and admin seed script

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Login page, server action, rate limiting, and cookie handling

**Files:**
- Create: `src/app/login/page.tsx`
- Create: `src/app/login/LoginForm.tsx`
- Create: `src/app/login/actions.ts`
- Test: `src/app/login/actions.test.ts`

**Interfaces:**
- Consumes: `verifyPassword` (Task 2), `createSession` (Task 3), `prisma` (including `AdminUser.failedLoginAttempts`/`lockedUntil`, added to the schema specifically for this task).
- Produces: `loginAction(formData: FormData): Promise<{ error: string } | never>` — on success, sets the `co_session` cookie and calls Next.js `redirect("/")`; on failure (including a locked-out account — same message either way, so a caller can't distinguish "wrong password" from "locked" from "no such user"), returns `{ error: string }` for the form to display. Task 5's `requireAdmin()` reads the same `co_session` cookie name.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/login/actions.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { hashPassword } from "@/lib/auth";

const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string) => cookieStore.set(name, value),
    get: (name: string) =>
      cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

import { loginAction } from "@/app/login/actions";

const GENERIC_ERROR = "Invalid email or password.";

async function makeAdmin(email = "rohit@example.com", password = "hunter2") {
  const org = await prisma.organization.create({ data: { name: "Test Org" } });
  return prisma.adminUser.create({
    data: { organizationId: org.id, email, passwordHash: await hashPassword(password) },
  });
}

function loginForm(email: string, password: string) {
  const form = new FormData();
  form.set("email", email);
  form.set("password", password);
  return form;
}

describe("loginAction", () => {
  beforeEach(async () => {
    await resetDb();
    cookieStore.clear();
    vi.clearAllMocks();
  });

  it("sets a session cookie and redirects on correct credentials", async () => {
    await makeAdmin();

    await expect(loginAction(loginForm("rohit@example.com", "hunter2"))).rejects.toThrow(
      "NEXT_REDIRECT"
    );

    expect(cookieStore.get("co_session")).toBeTruthy();
    const session = await prisma.adminSession.findFirst();
    expect(session?.token).toBe(cookieStore.get("co_session"));
  });

  it("returns an error and sets no cookie on wrong password", async () => {
    await makeAdmin();

    const result = await loginAction(loginForm("rohit@example.com", "wrong"));

    expect(result).toEqual({ error: GENERIC_ERROR });
    expect(cookieStore.has("co_session")).toBe(false);
  });

  it("returns the same generic error for an unknown email (no user enumeration)", async () => {
    const result = await loginAction(loginForm("nobody@example.com", "hunter2"));
    expect(result).toEqual({ error: GENERIC_ERROR });
  });

  it("increments failedLoginAttempts on a wrong password", async () => {
    const admin = await makeAdmin();

    await loginAction(loginForm("rohit@example.com", "wrong"));

    const updated = await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
    expect(updated.failedLoginAttempts).toBe(1);
  });

  it("locks the account after 5 failed attempts, rejecting even the correct password", async () => {
    await makeAdmin();

    for (let i = 0; i < 5; i++) {
      await loginAction(loginForm("rohit@example.com", "wrong"));
    }

    const result = await loginAction(loginForm("rohit@example.com", "hunter2"));

    expect(result).toEqual({ error: GENERIC_ERROR });
    expect(cookieStore.has("co_session")).toBe(false);
  });

  it("resets failedLoginAttempts and lockedUntil on a successful login", async () => {
    const admin = await makeAdmin();
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { failedLoginAttempts: 3 },
    });

    await expect(loginAction(loginForm("rohit@example.com", "hunter2"))).rejects.toThrow(
      "NEXT_REDIRECT"
    );

    const updated = await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
    expect(updated.failedLoginAttempts).toBe(0);
    expect(updated.lockedUntil).toBeNull();
  });

  it("allows login again once lockedUntil has passed", async () => {
    const admin = await makeAdmin();
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() - 1000) },
    });

    await expect(loginAction(loginForm("rohit@example.com", "hunter2"))).rejects.toThrow(
      "NEXT_REDIRECT"
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- login/actions.test`
Expected: FAIL — `Cannot find module '@/app/login/actions'`.

- [ ] **Step 3: Implement `src/app/login/actions.ts`**

```typescript
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { createSession } from "@/lib/session";

const GENERIC_ERROR = "Invalid email or password.";
const SESSION_COOKIE = "co_session";
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export async function loginAction(
  formData: FormData
): Promise<{ error: string } | void> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: GENERIC_ERROR };
  }

  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin || !admin.isActive) {
    return { error: GENERIC_ERROR };
  }

  // Checked before the password comparison, and returns the exact same
  // generic error as a wrong password — an attacker can't tell a locked
  // account apart from a wrong password or a nonexistent email.
  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    return { error: GENERIC_ERROR };
  }

  const valid = await verifyPassword(password, admin.passwordHash);
  if (!valid) {
    const failedLoginAttempts = admin.failedLoginAttempts + 1;
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        failedLoginAttempts,
        lockedUntil:
          failedLoginAttempts >= MAX_FAILED_ATTEMPTS
            ? new Date(Date.now() + LOCKOUT_DURATION_MS)
            : admin.lockedUntil,
      },
    });
    return { error: GENERIC_ERROR };
  }

  const { token, expiresAt } = await createSession(admin.id);

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });

  await prisma.adminUser.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
  });

  redirect("/");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- login/actions.test`
Expected: `8 passed`.

- [ ] **Step 5: Build the login page UI (Server Component + Client Component, so the error actually renders)**

```tsx
// src/app/login/page.tsx
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50">
      <LoginForm />
    </main>
  );
}
```

```tsx
// src/app/login/LoginForm.tsx
"use client";

import { useState } from "react";
import { loginAction } from "./actions";

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(formData: FormData) {
    setSubmitting(true);
    setError(null);
    try {
      const result = await loginAction(formData);
      if (result && "error" in result) {
        setError(result.error);
      }
      // On success, loginAction calls redirect() itself — this component
      // never regains control in that case.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      action={handleSubmit}
      className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 shadow-sm"
    >
      <h1 className="mb-6 text-lg font-semibold text-neutral-900">
        Sign in to ClientOS
      </h1>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      <label className="mb-1 block text-sm text-neutral-600" htmlFor="email">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        className="mb-4 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
      />
      <label className="mb-1 block text-sm text-neutral-600" htmlFor="password">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        required
        className="mb-6 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
      />
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-neutral-900 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
```

- [ ] **Step 6: Run full verification**

Run: `npm run build && npm run lint`
Expected: both pass clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add login page/action with rate limiting and visible error state

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 5: `requireAdmin()` + authenticated route group + middleware redirect

**Files:**
- Create: `src/lib/require-admin.ts`
- Create: `middleware.ts`
- Modify: move `src/app/page.tsx`, `src/app/layout.tsx` contents into a new `(app)` route group

**Interfaces:**
- Consumes: `validateSession` (Task 3).
- Produces: `requireAdmin(): Promise<{ id: number; email: string; organizationId: number }>` — reads the `co_session` cookie via `next/headers`, calls `validateSession`, and `redirect("/login")` if invalid. Every authenticated page/layout from Task 6 onward calls this first.

- [ ] **Step 1: Write `src/lib/require-admin.ts`**

No unit test here — it's a thin wrapper around already-tested `validateSession` plus Next.js's own `cookies()`/`redirect()`, which are framework primitives, not logic worth re-testing in isolation. Verified via the manual check in Step 4 below instead.

```typescript
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateSession } from "@/lib/session";

const SESSION_COOKIE = "co_session";

export async function requireAdmin(): Promise<{
  id: number;
  email: string;
  organizationId: number;
}> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  const admin = token ? await validateSession(token) : null;
  if (!admin) {
    redirect("/login");
  }

  return admin;
}
```

- [ ] **Step 2: Move the app shell into an `(app)` route group**

```bash
mkdir -p "src/app/(app)"
git mv src/app/page.tsx "src/app/(app)/page.tsx"
```

Rewrite `src/app/(app)/layout.tsx` (new file) to call `requireAdmin()`:

```tsx
import { requireAdmin } from "@/lib/require-admin";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return <div className="min-h-screen bg-neutral-50">{children}</div>;
}
```

(The Sidebar/Header wrapper markup itself is Task 6's job — this task only wires the auth gate.)

- [ ] **Step 3: Add `middleware.ts` for the fast, cookie-only redirect**

```typescript
import { NextRequest, NextResponse } from "next/server";

// Cheap, cookie-presence-only check — NOT the authoritative auth check.
// The MySQL driver adapter cannot run in Edge middleware, so the real
// DB-backed session validation happens in `(app)/layout.tsx` via
// `requireAdmin()`. This middleware only avoids a round-trip render for
// the common case of a fully logged-out visitor.
export function middleware(request: NextRequest) {
  const hasSessionCookie = request.cookies.has("co_session");

  if (!hasSessionCookie && request.nextUrl.pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, then in a browser:
1. Visit `http://localhost:3000/` while logged out → expect redirect to `/login`.
2. Log in with the seeded admin credentials from Task 3 → expect redirect to `/` and the placeholder text to render.
3. Delete the `co_session` cookie via devtools and reload `/` → expect redirect to `/login` again.

Expected: all three behave as described.

- [ ] **Step 5: Run full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all pass clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add requireAdmin auth gate, middleware redirect, and (app) route group

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 6: App shell — Sidebar + Header matching the reference layout

**Files:**
- Create: `src/components/shell/Sidebar.tsx`
- Create: `src/components/shell/Header.tsx`
- Create: `src/components/shell/ComingSoon.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/app/(app)/page.tsx` (Overview placeholder → real greeting)
- Create: `src/app/(app)/work/page.tsx`, `.../payments/page.tsx`, `.../calendar/page.tsx`, `.../reports/page.tsx`, `.../services/page.tsx`, `.../reminder-rules/page.tsx`, `.../team/page.tsx`, `.../integrations/page.tsx`, `.../settings/organization/page.tsx`, `.../settings/razorpay/page.tsx`, `.../settings/notifications/page.tsx`, `.../settings/preferences/page.tsx` (each renders `<ComingSoon />` — real content arrives in later plans)

**Interfaces:**
- Consumes: `requireAdmin()` result (admin's `email`/`name`) passed down from the layout for the Header.
- Produces: nothing new consumed by later tasks in this plan — Task 7 onward just adds new routes under `(app)/clients/*`, which the Sidebar already links to.

- [ ] **Step 1: Write `src/components/shell/ComingSoon.tsx`**

```tsx
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-neutral-300">
      <p className="text-sm text-neutral-400">{title} — coming in a later phase.</p>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/components/shell/Sidebar.tsx`**

Nav structure follows the reference image: primary nav, a "MANAGEMENT" group, a "SETTINGS" group. Every link is real (routes from Step 5 exist even if they render `<ComingSoon />` for now) — no dead links.

```tsx
import Link from "next/link";

const PRIMARY_NAV = [
  { href: "/", label: "Overview" },
  { href: "/clients", label: "Clients" },
  { href: "/work", label: "Work" },
  { href: "/payments", label: "Payments" },
  { href: "/calendar", label: "Calendar" },
  { href: "/reports", label: "Reports" },
];

const MANAGEMENT_NAV = [
  { href: "/services", label: "Services" },
  { href: "/reminder-rules", label: "Reminder Rules" },
  { href: "/team", label: "Team" },
  { href: "/integrations", label: "Integrations" },
];

const SETTINGS_NAV = [
  { href: "/settings/organization", label: "Organization" },
  { href: "/settings/razorpay", label: "Razorpay" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/preferences", label: "Preferences" },
];

function NavGroup({
  heading,
  items,
}: {
  heading?: string;
  items: { href: string; label: string }[];
}) {
  return (
    <div className="mb-6">
      {heading && (
        <p className="mb-2 px-3 text-xs font-medium tracking-wide text-neutral-400">
          {heading}
        </p>
      )}
      <nav className="flex flex-col gap-0.5">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-white px-3 py-4">
      <div className="mb-6 flex items-center gap-2 px-3">
        <div className="h-6 w-6 rounded-md bg-neutral-900" />
        <span className="text-sm font-semibold text-neutral-900">ClientOS</span>
      </div>
      <NavGroup items={PRIMARY_NAV} />
      <NavGroup heading="MANAGEMENT" items={MANAGEMENT_NAV} />
      <NavGroup heading="SETTINGS" items={SETTINGS_NAV} />
    </aside>
  );
}
```

- [ ] **Step 3: Write `src/components/shell/Header.tsx`**

```tsx
export function Header({ adminName }: { adminName: string }) {
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-8 py-4">
      <div>
        <h1 className="text-lg font-semibold text-neutral-900">
          Good {timeOfDayGreeting()}, {adminName}
        </h1>
        <p className="text-sm text-neutral-500">{today}</p>
      </div>
    </header>
  );
}

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}
```

- [ ] **Step 4: Wire the shell into `src/app/(app)/layout.tsx`**

```tsx
import { requireAdmin } from "@/lib/require-admin";
import { Sidebar } from "@/components/shell/Sidebar";
import { Header } from "@/components/shell/Header";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  return (
    <div className="flex min-h-screen bg-neutral-50">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Header adminName={admin.email.split("@")[0]} />
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create the placeholder routes**

For each of `work`, `payments`, `calendar`, `reports`, `services`, `reminder-rules`, `team`, `integrations`, `settings/organization`, `settings/razorpay`, `settings/notifications`, `settings/preferences`, create `src/app/(app)/<path>/page.tsx`:

```tsx
import { ComingSoon } from "@/components/shell/ComingSoon";

export default function Page() {
  return <ComingSoon title="This section" />;
}
```

(Give each file's `<ComingSoon>` a specific `title` matching its section, e.g. `title="Work"`, `title="Payments"`.)

Update `src/app/(app)/page.tsx` (Overview) to drop the old placeholder text — the Header already shows the greeting, so this can just note what's coming:

```tsx
import { ComingSoon } from "@/components/shell/ComingSoon";

export default function OverviewPage() {
  return <ComingSoon title="The attention dashboard" />;
}
```

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, log in, click through every Sidebar link.
Expected: every link renders its page with no 404s; Clients link goes to `/clients` (built in Task 7, will 404 until then — acceptable at this point in the plan, resolved by the next task).

- [ ] **Step 7: Run full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all pass clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add app shell (sidebar/header) and placeholder routes for future phases

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 7: Client list page

**Files:**
- Create: `src/app/(app)/clients/page.tsx`
- Create: `src/lib/clients.ts`
- Test: `src/lib/clients.test.ts`

**Interfaces:**
- Consumes: `prisma`, `requireAdmin()`'s `organizationId`.
- Produces: `listClients(organizationId: number, opts?: { search?: string; status?: ClientStatus }): Promise<Client[]>` from `src/lib/clients.ts` — Task 9's detail page and Task 8's post-create redirect both rely on the same `Client` shape (Prisma's generated type, re-exported, not redefined).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/clients.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { listClients } from "@/lib/clients";

describe("listClients", () => {
  let orgId: number;

  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    await prisma.client.createMany({
      data: [
        { organizationId: orgId, businessName: "ABC Interiors", status: "ACTIVE" },
        { organizationId: orgId, businessName: "XYZ Salon", status: "ACTIVE" },
        { organizationId: orgId, businessName: "Old Client Co", status: "CHURNED" },
      ],
    });
  });

  it("returns all clients for the organization by default", async () => {
    const result = await listClients(orgId);
    expect(result).toHaveLength(3);
  });

  it("filters by search substring on businessName (case-insensitive)", async () => {
    const result = await listClients(orgId, { search: "abc" });
    expect(result).toHaveLength(1);
    expect(result[0].businessName).toBe("ABC Interiors");
  });

  it("filters by status", async () => {
    const result = await listClients(orgId, { status: "CHURNED" });
    expect(result).toHaveLength(1);
    expect(result[0].businessName).toBe("Old Client Co");
  });

  it("never returns another organization's clients", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    await prisma.client.create({
      data: { organizationId: otherOrg.id, businessName: "Should Not Appear" },
    });

    const result = await listClients(orgId);

    expect(result.map((c) => c.businessName)).not.toContain("Should Not Appear");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- clients.test`
Expected: FAIL — `Cannot find module '@/lib/clients'`.

- [ ] **Step 3: Implement `src/lib/clients.ts`**

```typescript
import { prisma } from "@/lib/db";
import type { Client, ClientStatus } from "@/generated/prisma/client";

export async function listClients(
  organizationId: number,
  opts?: { search?: string; status?: ClientStatus }
): Promise<Client[]> {
  return prisma.client.findMany({
    where: {
      organizationId,
      ...(opts?.status ? { status: opts.status } : {}),
      ...(opts?.search
        ? { businessName: { contains: opts.search } }
        : {}),
    },
    orderBy: { businessName: "asc" },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- clients.test`
Expected: `4 passed`.

- [ ] **Step 5: Build the client list page**

```tsx
// src/app/(app)/clients/page.tsx
import Link from "next/link";
import { requireAdmin } from "@/lib/require-admin";
import { listClients } from "@/lib/clients";
import type { ClientStatus } from "@/generated/prisma/client";

const VALID_STATUSES: ClientStatus[] = ["ACTIVE", "PAUSED", "CHURNED"];

function parseStatus(value: string | undefined): ClientStatus | undefined {
  return VALID_STATUSES.includes(value as ClientStatus)
    ? (value as ClientStatus)
    : undefined;
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const clients = await listClients(admin.organizationId, {
    search: params.q,
    status: parseStatus(params.status),
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-900">Clients</h1>
        <Link
          href="/clients/new"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Add Client
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Business</th>
              <th className="px-4 py-3 font-medium">Contact</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-3">
                  <Link
                    href={`/clients/${client.id}`}
                    className="font-medium text-neutral-900 hover:underline"
                  >
                    {client.businessName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-neutral-600">
                  {client.contactPerson ?? "—"}
                </td>
                <td className="px-4 py-3 text-neutral-600">{client.status}</td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-neutral-400">
                  No clients yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all pass clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add client list page with search and status filtering

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 8: Create client (form + server action + activity log)

**Files:**
- Create: `src/app/(app)/clients/new/page.tsx`
- Create: `src/app/(app)/clients/actions.ts`
- Test: `src/app/(app)/clients/actions.test.ts`

**Interfaces:**
- Consumes: `prisma`, `requireAdmin()`.
- Produces: `createClientAction(organizationId: number, formData: FormData): Promise<{ error: string } | { clientId: number }>` — Task 9 links to `/clients/${clientId}` after a successful create; Task 10 (edit) and Task 12/13 (notes/contacts) follow the same `{ error } | { ok: true }`-shaped return convention established here.

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/(app)/clients/actions.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resetDb } from "@/lib/test-db";
import { createClientAction } from "@/app/(app)/clients/actions";

describe("createClientAction", () => {
  let orgId: number;

  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
  });

  it("creates a client and returns its id", async () => {
    const form = new FormData();
    form.set("businessName", "ABC Interiors");
    form.set("contactPerson", "Rohit Sharma");
    form.set("email", "rohit@abcinteriors.in");

    const result = await createClientAction(orgId, form);

    expect("clientId" in result).toBe(true);
    const client = await prisma.client.findUnique({
      where: { id: (result as { clientId: number }).clientId },
    });
    expect(client?.businessName).toBe("ABC Interiors");
    expect(client?.status).toBe("ACTIVE");
  });

  it("writes a client.created activity row", async () => {
    const form = new FormData();
    form.set("businessName", "ABC Interiors");

    const result = await createClientAction(orgId, form);
    const clientId = (result as { clientId: number }).clientId;

    const activity = await prisma.clientActivity.findFirst({ where: { clientId } });
    expect(activity?.eventType).toBe("client.created");
  });

  it("rejects an empty business name", async () => {
    const form = new FormData();
    form.set("businessName", "  ");

    const result = await createClientAction(orgId, form);

    expect(result).toEqual({ error: "Business name is required." });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- clients/actions.test`
Expected: FAIL — `Cannot find module '@/app/(app)/clients/actions'`.

- [ ] **Step 3: Implement `src/app/(app)/clients/actions.ts`**

```typescript
"use server";

import { prisma } from "@/lib/db";

export async function createClientAction(
  organizationId: number,
  formData: FormData
): Promise<{ error: string } | { clientId: number }> {
  const businessName = String(formData.get("businessName") ?? "").trim();
  if (!businessName) {
    return { error: "Business name is required." };
  }

  const contactPerson = optionalString(formData, "contactPerson");
  const phone = optionalString(formData, "phone");
  const email = optionalString(formData, "email");
  const website = optionalString(formData, "website");
  const industry = optionalString(formData, "industry");
  const location = optionalString(formData, "location");

  const client = await prisma.client.create({
    data: {
      organizationId,
      businessName,
      contactPerson,
      phone,
      email,
      website,
      industry,
      location,
    },
  });

  await prisma.clientActivity.create({
    data: {
      clientId: client.id,
      eventType: "client.created",
      summary: `${businessName} added as a client.`,
    },
  });

  return { clientId: client.id };
}

function optionalString(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value.length > 0 ? value : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- clients/actions.test`
Expected: `3 passed`.

- [ ] **Step 5: Build the create-client page**

`requireAdmin()` uses `next/headers`, which only works in a Server Component/Action — so the page itself is a Server Component that fetches `organizationId` and hands it down as a prop to a `"use client"` form component (same split used again in Task 10).

```tsx
// src/app/(app)/clients/new/page.tsx
import { requireAdmin } from "@/lib/require-admin";
import { ClientForm } from "./ClientForm";

export default async function NewClientPage() {
  const admin = await requireAdmin();
  return <ClientForm organizationId={admin.organizationId} />;
}
```

```tsx
// src/app/(app)/clients/new/ClientForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClientAction } from "../actions";

export function ClientForm({ organizationId }: { organizationId: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    const result = await createClientAction(organizationId, formData);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.push(`/clients/${result.clientId}`);
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-lg font-semibold text-neutral-900">Add Client</h1>
      <form action={handleSubmit} className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Field name="businessName" label="Business name" required />
        <Field name="contactPerson" label="Contact person" />
        <Field name="phone" label="Phone" />
        <Field name="email" label="Email" type="email" />
        <Field name="website" label="Website" />
        <Field name="industry" label="Industry" />
        <Field name="location" label="Location" />
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Create client
        </button>
      </form>
    </div>
  );
}

function Field({
  name,
  label,
  type = "text",
  required = false,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm text-neutral-600" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
      />
    </div>
  );
}
```

- [ ] **Step 6: Run full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all pass clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add create-client form, server action, and activity logging

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 9: Client detail page (Overview + activity timeline)

**Files:**
- Create: `src/app/(app)/clients/[id]/page.tsx`
- Create: `src/components/clients/ActivityTimeline.tsx`
- Modify: `src/lib/clients.ts` (add `getClientById`)
- Test: `src/lib/clients.test.ts` (extend)

**Interfaces:**
- Consumes: `listClients` pattern from Task 7.
- Produces: `getClientById(organizationId: number, clientId: number): Promise<(Client & { contacts: ClientContact[]; notes: ClientNote[]; activity: ClientActivity[] }) | null>` — Task 10 (edit), 12 (contacts), 13 (notes) all re-fetch through this same function after their mutations so the page always shows current state.

- [ ] **Step 1: Add the failing test to `src/lib/clients.test.ts`**

```typescript
// append to src/lib/clients.test.ts
import { getClientById } from "@/lib/clients";

describe("getClientById", () => {
  let orgId: number;

  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
  });

  it("returns the client with contacts, notes, and activity", async () => {
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors" },
    });
    await prisma.clientActivity.create({
      data: { clientId: client.id, eventType: "client.created", summary: "Created." },
    });

    const result = await getClientById(orgId, client.id);

    expect(result?.businessName).toBe("ABC Interiors");
    expect(result?.activity).toHaveLength(1);
  });

  it("returns null for a client in a different organization", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    const client = await prisma.client.create({
      data: { organizationId: otherOrg.id, businessName: "Not Mine" },
    });

    const result = await getClientById(orgId, client.id);

    expect(result).toBeNull();
  });

  it("returns null for a nonexistent id", async () => {
    const result = await getClientById(orgId, 999999);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- clients.test`
Expected: FAIL — `getClientById is not a function`.

- [ ] **Step 3: Implement `getClientById` in `src/lib/clients.ts`**

```typescript
// add to src/lib/clients.ts
export async function getClientById(organizationId: number, clientId: number) {
  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId },
    include: {
      contacts: { orderBy: { isPrimary: "desc" } },
      notes: { orderBy: { createdAt: "desc" } },
      activity: { orderBy: { createdAt: "desc" } },
    },
  });
  return client;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- clients.test`
Expected: all tests in the file pass (previous 4 + new 3 = 7).

- [ ] **Step 5: Write `src/components/clients/ActivityTimeline.tsx`**

```tsx
import type { ClientActivity } from "@/generated/prisma/client";

export function ActivityTimeline({ activity }: { activity: ClientActivity[] }) {
  if (activity.length === 0) {
    return <p className="text-sm text-neutral-400">No activity yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {activity.map((event) => (
        <li key={event.id} className="text-sm">
          <span className="text-neutral-900">{event.summary}</span>
          <span className="ml-2 text-neutral-400">
            {event.createdAt.toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 6: Build the detail page**

```tsx
// src/app/(app)/clients/[id]/page.tsx
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { getClientById } from "@/lib/clients";
import { ActivityTimeline } from "@/components/clients/ActivityTimeline";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdmin();
  const { id } = await params;
  const client = await getClientById(admin.organizationId, Number(id));

  if (!client) {
    notFound();
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-semibold text-neutral-900">
        {client.businessName}
      </h1>
      <p className="mb-6 text-sm text-neutral-500">{client.status}</p>

      <div className="grid grid-cols-2 gap-6">
        <section className="rounded-xl border border-neutral-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-medium text-neutral-900">Overview</h2>
          <dl className="space-y-2 text-sm">
            <Row label="Contact person" value={client.contactPerson} />
            <Row label="Phone" value={client.phone} />
            <Row label="Email" value={client.email} />
            <Row label="Website" value={client.website} />
            <Row label="Industry" value={client.industry} />
            <Row label="Location" value={client.location} />
          </dl>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-medium text-neutral-900">Activity</h2>
          <ActivityTimeline activity={client.activity} />
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="text-neutral-900">{value ?? "—"}</dd>
    </div>
  );
}
```

- [ ] **Step 7: Run full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all pass clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add client detail page with overview and activity timeline

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 10: Edit client

**Files:**
- Create: `src/app/(app)/clients/[id]/edit/page.tsx`
- Create: `src/app/(app)/clients/[id]/edit/EditClientForm.tsx`
- Modify: `src/app/(app)/clients/actions.ts` (add `updateClientAction`)
- Test: `src/app/(app)/clients/actions.test.ts` (extend)
- Modify: `src/app/(app)/clients/[id]/page.tsx` (add an "Edit" link)

**Interfaces:**
- Consumes: `getClientById`, the `{ error } | { ok: true }` convention from Task 8.
- Produces: `updateClientAction(organizationId: number, clientId: number, formData: FormData): Promise<{ error: string } | { ok: true }>`, writes `client.updated` activity listing which fields changed.

- [ ] **Step 1: Add the failing test**

```typescript
// append to src/app/(app)/clients/actions.test.ts
import { updateClientAction } from "@/app/(app)/clients/actions";

describe("updateClientAction", () => {
  let orgId: number;
  let clientId: number;

  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    orgId = org.id;
    const client = await prisma.client.create({
      data: { organizationId: orgId, businessName: "ABC Interiors", phone: "111" },
    });
    clientId = client.id;
  });

  it("updates the client's fields", async () => {
    const form = new FormData();
    form.set("businessName", "ABC Interiors Pvt Ltd");
    form.set("phone", "222");

    const result = await updateClientAction(orgId, clientId, form);

    expect(result).toEqual({ ok: true });
    const updated = await prisma.client.findUnique({ where: { id: clientId } });
    expect(updated?.businessName).toBe("ABC Interiors Pvt Ltd");
    expect(updated?.phone).toBe("222");
  });

  it("writes a client.updated activity row naming the changed fields", async () => {
    const form = new FormData();
    form.set("businessName", "ABC Interiors Pvt Ltd");
    form.set("phone", "111"); // unchanged

    await updateClientAction(orgId, clientId, form);

    const activity = await prisma.clientActivity.findFirst({
      where: { clientId, eventType: "client.updated" },
    });
    expect(activity?.summary).toContain("businessName");
    expect(activity?.summary).not.toContain("phone");
  });

  it("rejects an empty business name", async () => {
    const form = new FormData();
    form.set("businessName", "");

    const result = await updateClientAction(orgId, clientId, form);

    expect(result).toEqual({ error: "Business name is required." });
  });

  it("returns an error for a client outside the organization", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "Other" } });
    const form = new FormData();
    form.set("businessName", "Hijacked");

    const result = await updateClientAction(otherOrg.id, clientId, form);

    expect(result).toEqual({ error: "Client not found." });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- clients/actions.test`
Expected: FAIL — `updateClientAction is not a function`.

- [ ] **Step 3: Implement `updateClientAction`**

```typescript
// add to src/app/(app)/clients/actions.ts
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
  organizationId: number,
  clientId: number,
  formData: FormData
): Promise<{ error: string } | { ok: true }> {
  const existing = await prisma.client.findFirst({
    where: { id: clientId, organizationId },
  });
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

  const changedFields = EDITABLE_FIELDS.filter(
    (field) => nextValues[field] !== (existing[field] ?? null)
  );

  await prisma.client.update({ where: { id: clientId }, data: nextValues });

  if (changedFields.length > 0) {
    await prisma.clientActivity.create({
      data: {
        clientId,
        eventType: "client.updated",
        summary: `Updated: ${changedFields.join(", ")}.`,
      },
    });
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- clients/actions.test`
Expected: all pass (3 from Task 8 + 4 new = 7).

- [ ] **Step 5: Build the edit page (Server Component + client form, same split as Task 8)**

```tsx
// src/app/(app)/clients/[id]/edit/page.tsx
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { getClientById } from "@/lib/clients";
import { EditClientForm } from "./EditClientForm";

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdmin();
  const { id } = await params;
  const client = await getClientById(admin.organizationId, Number(id));
  if (!client) notFound();

  return <EditClientForm organizationId={admin.organizationId} client={client} />;
}
```

```tsx
// src/app/(app)/clients/[id]/edit/EditClientForm.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Client } from "@/generated/prisma/client";
import { updateClientAction } from "../../actions";

export function EditClientForm({
  organizationId,
  client,
}: {
  organizationId: number;
  client: Client;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    const result = await updateClientAction(organizationId, client.id, formData);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.push(`/clients/${client.id}`);
  }

  return (
    <div className="max-w-lg">
      <h1 className="mb-6 text-lg font-semibold text-neutral-900">Edit Client</h1>
      <form action={handleSubmit} className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Field name="businessName" label="Business name" defaultValue={client.businessName} required />
        <Field name="contactPerson" label="Contact person" defaultValue={client.contactPerson ?? ""} />
        <Field name="phone" label="Phone" defaultValue={client.phone ?? ""} />
        <Field name="email" label="Email" type="email" defaultValue={client.email ?? ""} />
        <Field name="website" label="Website" defaultValue={client.website ?? ""} />
        <Field name="industry" label="Industry" defaultValue={client.industry ?? ""} />
        <Field name="location" label="Location" defaultValue={client.location ?? ""} />
        <button
          type="submit"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Save changes
        </button>
      </form>
    </div>
  );
}

function Field({
  name,
  label,
  type = "text",
  required = false,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm text-neutral-600" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
      />
    </div>
  );
}
```

- [ ] **Step 6: Add the Edit link on the detail page**

In `src/app/(app)/clients/[id]/page.tsx`, add next to the business-name heading:

```tsx
import Link from "next/link";
// ...
<Link
  href={`/clients/${client.id}/edit`}
  className="text-sm text-neutral-500 hover:text-neutral-900 hover:underline"
>
  Edit
</Link>
```

- [ ] **Step 7: Run full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all pass clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add client edit page with change-tracked activity logging

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 11: Client contacts (add/remove additional contacts)

**Files:**
- Modify: `src/app/(app)/clients/actions.ts` (add `addContactAction`, `removeContactAction`)
- Test: `src/app/(app)/clients/actions.test.ts` (extend)
- Create: `src/components/clients/ContactsPanel.tsx`
- Modify: `src/app/(app)/clients/[id]/page.tsx` (render the panel)

**Interfaces:**
- Consumes: `getClientById`'s `contacts` array (already fetched in Task 9).
- Produces: `addContactAction(clientId: number, formData: FormData): Promise<{ error: string } | { ok: true }>`, `removeContactAction(clientId: number, contactId: number): Promise<{ ok: true }>`.

- [ ] **Step 1: Add the failing tests**

```typescript
// append to src/app/(app)/clients/actions.test.ts
import { addContactAction, removeContactAction } from "@/app/(app)/clients/actions";

describe("addContactAction / removeContactAction", () => {
  let clientId: number;

  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    const client = await prisma.client.create({
      data: { organizationId: org.id, businessName: "ABC Interiors" },
    });
    clientId = client.id;
  });

  it("adds a contact and logs activity", async () => {
    const form = new FormData();
    form.set("name", "Priya Mehta");
    form.set("role", "Marketing Manager");
    form.set("phone", "9999999999");

    const result = await addContactAction(clientId, form);

    expect(result).toEqual({ ok: true });
    const contact = await prisma.clientContact.findFirst({ where: { clientId } });
    expect(contact?.name).toBe("Priya Mehta");
    const activity = await prisma.clientActivity.findFirst({
      where: { clientId, eventType: "contact.added" },
    });
    expect(activity?.summary).toContain("Priya Mehta");
  });

  it("rejects a contact with no name", async () => {
    const form = new FormData();
    form.set("name", " ");

    const result = await addContactAction(clientId, form);

    expect(result).toEqual({ error: "Contact name is required." });
  });

  it("removes a contact", async () => {
    const contact = await prisma.clientContact.create({
      data: { clientId, name: "Priya Mehta" },
    });

    await removeContactAction(clientId, contact.id);

    expect(await prisma.clientContact.findUnique({ where: { id: contact.id } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- clients/actions.test`
Expected: FAIL — `addContactAction is not a function`.

- [ ] **Step 3: Implement both actions**

```typescript
// add to src/app/(app)/clients/actions.ts
export async function addContactAction(
  clientId: number,
  formData: FormData
): Promise<{ error: string } | { ok: true }> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Contact name is required." };
  }

  await prisma.clientContact.create({
    data: {
      clientId,
      name,
      role: optionalString(formData, "role"),
      phone: optionalString(formData, "phone"),
      email: optionalString(formData, "email"),
    },
  });

  await prisma.clientActivity.create({
    data: {
      clientId,
      eventType: "contact.added",
      summary: `Added contact ${name}.`,
    },
  });

  return { ok: true };
}

export async function removeContactAction(
  clientId: number,
  contactId: number
): Promise<{ ok: true }> {
  await prisma.clientContact.deleteMany({ where: { id: contactId, clientId } });
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- clients/actions.test`
Expected: all pass (7 from Task 10 + 3 new = 10).

- [ ] **Step 5: Build `ContactsPanel`**

```tsx
// src/components/clients/ContactsPanel.tsx
"use client";

import { useState } from "react";
import type { ClientContact } from "@/generated/prisma/client";
import { addContactAction, removeContactAction } from "@/app/(app)/clients/actions";

export function ContactsPanel({
  clientId,
  contacts,
}: {
  clientId: number;
  contacts: ClientContact[];
}) {
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(formData: FormData) {
    const result = await addContactAction(clientId, formData);
    if ("error" in result) {
      setError(result.error);
    } else {
      setError(null);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-medium text-neutral-900">Contacts</h2>
      <ul className="mb-4 space-y-2">
        {contacts.map((contact) => (
          <li key={contact.id} className="flex items-center justify-between text-sm">
            <span>
              {contact.name}
              {contact.role && <span className="text-neutral-400"> · {contact.role}</span>}
            </span>
            <form action={() => removeContactAction(clientId, contact.id)}>
              <button type="submit" className="text-neutral-400 hover:text-red-600">
                Remove
              </button>
            </form>
          </li>
        ))}
        {contacts.length === 0 && (
          <li className="text-sm text-neutral-400">No additional contacts.</li>
        )}
      </ul>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <form action={handleAdd} className="flex gap-2">
        <input
          name="name"
          placeholder="Name"
          required
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <input
          name="role"
          placeholder="Role"
          className="w-32 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm hover:bg-neutral-200"
        >
          Add
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 6: Render it on the detail page**

In `src/app/(app)/clients/[id]/page.tsx`, import `ContactsPanel` and add it as a third grid cell (change the grid to `grid-cols-2` with the Overview/Activity row followed by a full-width row, or a simple `grid-cols-3` — pick `grid-cols-2` with `<ContactsPanel>` spanning both columns below the existing two sections):

```tsx
import { ContactsPanel } from "@/components/clients/ContactsPanel";
// ... inside the grid, after the two existing <section> elements:
<div className="col-span-2">
  <ContactsPanel clientId={client.id} contacts={client.contacts} />
</div>
```

- [ ] **Step 7: Run full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all pass clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add client contacts panel (add/remove)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 12: Client notes

**Files:**
- Modify: `src/app/(app)/clients/actions.ts` (add `addNoteAction`)
- Test: `src/app/(app)/clients/actions.test.ts` (extend)
- Create: `src/components/clients/NotesPanel.tsx`
- Modify: `src/app/(app)/clients/[id]/page.tsx` (render the panel)

**Interfaces:**
- Consumes: `getClientById`'s `notes` array (already fetched in Task 9), `requireAdmin()`'s `id` as `authorAdminId`.
- Produces: `addNoteAction(clientId: number, authorAdminId: number, formData: FormData): Promise<{ error: string } | { ok: true }>`.

- [ ] **Step 1: Add the failing test**

```typescript
// append to src/app/(app)/clients/actions.test.ts
import { addNoteAction } from "@/app/(app)/clients/actions";

describe("addNoteAction", () => {
  let clientId: number;
  let adminId: number;

  beforeEach(async () => {
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    const client = await prisma.client.create({
      data: { organizationId: org.id, businessName: "ABC Interiors" },
    });
    clientId = client.id;
    const admin = await prisma.adminUser.create({
      data: { organizationId: org.id, email: "rohit@example.com", passwordHash: "x" },
    });
    adminId = admin.id;
  });

  it("adds a note and logs activity", async () => {
    const form = new FormData();
    form.set("body", "Client wants to pause Google Ads for a month.");

    const result = await addNoteAction(clientId, adminId, form);

    expect(result).toEqual({ ok: true });
    const note = await prisma.clientNote.findFirst({ where: { clientId } });
    expect(note?.body).toBe("Client wants to pause Google Ads for a month.");
    expect(note?.authorAdminId).toBe(adminId);
    const activity = await prisma.clientActivity.findFirst({
      where: { clientId, eventType: "note.added" },
    });
    expect(activity).not.toBeNull();
  });

  it("rejects an empty note", async () => {
    const form = new FormData();
    form.set("body", "   ");

    const result = await addNoteAction(clientId, adminId, form);

    expect(result).toEqual({ error: "Note cannot be empty." });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- clients/actions.test`
Expected: FAIL — `addNoteAction is not a function`.

- [ ] **Step 3: Implement `addNoteAction`**

```typescript
// add to src/app/(app)/clients/actions.ts
export async function addNoteAction(
  clientId: number,
  authorAdminId: number,
  formData: FormData
): Promise<{ error: string } | { ok: true }> {
  const body = String(formData.get("body") ?? "").trim();
  if (!body) {
    return { error: "Note cannot be empty." };
  }

  await prisma.clientNote.create({
    data: { clientId, authorAdminId, body },
  });

  await prisma.clientActivity.create({
    data: {
      clientId,
      eventType: "note.added",
      summary: "Note added.",
    },
  });

  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- clients/actions.test`
Expected: all pass (10 from Task 11 + 2 new = 12).

- [ ] **Step 5: Build `NotesPanel`**

```tsx
// src/components/clients/NotesPanel.tsx
"use client";

import { useState } from "react";
import type { ClientNote } from "@/generated/prisma/client";
import { addNoteAction } from "@/app/(app)/clients/actions";

export function NotesPanel({
  clientId,
  adminId,
  notes,
}: {
  clientId: number;
  adminId: number;
  notes: ClientNote[];
}) {
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(formData: FormData) {
    const result = await addNoteAction(clientId, adminId, formData);
    setError("error" in result ? result.error : null);
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-6">
      <h2 className="mb-4 text-sm font-medium text-neutral-900">Notes</h2>
      <ul className="mb-4 space-y-3">
        {notes.map((note) => (
          <li key={note.id} className="text-sm text-neutral-700">
            {note.body}
            <div className="text-xs text-neutral-400">
              {note.createdAt.toLocaleDateString("en-IN")}
            </div>
          </li>
        ))}
        {notes.length === 0 && (
          <li className="text-sm text-neutral-400">No notes yet.</li>
        )}
      </ul>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <form action={handleAdd} className="flex gap-2">
        <textarea
          name="body"
          placeholder="Add a note…"
          required
          rows={2}
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="self-end rounded-lg bg-neutral-100 px-3 py-1.5 text-sm hover:bg-neutral-200"
        >
          Add
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 6: Render it on the detail page**

In `src/app/(app)/clients/[id]/page.tsx`:

```tsx
import { NotesPanel } from "@/components/clients/NotesPanel";
// ... below the ContactsPanel row:
<div className="col-span-2">
  <NotesPanel clientId={client.id} adminId={admin.id} notes={client.notes} />
</div>
```

- [ ] **Step 7: Run full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all pass clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add client notes panel

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Plan-level manual verification (do this once, after Task 12)

1. `npm run dev`, visit `http://localhost:3000/` while logged out → redirected to `/login`.
2. Log in with the Task 3 seeded credentials → land on the Overview stub.
3. Click every Sidebar link → every one renders (Clients is real, the rest show "coming soon").
4. Go to Clients → Add Client → create "ABC Interiors" with a phone/email → redirected to its detail page.
5. On the detail page: edit the business name, add a second contact, add a note → all three show up immediately and each produces a new row in the Activity panel.
6. Confirm `clientos_dev` (not `clientos_test`) now has the real "ABC Interiors" row: `mysql -u root clientos_dev -e "SELECT businessName, status FROM clients;"`.

