/**
 * The /admin control plane: admins only; accounts (list, detail, role, suspend, ban,
 * erase, tier, override); quota tiers; providers and models (never a key, never provider
 * text); settings (audited); integrations; stats; interview metadata (never answers or
 * transcripts); shares; the audit trail. Every test restores any shared state it changes
 * (the default tier, settings, the catalogue).
 */
import type { AdminInterviewRow, AdminModel, AdminProvider, AdminStats, AdminUserDetail, AdminUserRow, AppSettings, AuditEntry, IntegrationStatus, ModelTestResult, Page, QuotaTier, RealtimeModelOption } from "@open-conversation/types";
import { describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { clearModelCache } from "../../src/services/models.service";
import { DEFAULT_SETTINGS } from "../../src/services/settings.service";
import { CANARY_KEY } from "./env";
import { anon, as, createUser, JOB_DESCRIPTION, jdInterview, PASSWORD, resetSettings, startLive, stubModels, stubsUrl, type TestUser } from "./harness";

const ADMIN_GETS = ["/api/admin/me", "/api/admin/stats", "/api/admin/users", "/api/admin/tiers", "/api/admin/providers", "/api/admin/models", "/api/admin/settings", "/api/admin/integrations", "/api/admin/interviews", "/api/admin/shares", "/api/admin/audit"];

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

async function auditFor(admin: TestUser, entityId: string): Promise<AuditEntry[]> {
  return ((await as(admin).get(`/api/admin/audit?entityId=${entityId}`).expect(200)).body as Page<AuditEntry>).items;
}

/** One answered question and one ended live session, so counts, scores and minutes are non-zero. */
async function practise(user: TestUser, text = "I led the payments migration to queues and cut failures by half, measured over a quarter.") {
  const iv = await jdInterview(user);
  const grant = await startLive(user, iv.id);
  await db.updateTable("live_sessions").set({ created_at: new Date(Date.now() - 90_000) }).where("id", "=", grant.id).execute();
  await as(user).post(`/api/interviews/${iv.id}/answers`).send({ round: 0, question: 0, transcript: [{ role: "candidate", text }] }).expect(202);
  await as(user).post(`/api/interviews/${iv.id}/live/${grant.id}/end`).send().expect(200);
  return iv;
}

describe("who may open /admin", () => {
  test("signed out 401, users 403 FORBIDDEN_ADMIN, a suspended admin has no powers, admins 200", async () => {
    const user = await createUser();
    const admin = await createUser({ role: "ADMIN" });
    for (const url of ADMIN_GETS) {
      expect((await anon().get(url)).status, url).toBe(401);
      const res = await as(user).get(url);
      expect([res.status, res.body.code], url).toEqual([403, "FORBIDDEN_ADMIN"]);
      expect((await as(admin).get(url)).status, url).toBe(200);
    }
    const suspendedAdmin = await createUser({ role: "ADMIN", status: "SUSPENDED" });
    expect((await as(suspendedAdmin).get("/api/admin/users").expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
    expect((await as(admin).get("/api/admin/me").expect(200)).body).toEqual({ role: "ADMIN" });
    expect((await as(user).get("/api/users/me").expect(200)).body.canOpenAdmin).toBe(false);
    expect((await as(admin).get("/api/users/me").expect(200)).body.canOpenAdmin).toBe(true);
  });

  test("a user's writes to admin routes are 403 and change nothing", async () => {
    const user = await createUser();
    const target = await createUser();
    const writes = [
      as(user).post("/api/admin/tiers").send({ name: "Mine", monthlyInterviews: null, monthlyVoiceMinutes: null, maxSessionMinutes: 120 }),
      as(user).patch(`/api/admin/users/${user.id}/role`).send({ role: "ADMIN" }),
      as(user).put(`/api/admin/users/${user.id}/quota`).send({ monthlyInterviews: null, monthlyVoiceMinutes: null, note: null }),
      as(user).post(`/api/admin/users/${target.id}/ban`).send({ reason: "nope" }),
      as(user).post(`/api/admin/users/${target.id}/erase`).send({ reason: "Requested" }),
      as(user).patch("/api/admin/settings").send({ registration: "CLOSED" }),
      as(user).post("/api/admin/providers").send({ id: "sneaky", kind: "STUB", displayName: "Sneaky", baseUrl: null, enabled: true }),
      as(user).post("/api/admin/models").send({ providerId: "stub", kind: "TEXT", modelRef: "sneaky", displayName: "Sneaky" }),
    ];
    for (const w of writes) {
      const res = await w;
      expect([res.status, res.body.code]).toEqual([403, "FORBIDDEN_ADMIN"]);
    }
    const rows = await db.selectFrom("users").select(["id", "role", "status"]).where("id", "in", [user.id, target.id]).execute();
    expect(rows.every((r) => r.role === "USER" && r.status === "ACTIVE")).toBe(true);
    expect(await db.selectFrom("user_quota_overrides").select("user_id").where("user_id", "=", user.id).execute()).toEqual([]);
    expect(await db.selectFrom("providers").select("id").where("id", "=", "sneaky").execute()).toEqual([]);
  });
});

describe("accounts", () => {
  test("list with search and filters; detail with totals and usage, never interview content", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ada = await createUser({ displayName: "Findable Person" });
    const secret = `confidential${Date.now().toString(36)}`;
    await practise(ada, `My ${secret} answer about payments and the queue migration I led last year.`);
    const list = (await as(admin).get(`/api/admin/users?q=${ada.username}`).expect(200)).body as Page<AdminUserRow>;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toEqual({
      id: ada.id,
      username: ada.username,
      displayName: "Findable Person",
      role: "USER",
      email: ada.email,
      status: "ACTIVE",
      quotaTier: null,
      createdAt: expect.any(String),
      lastSeenAt: null,
      suspendedUntil: null,
      interviewsThisMonth: 1,
      voiceMinutesThisMonth: 2,
    });
    expect(((await as(admin).get("/api/admin/users?role=ADMIN&limit=100").expect(200)).body as Page<AdminUserRow>).items.every((u) => u.role === "ADMIN")).toBe(true);
    // Wildcards match literally.
    expect(((await as(admin).get("/api/admin/users?q=%25%25%25").expect(200)).body as Page<AdminUserRow>).items).toEqual([]);

    const detail = (await as(admin).get(`/api/admin/users/${ada.id}`).expect(200)).body as AdminUserDetail;
    expect(detail.totals).toEqual({ interviews: 1, completedInterviews: 0, answers: 1, voiceMinutes: 2 });
    expect(detail.usage).toEqual([{ date: new Date().toISOString().slice(0, 10), interviews: 1, voiceMinutes: 2 }]);
    expect(detail.override).toBeNull();
    expect(JSON.stringify(detail)).not.toContain(secret);
    expect(JSON.stringify(detail)).not.toMatch(/transcript|feedback|summary/i);
    await as(admin).get(`/api/admin/users/${ULID}`).expect(404);
  });

  test("role change: promote, demote (the demoted token stops working at once), never yourself", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const bob = await createUser();
    await as(admin).patch(`/api/admin/users/${bob.id}/role`).send({ role: "ADMIN" }).expect(200);
    expect(((await as(admin).get(`/api/admin/users/${bob.id}`).expect(200)).body as AdminUserDetail).role).toBe("ADMIN");
    await as(bob).get("/api/admin/me").expect(200);
    await as(admin).patch(`/api/admin/users/${bob.id}/role`).send({ role: "USER" }).expect(200);
    expect((await as(bob).get("/api/admin/me").expect(401)).body.code).toBe("TOKEN_INVALID");
    expect((await as(admin).patch(`/api/admin/users/${admin.id}/role`).send({ role: "USER" }).expect(403)).body.code).toBe("SELF_ACTION");
    await as(admin).patch(`/api/admin/users/${bob.id}/role`).send({ role: "OWNER" }).expect(400);
    const entries = await auditFor(admin, bob.id);
    expect(entries.map((e) => e.action)).toEqual(["user.role", "user.role"]);
    expect(entries[0]!.data).toEqual({ from: "ADMIN", to: "USER" });
    expect(entries[0]!.actor?.id).toBe(admin.id);
  });

  test("the role change response shows the new role", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const bob = await createUser();
    expect(((await as(admin).patch(`/api/admin/users/${bob.id}/role`).send({ role: "ADMIN" }).expect(200)).body as AdminUserRow).role).toBe("ADMIN");
  });

  test("LAST_ADMIN: the only active admin cannot delete their own account", async () => {
    // A role change or erase is always made by another active admin, so LAST_ADMIN can only arise from self-deletion.
    const admin = await createUser({ role: "ADMIN" });
    const others = await db.selectFrom("users").select("id").where("role", "=", "ADMIN").where("status", "=", "ACTIVE").where("id", "<>", admin.id).execute();
    const ids = others.map((o) => o.id);
    if (ids.length) await db.updateTable("users").set({ status: "SUSPENDED" }).where("id", "in", ids).execute();
    try {
      expect((await as(admin).delete("/api/users/me").send({ password: PASSWORD }).expect(409)).body.code).toBe("LAST_ADMIN");
    } finally {
      if (ids.length) await db.updateTable("users").set({ status: "ACTIVE" }).where("id", "in", ids).execute();
    }
  });

  test("suspend makes an account read-only until it ends; admins are protected; unsuspend", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const other = await createUser({ role: "ADMIN" });
    const ada = await createUser();
    const iv = await jdInterview(ada);
    const row = (await as(admin).post(`/api/admin/users/${ada.id}/suspend`).send({ days: 3, reason: "cool off" }).expect(200)).body as AdminUserRow;
    expect(row.status).toBe("SUSPENDED");
    expect(new Date(row.suspendedUntil!).getTime()).toBeGreaterThan(Date.now() + 2 * 86_400_000);
    await as(ada).get(`/api/interviews/${iv.id}`).expect(200);
    await as(ada).get(`/api/interviews/${iv.id}/report`).expect(200);
    const create = () => as(ada).post("/api/interviews/from-job-description").send({ company: "Example Labs", role: "Backend Engineer", jobDescription: JOB_DESCRIPTION });
    expect((await create().expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
    expect((await as(ada).post(`/api/interviews/${iv.id}/live`).send({}).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
    expect((await as(ada).get("/api/users/me").expect(200)).body).toMatchObject({ status: "SUSPENDED", suspendedUntil: row.suspendedUntil });
    await as(admin).post(`/api/admin/users/${ada.id}/suspend`).send({ days: 0 }).expect(400);
    expect((await as(admin).post(`/api/admin/users/${other.id}/suspend`).send({ days: 1 }).expect(403)).body.code).toBe("TARGET_PROTECTED");
    await as(admin).post(`/api/admin/users/${ada.id}/unsuspend`).send({}).expect(200);
    await create().expect(201);
    expect((await as(admin).post(`/api/admin/users/${ada.id}/unsuspend`).send({}).expect(409)).body.code).toBe("INVALID_STATUS");
  });

  test("ban signs the account out everywhere and takes its shared links down; unban", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ada = await createUser();
    const iv = await jdInterview(ada);
    const share = (await as(ada).post(`/api/interviews/${iv.id}/shares`).send({}).expect(201)).body;
    await anon().get(`/api/shared/${share.id}`).expect(200);
    await as(admin).post(`/api/admin/users/${ada.id}/ban`).send({ reason: "spam" }).expect(200);
    expect((await as(ada).get("/api/users/me")).status).toBe(401);
    await anon().get(`/api/shared/${share.id}`).expect(404);
    const s = await db.selectFrom("shares").select(["revoked_at", "revoked_by"]).where("id", "=", share.id).executeTakeFirstOrThrow();
    expect(s.revoked_at).not.toBeNull();
    expect(s.revoked_by).toBe(admin.id);
    expect((await as(admin).get(`/api/admin/users?status=BANNED&q=${ada.username}`).expect(200)).body.items).toHaveLength(1);
    // Sign-in is refused while banned.
    expect((await anon().post("/api/auth/login").send({ login: ada.email, password: PASSWORD })).status).toBe(403);
    await as(admin).post(`/api/admin/users/${ada.id}/unban`).send({}).expect(200);
    await anon().post("/api/auth/login").send({ login: ada.email, password: PASSWORD }).expect(200);
  });

  test("erase removes interviews, answers, live sessions, links and preferences, anonymises the identity, and is audited", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ada = await createUser();
    const iv = await practise(ada);
    await as(ada).post(`/api/interviews/${iv.id}/shares`).send({}).expect(201);
    await as(ada).patch("/api/me/preferences").send({ voice: "nova" }).expect(200);
    await as(admin).post(`/api/admin/users/${ada.id}/erase`).send({ reason: "x" }).expect(400);
    await as(admin).post(`/api/admin/users/${ada.id}/erase`).send({ reason: "Requested by the person" }).expect(204);
    expect(await db.selectFrom("interviews").select("id").where("user_id", "=", ada.id).execute()).toEqual([]);
    expect(await db.selectFrom("answers").select("id").where("interview_id", "=", iv.id).execute()).toEqual([]);
    expect(await db.selectFrom("live_sessions").select("id").where("user_id", "=", ada.id).execute()).toEqual([]);
    expect(await db.selectFrom("shares").select("id").where("user_id", "=", ada.id).execute()).toEqual([]);
    expect(await db.selectFrom("user_preferences").select("user_id").where("user_id", "=", ada.id).execute()).toEqual([]);
    const user = await db.selectFrom("users").select(["status", "email", "display_name"]).where("id", "=", ada.id).executeTakeFirstOrThrow();
    expect(user).toMatchObject({ status: "DEACTIVATED", display_name: "Deleted user" });
    expect(user.email).not.toBe(ada.email);
    // Usage totals survive (counts only), so the overview stays right.
    expect((await db.selectFrom("usage_daily").select("user_id").where("user_id", "=", ada.id).execute()).length).toBeGreaterThan(0);
    expect((await as(admin).post(`/api/admin/users/${ada.id}/erase`).send({ reason: "Again please" }).expect(409)).body.code).toBe("ALREADY_ERASED");
    expect((await auditFor(admin, ada.id)).map((e) => e.action)).toContain("user.erase");
  });

  test("tier assignment and a per-user override", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ada = await createUser();
    const name = `Staff ${Date.now().toString(36)}`;
    const tiers = (await as(admin).post("/api/admin/tiers").send({ name, monthlyInterviews: null, monthlyVoiceMinutes: 600, maxSessionMinutes: 30 }).expect(201)).body as QuotaTier[];
    const staff = tiers.find((t) => t.name === name)!;
    expect(staff).toMatchObject({ monthlyInterviews: null, monthlyVoiceMinutes: 600, maxSessionMinutes: 30, isDefault: false, userCount: 0 });
    const row = (await as(admin).put(`/api/admin/users/${ada.id}/tier`).send({ tierId: staff.id }).expect(200)).body as AdminUserRow;
    expect(row.quotaTier).toEqual({ id: staff.id, name: staff.name });
    expect((await as(ada).get("/api/me/usage").expect(200)).body).toMatchObject({ interviews: { limit: null }, voiceMinutes: { limit: 600 }, maxSessionMinutes: 30 });
    expect(((await as(admin).get("/api/admin/tiers").expect(200)).body as QuotaTier[]).find((t) => t.id === staff.id)!.userCount).toBe(1);

    const detail = (await as(admin).put(`/api/admin/users/${ada.id}/quota`).send({ monthlyInterviews: 3, monthlyVoiceMinutes: null, note: "pilot" }).expect(200)).body as AdminUserDetail;
    expect(detail.override).toMatchObject({ monthlyInterviews: 3, monthlyVoiceMinutes: null, note: "pilot" });
    expect((await as(ada).get("/api/me/usage").expect(200)).body).toMatchObject({ interviews: { limit: 3 }, voiceMinutes: { limit: 600 } });
    await as(admin).put(`/api/admin/users/${ada.id}/quota`).send({ monthlyInterviews: -1, monthlyVoiceMinutes: null, note: null }).expect(400);
    await as(admin).put(`/api/admin/users/${ada.id}/quota`).send({ monthlyInterviews: 1, monthlyVoiceMinutes: null, note: null, dailyTokens: 5 }).expect(400);
    expect(((await as(admin).delete(`/api/admin/users/${ada.id}/quota`).expect(200)).body as AdminUserDetail).override).toBeNull();
    await as(admin).put(`/api/admin/users/${ada.id}/tier`).send({ tierId: null }).expect(200);
    expect((await as(ada).get("/api/me/usage").expect(200)).body).toMatchObject({ interviews: { limit: 8 }, voiceMinutes: { limit: 120 }, maxSessionMinutes: 15 });
    expect((await as(admin).put(`/api/admin/users/${ada.id}/tier`).send({ tierId: ULID }).expect(404)).body.code).toBe("TIER_NOT_FOUND");
    expect((await auditFor(admin, ada.id)).map((e) => e.action)).toEqual(expect.arrayContaining(["user.tier", "user.quota_override", "user.quota_override_removed"]));
    await as(admin).delete(`/api/admin/tiers/${staff.id}`).expect(200);
  });
});

