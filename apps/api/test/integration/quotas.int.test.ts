/**
 * Monthly allowances: tier limits, per-user overrides, interview creation refused when
 * the month's interviews are used, parallel creation that cannot overshoot, voice minutes
 * capping the next session, and deletion never giving quota back.
 */
import type { Usage } from "@open-conversation/types";
import { sql } from "kysely";
import { describe, expect, test } from "vitest";
import { newId } from "../../src/core/ids";
import { db } from "../../src/db/kysely";
import { as, createUser, JOB_DESCRIPTION, jdInterview, startLive, stubModels, type TestUser } from "./harness";

async function usage(user: TestUser): Promise<Usage> {
  return (await as(user).get("/api/me/usage").expect(200)).body as Usage;
}

async function override(user: TestUser, values: { monthly_interviews?: number | null; monthly_voice_minutes?: number | null }) {
  await db
    .insertInto("user_quota_overrides")
    .values({ user_id: user.id, monthly_interviews: values.monthly_interviews ?? null, monthly_voice_minutes: values.monthly_voice_minutes ?? null })
    .onConflict((oc) => oc.column("user_id").doUpdateSet({ monthly_interviews: values.monthly_interviews ?? null, monthly_voice_minutes: values.monthly_voice_minutes ?? null }))
    .execute();
}

const createJd = (user: TestUser) => as(user).post("/api/interviews/from-job-description").send({ company: "Example Labs", role: "Backend Engineer", jobDescription: JOB_DESCRIPTION });

describe("usage and limits", () => {
  test("a new user is on the default tier; creating an interview books one", async () => {
    const ada = await createUser();
    const before = await usage(ada);
    const now = new Date();
    expect(before).toMatchObject({ month: now.toISOString().slice(0, 7), interviews: { used: 0, limit: 8 }, voiceMinutes: { used: 0, limit: 120 }, maxSessionMinutes: 15 });
    expect(before.resetsAt).toBe(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString());
    await jdInterview(ada);
    expect((await usage(ada)).interviews.used).toBe(1);
  });

  test("a tier sets the limits; an override wins field by field; a null override field falls back to the tier", async () => {
    const ada = await createUser();
    const tierId = newId();
    await db.insertInto("quota_tiers").values({ id: tierId, name: `Cohort ${tierId}`, monthly_interviews: 30, monthly_voice_minutes: 600, max_session_minutes: 20 }).execute();
    await db.updateTable("users").set({ quota_tier_id: tierId }).where("id", "=", ada.id).execute();
    expect(await usage(ada)).toMatchObject({ interviews: { limit: 30 }, voiceMinutes: { limit: 600 }, maxSessionMinutes: 20 });
    await override(ada, { monthly_interviews: 2, monthly_voice_minutes: null });
    expect(await usage(ada)).toMatchObject({ interviews: { limit: 2 }, voiceMinutes: { limit: 600 } });
  });

  test("the month's last interview is the last one: the next is 429 QUOTA_EXCEEDED", async () => {
    const ada = await createUser();
    await override(ada, { monthly_interviews: 1 });
    expect((await createJd(ada)).status).toBe(201);
    const refused = await createJd(ada);
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe("QUOTA_EXCEEDED");
  });

  test("parallel creation cannot draw past the limit: of 5 requests with 2 left, exactly 2 succeed", async () => {
    const ada = await createUser();
    await override(ada, { monthly_interviews: 2 });
    const results = await Promise.all(Array.from({ length: 5 }, () => createJd(ada)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 429)).toHaveLength(3);
  });

  test("deleting an interview does not give its quota back", async () => {
    const ada = await createUser();
    const iv = await jdInterview(ada);
    expect((await as(ada).delete(`/api/interviews/${iv.id}`)).status).toBe(204);
    expect((await usage(ada)).interviews.used).toBe(1);
  });

  test("voice minutes cap the next session's length, and none left is 429", async () => {
    const ada = await createUser();
    await override(ada, { monthly_voice_minutes: 10 });
    const iv = await jdInterview(ada);
    const { voice } = await stubModels();
    await db.insertInto("usage_daily").values({ user_id: ada.id, day: sql<Date>`current_date`, model_id: voice, voice_seconds: 9 * 60 }).execute();
    const grant = await startLive(ada, iv.id);
    expect(grant.maxSeconds).toBe(60);
    await as(ada).post(`/api/interviews/${iv.id}/live/${grant.id}/end`).send();
    await db.updateTable("usage_daily").set({ voice_seconds: 10 * 60 }).where("user_id", "=", ada.id).where("model_id", "=", voice).execute();
    const refused = await as(ada).post(`/api/interviews/${iv.id}/live`).send({});
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe("QUOTA_EXCEEDED");
  });

  test("usage rows hold counts and seconds only, never text", async () => {
    const ada = await createUser();
    await jdInterview(ada, { jobDescription: `${JOB_DESCRIPTION} SECRET_PHRASE_IN_JD` });
    const rows = await db.selectFrom("usage_daily").selectAll().where("user_id", "=", ada.id).execute();
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain("SECRET_PHRASE_IN_JD");
  });
});
