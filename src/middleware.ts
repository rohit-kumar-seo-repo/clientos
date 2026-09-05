import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";

// Cheap, cookie-presence-only check — NOT the authoritative auth check.
// The MySQL driver adapter cannot run in Edge middleware, so the real
// DB-backed session validation happens in `(app)/layout.tsx` via
// `requireAdmin()`. This middleware only avoids a round-trip render for
// the common case of a fully logged-out visitor.
export function middleware(request: NextRequest) {
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);

  if (!hasSessionCookie && request.nextUrl.pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
