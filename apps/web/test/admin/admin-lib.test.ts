import { describe, expect, it } from "vitest";
import { ApiError } from "@open-conversation/api-client";
import type { AdminModel, AppSettings } from "@open-conversation/types";
import {
  accountActions, adminErrorMessage, dirtyGroups, formatMinutes, formatUsd, groupModels, groupPatch, limitLabel, parseDomains, parseLimit, parsePreset, parsePrice, parseVoices, presetRange, scoreLabel,
  settingsErrors, settingsPatch,
} from "@/lib/admin";
import { ADMIN_NAV, activeNavHref, navLabel } from "@/components/admin/shell/nav";
import { tierDraftErrors } from "@/components/admin/pages/quotas";
import { modelDraftBody, modelDraftErrors, priceLine } from "@/components/admin/pages/models";
import { fromForm, toForm } from "@/components/admin/pages/settings";
import { auditAction } from "@/components/admin/pages/audit";

const settings: AppSettings = {
  appName: "Mock Interviews",
  tagline: "Practise out loud",
  registration: "OPEN",
  allowedEmailDomains: [],
  supportEmail: null,
  interviewerName: "Avani",
  interviewerAddendum: "",
  features: { resumeUpload: true, jobDescription: true, codeQuestions: true, proctoring: true, sharing: true, pdfExport: true },
  retentionDays: null,
  minSupportedVersion: null,
};

describe("navigation", () => {
  it("lists the eight areas in order", () => {
    expect(ADMIN_NAV.map((i) => i.label)).toEqual(["Overview", "Users", "Interviews", "Models", "Quotas", "Shared links", "Settings", "Audit log"]);
  });
  it("matches the longest href, and /admin only itself", () => {
    expect(activeNavHref("/admin")).toBe("/admin");
    expect(activeNavHref("/admin/users")).toBe("/admin/users");
    expect(activeNavHref("/admin/users/abc")).toBe("/admin/users");
    expect(activeNavHref("/admin/usersx")).toBeNull();
    expect(navLabel("/admin/shares")).toBe("Shared links");
    expect(navLabel("/admin/interviews")).toBe("Interviews");
  });
});

describe("date ranges", () => {
  it("parses presets and falls back to 30 days", () => {
    expect(parsePreset("7")).toBe(7);
    expect(parsePreset("90")).toBe(90);
    expect(parsePreset("12")).toBe(30);
    expect(parsePreset("")).toBe(30);
  });
  it("counts UTC days, today included", () => {
    expect(presetRange(7, new Date("2026-10-27T23:30:00Z"))).toEqual({ from: "2026-10-21", to: "2026-10-27" });
    expect(presetRange(1, new Date("2026-01-01T00:10:00Z"))).toEqual({ from: "2026-01-01", to: "2026-01-01" });
  });
  it("formats money, minutes and scores", () => {
    expect(formatUsd(12.4, "en-US")).toBe("$12.40");
    expect(formatUsd(0.0031, "en-US")).toBe("$0.0031");
    expect(formatUsd(0, "en-US")).toBe("$0.00");
    expect(formatMinutes(42, "en-US")).toBe("42 min");
    expect(formatMinutes(1250, "en-US")).toBe("1,250 min");
    expect(scoreLabel(null)).toBe("Not scored");
    expect(scoreLabel(71.6)).toBe("72");
  });
});

describe("account actions", () => {
  const base = { id: "u1", role: "USER" as const, status: "ACTIVE" as const };
  it("offers suspend, ban, erase and make admin for an active user", () => {
    const a = accountActions(base, "me");
    expect(a).toMatchObject({ makeAdmin: true, removeAdmin: false, suspend: true, unsuspend: false, ban: true, unban: false, erase: true });
  });
  it("protects admins: only remove admin", () => {
    const a = accountActions({ ...base, role: "ADMIN" }, "me");
    expect(a).toMatchObject({ removeAdmin: true, makeAdmin: false, suspend: false, ban: false, erase: false });
  });
  it("offers nothing on your own account", () => {
    const a = accountActions({ ...base, id: "me", role: "ADMIN" }, "me");
    expect(a.self).toBe(true);
    expect(Object.entries(a).filter(([k, v]) => k !== "self" && v)).toEqual([]);
  });
  it("offers the way back for suspended and banned accounts", () => {
    expect(accountActions({ ...base, status: "SUSPENDED" }, "me")).toMatchObject({ unsuspend: true, suspend: false, ban: true });
    expect(accountActions({ ...base, status: "BANNED" }, "me")).toMatchObject({ unban: true, ban: false, makeAdmin: false });
    expect(accountActions({ ...base, status: "DEACTIVATED" }, "me")).toMatchObject({ erased: true, erase: false, ban: false, suspend: false });
  });
});

describe("admin error copy", () => {
  const err = (code: string, message: string, status = 409) => new ApiError({ status, code, message });
  it("explains the guard rails", () => {
    expect(adminErrorMessage(err("LAST_ADMIN", "x"))).toMatch(/last admin/);
    expect(adminErrorMessage(err("SELF_ACTION", "x", 403))).toBe("You cannot do this to your own account.");
  });
  it("uses the server's exact words for its own codes", () => {
    expect(adminErrorMessage(err("TARGET_PROTECTED", "Demote an admin before banning them", 403))).toBe("Demote an admin before banning them.");
    expect(adminErrorMessage(err("TIER_NAME_TAKEN", "A tier with this name exists"))).toBe("A tier with this name exists.");
  });
});

