/** Meta, usage, voice models and preferences. Thin controllers. */
import type { Request, Response } from "express";
import { z } from "zod";
import { id, parse } from "../core/validate";
import { actorOf } from "../middleware/http";
import { appMeta } from "../services/meta.service";
import { realtimeOptions } from "../services/models.service";
import * as prefs from "../services/preferences.service";
import { usageOf } from "../services/quota.service";

export async function meta(_req: Request, res: Response) {
  res.setHeader("Cache-Control", "public, max-age=30");
  res.json(await appMeta());
}

export async function usage(req: Request, res: Response) {
  res.json(await usageOf(actorOf(req).id));
}

export async function realtimeModels(req: Request, res: Response) {
  actorOf(req);
  res.json(await realtimeOptions());
}

export async function getPreferences(req: Request, res: Response) {
  res.json(await prefs.preferencesOf(actorOf(req).id));
}

export async function updatePreferences(req: Request, res: Response) {
  const body = parse(
    z
      .object({
        voice: z.string().trim().min(1).max(40),
        transcriptionLanguage: z.string().regex(/^(auto|[a-z]{2})$/),
        proctoringDefault: z.boolean(),
        defaultRealtimeModelId: id().nullable(),
      })
      .partial()
      .strict(),
    req.body,
  );
  res.json(await prefs.updatePreferences(actorOf(req), body));
}
