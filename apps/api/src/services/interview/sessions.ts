/**
 * Closing live sessions and booking their voice time. Shared by the live session routes,
 * finishing an interview and the sweeper. Time is measured on the server: from minting
 * the credential to the close, capped at the session's max_seconds.
 */
import type { Effects } from "../../core/effects";
import type { Executor } from "../../db/kysely";
import { recordUsage } from "../quota.service";

export type CloseReason = "ENDED" | "EXPIRED";

export function measuredSeconds(createdAt: Date, maxSeconds: number, now = new Date()): number {
  return Math.max(0, Math.min(maxSeconds, Math.round((now.getTime() - createdAt.getTime()) / 1000)));
}

/**
 * Close one OPEN session (no-op when it is already closed) and book its seconds. When the
 * provider call is known, the hang-up is queued after commit.
 */
export async function closeSession(trx: Executor, sessionId: string, reason: CloseReason, fx: Effects, now = new Date()): Promise<number | null> {
  const s = await trx.selectFrom("live_sessions").selectAll().where("id", "=", sessionId).where("status", "=", "OPEN").forUpdate().executeTakeFirst();
  if (!s) return null;
  const seconds = reason === "EXPIRED" ? s.max_seconds : measuredSeconds(s.created_at, s.max_seconds, now);
  await trx.updateTable("live_sessions").set({ status: reason, seconds, ended_at: now }).where("id", "=", s.id).execute();
  if (s.model_id && seconds > 0) await recordUsage({ userId: s.user_id, modelId: s.model_id, voiceSeconds: seconds }, trx);
  if (s.provider_call_id && s.provider_kind === "OPENAI") fx.job("interview.hangup", { sessionId: s.id });
  return seconds;
}

/** Close every OPEN session of a user (a new session replaces the old one; finishing ends it). */
export async function closeOpenSessions(trx: Executor, userId: string, fx: Effects): Promise<void> {
  const open = await trx.selectFrom("live_sessions").select("id").where("user_id", "=", userId).where("status", "=", "OPEN").execute();
  for (const s of open) await closeSession(trx, s.id, "ENDED", fx);
}
