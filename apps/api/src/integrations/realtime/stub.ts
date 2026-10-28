/**
 * The stub provider: no network, no key. The credential is a signed, expiring token the
 * web app's stub transport checks only for shape; the interviewer "speaks" the script with
 * the browser's speech synthesis and the candidate types or dictates. Used for local
 * development and the end-to-end tests. Never offered in production: the starter catalogue
 * adds the stub provider only outside production, and an admin cannot create one there.
 */
import crypto from "node:crypto";
import { config } from "../../core/config";
import type { RealtimeAdapter } from "./types";

export const stubRealtime: RealtimeAdapter = {
  provider: "stub",
  async mint(req) {
    const expiresAt = new Date(Date.now() + req.connectTtlSeconds * 1000);
    const payload = Buffer.from(JSON.stringify({ m: req.model, exp: expiresAt.getTime(), n: crypto.randomBytes(8).toString("hex") })).toString("base64url");
    const sig = crypto.createHmac("sha256", config.JWT_SECRET).update(`stub-realtime.${payload}`).digest("base64url");
    return { credential: `stub_${payload}.${sig}`, expiresAt, connectUrl: null };
  },
};
