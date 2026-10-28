import { describe, expect, it } from "vitest";
import { buildCsp } from "@/middleware";
import { realtimeOrigins, serverEnv } from "@/lib/runtime-env";

describe("content security policy", () => {
  it("is strict by default, allows the realtime origin, WebAssembly and no frames", () => {
    const csp = buildCsp({ nonce: "abc", dev: false, realtime: ["wss://generativelanguage.googleapis.com"] });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic' 'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' wss://generativelanguage.googleapis.com");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/connect-src[^;]* (https|wss):(;| )/);
  });
  it("allows eval and websockets for the dev server only", () => {
    expect(buildCsp({ nonce: "n", dev: true, realtime: [] })).toContain("'unsafe-eval'");
    expect(buildCsp({ nonce: "n", dev: false, realtime: [] })).not.toContain("ws:");
  });
  it("parses realtime origins, defaults to Gemini Live, and drops anything that is not a wss or https origin", () => {
    expect(realtimeOrigins("wss://live.example.org, https://rt.example.org/ ,javascript:x,http://plain.example,wss://a.example/path")).toEqual(["wss://live.example.org", "https://rt.example.org"]);
    expect(realtimeOrigins(undefined)).toEqual(["wss://generativelanguage.googleapis.com"]);
    expect(realtimeOrigins(" ")).toEqual(["wss://generativelanguage.googleapis.com"]);
  });
});

describe("runtime env", () => {
  it("reads the container environment with defaults", () => {
    expect(serverEnv({})).toEqual({ productName: "Euron Open Conversation", apiUrl: "/api" });
    expect(serverEnv({ PRODUCT_NAME: " Acme Assistant ", PUBLIC_API_URL: "https://api.example.org/api" })).toMatchObject({ productName: "Acme Assistant", apiUrl: "https://api.example.org/api" });
  });
});
