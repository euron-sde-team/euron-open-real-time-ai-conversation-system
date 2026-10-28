/**
 * Test harness: the app in-process, fast user creation, the starter model catalogue
 * (with the stub provider), and helpers to create interviews and walk through them.
 *
 *   const ada = await createUser();                     // ACTIVE, verified USER
 *   const iv = await jdInterview(ada);                  // planned by the stub, READY
 *   const grant = await startLive(ada, iv.id);          // a stub realtime credential
 *
 * Jobs run inline after commit (JOBS_MODE=inline), so a plan is READY and an answer is
 * SCORED by the time the creating request returns.
 */
import type { AppSettings, Interview, LiveSessionGrant } from "@open-conversation/types";
import { beforeAll } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { newId } from "../../src/core/ids";
import { db, initDbTypes } from "../../src/db/kysely";
import { ensureStarterCatalog } from "../../src/demo/catalog";
import { registerAllJobs } from "../../src/jobs";
import { hashPassword } from "../../src/security/passwords";
import { signAccessToken } from "../../src/security/tokens";
import { clearModelCache } from "../../src/services/models.service";
import { clearSettingsCache, saveSettings } from "../../src/services/settings.service";

registerAllJobs();
export const app = createApp();


// enum[] and citext[] columns parse as arrays only after this lookup, as at boot.
beforeAll(async () => {
  await initDbTypes();
  await ensureStarterCatalog(db, { includeStub: true });
  clearModelCache();
});


export const PASSWORD = "correct-horse-battery-staple";
let passwordHash: string | null = null;

export interface TestUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  token: string;
}

let counter = 0;
export function unique(prefix: string): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${process.pid.toString(36)}${counter}`.slice(0, 38);
}

export type Role = "USER" | "ADMIN";

/** Insert an ACTIVE, verified user directly, and mint an access token for them. */
export async function createUser(over: { role?: Role; status?: "ACTIVE" | "SUSPENDED" | "BANNED"; displayName?: string; username?: string } = {}): Promise<TestUser> {
  passwordHash ??= await hashPassword(PASSWORD);
  const username = over.username ?? unique("u");
  const email = `${username}@example.com`;
  const row = await db
    .insertInto("users")
    .values({
      id: newId(),
      email,
      username,
      display_name: over.displayName ?? `User ${username}`,
      password_hash: passwordHash,
      role: over.role ?? "USER",
      status: over.status ?? "ACTIVE",
      email_verified_at: new Date(),
      ...(over.status === "SUSPENDED" ? { suspended_until: new Date(Date.now() + 86_400_000) } : {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { id: row.id, email, username, displayName: row.display_name, token: signAccessToken(row.id, row.token_version) };
}

/** A supertest agent that sends the user's bearer token on every request. */
export function as(user: TestUser | null) {
  const agent = request(app);
  const auth = (r: request.Test) => (user ? r.set("Authorization", `Bearer ${user.token}`) : r);
  return {
    get: (url: string) => auth(agent.get(url)),
    post: (url: string) => auth(agent.post(url)),
    put: (url: string) => auth(agent.put(url)),
    patch: (url: string) => auth(agent.patch(url)),
    delete: (url: string) => auth(agent.delete(url)),
  };
}

export const anon = () => as(null);

// ─── Models ─────────────────────────────────────────────────────────────────

export interface StubModels {
  text: string;
  voice: string;
}

/** The ids of the stub provider's models (ensureStarterCatalog inserted them). */
export async function stubModels(): Promise<StubModels> {
  const rows = await db.selectFrom("models").select(["id", "model_ref"]).where("provider_id", "=", "stub").execute();
  const by = (ref: string) => rows.find((r) => r.model_ref === ref)!.id;
  return { text: by("stub-text"), voice: by("stub-voice") };
}

// ─── Settings ───────────────────────────────────────────────────────────────

/** Merge a patch into the deployment settings (in-process cache cleared). */
export async function setSettings(patch: Partial<AppSettings>): Promise<void> {
  clearSettingsCache();
  await saveSettings(patch, null);
  clearSettingsCache();
}

/** Back to the defaults. */
export async function resetSettings(): Promise<void> {
  await db.deleteFrom("settings").where("key", "=", "app").execute();
  clearSettingsCache();
}

// ─── Stubs ──────────────────────────────────────────────────────────────────

export function stubsUrl(): string {
  return process.env.STUBS_URL!;
}

export interface StubRequest {
  method: string;
  path: string;
  at: string;
  body: any;
}

/** What the stub providers received, newest first. */
export async function stubRequests(): Promise<StubRequest[]> {
  const res = await fetch(`${stubsUrl()}/__/requests`);
  return (await res.json()) as StubRequest[];
}

/** Chat completion requests whose messages mention `marker` anywhere, newest first. */
export async function chatRequestsMentioning(marker: string): Promise<StubRequest[]> {
  return (await stubRequests()).filter((r) => r.path === "/v1/chat/completions" && JSON.stringify(r.body?.messages ?? []).includes(marker));
}

/** The realtime client secrets the stub minted (newest first) with the session config each carried. */
export async function stubRealtime(): Promise<{ secrets: { value: string; session: any }[]; hangups: string[] }> {
  return (await (await fetch(`${stubsUrl()}/__/realtime`)).json()) as { secrets: { value: string; session: any }[]; hangups: string[] };
}

// ─── Interviews ─────────────────────────────────────────────────────────────

export const JOB_DESCRIPTION =
  "We are hiring a Backend Engineer to build Node.js and TypeScript services on Postgres and Redis. You will design APIs, own reliability for payment flows, write tests, review code and mentor two junior engineers. Requirements: 4+ years of backend experience.";

/** Create an interview from a job description; the inline planner makes it READY before this returns. */
export async function jdInterview(user: TestUser, over: { company?: string; role?: string; jobDescription?: string; proctoring?: boolean } = {}): Promise<Interview> {
  const res = await as(user)
    .post("/api/interviews/from-job-description")
    .send({ company: over.company ?? "Example Labs", role: over.role ?? "Backend Engineer", jobDescription: over.jobDescription ?? JOB_DESCRIPTION, ...(over.proctoring !== undefined ? { proctoring: over.proctoring } : {}) });
  if (res.status !== 201) throw new Error(`create interview: ${res.status} ${JSON.stringify(res.body)}`);
  const got = await as(user).get(`/api/interviews/${res.body.id}`);
  return got.body as Interview;
}

/** Open a live session for the current question (or the one given). */
export async function startLive(user: TestUser, interviewId: string, at: { round?: number; question?: number } = {}): Promise<LiveSessionGrant> {
  const res = await as(user).post(`/api/interviews/${interviewId}/live`).send(at);
  if (res.status !== 201) throw new Error(`start live: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as LiveSessionGrant;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until fn returns something truthy. */
export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 10_000, everyMs = 50): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error("waitFor timed out");
    await sleep(everyMs);
  }
}
