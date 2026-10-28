/**
 * Monthly allowances (ADR 0006): interviews created and minutes of live voice per UTC
 * calendar month, from the user's quota tier (or the default tier) with an optional
 * per-user override on top. There is no billing: admins decide who gets how much.
 *
 * Counting
 *   usage_daily is the durable record. Interviews and voice seconds are booked there, so
 *   deleting an interview never gives quota back. Every check-and-book runs inside a
 *   transaction holding a per-user advisory lock, so parallel requests cannot draw past
 *   a limit.
 *
 *   Voice time is measured by the server (from minting the credential to the end call or
 *   the sweeper), never reported by the browser, and capped at the session's max_seconds.
 */
import type { Usage } from "@open-conversation/types";
import { sql } from "kysely";
import { tooMany } from "../core/errors";
import { db, type Executor } from "../db/kysely";

export interface Limits {
  /** Null means unlimited. */
  monthlyInterviews: number | null;
  monthlyVoiceMinutes: number | null;
  maxSessionMinutes: number;
}

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function nextMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** The tier (or the default tier) with the user's override applied. */
export async function limitsFor(userId: string, exec: Executor = db): Promise<Limits> {
  const row = await exec
    .selectFrom("users as u")
    .leftJoin("quota_tiers as t", "t.id", "u.quota_tier_id")
    .leftJoin("quota_tiers as d", (j) => j.on("d.is_default", "=", true))
    .leftJoin("user_quota_overrides as o", "o.user_id", "u.id")
    .select([
      "t.id as tier_id",
      "t.monthly_interviews as t_interviews",
      "t.monthly_voice_minutes as t_minutes",
      "t.max_session_minutes as t_session",
      "d.monthly_interviews as d_interviews",
      "d.monthly_voice_minutes as d_minutes",
      "d.max_session_minutes as d_session",
      "o.user_id as o_user",
      "o.monthly_interviews as o_interviews",
      "o.monthly_voice_minutes as o_minutes",
    ])
    .where("u.id", "=", userId)
    .executeTakeFirst();
  if (!row) return { monthlyInterviews: 0, monthlyVoiceMinutes: 0, maxSessionMinutes: 1 };
  const onTier = row.tier_id !== null;
  const tierInterviews = onTier ? row.t_interviews : row.d_interviews;
  const tierMinutes = onTier ? row.t_minutes : row.d_minutes;
  return {
    monthlyInterviews: row.o_user && row.o_interviews !== null ? row.o_interviews : (tierInterviews ?? null),
    monthlyVoiceMinutes: row.o_user && row.o_minutes !== null ? row.o_minutes : (tierMinutes ?? null),
    maxSessionMinutes: (onTier ? row.t_session : row.d_session) ?? 15,
  };
}

/** Interviews and voice seconds booked this month. */
export async function usedThisMonth(userId: string, exec: Executor = db, now = new Date()): Promise<{ interviews: number; voiceSeconds: number }> {
  const row = await exec
    .selectFrom("usage_daily")
    .select([sql<number>`coalesce(sum(interviews), 0)::int`.as("interviews"), sql<number>`coalesce(sum(voice_seconds), 0)::bigint`.as("voice_seconds")])
    .where("user_id", "=", userId)
    .where("day", ">=", sql<Date>`${utcDay(monthStart(now))}::date`)
    .executeTakeFirst();
  return { interviews: Number(row?.interviews ?? 0), voiceSeconds: Number(row?.voice_seconds ?? 0) };
}

export async function usageOf(userId: string, now = new Date()): Promise<Usage> {
  const [limits, used] = await Promise.all([limitsFor(userId), usedThisMonth(userId, db, now)]);
  return {
    month: utcDay(monthStart(now)).slice(0, 7),
    interviews: { used: used.interviews, limit: limits.monthlyInterviews },
    voiceMinutes: { used: Math.ceil(used.voiceSeconds / 60), limit: limits.monthlyVoiceMinutes },
    maxSessionMinutes: limits.maxSessionMinutes,
    resetsAt: nextMonthStart(now).toISOString(),
  };
}

/** Serialises quota decisions for one user until the surrounding transaction ends. */
export async function lockUserQuota(userId: string, trx: Executor): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtext(${`quota:${userId}`}))`.execute(trx);
}

export function quotaExceeded(message: string) {
  return Object.assign(tooMany(message), { code: "QUOTA_EXCEEDED" as const });
}

/** Inside a locked transaction: refuse when this month's interviews reached the limit. */
export async function assertInterviewLeft(userId: string, trx: Executor): Promise<void> {
  const [limits, used] = await Promise.all([limitsFor(userId, trx), usedThisMonth(userId, trx)]);
  if (limits.monthlyInterviews !== null && used.interviews >= limits.monthlyInterviews) {
    throw quotaExceeded(`You have used this month's ${limits.monthlyInterviews} interviews`);
  }
}

/**
 * Inside a locked transaction: the seconds the next live session may run, or a 429 when
 * no voice time is left. The session cap is the smaller of the tier's session length and
 * what is left of the month.
 */
export async function voiceSecondsAllowed(userId: string, trx: Executor): Promise<number> {
  const [limits, used] = await Promise.all([limitsFor(userId, trx), usedThisMonth(userId, trx)]);
  const sessionCap = limits.maxSessionMinutes * 60;
  if (limits.monthlyVoiceMinutes === null) return sessionCap;
  const left = limits.monthlyVoiceMinutes * 60 - used.voiceSeconds;
  if (left < 30) throw quotaExceeded(`You have used this month's ${limits.monthlyVoiceMinutes} minutes of live voice`);
  return Math.min(sessionCap, left);
}

export interface UsageRecord {
  userId: string;
  modelId: string;
  calls?: number;
  interviews?: number;
  inputTokens?: number;
  outputTokens?: number;
  voiceSeconds?: number;
}

/** Book usage for today. Counts only (ADR 0006). */
export async function recordUsage(u: UsageRecord, exec: Executor = db): Promise<void> {
  await exec
    .insertInto("usage_daily")
    .values({
      user_id: u.userId,
      day: sql<Date>`${utcDay()}::date`,
      model_id: u.modelId,
      calls: u.calls ?? 0,
      interviews: u.interviews ?? 0,
      input_tokens: u.inputTokens ?? 0,
      output_tokens: u.outputTokens ?? 0,
      voice_seconds: u.voiceSeconds ?? 0,
    })
    .onConflict((oc) =>
      oc.columns(["user_id", "day", "model_id"]).doUpdateSet((eb) => ({
        calls: eb("usage_daily.calls", "+", eb.ref("excluded.calls")),
        interviews: eb("usage_daily.interviews", "+", eb.ref("excluded.interviews")),
        input_tokens: eb("usage_daily.input_tokens", "+", eb.ref("excluded.input_tokens")),
        output_tokens: eb("usage_daily.output_tokens", "+", eb.ref("excluded.output_tokens")),
        voice_seconds: eb("usage_daily.voice_seconds", "+", eb.ref("excluded.voice_seconds")),
      })),
    )
    .execute();
}
