/** Pure helpers for the /admin control plane (tested in test/admin). No React, no fetching. */
import { isApiError } from "@open-conversation/api-client";
import type { AdminModel, AppSettings, InterviewSource, InterviewStatus, ModelKind, ProviderKind, UserRole, UserStatus } from "@open-conversation/types";
import { errorMessage } from "./errors";

// ─── Numbers and dates ──────────────────────────────────────────────────────

/** 12,345 */
export function formatCount(v: number, locale?: string): string {
  return new Intl.NumberFormat(locale).format(v);
}

/** 3.5M, 950, 12K: for token totals that run into the millions. */
export function formatCompact(v: number, locale?: string): string {
  return new Intl.NumberFormat(locale, { notation: v >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(v);
}

/** "Mar 4, 2026" */
export function shortDate(iso: string | null | undefined, locale?: string): string {
  if (!iso) return "";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric" }).format(t);
}

/** YYYY-MM-DD of a moment in UTC (the stats API counts UTC days). */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const RANGE_PRESETS = [7, 30, 90] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

/** The URL's ?range= as a preset; anything else is the 30 day default. */
export function parsePreset(v: string | null | undefined): RangePreset {
  const n = Number(v);
  return (RANGE_PRESETS as readonly number[]).includes(n) ? (n as RangePreset) : 30;
}

/** The last `days` UTC days, today included. */
export function presetRange(days: number, now = new Date()): { from: string; to: string } {
  const from = new Date(now.getTime() - (days - 1) * 86_400_000);
  return { from: utcDay(from), to: utcDay(now) };
}

/** "$12.40", or "$0.0031" for sums under a cent, so a small estimate never reads as zero. */
export function formatUsd(v: number, locale?: string): string {
  const small = v > 0 && v < 0.01;
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: small ? 4 : 2 }).format(v);
}