describe("quota tiers", () => {
  test("create, update, one default at a time, the default cannot be deleted, names are unique", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const original = ((await as(admin).get("/api/admin/tiers").expect(200)).body as QuotaTier[]).find((t) => t.isDefault)!;
    expect(original).toMatchObject({ name: "Default", monthlyInterviews: 8, monthlyVoiceMinutes: 120, maxSessionMinutes: 15 });
    const name = `Pro ${Date.now().toString(36)}`;
    let tiers = (await as(admin).post("/api/admin/tiers").send({ name, monthlyInterviews: 20, monthlyVoiceMinutes: 300, maxSessionMinutes: 20 }).expect(201)).body as QuotaTier[];
    const pro = tiers.find((t) => t.name === name)!;
    expect((await as(admin).post("/api/admin/tiers").send({ name, monthlyInterviews: 1, monthlyVoiceMinutes: 1, maxSessionMinutes: 1 }).expect(409)).body.code).toBe("TIER_NAME_TAKEN");
    try {
      tiers = (await as(admin).put(`/api/admin/tiers/${pro.id}`).send({ name, monthlyInterviews: 40, monthlyVoiceMinutes: 300, maxSessionMinutes: 20, isDefault: true }).expect(200)).body as QuotaTier[];
      expect(tiers.filter((t) => t.isDefault).map((t) => t.id)).toEqual([pro.id]);
      expect(tiers.find((t) => t.id === pro.id)!.monthlyInterviews).toBe(40);
      // Users without a tier now get the new default.
      const ada = await createUser();
      expect((await as(ada).get("/api/me/usage").expect(200)).body).toMatchObject({ interviews: { limit: 40 }, maxSessionMinutes: 20 });
      expect((await as(admin).delete(`/api/admin/tiers/${pro.id}`).expect(409)).body.code).toBe("TIER_IS_DEFAULT");
      // A default is moved to another tier, never removed: saving it with isDefault false keeps it the default.
      tiers = (await as(admin).put(`/api/admin/tiers/${pro.id}`).send({ name, monthlyInterviews: 40, monthlyVoiceMinutes: 300, maxSessionMinutes: 20, isDefault: false }).expect(200)).body as QuotaTier[];
      expect(tiers.filter((t) => t.isDefault).map((t) => t.id)).toEqual([pro.id]);
    } finally {
      await as(admin).put(`/api/admin/tiers/${original.id}`).send({ name: "Default", monthlyInterviews: 8, monthlyVoiceMinutes: 120, maxSessionMinutes: 15, isDefault: true }).expect(200);
    }
    tiers = (await as(admin).delete(`/api/admin/tiers/${pro.id}`).expect(200)).body as QuotaTier[];
    expect(tiers.some((t) => t.id === pro.id)).toBe(false);
    expect(tiers.find((t) => t.isDefault)!.id).toBe(original.id);
    await as(admin).post("/api/admin/tiers").send({ name: "Bad", monthlyInterviews: 1, monthlyVoiceMinutes: 1, maxSessionMinutes: 0 }).expect(400);
    await as(admin).post("/api/admin/tiers").send({ name: "Bad", monthlyInterviews: 1, monthlyVoiceMinutes: 1, maxSessionMinutes: 121 }).expect(400);
    await as(admin).delete(`/api/admin/tiers/${ULID}`).expect(404);
  });
});

