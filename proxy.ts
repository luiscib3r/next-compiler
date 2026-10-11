import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/proxy/redirect") {
    return NextResponse.redirect(new URL("/static", request.url));
  }
  if (pathname === "/proxy/rewrite") {
    return NextResponse.rewrite(new URL("/static", request.url));
  }
  if (pathname === "/proxy/json") {
    return NextResponse.json({ from: "proxy", pathname });
  }

  const response = NextResponse.next();
  response.headers.set("x-proxy", "1");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
