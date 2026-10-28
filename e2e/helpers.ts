/**
 * Shared helpers for the end-to-end suite. Setup goes through the real REST API (never the
 * database) so each test spends browser time only on the behaviour under test.
 *
 * Every simulated person gets their own client address (X-Forwarded-For, honoured by the
 * stack's single trusted proxy hop) on API calls and on their browser's API calls, so the
 * per-IP budgets (sign-in, sign-up) apply per person instead of every test sharing one.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

export const WEB = (process.env.E2E_BASE_URL || "http://localhost:3550").replace(/\/+$/, "");
export const API = (process.env.E2E_API_URL || "http://localhost:5046/api").replace(/\/+$/, "");
export const MAILPIT = (process.env.E2E_MAILPIT_URL || "http://localhost:8066").replace(/\/+$/, "");

/** The demo password: E2E_DEMO_PASSWORD, else CONV_DEMO_PASSWORD from deploy/compose/.env (`make env`). */
export function demoPassword(): string {
  if (process.env.E2E_DEMO_PASSWORD) return process.env.E2E_DEMO_PASSWORD;
  const file = path.join(__dirname, "..", "deploy", "compose", ".env");
  const line = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("CONV_DEMO_PASSWORD=")) : undefined;
  if (!line) throw new Error("No demo password: run `make env && make demo`, or set E2E_DEMO_PASSWORD");
  return line.slice("CONV_DEMO_PASSWORD=".length).trim().replace(/^["']|["']$/g, "");
}

/** Demo accounts (apps/api/src/demo/seed.ts). */
export const DEMO = { admin: "admin@example.com" };

/** A technical job description: the stub planner adds a Python two-sum coding round for it. */
export const JD = {
  company: "Example Labs",
  role: "Senior Backend Engineer",
  jobDescription: "We are hiring a backend engineer to build Python and Node.js services, design REST APIs, and scale Postgres and Redis for millions of requests a day.",
};

export interface TestUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  password: string;
  accessToken: string;
  /** The simulated client address this person uses. */
  ip: string;
}

const run = randomBytes(3).toString("hex");
let seq = 0;

/** A unique suffix for names and addresses (lowercase letters and digits). */
export function uniq(prefix = "e2e"): string {
  seq += 1;
  return `${prefix}${run}${seq}${randomBytes(2).toString("hex")}`;
}

// Addresses in 10.0.0.0/8: a random starting point per worker, then sequential.
let nextIp = randomBytes(3).readUIntBE(0, 3) & 0xffffff;

/** A fresh client address for one simulated person. */
export function clientIp(): string {
  nextIp = (nextIp + 1) & 0xffffff;
  return `10.${(nextIp >> 16) & 255}.${(nextIp >> 8) & 255}.${nextIp & 255}`;
}

type Json = Record<string, unknown>;
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Calls the API, failing the test on an unexpected status. */
export async function call<T = Json>(request: APIRequestContext, method: Method, route: string, opts: { token?: string; ip?: string; data?: unknown; expect?: number } = {}): Promise<T> {
  const headers: Record<string, string> = { "X-Forwarded-For": opts.ip ?? clientIp() };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const r = await request.fetch(`${API}${route}`, { method, headers, data: opts.data as never, maxRedirects: 0 });
  const text = await r.text();
  if (opts.expect !== undefined) expect(r.status(), `${method} ${route}: ${text}`).toBe(opts.expect);
  else expect(r.ok(), `${method} ${route} -> ${r.status()}: ${text}`).toBe(true);
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    return {} as T;
  }
}

/** Calls the API as a test user. */
export function as<T = Json>(request: APIRequestContext, user: Pick<TestUser, "accessToken" | "ip">, method: Method, route: string, data?: unknown) {
  return call<T>(request, method, route, { token: user.accessToken, ip: user.ip, data });
}

