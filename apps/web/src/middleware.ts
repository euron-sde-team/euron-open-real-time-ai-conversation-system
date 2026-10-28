import { NextResponse, type NextRequest } from "next/server";
import { realtimeOrigins } from "@/lib/runtime-env";

/**
 * Per-request Content-Security-Policy with a nonce. Next reads the nonce from the
 * request's CSP header and stamps it on its own scripts; `strict-dynamic` lets those
 * load the app chunks. Origins come from the runtime environment, so one image fits
 * every deployment:
 *   REALTIME_ORIGINS  where realtime voice connects from the browser: Gemini Live's
 *                     WebSocket. OpenAI's WebRTC handshake goes through this origin's
 *                     /api relay, and WebRTC media is not governed by connect-src.
 * 'wasm-unsafe-eval' lets the self-hosted MediaPipe face detector compile its
 * WebAssembly (proctoring); it does not allow eval of JavaScript.
 */
export function buildCsp(opts: { nonce: string; dev: boolean; realtime: string[] }): string {
  const realtime = opts.realtime.join(" ");
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${opts.nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${opts.dev ? " 'unsafe-eval'" : ""}`,
    // Radix positions popovers with inline styles; CodeMirror sizes its editor with them. Styles cannot run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${realtime}${opts.dev ? " ws: wss:" : ""}`.trim(),
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ];
  return directives.join("; ");
}

export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV !== "production",
    realtime: realtimeOrigins(process.env.REALTIME_ORIGINS),
  });

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|env.js|icon.svg|favicon.ico).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
