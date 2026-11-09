import { NextRequest, NextResponse } from "next/server";

// Optimistic gate only (the backend verifies the JWT on every request).
// Public on purpose (not in the matcher): /, /login, /tools, /compare, and /join/<code> (team invite links).
export function middleware(req: NextRequest) {
  if (!req.cookies.get("ss_token")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*", "/war-room/:path*", "/onboard/:path*", "/profile/:path*", "/agents/:path*", "/team/:path*", "/people/:path*"] };