describe("providers and models", () => {
  test("providers report keyConfigured, never a key; CRUD with validation", async () => {
    const admin = await createUser({ role: "ADMIN" });
    let providers = (await as(admin).get("/api/admin/providers").expect(200)).body as AdminProvider[];
    expect(providers.find((p) => p.id === "openai")).toMatchObject({ kind: "OPENAI", keyConfigured: true });
    expect(providers.find((p) => p.id === "anthropic")).toMatchObject({ keyConfigured: false });
    expect(providers.find((p) => p.id === "stub")).toMatchObject({ kind: "STUB", keyConfigured: true, modelCount: 2 });
    expect(JSON.stringify(providers)).not.toContain(CANARY_KEY);

    const slug = `local-${Date.now().toString(36)}`;
    providers = (await as(admin).post("/api/admin/providers").send({ id: slug, kind: "OPENAI_COMPATIBLE", displayName: "Local server", baseUrl: `${stubsUrl()}/v1`, enabled: true }).expect(201)).body as AdminProvider[];
    expect(providers.find((p) => p.id === slug)).toMatchObject({ keyConfigured: false, modelCount: 0, baseUrl: `${stubsUrl()}/v1` });
    expect((await as(admin).post("/api/admin/providers").send({ id: slug, kind: "STUB", displayName: "Dup", baseUrl: null, enabled: true }).expect(409)).body.code).toBe("PROVIDER_SLUG_TAKEN");
    expect((await as(admin).post("/api/admin/providers").send({ id: `x${slug}`, kind: "OPENAI_COMPATIBLE", displayName: "No URL", baseUrl: null, enabled: true }).expect(400)).body.code).toBe("BASE_URL_REQUIRED");
    expect((await as(admin).post("/api/admin/providers").send({ id: `y${slug}`, kind: "OPENAI", displayName: "Bad URL", baseUrl: "file:///etc/passwd", enabled: true }).expect(400)).body.code).toBe("BASE_URL_INVALID");
    await as(admin).post("/api/admin/providers").send({ id: "Bad Slug!", kind: "STUB", displayName: "x", baseUrl: null, enabled: true }).expect(400);
    await as(admin).post("/api/admin/providers").send({ id: `z${slug}`, kind: "STUB", displayName: "x", baseUrl: null, enabled: true, apiKey: "sk-nope" }).expect(400);
    await as(admin).put(`/api/admin/providers/${slug}`).send({ kind: "OPENAI_COMPATIBLE", displayName: "Renamed", baseUrl: `${stubsUrl()}/v1`, enabled: false }).expect(200);
    providers = (await as(admin).delete(`/api/admin/providers/${slug}`).expect(200)).body as AdminProvider[];
    expect(providers.some((p) => p.id === slug)).toBe(false);
    await as(admin).delete(`/api/admin/providers/${slug}`).expect(404);
    expect((await auditFor(admin, slug)).map((e) => e.action)).toEqual(["provider.delete", "provider.update", "provider.create"]);
  });

  test("voice models: create, appear in the picker, test call, validation, disable hides, delete", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ada = await createUser();
    const ref = `stub-voice-extra-${Date.now().toString(36)}`;
    const picker = async () => ((await as(ada).get("/api/me/realtime-models").expect(200)).body as RealtimeModelOption[]).map((m) => m.id);
    let models = (await as(admin).post("/api/admin/models").send({ providerId: "stub", kind: "REALTIME", modelRef: ref, displayName: "Stub Voice Extra", voices: ["default", "calm"], usdPerMinute: 0.06 }).expect(201)).body as AdminModel[];
    const extra = models.find((m) => m.modelRef === ref)!;
    expect(extra).toMatchObject({ providerId: "stub", kind: "REALTIME", voices: ["default", "calm"], usdPerMinute: 0.06, enabled: true, isDefault: false, maxOutputTokens: 8192 });
    try {
      expect(await picker()).toContain(extra.id);
      const ok = (await as(admin).post(`/api/admin/models/${extra.id}/test`).send({}).expect(200)).body as ModelTestResult;
      expect(ok).toEqual({ ok: true, latencyMs: expect.any(Number), message: "The provider issued a voice session credential." });
      expect((await as(admin).post("/api/admin/models").send({ providerId: "stub", kind: "REALTIME", modelRef: ref, displayName: "Again", voices: ["default"] }).expect(409)).body.code).toBe("MODEL_DUPLICATE");
      expect((await as(admin).post("/api/admin/models").send({ providerId: "stub", kind: "REALTIME", modelRef: `${ref}-novoice`, displayName: "No voice" }).expect(400)).body.code).toBe("VOICES_REQUIRED");
      expect((await as(admin).post("/api/admin/models").send({ providerId: "anthropic", kind: "REALTIME", modelRef: "claude-voice", displayName: "Nope", voices: ["a"] }).expect(400)).body.code).toBe("REALTIME_PROVIDER_UNSUPPORTED");
      expect((await as(admin).post("/api/admin/models").send({ providerId: "nope-nope", kind: "TEXT", modelRef: "m", displayName: "M" }).expect(404)).body.code).toBe("PROVIDER_NOT_FOUND");
      await as(admin).post("/api/admin/models").send({ providerId: "stub", kind: "CHAT", modelRef: "m", displayName: "M" }).expect(400);
      await as(admin).put(`/api/admin/models/${extra.id}`).send({ providerId: "stub", kind: "REALTIME", modelRef: ref, displayName: "Stub Voice Extra", voices: ["default"], enabled: false }).expect(200);
      expect(await picker()).not.toContain(extra.id);
      // A candidate cannot pick a disabled voice model for an interview.
      const iv = await jdInterview(ada);
      expect((await as(ada).patch(`/api/interviews/${iv.id}`).send({ realtimeModelId: extra.id }).expect(400)).body.code).toBe("MODEL_UNAVAILABLE");
    } finally {
      models = (await as(admin).delete(`/api/admin/models/${extra.id}`).expect(200)).body as AdminModel[];
      clearModelCache();
    }
    expect(models.some((m) => m.id === extra.id)).toBe(false);
    await as(admin).delete(`/api/admin/models/${extra.id}`).expect(404);
  });

  test("a text model test answers through the stub; a failing one returns a key-free, provider-text-free message", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { text } = await stubModels();
    expect((await as(admin).post(`/api/admin/models/${text}/test`).send({}).expect(200)).body).toEqual({ ok: true, latencyMs: expect.any(Number), message: "The model answered." });
    const slug = `broken-${Date.now().toString(36)}`;
    await as(admin).post("/api/admin/providers").send({ id: slug, kind: "OPENAI_COMPATIBLE", displayName: "Broken", baseUrl: `${stubsUrl()}/nowhere`, enabled: true }).expect(201);
    try {
      const models = (await as(admin).post("/api/admin/models").send({ providerId: slug, kind: "TEXT", modelRef: "ghost", displayName: "Ghost" }).expect(201)).body as AdminModel[];
      const ghost = models.find((m) => m.providerId === slug)!;
      const res = (await as(admin).post(`/api/admin/models/${ghost.id}/test`).send({}).expect(200)).body as ModelTestResult;
      expect(res.ok).toBe(false);
      expect(res.message).toBe("The provider could not be reached or had an error.");
      expect(JSON.stringify(res)).not.toMatch(/no stub for|nowhere|POST/);
      // A provider without a key says so, for text and voice models alike.
      const all = (await as(admin).get("/api/admin/models").expect(200)).body as AdminModel[];
      const haiku = all.find((m) => m.providerId === "anthropic")!;
      expect((await as(admin).post(`/api/admin/models/${haiku.id}/test`).send({}).expect(200)).body).toEqual({ ok: false, latencyMs: 0, message: "No key is configured for this provider on the server." });
      const live = all.find((m) => m.providerId === "gemini" && m.kind === "REALTIME")!;
      expect((await as(admin).post(`/api/admin/models/${live.id}/test`).send({}).expect(200)).body).toMatchObject({ ok: false, latencyMs: 0 });
      await as(admin).post(`/api/admin/models/${ULID}/test`).send({}).expect(404);
    } finally {
      await as(admin).delete(`/api/admin/providers/${slug}`).expect(200);
      clearModelCache();
    }
  });
});

