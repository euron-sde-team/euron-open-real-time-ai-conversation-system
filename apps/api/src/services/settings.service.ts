/**
 * Deployment settings: one JSON document in the `settings` table, merged over the
 * defaults below, cached for a few seconds per process. Admins edit it through
 * /api/admin/settings; every save is audited with the before and after values.
 */
import type { AppSettings } from "@open-conversation/types";
import { config } from "../core/config";
import { db, type Executor } from "../db/kysely";

export const DEFAULT_SETTINGS: AppSettings = {
  appName: config.PRODUCT_NAME,
  tagline: "Practise interviews out loud with an AI interviewer.",
  registration: "OPEN",
  allowedEmailDomains: [],
  supportEmail: null,
  interviewerName: "Avani",
  interviewerAddendum: "",
  features: { resumeUpload: true, jobDescription: true, codeQuestions: true, proctoring: true, sharing: true, pdfExport: true },
  retentionDays: null,
  minSupportedVersion: null,
};

const TTL_MS = 5_000;
let cache: { at: number; value: AppSettings } | null = null;

/** Groups merge key by key, so a stored document from an older release keeps working. */
export function mergeSettings(base: AppSettings, stored: Partial<AppSettings>): AppSettings {
  return {
    ...base,
    ...stored,
    features: { ...base.features, ...(stored.features ?? {}) },
  };
}

export async function getSettings(exec: Executor = db): Promise<AppSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const row = await exec.selectFrom("settings").select("value").where("key", "=", "app").executeTakeFirst();
  const value = mergeSettings(DEFAULT_SETTINGS, (row?.value as Partial<AppSettings>) ?? {});
  cache = { at: Date.now(), value };
  return value;
}

export async function saveSettings(patch: Partial<AppSettings>, actorId: string | null, exec: Executor = db): Promise<{ before: AppSettings; after: AppSettings }> {
  const before = await getSettings(exec);
  const after = mergeSettings(before, patch);
  await exec
    .insertInto("settings")
    .values({ key: "app", value: JSON.stringify(after), updated_by: actorId })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value: JSON.stringify(after), updated_by: actorId, updated_at: new Date() }))
    .execute();
  cache = null;
  return { before, after };
}

export function clearSettingsCache(): void {
  cache = null;
}

/** The name to show for this deployment (emails, page titles). */
export async function appName(exec: Executor = db): Promise<string> {
  return (await getSettings(exec)).appName?.trim() || config.PRODUCT_NAME;
}