/** "42 min", "1,250 min": voice time is counted in whole and partial minutes. */
export function formatMinutes(v: number, locale?: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v)} min`;
}

/** A 1 to 100 score, or "Not scored" before any answer is scored. */
export function scoreLabel(v: number | null | undefined): string {
  return v === null || v === undefined ? "Not scored" : String(Math.round(v));
}

// ─── Accounts ───────────────────────────────────────────────────────────────

export const ROLE_LABEL: Record<UserRole, string> = { USER: "User", ADMIN: "Admin" };

export const STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: "Active",
  PENDING_VERIFICATION: "Not verified",
  SUSPENDED: "Suspended",
  BANNED: "Banned",
  DEACTIVATED: "Erased",
};

export type StatusTone = "success" | "warning" | "danger" | "muted";
export const STATUS_TONE: Record<UserStatus, StatusTone> = {
  ACTIVE: "success",
  PENDING_VERIFICATION: "muted",
  SUSPENDED: "warning",
  BANNED: "danger",
  DEACTIVATED: "muted",
};

/** Which account actions make sense for a target, given who is looking. Mirrors the API rules. */
export function accountActions(target: { id: string; role: UserRole; status: UserStatus }, actorId: string | undefined) {
  const self = target.id === actorId;
  const erased = target.status === "DEACTIVATED";
  const admin = target.role === "ADMIN";
  return {
    self,
    erased,
    makeAdmin: !self && !erased && !admin && target.status !== "BANNED",
    removeAdmin: !self && admin,
    // The API protects admins: demote first.
    suspend: !self && !erased && !admin && (target.status === "ACTIVE" || target.status === "PENDING_VERIFICATION"),
    unsuspend: !self && target.status === "SUSPENDED",
    ban: !self && !erased && !admin && target.status !== "BANNED",
    unban: !self && target.status === "BANNED",
    erase: !self && !erased && !admin,
  };
}

/**
 * Admin-facing copy for an error. The control plane's own codes carry exact server
 * messages ("Demote an admin before banning them"), so those win over generic copy.
 */
const ADMIN_COPY: Record<string, string> = {
  LAST_ADMIN: "This is the last admin. Make someone else an admin first.",
  SELF_ACTION: "You cannot do this to your own account.",
  TIER_IS_DEFAULT: "This is the default tier. Make another tier the default first.",
};
const SERVER_MESSAGE_CODES = new Set([
  "TARGET_PROTECTED",
  "INVALID_STATUS",
  "USER_ERASED",
  "ALREADY_ERASED",
  "DAYS_INVALID",
  "TIER_NAME_TAKEN",
  "TIER_DEFAULT_REQUIRED",
  "BASE_URL_REQUIRED",
  "BASE_URL_INVALID",
  "STUB_IN_PRODUCTION",
  "PROVIDER_SLUG_TAKEN",
  "MODEL_DUPLICATE",
  "SETTINGS_INVALID",
]);

export function adminErrorMessage(e: unknown): string {
  if (isApiError(e)) {
    if (ADMIN_COPY[e.code]) return ADMIN_COPY[e.code]!;
    if (SERVER_MESSAGE_CODES.has(e.code) && e.message) return sentence(e.message);
  }
  return errorMessage(e);
}

const sentence = (s: string) => {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

// ─── Quotas ─────────────────────────────────────────────────────────────────

/** "200,000" or "Unlimited". */
export function limitLabel(v: number | null, locale?: string): string {
  return v === null ? "Unlimited" : formatCount(v, locale);
}

/**
 * A limit input: empty means unlimited (null); otherwise a whole number from 0.
 * Returns undefined when the text is not a valid limit.
 */
export function parseLimit(text: string): number | null | undefined {
  const t = text.replace(/[\s,_]/g, "");
  if (!t) return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isSafeInteger(n) && n <= 1_000_000_000_000 ? n : undefined;
}

export function limitText(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}

// ─── Providers and models ───────────────────────────────────────────────────

export const PROVIDER_KIND_LABEL: Record<ProviderKind, string> = {
  OPENAI: "OpenAI",
  ANTHROPIC: "Anthropic",
  GEMINI: "Google Gemini",
  OPENAI_COMPATIBLE: "OpenAI compatible",
  STUB: "Local stub",
};

export const MODEL_KINDS: { kind: ModelKind; label: string; description: string }[] = [
  { kind: "REALTIME", label: "Voice", description: "Run the live interview: the interviewer speaks and listens in real time." },
  { kind: "TEXT", label: "Text", description: "Write interview plans and score answers." },
];

/** Provider slugs, as the API accepts them: 3 to 40 lowercase letters, digits and inner hyphens. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** Models in each kind, in catalogue order (sort order, then name). */
export function groupModels(models: readonly AdminModel[]): Record<ModelKind, AdminModel[]> {
  const out: Record<ModelKind, AdminModel[]> = { TEXT: [], REALTIME: [] };
  for (const m of models) out[m.kind].push(m);
  for (const k of Object.keys(out) as ModelKind[]) out[k].sort((a, b) => a.sortOrder - b.sortOrder || a.displayName.localeCompare(b.displayName));
  return out;
}

/**
 * A price input: empty means not set (null); otherwise a number from 0.
 * Returns undefined when the text is not a valid price.
 */
export function parsePrice(text: string): number | null | undefined {
  const t = text.trim().replace(/^\$/, "");
  if (!t) return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n <= 10_000 ? n : undefined;
}

export function priceText(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}

/** Split a typed list of voices (commas, spaces or new lines) into clean, unique names, in order. */
export function parseVoices(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean))];
}

// ─── Interviews ─────────────────────────────────────────────────────────────

export const INTERVIEW_STATUS_LABEL: Record<InterviewStatus, string> = {
  PLANNING: "Planning",
  PLAN_FAILED: "Plan failed",
  READY: "Ready",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
};

export const INTERVIEW_STATUS_TONE: Record<InterviewStatus, StatusTone> = {
  PLANNING: "muted",
  PLAN_FAILED: "danger",
  READY: "muted",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
};

export const INTERVIEW_SOURCE_LABEL: Record<InterviewSource, string> = { RESUME: "Resume", JOB_DESCRIPTION: "Job description" };

// ─── Settings ───────────────────────────────────────────────────────────────

export type SettingsGroup = "general" | "signup" | "features" | "interviewer" | "data" | "mobile";

export const SETTINGS_GROUP_KEYS: Record<SettingsGroup, (keyof AppSettings)[]> = {
  general: ["appName", "tagline", "supportEmail"],
  signup: ["registration", "allowedEmailDomains"],
  features: ["features"],
  interviewer: ["interviewerName", "interviewerAddendum"],
  data: ["retentionDays"],
  mobile: ["minSupportedVersion"],
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The PATCH body for a settings draft: only the keys that changed, with nested groups
 * (features) narrowed to their changed keys. The server merges key by key.
 */
export function settingsPatch(base: AppSettings, draft: AppSettings): Partial<AppSettings> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as (keyof AppSettings)[]) {
    const a = base[key];
    const b = draft[key];
    if (same(a, b)) continue;
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      const ao = a as unknown as Record<string, unknown>;
      out[key] = Object.fromEntries(Object.entries(b as unknown as Record<string, unknown>).filter(([k, v]) => !same(ao[k], v)));
    } else out[key] = b;
  }
  return out as Partial<AppSettings>;
}

/** Which form groups have unsaved changes. */
export function dirtyGroups(base: AppSettings, draft: AppSettings): SettingsGroup[] {
  const patch = settingsPatch(base, draft);
  return (Object.keys(SETTINGS_GROUP_KEYS) as SettingsGroup[]).filter((g) => SETTINGS_GROUP_KEYS[g].some((k) => k in patch));
}

/** The patch restricted to one group's keys (each group saves on its own). */
export function groupPatch(base: AppSettings, draft: AppSettings, group: SettingsGroup): Partial<AppSettings> {
  const patch = settingsPatch(base, draft);
  return Object.fromEntries(Object.entries(patch).filter(([k]) => SETTINGS_GROUP_KEYS[group].includes(k as keyof AppSettings))) as Partial<AppSettings>;
}

/** Field problems in a draft, by key, matching the server's rules. */
export function settingsErrors(s: AppSettings): Partial<Record<keyof AppSettings, string>> {
  const e: Partial<Record<keyof AppSettings, string>> = {};
  if (!s.appName.trim()) e.appName = "Give the app a name.";
  else if (s.appName.trim().length > 60) e.appName = "Use 60 characters or fewer.";
  if (s.tagline.length > 160) e.tagline = "Use 160 characters or fewer.";
  if (s.supportEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.supportEmail.trim())) e.supportEmail = "Enter a valid email address, or leave it empty.";
  if (s.registration === "INVITE_ONLY" && !s.allowedEmailDomains.length) e.allowedEmailDomains = "Invite-only sign-up needs at least one allowed domain.";
  if (!s.interviewerName.trim()) e.interviewerName = "Give the interviewer a name.";
  else if (s.interviewerName.trim().length > 40) e.interviewerName = "Use 40 characters or fewer.";
  if (s.interviewerAddendum.length > 2000) e.interviewerAddendum = "Use 2,000 characters or fewer.";
  if (s.retentionDays !== null && !(Number.isInteger(s.retentionDays) && s.retentionDays >= 7 && s.retentionDays <= 3650)) e.retentionDays = "Between 7 and 3,650 days.";
  if (s.minSupportedVersion !== null && !/^\d+\.\d+\.\d+$/.test(s.minSupportedVersion)) e.minSupportedVersion = "Use a version like 1.4.0, or leave it empty.";
  return e;
}

/** Split a pasted list of domains (commas, spaces or new lines) into clean, unique entries. */
export function parseDomains(input: string, existing: readonly string[] = []): { added: string[]; invalid: string[] } {
  const seen = new Set(existing);
  const added: string[] = [];
  const invalid: string[] = [];
  for (const raw of input.split(/[\s,;]+/)) {
    const d = raw.trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!d) continue;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) invalid.push(raw.trim());
    else if (!seen.has(d)) {
      seen.add(d);
      added.push(d);
    }
  }
  return { added, invalid };
}

// ─── Audit ──────────────────────────────────────────────────────────────────

/** "user.quota_override" to "User quota override". */
export function humanizeAction(action: string): string {
  const s = action.replace(/[._]/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Pretty JSON for the audit detail (stable key order, two-space indent). */
export function prettyJson(v: unknown): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === "object") return Object.fromEntries(Object.keys(x as Record<string, unknown>).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])]));
    return x;
  };
  return JSON.stringify(sort(v), null, 2);
}

// ─── Shared with the account center ─────────────────────────────────────────

/** "Chrome on macOS" from a user agent string. (Used by the account security section.) */
export function summarizeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : /curl|node|okhttp|axios/i.test(ua)
              ? "App or script"
              : "Browser";
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X|Macintosh/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  return os ? `${browser} on ${os}` : browser;
}