describe("limits", () => {
  it("reads empty as unlimited and rejects non-numbers", () => {
    expect(parseLimit("")).toBeNull();
    expect(parseLimit(" 200,000 ")).toBe(200000);
    expect(parseLimit("0")).toBe(0);
    expect(parseLimit("-1")).toBeUndefined();
    expect(parseLimit("1.5")).toBeUndefined();
    expect(parseLimit("abc")).toBeUndefined();
  });
  it("labels null as Unlimited", () => {
    expect(limitLabel(null)).toBe("Unlimited");
    expect(limitLabel(20, "en-US")).toBe("20");
  });
  it("validates a tier draft like the API", () => {
    expect(tierDraftErrors({ name: "Pro", interviews: "", minutes: "300", maxSessionMinutes: "30" })).toEqual({});
    expect(Object.keys(tierDraftErrors({ name: " ", interviews: "x", minutes: "1", maxSessionMinutes: "121" })).sort()).toEqual(["interviews", "maxSessionMinutes", "name"]);
  });
});

describe("models", () => {
  const m = (over: Partial<AdminModel>): AdminModel => ({
    id: "m",
    providerId: "openai",
    kind: "TEXT",
    modelRef: "x",
    displayName: "X",
    description: "",
    maxOutputTokens: 4096,
    voices: [],
    inputUsdPerMtok: null,
    outputUsdPerMtok: null,
    usdPerMinute: null,
    enabled: true,
    isDefault: false,
    sortOrder: 0,
    ...over,
  });
  it("groups by kind in sort order", () => {
    const g = groupModels([m({ id: "b", displayName: "B", sortOrder: 2 }), m({ id: "rt", kind: "REALTIME" }), m({ id: "a", displayName: "A", sortOrder: 1 })]);
    expect(g.TEXT.map((x) => x.id)).toEqual(["a", "b"]);
    expect(g.REALTIME.map((x) => x.id)).toEqual(["rt"]);
  });
  it("reads prices and voices", () => {
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("$2.50")).toBe(2.5);
    expect(parsePrice("-1")).toBeUndefined();
    expect(parsePrice("abc")).toBeUndefined();
    expect(parseVoices("alloy, verse  alloy\ncoral")).toEqual(["alloy", "verse", "coral"]);
  });
  it("writes prices as one line", () => {
    expect(priceLine(m({}))).toBe("No price set");
    expect(priceLine(m({ inputUsdPerMtok: 2.5, outputUsdPerMtok: 10 }))).toBe("$2.50 in, $10.00 out per 1M tokens");
    expect(priceLine(m({ kind: "REALTIME", usdPerMinute: 0.06 }))).toBe("$0.06 a minute");
  });
  it("validates a model draft like the API", () => {
    const ok = {
      providerId: "openai",
      kind: "REALTIME" as const,
      modelRef: "gpt-realtime",
      displayName: "Realtime",
      description: "",
      maxOutputTokens: "8192",
      voices: "alloy, verse",
      inputUsdPerMtok: "",
      outputUsdPerMtok: "",
      usdPerMinute: "0.06",
      enabled: true,
      isDefault: false,
      sortOrder: "0",
    };
    expect(modelDraftErrors(ok)).toEqual({});
    expect(Object.keys(modelDraftErrors({ ...ok, usdPerMinute: "500", inputUsdPerMtok: "x", modelRef: "" })).sort()).toEqual(["inputUsdPerMtok", "modelRef", "usdPerMinute"]);
    expect(modelDraftBody(ok)).toMatchObject({ voices: ["alloy", "verse"], usdPerMinute: 0.06, inputUsdPerMtok: null, maxOutputTokens: 8192 });
    // Voices and the per-minute price only travel with voice models.
    expect(modelDraftBody({ ...ok, kind: "TEXT" })).toMatchObject({ voices: [], usdPerMinute: null });
  });
});

describe("settings", () => {
  it("patches only what changed, nested groups narrowed to their keys", () => {
    const draft = { ...settings, tagline: "New", interviewerName: "Sam", features: { ...settings.features, proctoring: false } };
    expect(settingsPatch(settings, draft)).toEqual({ tagline: "New", interviewerName: "Sam", features: { proctoring: false } });
    expect(dirtyGroups(settings, draft)).toEqual(["general", "features", "interviewer"]);
    expect(groupPatch(settings, draft, "features")).toEqual({ features: { proctoring: false } });
    expect(settingsPatch(settings, settings)).toEqual({});
  });
  it("round-trips the form, empty boxes as null", () => {
    expect(fromForm(toForm(settings))).toEqual(settings);
    const f = toForm(settings);
    expect(fromForm({ ...f, retentionDays: "90", supportEmail: " help@example.com ", minSupportedVersion: "1.2.0" })).toMatchObject({ retentionDays: 90, supportEmail: "help@example.com", minSupportedVersion: "1.2.0" });
  });
  it("validates like the API", () => {
    expect(settingsErrors(settings)).toEqual({});
    const e = settingsErrors({ ...settings, appName: "", interviewerName: " ", registration: "INVITE_ONLY", retentionDays: 3, minSupportedVersion: "1.2", supportEmail: "nope" });
    expect(Object.keys(e).sort()).toEqual(["allowedEmailDomains", "appName", "interviewerName", "minSupportedVersion", "retentionDays", "supportEmail"]);
    expect(settingsErrors({ ...settings, interviewerAddendum: "x".repeat(2001) })).toHaveProperty("interviewerAddendum");
  });
  it("cleans pasted domains", () => {
    expect(parseDomains("Example.com, @team.org https://x.io/path bad", ["team.org"])).toEqual({ added: ["example.com", "x.io"], invalid: ["bad"] });
  });
});

describe("audit filters", () => {
  it("prefers a typed prefix over the group tab", () => {
    expect(auditAction("user", "")).toBe("user.");
    expect(auditAction("user", " model.save ")).toBe("model.save");
    expect(auditAction("all", "")).toBe("");
    expect(auditAction("nope", "")).toBe("");
  });
});
