/**
 * Share links: only the owner creates and revokes them; the public read needs no account
 * and shows the transcript and code only when the owner opted in; revoked, expired,
 * unknown and malformed links are the same 404; admins can take a link down; the sharing
 * switch turns creation and reading off.
 */
import type { Interview, SharedReport, ShareSummary } from "@open-conversation/types";
import { afterEach, describe, expect, test } from "vitest";
import { db } from "../../src/db/kysely";
import { DEFAULT_SETTINGS } from "../../src/services/settings.service";
import { anon, as, createUser, jdInterview, resetSettings, setSettings, startLive, type TestUser } from "./harness";

afterEach(async () => {
  await resetSettings();
});

const ANSWER = "MARKER_SHARED_TRANSCRIPT: I rebuilt the billing pipeline on queues and cut failed charges by forty percent.";
const CODE = "def two_sum(nums, target):\n    seen = {}  # MARKER_SHARED_CODE\n    return [0, 1]";

/** An interview with one voice answer and one code answer, finished. */
async function answered(user: TestUser): Promise<Interview> {
  const iv = await jdInterview(user);
  await startLive(user, iv.id);
  await as(user).post(`/api/interviews/${iv.id}/answers`).send({ round: 0, question: 0, transcript: [{ role: "candidate", text: ANSWER }] }).expect(202);
  const r = iv.plan!.findIndex((x) => x.questions.some((q) => q.code));
  await as(user).post(`/api/interviews/${iv.id}/answers`).send({ round: r, question: 0, code: CODE, language: "python" }).expect(202);
  await as(user).post(`/api/interviews/${iv.id}/complete`).send().expect(200);
  return iv;
}

async function share(user: TestUser, interviewId: string, body: object = {}): Promise<ShareSummary> {
  return (await as(user).post(`/api/interviews/${interviewId}/shares`).send(body).expect(201)).body as ShareSummary;
}

describe("creating links", () => {
  test("the owner creates one: a long random id, the web URL, no expiry by default; listed under /api/shares", async () => {
    const ada = await createUser();
    const iv = await jdInterview(ada);
    const s = await share(ada, iv.id);
    expect(s).toEqual({ id: expect.stringMatching(/^[0-9A-Z]{26}-[A-Za-z0-9_-]{22}$/), interviewId: iv.id, interviewTitle: iv.title, url: `http://localhost:3550/s/${s.id}`, includeTranscript: false, viewCount: 0, expiresAt: null, createdAt: expect.any(String) });
    const list = (await as(ada).get("/api/shares").expect(200)).body;
    expect(list.items.map((x: ShareSummary) => x.id)).toEqual([s.id]);
  });

  test("another user gets 404 creating a link to it, and sees none of the owner's links", async () => {
    const ada = await createUser();
    const eve = await createUser();
    const iv = await jdInterview(ada);
    const s = await share(ada, iv.id);
    expect((await as(eve).post(`/api/interviews/${iv.id}/shares`).send({}).expect(404)).body.code).toBe("INTERVIEW_NOT_FOUND");
    expect((await as(eve).get("/api/shares").expect(200)).body.items).toEqual([]);
    expect((await as(eve).delete(`/api/shares/${s.id}`).expect(404)).body.code).toBe("SHARE_NOT_FOUND");
    await anon().get(`/api/shared/${s.id}`).expect(200);
    await anon().post(`/api/interviews/${iv.id}/shares`).send({}).expect(401);
  });

  test("the body is strict and the expiry bounded", async () => {
    const ada = await createUser();
    const iv = await jdInterview(ada);
    await as(ada).post(`/api/interviews/${iv.id}/shares`).send({ expiresInDays: 0 }).expect(400);
    await as(ada).post(`/api/interviews/${iv.id}/shares`).send({ expiresInDays: 366 }).expect(400);
    await as(ada).post(`/api/interviews/${iv.id}/shares`).send({ includeTranscript: "yes" }).expect(400);
    await as(ada).post(`/api/interviews/${iv.id}/shares`).send({ viewCount: 1000 }).expect(400);
    const s = await share(ada, iv.id, { expiresInDays: 7 });
    expect(Math.abs(Date.parse(s.expiresAt!) - (Date.now() + 7 * 86_400_000))).toBeLessThan(60_000);
  });

  test("at most ten live links per interview", async () => {
    const ada = await createUser();
    const iv = await jdInterview(ada);
    const made: ShareSummary[] = [];
    for (let i = 0; i < 10; i++) made.push(await share(ada, iv.id));
    expect((await as(ada).post(`/api/interviews/${iv.id}/shares`).send({}).expect(403)).body.code).toBe("SHARE_LIMIT");
    await as(ada).delete(`/api/shares/${made[0]!.id}`).expect(204);
    await share(ada, iv.id);
  });
});

