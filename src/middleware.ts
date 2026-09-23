import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";

// Cheap, cookie-presence-only check — NOT the authoritative auth check.
// The MySQL driver adapter cannot run in Edge middleware, so the real
// DB-backed session validation happens in `(app)/layout.tsx` via
// `requireAdmin()`. This middleware only avoids a round-trip render for
// the common case of a fully logged-out visitor.
//
// api/webhooks is the one deliberate exception: Razorpay's webhook POSTs
// carry no session cookie (it authenticates via HMAC signature instead —
// verified inside the route handler itself) and must never be redirected.
export function middleware(request: NextRequest) {
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);

  if (!hasSessionCookie && request.nextUrl.pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|api/webhooks|_next/static|_next/image|favicon.ico).*)"],
};
