/**
 * Global authentication middleware for all /api/* management routes.
 *
 * Routes in PUBLIC_API_ROUTES are always accessible without authentication.
 * All other /api/* routes require authentication when auth is configured.
 *
 * This provides defense-in-depth on top of per-route requireManagementAuth()
 * guards that already exist on some routes.
 *
 * Note: isAuthenticated() and isAuthRequired() from apiAuth.ts use next/headers
 * cookies() and SQLite (getSettings()) which are not available in middleware
 * (Edge runtime). Auth is handled inline here using jose and env vars.
 */
import { NextResponse, NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { isPublicApiRoute } from "@/shared/utils/apiAuth";

/**
 * Determine if auth is required based on environment variables only.
 * This is a conservative check — if JWT_SECRET or INITIAL_PASSWORD is set,
 * we assume auth is configured. Per-route requireManagementAuth() guards
 * provide full DB-backed auth checking.
 */
function isAuthConfigured(): boolean {
  return Boolean(process.env.JWT_SECRET || process.env.INITIAL_PASSWORD);
}

/**
 * Verify JWT from cookie using jose (middleware-safe, no next/headers dependency).
 */
async function verifyJwtCookie(request: NextRequest): Promise<boolean> {
  if (!process.env.JWT_SECRET) return false;
  const token = request.cookies.get("auth_token")?.value;
  if (!token) return false;
  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Only guard API routes
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Allow public routes through unconditionally
  if (isPublicApiRoute(pathname)) {
    return NextResponse.next();
  }

  // If auth is not configured (no JWT_SECRET or INITIAL_PASSWORD), allow all.
  // Per-route requireManagementAuth() does the full DB-backed check when needed.
  if (!isAuthConfigured()) {
    return NextResponse.next();
  }

  // Check JWT cookie (middleware-safe)
  if (await verifyJwtCookie(request)) {
    return NextResponse.next();
  }

  // Check Bearer token — presence check only; full API key validation happens
  // in per-route requireManagementAuth() guards which have DB access.
  const authHeader = request.headers.get("authorization");
  const hasBearerToken =
    typeof authHeader === "string" && authHeader.trim().toLowerCase().startsWith("bearer ");

  if (hasBearerToken) {
    // Let through for per-route validation
    return NextResponse.next();
  }

  // Unauthenticated — return 401
  return NextResponse.json(
    {
      error: "Authentication required",
      type: "invalid_request",
    },
    { status: 401 }
  );
}

export const config = {
  matcher: "/api/:path*",
};
