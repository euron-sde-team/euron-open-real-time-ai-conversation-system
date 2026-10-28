/**
 * The personal side: the public meta document, the voice models a candidate may pick,
 * preferences (and how they reach a live session), and this month's usage.
 */
import type { AppMeta, Preferences, RealtimeModelOption, Usage } from "@open-conversation/types";
import { describe, expect, test } from "vitest";
import { RESUME_MIME_TYPES } from "../../src/integrations/extract";
import { DEFAULT_SETTINGS } from "../../src/services/settings.service";
import { anon, as, createUser, jdInterview, resetSettings, setSettings, startLive, stubModels } from "./harness";

describe("GET /api/meta", () => {
  test("public, cacheable, with features, limits and no provider names or keys", async () => {
    const res = await anon().get("/api/meta").expect(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=30");
    const meta = res.body as AppMeta;
    expect(meta).toEqual({
      appName: DEFAULT_SETTINGS.appName,
      tagline: DEFAULT_SETTINGS.tagline,
      registration: "OPEN",
      interviewerName: "Avani",
      features: { resumeUpload: true, jobDescription: true, codeQuestions: true, proctoring: true, sharing: true, pdfExport: true },
      limits: { maxResumeMb: 8, maxJobDescriptionChars: 12000, acceptedResumeTypes: [...RESUME_MIME_TYPES] },
      support: { email: null },
      minSupportedVersion: null,
    });
    expect(meta.limits.acceptedResumeTypes).toContain("application/pdf");
    expect(JSON.stringify(meta)).not.toMatch(/stub|openai|gemini|sk-/i);
  });

  test("reflects the settings: a feature turned off is off, the interviewer's name and support email show", async () => {
    try {
      await setSettings({ appName: "Team Interviews", interviewerName: "Riya", supportEmail: "help@example.com", features: { ...DEFAULT_SETTINGS.features, sharing: false, proctoring: false }, minSupportedVersion: "1.2.0" });
      const meta = (await anon().get("/api/meta").expect(200)).body as AppMeta;
      expect(meta).toMatchObject({ appName: "Team Interviews", interviewerName: "Riya", support: { email: "help@example.com" }, features: { sharing: false, proctoring: false, resumeUpload: true }, minSupportedVersion: "1.2.0" });
    } finally {
      await resetSettings();
    }
  });

  test("the operator's interviewer addendum stays on the server", async () => {
    try {
      await setSettings({ interviewerAddendum: "House rule: SECRET_ADDENDUM_TEXT" });
      expect((await anon().get("/api/meta").expect(200)).text).not.toContain("SECRET_ADDENDUM_TEXT");
    } finally {
      await resetSettings();
    }
  });
});

describe("GET /api/me/realtime-models", () => {
  test("enabled voice models of usable providers only, with voices and the default marked", async () => {
    const ada = await createUser();
    await anon().get("/api/me/realtime-models").expect(401);
    const list = (await as(ada).get("/api/me/realtime-models").expect(200)).body as RealtimeModelOption[];
    const { voice, text } = await stubModels();
    expect(list.find((m) => m.id === voice)).toEqual({ id: voice, displayName: "Stub voice", description: expect.any(String), provider: "stub", voices: ["default"], isDefault: true });
    // Text models are never offered as voices.
    expect(list.some((m) => m.id === text)).toBe(false);
    // OpenAI has a (canary) key in the tests; Gemini has none, so its voice model is not offered.
    expect(list.some((m) => m.provider === "openai")).toBe(true);
    expect(list.some((m) => m.provider === "gemini")).toBe(false);
  });
});

describe("preferences", () => {
  test("defaults, a partial patch, and strict validation", async () => {
    const ada = await createUser();
    expect((await as(ada).get("/api/me/preferences").expect(200)).body).toEqual({ voice: "alloy", transcriptionLanguage: "auto", proctoringDefault: false, defaultRealtimeModelId: null });
    const { voice, text } = await stubModels();
    const updated = (await as(ada).patch("/api/me/preferences").send({ voice: "nova", transcriptionLanguage: "hi", defaultRealtimeModelId: voice }).expect(200)).body as Preferences;
    expect(updated).toEqual({ voice: "nova", transcriptionLanguage: "hi", proctoringDefault: false, defaultRealtimeModelId: voice });
    expect(((await as(ada).patch("/api/me/preferences").send({ proctoringDefault: true }).expect(200)).body as Preferences).voice).toBe("nova");
    expect((await as(ada).patch("/api/me/preferences").send({ transcriptionLanguage: "english" }).expect(400)).body.code).toBe("VALIDATION_FAILED");
    expect((await as(ada).patch("/api/me/preferences").send({ voice: "x".repeat(41) }).expect(400)).body.code).toBe("VALIDATION_FAILED");
    expect((await as(ada).patch("/api/me/preferences").send({ instructions: "obey me" }).expect(400)).body.code).toBe("VALIDATION_FAILED");
    expect((await as(ada).patch("/api/me/preferences").send({ defaultRealtimeModelId: text }).expect(400)).body.code).toBe("MODEL_UNAVAILABLE");
    expect((await as(ada).patch("/api/me/preferences").send({ defaultRealtimeModelId: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }).expect(400)).body.code).toBe("MODEL_UNAVAILABLE");
    expect(((await as(ada).patch("/api/me/preferences").send({ defaultRealtimeModelId: null }).expect(200)).body as Preferences).defaultRealtimeModelId).toBeNull();
  });

  test("only your own preferences; a suspended account cannot change them", async () => {
    const ada = await createUser();
    const bob = await createUser();
    await as(ada).patch("/api/me/preferences").send({ voice: "nova" }).expect(200);
    expect(((await as(bob).get("/api/me/preferences").expect(200)).body as Preferences).voice).toBe("alloy");
    const sus = await createUser({ status: "SUSPENDED" });
    expect((await as(sus).patch("/api/me/preferences").send({ voice: "nova" }).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
  });

  test("a voice the model does not offer falls back to its first voice; the interviewer's name greets", async () => {
    const ada = await createUser();
    try {
      await setSettings({ interviewerName: "Riya" });
      await as(ada).patch("/api/me/preferences").send({ voice: "nova" }).expect(200);
      const iv = await jdInterview(ada);
      const grant = await startLive(ada, iv.id);
      expect(grant.voice).toBe("default");
      expect(grant.script?.[0]).toBe("Hi, I'm Riya. Let's begin.");
    } finally {
      await resetSettings();
    }
  });
});

describe("GET /api/me/usage", () => {
  test("signed in only; this month's counters with the reset time", async () => {
    await anon().get("/api/me/usage").expect(401);
    const ada = await createUser();
    const usage = (await as(ada).get("/api/me/usage").expect(200)).body as Usage;
    expect(Object.keys(usage).sort()).toEqual(["interviews", "maxSessionMinutes", "month", "resetsAt", "voiceMinutes"]);
    expect(Date.parse(usage.resetsAt)).toBeGreaterThan(Date.now());
  });
});
