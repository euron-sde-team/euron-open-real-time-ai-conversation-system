/** GET /api/meta: what a client needs before anyone signs in. Never a key, never a provider name. */
import type { AppMeta } from "@open-conversation/types";
import { config } from "../core/config";
import { RESUME_MIME_TYPES } from "../integrations/extract";
import { MAX_JOB_DESCRIPTION_CHARS } from "./interview/plan";
import { getSettings } from "./settings.service";

export async function appMeta(): Promise<AppMeta> {
  const s = await getSettings();
  return {
    appName: s.appName,
    tagline: s.tagline,
    registration: s.registration,
    interviewerName: s.interviewerName,
    features: { ...s.features },
    limits: { maxResumeMb: config.MAX_RESUME_MB, maxJobDescriptionChars: MAX_JOB_DESCRIPTION_CHARS, acceptedResumeTypes: [...RESUME_MIME_TYPES] },
    support: { email: s.supportEmail },
    minSupportedVersion: s.minSupportedVersion,
  };
}
