/**
 * The single source of truth for the session cookie's name.
 *
 * Lives in its own dependency-free leaf module (rather than directly in
 * `@/lib/session`) purely so `src/middleware.ts` can import it: middleware
 * runs in the Edge runtime, and importing `@/lib/session` there would pull
 * in `@/lib/db`'s module-scope PrismaClient + MariaDB driver, neither of
 * which can run on the Edge. Server-side code should keep importing
 * `SESSION_COOKIE_NAME` from `@/lib/session`, which re-exports it.
 */
export const SESSION_COOKIE_NAME = "co_session";
