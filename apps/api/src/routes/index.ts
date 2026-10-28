/**
 * Every router and where it is mounted. scripts/gen-openapi.ts reads this file, so keep
 * one `[prefix, router]` entry per line.
 */
import type { Express } from "express";
import { router as admin } from "./admin.routes";
import { router as auth } from "./auth.routes";
import { router as interviews } from "./interviews.routes";
import { router as me } from "./me.routes";
import { router as meta } from "./meta.routes";
import { router as realtime } from "./realtime.routes";
import { router as shared } from "./shared.routes";
import { router as shares } from "./shares.routes";
import { router as users } from "./users.routes";

export const MOUNTS = [
  ["/api/auth", auth],
  ["/api/users", users],
  ["/api/meta", meta],
  ["/api/me", me],
  ["/api/interviews", interviews],
  ["/api/realtime", realtime],
  ["/api/shares", shares],
  ["/api/shared", shared],
  ["/api/admin", admin],
] as const;

export function mountRoutes(app: Express): void {
  for (const [prefix, router] of MOUNTS) app.use(prefix, router);
}
