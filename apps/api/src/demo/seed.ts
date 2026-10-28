/**
 * Demo data so a fresh install has something to look at. Run with `make demo` (or
 * `node dist/cli.js demo:seed`).
 *
 *   - the starter model catalogue plus the local stub provider (plans, scores and the
 *     interviewer's voice all work through it without any key)
 *   - an admin and four people; the main person has a finished backend interview (with a
 *     coding round, proctoring and a share link), a finished product interview from a job
 *     description, and a planned interview ready to start
 *   - finished interviews for the others and thirty days of usage, for the admin overview
 *
 * Refuses to run with NODE_ENV=production. If the demo admin exists it prints the logins
 * and exits.
 */
import crypto from "node:crypto";
import { sql } from "kysely";
import type { PlanRound } from "@open-conversation/types";
import { config } from "../core/config";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { closeRedis } from "../integrations/redis";
import { closeQueues } from "../jobs/registry";
import { hashPassword } from "../security/passwords";
import { createShare } from "../services/share.service";
import { ensureStarterCatalog } from "./catalog";
import { MAIN_INTERVIEWS, OTHER_INTERVIEWS, type DemoInterview } from "./content";

const ADMIN_EMAIL = "admin@example.com";
const HOUR = 3_600_000;

const PEOPLE = [
  { email: "priya.nair@example.com", username: "priya-nair", name: "Priya Nair", main: true },
  { email: "leo.marquez@example.com", username: "leo-marquez", name: "Leo Marquez" },
  { email: "sam.kowalski@example.com", username: "sam-kowalski", name: "Sam Kowalski" },
  { email: "amara.okafor@example.com", username: "amara-okafor", name: "Amara Okafor" },
];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261028);

