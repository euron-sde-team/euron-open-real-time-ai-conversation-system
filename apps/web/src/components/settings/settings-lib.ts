/** Pure helpers for the settings page (tested in test/settings). No React, no fetching. */
import type { Preferences, RealtimeModelOption, ShareSummary } from "@open-conversation/types";

/** Transcription languages offered in settings: ISO-639-1 codes, "auto" first. The API accepts any two-letter code. */
export const TRANSCRIPTION_LANGUAGES: { code: string; name: string }[] = [
  { code: "auto", name: "Detect automatically" },
  { code: "en", name: "English" },
  { code: "hi", name: "Hindi" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "pt", name: "Portuguese" },
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
  { code: "pl", name: "Polish" },
  { code: "tr", name: "Turkish" },
  { code: "ru", name: "Russian" },
  { code: "ar", name: "Arabic" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
];

/** The language list, with a saved code that is not on it kept as its own entry so the select never lies. */
export function languageOptions(current: string): { code: string; name: string }[] {
  return TRANSCRIPTION_LANGUAGES.some((l) => l.code === current) ? TRANSCRIPTION_LANGUAGES : [...TRANSCRIPTION_LANGUAGES, { code: current, name: current.toUpperCase() }];
}

/** The voice model that runs your interviews: your pick while it is still offered, else the deployment's default, else the first. */
export function effectiveModel(models: readonly RealtimeModelOption[], prefs: Pick<Preferences, "defaultRealtimeModelId">): RealtimeModelOption | null {
  return models.find((m) => m.id === prefs.defaultRealtimeModelId) ?? models.find((m) => m.isDefault) ?? models[0] ?? null;
}

/** The voice the room will use with this model: yours when the model offers it, else the model's first (as the server does). */
export function effectiveVoice(model: RealtimeModelOption | null, voice: string): string {
  if (!model || !model.voices.length) return voice;
  return model.voices.includes(voice) ? voice : model.voices[0]!;
}

/** The preference change for picking a model: the voice follows when the new model does not offer it. */
export function modelPatch(models: readonly RealtimeModelOption[], id: string | null, voice: string): Partial<Preferences> {
  const next = effectiveModel(models, { defaultRealtimeModelId: id });
  const v = effectiveVoice(next, voice);
  return v === voice ? { defaultRealtimeModelId: id } : { defaultRealtimeModelId: id, voice: v };
}

/** "alloy" to "Alloy". */
export function voiceLabel(v: string): string {
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
}

/** "No expiry", "Expired" or "Expires Mar 4, 2026". */
export function expiryLabel(s: Pick<ShareSummary, "expiresAt">, now = Date.now(), locale?: string): string {
  if (!s.expiresAt) return "No expiry";
  const t = new Date(s.expiresAt);
  if (Number.isNaN(t.getTime())) return "No expiry";
  if (t.getTime() <= now) return "Expired";
  return `Expires ${new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(t)}`;
}

/** "1 view", "12 views". */
export function viewsLabel(n: number, locale?: string): string {
  return `${new Intl.NumberFormat(locale).format(n)} ${n === 1 ? "view" : "views"}`;
}