describe("settings, integrations, stats, interviews, shares and the audit trail", () => {
  test("settings patch merges groups, validates, and is audited with before and after", async () => {
    const admin = await createUser({ role: "ADMIN" });
    try {
      const after = (await as(admin).patch("/api/admin/settings").send({ tagline: "Practise anything", features: { sharing: false }, interviewerAddendum: "Keep questions short." }).expect(200)).body as AppSettings;
      expect(after.tagline).toBe("Practise anything");
      expect(after.features).toEqual({ ...DEFAULT_SETTINGS.features, sharing: false });
      expect(after.interviewerAddendum).toBe("Keep questions short.");
      expect((await as(admin).get("/api/admin/settings").expect(200)).body.tagline).toBe("Practise anything");
      const entry = (await auditFor(admin, "app")).find((e) => e.action === "settings.update")!;
      expect((entry.data.keys as string[]).sort()).toEqual(["features", "interviewerAddendum", "tagline"]);
      expect(entry.data).toMatchObject({ before: { tagline: DEFAULT_SETTINGS.tagline }, after: { tagline: "Practise anything", features: { sharing: false } } });
      expect((await as(admin).patch("/api/admin/settings").send({ registration: "INVITE_ONLY", allowedEmailDomains: [] }).expect(400)).body.code).toBe("SETTINGS_INVALID");
      await as(admin).patch("/api/admin/settings").send({ registration: "INVITE_ONLY", allowedEmailDomains: ["example.com"] }).expect(200);
      await as(admin).patch("/api/admin/settings").send({ retentionDays: 1 }).expect(400);
      await as(admin).patch("/api/admin/settings").send({ interviewerName: "" }).expect(400);
      await as(admin).patch("/api/admin/settings").send({ interviewerAddendum: "x".repeat(2001) }).expect(400);
      await as(admin).patch("/api/admin/settings").send({ unknownKey: true }).expect(400);
      await as(admin).patch("/api/admin/settings").send({ features: { webSearch: true } }).expect(400);
    } finally {
      await resetSettings();
    }
  });

  test("integrations say what is configured, never a key", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const res = await as(admin).get("/api/admin/integrations").expect(200);
    const status = res.body as IntegrationStatus;
    expect(Object.keys(status).sort()).toEqual(["mail", "realtime", "textModels"]);
    expect(status.mail).toEqual({ mode: expect.any(String) });
    expect(status.realtime.openai).toMatchObject({ keyConfigured: true });
    expect(status.realtime.openai.models).toBeGreaterThanOrEqual(2);
    expect(status.realtime.gemini).toEqual({ keyConfigured: false, models: 1 });
    expect(status.realtime.stub.keyConfigured).toBe(true);
    expect(status.realtime.stub.models).toBeGreaterThanOrEqual(1);
    expect(status.textModels).toBeGreaterThanOrEqual(4);
    expect(res.text).not.toContain(CANARY_KEY);
  });

  test("stats has the documented shape and counts today's activity", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ada = await createUser();
    await practise(ada);
    const stats = (await as(admin).get("/api/admin/stats").expect(200)).body as AdminStats;
    expect(Object.keys(stats).sort()).toEqual(["averageScore", "byModel", "daily", "from", "to", "totals"]);
    expect(Object.keys(stats.totals).sort()).toEqual(["activeUsers", "answers", "completedInterviews", "estimatedCostUsd", "interviews", "newUsers", "users", "voiceMinutes"]);
    expect(stats.totals.interviews).toBeGreaterThan(0);
    expect(stats.totals.answers).toBeGreaterThan(0);
    expect(stats.totals.voiceMinutes).toBeGreaterThan(0);
    expect(stats.averageScore).toEqual(expect.any(Number));
    const today = new Date().toISOString().slice(0, 10);
    expect(stats.to).toBe(today);
    expect(stats.daily.find((d) => d.date === today)).toMatchObject({ activeUsers: expect.any(Number), interviews: expect.any(Number), voiceMinutes: expect.any(Number) });
    const { text, voice } = await stubModels();
    expect(stats.byModel.find((m) => m.modelId === text)).toMatchObject({ displayName: "Stub planner", kind: "TEXT" });
    expect(stats.byModel.find((m) => m.modelId === voice)).toMatchObject({ displayName: "Stub voice", kind: "REALTIME" });
    expect(stats.byModel.find((m) => m.modelId === voice)!.voiceMinutes).toBeGreaterThan(0);
    expect((await as(admin).get("/api/admin/stats?from=2026-02-01&to=2026-01-01").expect(400)).body.code).toBe("RANGE_INVALID");
    expect((await as(admin).get("/api/admin/stats?from=2024-01-01&to=2026-01-01").expect(400)).body.code).toBe("RANGE_TOO_LONG");
    await as(admin).get("/api/admin/stats?from=yesterday").expect(400);
  });

  test("the interview list is metadata only: no summary, plan, answers or transcripts", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ada = await createUser();
    const secret = `privatejd${Date.now().toString(36)}`;
    const iv = await jdInterview(ada, { jobDescription: `${JOB_DESCRIPTION} ${secret}` });
    const grant = await startLive(ada, iv.id);
    await db.updateTable("live_sessions").set({ created_at: new Date(Date.now() - 61_000) }).where("id", "=", grant.id).execute();
    await as(ada).post(`/api/interviews/${iv.id}/answers`).send({ round: 0, question: 0, transcript: [{ role: "candidate", text: `My answer mentions ${secret}twice and real results.` }] }).expect(202);
    await as(ada).post(`/api/interviews/${iv.id}/live/${grant.id}/end`).send().expect(200);

    const res = await as(admin).get(`/api/admin/interviews?userId=${ada.id}`).expect(200);
    const page = res.body as Page<AdminInterviewRow>;
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toEqual({
      id: iv.id,
      title: "Backend Engineer at Example Labs",
      source: "JOB_DESCRIPTION",
      status: "IN_PROGRESS",
      owner: { id: ada.id, username: ada.username, displayName: ada.displayName, role: "USER" },
      questionCount: iv.questionCount,
      answeredCount: 1,
      overallScore: expect.any(Number),
      voiceMinutes: 2,
      createdAt: expect.any(String),
    });
    expect(res.text).not.toContain(secret);
    expect(res.text).not.toMatch(/"summary"|"plan"|"answers"|"transcript"|"feedback"|"jobDescription"|"job_description"/);
    expect(res.text).not.toContain(iv.plan![0]!.questions[0]!.text);

    expect(((await as(admin).get(`/api/admin/interviews?userId=${ada.id}&status=COMPLETED`).expect(200)).body as Page<AdminInterviewRow>).items).toEqual([]);
    expect(((await as(admin).get(`/api/admin/interviews?userId=${ada.id}&q=backend`).expect(200)).body as Page<AdminInterviewRow>).items).toHaveLength(1);
    expect(((await as(admin).get("/api/admin/interviews?q=%25%25").expect(200)).body as Page<AdminInterviewRow>).items).toEqual([]);
    await as(admin).get("/api/admin/interviews?status=DONE").expect(400);
    await as(admin).get("/api/admin/interviews?userId=nope").expect(400);
    // No admin route opens one interview, its report or its transcript.
    expect((await as(admin).get(`/api/admin/interviews/${iv.id}`)).status).toBe(404);
    expect((await as(admin).get(`/api/interviews/${iv.id}`)).status).toBe(404);
    expect((await as(admin).get(`/api/interviews/${iv.id}/report`)).status).toBe(404);
  });

  test("the interview list pages with a cursor", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ada = await createUser();
    for (let i = 0; i < 3; i++) await jdInterview(ada);
    const first = (await as(admin).get(`/api/admin/interviews?userId=${ada.id}&limit=2`).expect(200)).body as Page<AdminInterviewRow>;
    expect(first.items).toHaveLength(2);
    const second = (await as(admin).get(`/api/admin/interviews?userId=${ada.id}&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`).expect(200)).body as Page<AdminInterviewRow>;
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((r) => r.id)).size).toBe(3);
  });

  test("admins list and take down shared links; the action is audited", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ada = await createUser();
    const iv = await jdInterview(ada);
    const share = (await as(ada).post(`/api/interviews/${iv.id}/shares`).send({}).expect(201)).body;
    const list = (await as(admin).get("/api/admin/shares?limit=100").expect(200)).body;
    expect(list.items.find((s: { id: string }) => s.id === share.id)).toMatchObject({ owner: { id: ada.id }, title: iv.title, revoked: false, viewCount: 0, url: share.url });
    await as(admin).post(`/api/admin/shares/${share.id}/revoke`).send({ reason: "no" }).expect(400);
    await as(admin).post(`/api/admin/shares/${share.id}/revoke`).send({ reason: "Reported content" }).expect(204);
    await anon().get(`/api/shared/${share.id}`).expect(404);
    expect((await auditFor(admin, share.id))[0]).toMatchObject({ action: "share.revoke", entityType: "share", data: { reason: "Reported content" } });
    expect(((await as(admin).get("/api/admin/shares?limit=100").expect(200)).body.items as { id: string }[]).some((s) => s.id === share.id)).toBe(false);
    expect(((await as(admin).get("/api/admin/shares?includeRevoked=true&limit=100").expect(200)).body.items as { id: string }[]).some((s) => s.id === share.id)).toBe(true);
    expect((await as(admin).post(`/api/admin/shares/${share.id}/revoke`).send({ reason: "Reported again" }).expect(404)).body.code).toBe("SHARE_NOT_FOUND");
  });

  test("the audit trail filters by action prefix and actor", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ada = await createUser();
    await as(admin).post(`/api/admin/users/${ada.id}/suspend`).send({ days: 1 }).expect(200);
    const byActor = ((await as(admin).get(`/api/admin/audit?actorId=${admin.id}`).expect(200)).body as Page<AuditEntry>).items;
    expect(byActor.map((e) => e.action)).toEqual(["user.suspend"]);
    const prefix = ((await as(admin).get(`/api/admin/audit?action=user.&entityId=${ada.id}`).expect(200)).body as Page<AuditEntry>).items;
    expect(prefix).toHaveLength(1);
    expect(prefix[0]).toMatchObject({ entityType: "user", entityId: ada.id, actor: { id: admin.id }, data: { days: 1, reason: null } });
    expect(((await as(admin).get(`/api/admin/audit?action=share.&entityId=${ada.id}`).expect(200)).body as Page<AuditEntry>).items).toEqual([]);
  });
});