export async function seedDemo(): Promise<void> {
  if (config.NODE_ENV === "production") throw new Error("demo:seed refuses to run in production");
  const password = config.DEMO_PASSWORD ?? crypto.randomBytes(9).toString("base64url");
  const existing = await db.selectFrom("users").select("id").where("email", "=", ADMIN_EMAIL).executeTakeFirst();
  if (existing) {
    printLogins(config.DEMO_PASSWORD ? password : null);
    return;
  }
  const models = await ensureStarterCatalog(db, { includeStub: true });
  if (!models) throw new Error("the stub provider was not created");
  const hash = await hashPassword(password);
  const now = Date.now();

  const adminId = newId();
  await db
    .insertInto("users")
    .values({ id: adminId, email: ADMIN_EMAIL, username: "admin", display_name: "Morgan Ellis", password_hash: hash, role: "ADMIN", status: "ACTIVE", email_verified_at: new Date(now - 40 * 24 * HOUR), created_at: new Date(now - 40 * 24 * HOUR) })
    .execute();
  const coachingTier = newId();
  await db.insertInto("quota_tiers").values({ id: coachingTier, name: "Coaching cohort", monthly_interviews: 30, monthly_voice_minutes: 600, max_session_minutes: 20 }).execute();

  const ids: Record<string, string> = {};
  for (const [i, p] of PEOPLE.entries()) {
    const id = newId();
    ids[p.username] = id;
    await db
      .insertInto("users")
      .values({
        id,
        email: p.email,
        username: p.username,
        display_name: p.name,
        password_hash: hash,
        role: "USER",
        status: "ACTIVE",
        email_verified_at: new Date(now - (30 - i) * 24 * HOUR),
        created_at: new Date(now - (30 - i) * 24 * HOUR),
        quota_tier_id: i === 0 || i === 2 ? coachingTier : null,
        last_seen_at: new Date(now - i * HOUR),
      })
      .execute();
  }
  const main = ids["priya-nair"]!;
  await db.insertInto("user_preferences").values({ user_id: main, voice: "default", transcription_language: "en", proctoring_default: true, default_realtime_model_id: models.voice }).execute();

  for (const iv of MAIN_INTERVIEWS) {
    const interviewId = await seedInterview(main, iv, models, now);
    if (iv.share) await createShare({ id: main, username: "priya-nair", displayName: "Priya Nair", role: "USER", status: "ACTIVE" }, interviewId, { includeTranscript: true, expiresInDays: 30 });
  }

  for (const [n, username] of ["leo-marquez", "sam-kowalski", "amara-okafor"].entries()) {
    const o = OTHER_INTERVIEWS[n]!;
    const plan: PlanRound[] = [
      { name: "Introduction & Background", focus: "Story and motivation", description: "Background and fit.", questions: o.scores.slice(0, 2).map((_, i) => ({ text: i ? "What are you looking for in your next team?" : "Please introduce yourself and walk me through your background.", code: false, language: null })) },
      { name: `${o.domain} Depth`, focus: "Role depth", description: "Hands-on depth for the role.", questions: o.scores.slice(2).map((_, i) => ({ text: `Tell me about the hardest ${o.domain.toLowerCase()} problem you solved recently (${i + 1}).`, code: false, language: null })) },
    ];
    const answers = o.scores.map(([d, c], i) => ({
      round: i < 2 ? 0 : 1,
      question: i < 2 ? i : i - 2,
      domain: d,
      communication: c,
      transcript: [
        { role: "interviewer" as const, text: "Thanks, tell me more." },
        { role: "candidate" as const, text: "I worked on that end to end and measured the result." },
      ],
      feedback: { analysis: "A clear answer with a concrete example. Add a measurable outcome to make it stronger.", strengths: ["Concrete example", "Clear structure"], weaknesses: ["No measurable outcome"], suggestions: ["Quantify the result"], correctedSnippet: null },
    }));
    await seedInterview(ids[username]!, { title: o.title, source: "RESUME", company: null, role: o.role, domain: o.domain, summary: `${o.role} candidate.`, daysAgo: 3 + n * 4, status: "COMPLETED", proctoring: false, plan, answers, minutesPerQuestion: 3 }, models, now);
  }

  // Thirty days of usage for the admin overview (the interviews above booked their own).
  for (const userId of Object.values(ids)) {
    for (let d = 8; d < 30; d++) {
      if (rand() < 0.6) continue;
      const day = new Date(now - d * 24 * HOUR).toISOString().slice(0, 10);
      const calls = 1 + Math.ceil(rand() * 10);
      await db
        .insertInto("usage_daily")
        .values({ user_id: userId, day: sql<Date>`${day}::date`, model_id: models.text, calls, interviews: rand() < 0.5 ? 1 : 0, input_tokens: calls * 2500, output_tokens: calls * 900 })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await db
        .insertInto("usage_daily")
        .values({ user_id: userId, day: sql<Date>`${day}::date`, model_id: models.voice, voice_seconds: Math.floor(300 + rand() * 1500) })
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
  }
  printLogins(password);
  await closeQueues();
  await closeRedis();
}

async function seedInterview(userId: string, iv: DemoInterview, models: { text: string; voice: string }, now: number): Promise<string> {
  const created = new Date(now - iv.daysAgo * 24 * HOUR - 2 * HOUR);
  const id = newId();
  const answered = iv.answers.length;
  const last = iv.answers[answered - 1];
  await db
    .insertInto("interviews")
    .values({
      id,
      user_id: userId,
      source: iv.source,
      status: iv.status,
      title: iv.title,
      company: iv.company,
      role: iv.role,
      domain: iv.domain,
      summary: iv.summary,
      job_description: iv.jobDescription ?? null,
      plan: JSON.stringify(iv.plan),
      proctoring: iv.proctoring,
      text_model_id: models.text,
      realtime_model_id: models.voice,
      current_round: iv.status === "COMPLETED" && last ? last.round : 0,
      current_question: iv.status === "COMPLETED" && last ? last.question : 0,
      started_at: answered ? new Date(created.getTime() + 5 * 60_000) : null,
      completed_at: iv.status === "COMPLETED" ? new Date(created.getTime() + (answered * iv.minutesPerQuestion + 8) * 60_000) : null,
      created_at: created,
      updated_at: created,
    })
    .execute();
  await db.insertInto("usage_daily").values({ user_id: userId, day: sql<Date>`${created.toISOString().slice(0, 10)}::date`, model_id: models.text, calls: 1 + answered, interviews: 1, input_tokens: 4000 + answered * 1800, output_tokens: 3000 + answered * 600 }).onConflict((oc) => oc.columns(["user_id", "day", "model_id"]).doUpdateSet((eb) => ({ interviews: eb("usage_daily.interviews", "+", 1), calls: eb("usage_daily.calls", "+", eb.ref("excluded.calls")) }))).execute();

  let at = created.getTime() + 5 * 60_000;
  let voiceSeconds = 0;
  for (const a of iv.answers) {
    const seconds = Math.round(iv.minutesPerQuestion * 60 * (0.7 + rand() * 0.6));
    voiceSeconds += seconds;
    await db
      .insertInto("live_sessions")
      .values({ id: newId(), interview_id: id, user_id: userId, model_id: models.voice, provider_kind: "STUB", round_index: a.round, question_index: a.question, status: "ENDED", max_seconds: 900, seconds, created_at: new Date(at), expires_at: new Date(at + 1000 * 1100), ended_at: new Date(at + seconds * 1000) })
      .execute();
    at += seconds * 1000;
    await db
      .insertInto("answers")
      .values({
        id: newId(),
        interview_id: id,
        round_index: a.round,
        question_index: a.question,
        kind: a.code ? "CODE" : "VOICE",
        transcript: JSON.stringify(a.transcript ?? []),
        code: a.code ?? null,
        language: a.language ?? null,
        status: "SCORED",
        domain_rating: a.domain,
        communication_rating: a.communication,
        feedback: JSON.stringify(a.feedback),
        scored_at: new Date(at + 20_000),
        created_at: new Date(at),
        updated_at: new Date(at),
      })
      .execute();
  }
  if (voiceSeconds) {
    await db.insertInto("usage_daily").values({ user_id: userId, day: sql<Date>`${created.toISOString().slice(0, 10)}::date`, model_id: models.voice, voice_seconds: voiceSeconds }).onConflict((oc) => oc.columns(["user_id", "day", "model_id"]).doUpdateSet((eb) => ({ voice_seconds: eb("usage_daily.voice_seconds", "+", eb.ref("excluded.voice_seconds")) }))).execute();
  }
  if (iv.proctoring && answered) {
    const start = created.getTime() + 5 * 60_000;
    const events: [string, number][] = [
      ["TAB_HIDDEN", 9],
      ["TAB_VISIBLE", 9.3],
      ["NO_FACE", 21],
      ["FACE_BACK", 21.2],
    ];
    for (const [kind, minute] of events) {
      await db.insertInto("proctor_events").values({ id: newId(), interview_id: id, kind: kind as "NO_FACE", round_index: 1, question_index: 0, occurred_at: new Date(start + minute * 60_000) }).execute();
    }
  }
  return id;
}

function printLogins(password: string | null): void {
  const lines = [
    "",
    "  Demo accounts (all share one password):",
    `    admin     ${ADMIN_EMAIL}`,
    ...PEOPLE.map((p) => `    ${p.main ? "main     " : "user     "} ${p.email}`),
    password ? "" : "  The password was printed when the demo was first seeded (DEMO_PASSWORD in deploy/compose/.env).",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}
