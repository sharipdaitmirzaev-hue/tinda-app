import { NextResponse, type NextRequest } from "next/server";
import { assert_csrf_origin } from "@/lib/security/csrf";
import { apply_security_headers } from "@/lib/security/headers";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    const csrf = assert_csrf_origin({
      method: request.method,
      headers: request.headers,
    });
    if (!csrf.ok) {
      const response = NextResponse.json(
        {
          error: {
            code: "forbidden",
            message: csrf.message,
          },
        },
        { status: 403 },
      );
      apply_security_headers(response.headers);
      return response;
    }
  }

  const response = NextResponse.next();
  apply_security_headers(response.headers);
  return response;
}

export const config = {
  matcher: [
    /*
     * Apply to pages and API, skip Next internals and static assets.
     */
    "/((?!_next/static|_next/image|favicon.ico|uploads/|images/).*)",
  ],
};
