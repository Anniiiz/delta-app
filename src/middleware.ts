import { NextResponse, type NextRequest } from "next/server";

/**
 * When exposed through a tunnel for Context.dev webhooks, only the webhook receiver is reachable from
 * outside. The dashboard and every credit-spending endpoint stay local unless ALLOW_REMOTE_APP=1.
 */
export function middleware(req: NextRequest) {
  if (process.env.ALLOW_REMOTE_APP === "1") return NextResponse.next();
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(":")[0];
  const viaTunnel = req.headers.has("cf-connecting-ip") || req.headers.has("cf-ray") || req.headers.has("ngrok-trace-id");
  const local = !viaTunnel && (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost"));
  if (local) return NextResponse.next();
  const p = req.nextUrl.pathname;
  if (p.startsWith("/api/webhooks/context/") || p.startsWith("/_next/static") || p === "/favicon.ico") return NextResponse.next();
  return new NextResponse("Not available remotely", { status: 403 });
}

export const config = { matcher: "/:path*" };
