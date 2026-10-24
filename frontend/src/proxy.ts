import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic check only: no refresh cookie means no session, so skip straight to /login.
 * The backend still authenticates every API call (an expired session is handled by the API client).
 */
export function proxy(request: NextRequest) {
  const hasSession =
    request.cookies.has("refresh") || request.cookies.has("__Host-refresh");
  if (hasSession) return NextResponse.next();

  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