describe("reading a link", () => {
  test("works without an account; shows the report without the owner's account details; counts views", async () => {
    const ada = await createUser({ displayName: "Shared Candidate" });
    const iv = await answered(ada);
    const s = await share(ada, iv.id);
    const res = await anon().get(`/api/shared/${s.id}`).expect(200);
    const report = res.body as SharedReport;
    expect(report.sharedAt).toBe(s.createdAt);
    expect(report.candidateName).toBe("Shared Candidate");
    expect(report.interview).toMatchObject({ id: iv.id, title: iv.title, status: "COMPLETED" });
    expect(report.questions).toHaveLength(iv.questionCount);
    expect(report.overallRating).toEqual(expect.any(Number));
    expect(res.text).not.toContain(ada.email);
    expect(res.text).not.toContain(ada.id);
    await anon().get(`/api/shared/${s.id}`).expect(200);
    const list = (await as(ada).get("/api/shares").expect(200)).body.items as ShareSummary[];
    expect(list.find((x) => x.id === s.id)!.viewCount).toBe(2);
  });

  test("the transcript and submitted code are hidden unless the owner included them", async () => {
    const ada = await createUser();
    const iv = await answered(ada);
    const hidden = await anon().get(`/api/shared/${(await share(ada, iv.id)).id}`).expect(200);
    expect(hidden.text).not.toContain("MARKER_SHARED_TRANSCRIPT");
    expect(hidden.text).not.toContain("MARKER_SHARED_CODE");
    const answeredQs = (hidden.body as SharedReport).questions.filter((q) => q.answer);
    expect(answeredQs).toHaveLength(2);
    expect(answeredQs.every((q) => q.transcript === null && q.submittedCode === null)).toBe(true);
    // Scores and feedback are part of the report either way.
    expect(answeredQs.every((q) => q.answer!.status === "SCORED" && q.answer!.domainRating !== null)).toBe(true);

    const shown = await anon().get(`/api/shared/${(await share(ada, iv.id, { includeTranscript: true })).id}`).expect(200);
    expect(shown.text).toContain("MARKER_SHARED_TRANSCRIPT");
    expect(shown.text).toContain("MARKER_SHARED_CODE");
  });

  test("a revoked link is 404 at once, and revoking twice is 404", async () => {
    const ada = await createUser();
    const iv = await jdInterview(ada);
    const s = await share(ada, iv.id);
    await anon().get(`/api/shared/${s.id}`).expect(200);
    await as(ada).delete(`/api/shares/${s.id}`).expect(204);
    expect((await anon().get(`/api/shared/${s.id}`).expect(404)).body.code).toBe("SHARE_NOT_FOUND");
    await as(ada).delete(`/api/shares/${s.id}`).expect(404);
    expect((await as(ada).get("/api/shares").expect(200)).body.items).toEqual([]);
  });

  test("an expired link is 404", async () => {
    const ada = await createUser();
    const iv = await jdInterview(ada);
    const s = await share(ada, iv.id, { expiresInDays: 1 });
    await anon().get(`/api/shared/${s.id}`).expect(200);
    await db.updateTable("shares").set({ expires_at: new Date(Date.now() - 1000) }).where("id", "=", s.id).execute();
    expect((await anon().get(`/api/shared/${s.id}`).expect(404)).body.code).toBe("SHARE_NOT_FOUND");
  });

  test("deleting the interview takes its links with it", async () => {
    const ada = await createUser();
    const iv = await jdInterview(ada);
    const s = await share(ada, iv.id);
    await as(ada).delete(`/api/interviews/${iv.id}`).expect(204);
    await anon().get(`/api/shared/${s.id}`).expect(404);
  });

  test("unknown and malformed ids are the same 404, never a 400 or 500", async () => {
    const ada = await createUser();
    const iv = await jdInterview(ada);
    const s = await share(ada, iv.id);
    const unknown = `${s.id.slice(0, 27)}${"A".repeat(22)}`;
    for (const id of [unknown, "not-a-share", "01ARZ3NDEKTSV4RRFFQ69G5FAV", "%27%20OR%201%3D1", `${s.id}x`, s.id.toLowerCase()]) {
      const res = await anon().get(`/api/shared/${id}`);
      expect([res.status, res.body.code], id).toEqual([404, "SHARE_NOT_FOUND"]);
    }
    expect((await as(ada).delete("/api/shares/not-a-share").expect(404)).body.code).toBe("SHARE_NOT_FOUND");
  });
});

describe("admins and the sharing switch", () => {
  test("an admin can take a link down; the owner's list no longer shows it", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const ada = await createUser();
    const iv = await jdInterview(ada);
    const s = await share(ada, iv.id);
    await as(admin).post(`/api/admin/shares/${s.id}/revoke`).send({ reason: "Reported content" }).expect(204);
    await anon().get(`/api/shared/${s.id}`).expect(404);
    expect((await as(ada).get("/api/shares").expect(200)).body.items).toEqual([]);
    expect((await db.selectFrom("shares").select("revoked_by").where("id", "=", s.id).executeTakeFirstOrThrow()).revoked_by).toBe(admin.id);
    expect((await as(admin).post("/api/admin/shares/not-a-share/revoke").send({ reason: "Reported content" }).expect(400)).body.code).toBe("VALIDATION_FAILED");
    // A user cannot use the admin route on their own link.
    const s2 = await share(ada, iv.id);
    expect((await as(ada).post(`/api/admin/shares/${s2.id}/revoke`).send({ reason: "Mine anyway" }).expect(403)).body.code).toBe("FORBIDDEN_ADMIN");
  });

  test("with sharing off, links cannot be made and existing ones stop working until it is back on", async () => {
    const ada = await createUser();
    const iv = await jdInterview(ada);
    const s = await share(ada, iv.id);
    await setSettings({ features: { ...DEFAULT_SETTINGS.features, sharing: false } });
    expect((await as(ada).post(`/api/interviews/${iv.id}/shares`).send({}).expect(403)).body.code).toBe("FEATURE_DISABLED");
    expect((await anon().get(`/api/shared/${s.id}`).expect(404)).body.code).toBe("SHARE_NOT_FOUND");
    await resetSettings();
    await anon().get(`/api/shared/${s.id}`).expect(200);
  });

  test("a suspended owner cannot make links", async () => {
    const ada = await createUser();
    const iv = await jdInterview(ada);
    await db.updateTable("users").set({ status: "SUSPENDED", suspended_until: new Date(Date.now() + 86_400_000) }).where("id", "=", ada.id).execute();
    expect((await as(ada).post(`/api/interviews/${iv.id}/shares`).send({}).expect(403)).body.code).toBe("ACCOUNT_RESTRICTED");
  });
});