/** The verification link mailed to `email` (only when the stack requires verification; polls Mailpit). */
async function verificationToken(request: APIRequestContext, email: string): Promise<string> {
  let link = "";
  await expect
    .poll(
      async () => {
        const r = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=5`).catch(() => null);
        const id = r?.ok() ? (((await r.json()).messages ?? []) as { ID: string }[])[0]?.ID : undefined;
        if (!id) return false;
        const full = await (await request.get(`${MAILPIT}/api/v1/message/${id}`)).json();
        link = `${full.Text}\n${full.HTML}`.replace(/&amp;/g, "&").match(/https?:\/\/[^\s"'<>]+\/verify-email\?token=[^\s"'<>]+/)?.[0] ?? "";
        return !!link;
      },
      { timeout: 30_000, message: `verification mail to ${email}` },
    )
    .toBe(true);
  return decodeURIComponent(new URL(link).searchParams.get("token") ?? "");
}

/** A fresh, signed-in account created through the API. */
export async function newUser(request: APIRequestContext): Promise<TestUser> {
  const username = uniq("u");
  const email = `${username}@example.com`;
  const password = `Pw-${randomBytes(9).toString("base64url")}`;
  const displayName = `Tester ${username.slice(-6)}`;
  const ip = clientIp();
  const signup = await call<{ verificationRequired?: boolean; accessToken?: string; user?: { id: string } }>(request, "POST", "/auth/signup", { ip, data: { email, username, displayName, password } });
  if (signup.accessToken && signup.user) return { id: signup.user.id, email, username, displayName, password, accessToken: signup.accessToken, ip };
  expect(signup.verificationRequired).toBe(true);
  const auth = await call<{ accessToken: string; user: { id: string } }>(request, "POST", "/auth/verify-email", { ip, data: { token: await verificationToken(request, email) } });
  return { id: auth.user.id, email, username, displayName, password, accessToken: auth.accessToken, ip };
}

/** Signs an existing account in through the API (the demo admin). */
export async function apiLogin(request: APIRequestContext, login: string, password = demoPassword()): Promise<TestUser> {
  const ip = clientIp();
  const r = await call<{ accessToken: string; user: { id: string; email: string; username: string; displayName: string } }>(request, "POST", "/auth/login", { ip, data: { login, password } });
  return { id: r.user.id, email: r.user.email, username: r.user.username, displayName: r.user.displayName, password, accessToken: r.accessToken, ip };
}

/** A browser context that presents itself from `ip` to the API, which keeps per-IP budgets. */
export async function newContext(browser: Browser, ip: string = clientIp()): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  await ctx.route(`${WEB}/api/**`, (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }));
  return ctx;
}

/** Signs in through the UI login form and waits until the form has sent the browser on. */
export async function signIn(page: Page, user: Pick<TestUser, "email" | "password">, opts: { next?: string } = {}) {
  await page.goto(opts.next ? `/login?next=${encodeURIComponent(opts.next)}` : "/login");
  await page.locator("#login").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByTestId("login-submit").click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** A new browser context (a device with its own address) for `user`, signed in through the UI. */
export async function pageFor(browser: Browser, user: TestUser, next?: string): Promise<Page> {
  const ctx = await newContext(browser, user.ip);
  const page = await ctx.newPage();
  await signIn(page, user, { next });
  return page;
}

export async function signOut(page: Page) {
  await page.getByTestId("account-menu").first().click();
  await page.getByTestId("sign-out").first().click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId("account-menu")).toHaveCount(0);
}

// ─── Interviews ──────────────────────────────────────────────────────────────

export interface PlanRound {
  name: string;
  questions: { text: string; code: boolean }[];
}
export interface InterviewJson {
  id: string;
  status: string;
  plan: PlanRound[] | null;
}

/** A READY interview from the technical job description, created through the API. */
export async function jdInterview(request: APIRequestContext, user: TestUser): Promise<InterviewJson> {
  const iv = await as<InterviewJson>(request, user, "POST", "/interviews/from-job-description", { ...JD, proctoring: false });
  let ready = iv;
  await expect
    .poll(async () => (ready = await as<InterviewJson>(request, user, "GET", `/interviews/${iv.id}`)).status, { timeout: 60_000, message: "the plan is ready" })
    .toBe("READY");
  return ready;
}

/**
 * A COMPLETED interview: the first two questions answered over the API the way the room
 * sends them (one live session each, then the transcript), then finished.
 */
export async function completedInterview(request: APIRequestContext, user: TestUser): Promise<InterviewJson> {
  const iv = await jdInterview(request, user);
  for (const question of [0, 1]) {
    const grant = await as<{ id: string; question: { text: string } }>(request, user, "POST", `/interviews/${iv.id}/live`, { round: 0, question });
    await as(request, user, "POST", `/interviews/${iv.id}/live/${grant.id}/end`);
    const transcript = [
      { role: "interviewer", text: grant.question.text },
      { role: "candidate", text: "I have spent six years building Python and Node.js services, owning the API design, the Postgres schema and the on-call rotation for a billing platform." },
    ];
    await as(request, user, "POST", `/interviews/${iv.id}/answers`, { round: 0, question, transcript });
  }
  await as(request, user, "POST", `/interviews/${iv.id}/complete`);
  return iv;
}

/** On the report: waits until every answer is scored (the page polls while any is SCORING). */
export async function waitForScores(page: Page) {
  await expect(page.getByRole("heading", { name: "Question by question" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Scoring (one answer|\d+ answers)/)).toHaveCount(0, { timeout: 60_000 });
}

/** Room: the typed-answer box, enabled once the interviewer has finished the question's opening lines. */
export function answerBox(page: Page) {
  return page.getByLabel("Type your answer");
}
