/**
 * Live voice sessions (ADR 0003). One session per question:
 *
 *   1. POST /interviews/:id/live      owner + quota checked under the user's quota lock;
 *                                     any other open session of the user is closed; the
 *                                     interviewer's instructions are built from the stored
 *                                     plan; the provider mints a short-lived credential
 *                                     with them inside; a live_sessions row records it.
 *   2. The browser connects to the provider (OpenAI through the SDP relay below).
 *   3. POST /interviews/:id/live/:sid/end   books the server-measured seconds.
 *   4. The sweeper expires sessions the browser never ended, booking their full length.
 *
 * Nothing the browser sends becomes part of the instructions.
 */
import crypto from "node:crypto";
import type { LiveSessionEnd, LiveSessionGrant } from "@open-conversation/types";
import { config } from "../../core/config";
import { type Actor, requireActive } from "../../core/context";
import { Effects, withTransaction } from "../../core/effects";
import { badRequest, conflict, HttpError, notFound } from "../../core/errors";
import { newId } from "../../core/ids";
import { captureError } from "../../core/logger";
import { db } from "../../db/kysely";
import { realtimeAdapter, realtimeBaseUrl, RealtimeMintError } from "../../integrations/realtime";
import { planOf } from "../../presenters/interview.presenter";
import { findModel, realtimeProviderOf, resolveRealtimeModel, endpointFor } from "../models.service";
import { preferencesOf } from "../preferences.service";
import { limitsFor, lockUserQuota, usedThisMonth, voiceSecondsAllowed } from "../quota.service";
import { getSettings } from "../settings.service";
import { ownedInterview } from "./interview.service";
import { questionAt } from "./plan";
import { END_QUESTION_TOOL, interviewerInstructions } from "./prompts";
import { closeOpenSessions, closeSession } from "./sessions";

export function hashCredential(credential: string): string {
  return crypto.createHash("sha256").update(credential).digest("hex");
}

const serviceUnavailable = (message: string, code: string) => new HttpError(503, message, code);

export async function startLive(actor: Actor, interviewId: string, at: { round?: number; question?: number }): Promise<LiveSessionGrant> {
  const a = requireActive(actor);
  const row = await ownedInterview(a.id, interviewId);
  if (row.status === "COMPLETED") throw conflict("This interview is finished", "INTERVIEW_COMPLETED");
  if (row.status !== "READY" && row.status !== "IN_PROGRESS") throw conflict("The plan is not ready yet", "PLAN_NOT_READY");
  const plan = planOf(row);
  if (!plan) throw conflict("The plan is not ready yet", "PLAN_NOT_READY");
  const round = at.round ?? row.current_round;
  const index = at.question ?? row.current_question;
  const asked = questionAt(plan, round, index);
  if (!asked) throw badRequest("There is no such question", "QUESTION_NOT_FOUND");

  const [prefs, settings] = await Promise.all([preferencesOf(a.id), getSettings()]);
  // With code questions switched off, a code question is asked and answered by voice.
  const q = settings.features.codeQuestions ? asked : { ...asked, code: false, language: null };
  const effectivePlan = settings.features.codeQuestions ? plan : plan.map((r) => ({ ...r, questions: r.questions.map((x) => ({ ...x, code: false, language: null })) }));
  const model = await resolveRealtimeModel(row.realtime_model_id, prefs.defaultRealtimeModelId);
  if (!model) throw serviceUnavailable("No voice model is set up yet. Ask an admin to add one.", "NO_REALTIME_MODEL");
  const provider = realtimeProviderOf(model.kind)!;
  const voice = model.model.voices.includes(prefs.voice) ? prefs.voice : (model.model.voices[0] ?? prefs.voice);
  const first = row.started_at === null && round === 0 && index === 0;
  const instructions = interviewerInstructions({
    interviewerName: settings.interviewerName,
    addendum: settings.interviewerAddendum,
    summary: row.summary,
    company: row.company,
    role: row.role,
    plan: effectivePlan,
    round,
    question: index,
    first,
    language: prefs.transcriptionLanguage,
  });

  // Book the session under the quota lock; mint after commit so a slow provider never holds the lock.
  const fx = new Effects();
  const session = await db.transaction().execute(async (trx) => {
    await lockUserQuota(a.id, trx);
    await closeOpenSessions(trx, a.id, fx);
    const maxSeconds = await voiceSecondsAllowed(a.id, trx);
    const now = new Date();
    const s = await trx
      .insertInto("live_sessions")
      .values({
        id: newId(),
        interview_id: row.id,
        user_id: a.id,
        model_id: model.model.id,
        provider_kind: model.kind,
        round_index: round,
        question_index: index,
        max_seconds: maxSeconds,
        expires_at: new Date(now.getTime() + (config.REALTIME_CONNECT_TTL_SECONDS + maxSeconds + config.REALTIME_GRACE_SECONDS) * 1000),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx
      .updateTable("interviews")
      .set({ status: "IN_PROGRESS", started_at: row.started_at ?? now, current_round: round, current_question: index, realtime_model_id: row.realtime_model_id ?? model.model.id, updated_at: now })
      .where("id", "=", row.id)
      .execute();
    return s;
  });
  await fx.flush();

  const script = provider === "stub" ? [first ? `Hi, I'm ${settings.interviewerName}. Let's begin.` : "Alright, next question.", q.text] : [];
  try {
    const minted = await realtimeAdapter(provider).mint(
      {
        model: model.model.model_ref,
        voice,
        instructions,
        tool: { ...END_QUESTION_TOOL, parameters: { ...END_QUESTION_TOOL.parameters } },
        transcriptionLanguage: prefs.transcriptionLanguage,
        connectTtlSeconds: config.REALTIME_CONNECT_TTL_SECONDS,
        maxSeconds: session.max_seconds,
        script,
      },
      model.endpoint.apiKey,
      realtimeBaseUrl(provider, model.provider.base_url),
    );
    await db.updateTable("live_sessions").set({ credential_hash: hashCredential(minted.credential) }).where("id", "=", session.id).execute();
    return {
      id: session.id,
      provider,
      credential: minted.credential,
      model: model.model.model_ref,
      voice,
      connectUrl: minted.connectUrl,
      expiresAt: minted.expiresAt.toISOString(),
      maxSeconds: session.max_seconds,
      question: { round, index, text: q.text, code: q.code, language: q.language },
      ...(provider === "stub" ? { script } : {}),
    };
  } catch (err) {
    // Nothing was spoken: close the session at zero seconds.
    await db.updateTable("live_sessions").set({ status: "ENDED", seconds: 0, ended_at: new Date() }).where("id", "=", session.id).where("status", "=", "OPEN").execute();
    if (err instanceof RealtimeMintError) {
      captureError(err, { where: "live.mint", provider, status: err.status });
      throw new HttpError(502, "The voice service could not start a session. Try again in a moment.", "REALTIME_UNAVAILABLE");
    }
    throw err;
  }
}

export async function endLive(actor: Actor, interviewId: string, sessionId: string): Promise<LiveSessionEnd> {
  const a = requireActive(actor);
  const seconds = await withTransaction(async (trx, fx) => {
    const s = await trx.selectFrom("live_sessions").select(["id", "status", "seconds"]).where("id", "=", sessionId).where("interview_id", "=", interviewId).where("user_id", "=", a.id).executeTakeFirst();
    if (!s) throw notFound("Session not found", "LIVE_SESSION_NOT_FOUND");
    if (s.status !== "OPEN") return s.seconds;
    return (await closeSession(trx, s.id, "ENDED", fx)) ?? 0;
  });
  const [limits, used] = await Promise.all([limitsFor(a.id), usedThisMonth(a.id)]);
  return { seconds, voiceMinutesLeft: limits.monthlyVoiceMinutes === null ? null : Math.max(0, limits.monthlyVoiceMinutes - Math.ceil(used.voiceSeconds / 60)) };
}

/** Sessions past their expiry become EXPIRED and book their full length. Returns how many. */
export async function sweepLiveSessions(now = new Date()): Promise<number> {
  const due = await db.selectFrom("live_sessions").select("id").where("status", "=", "OPEN").where("expires_at", "<=", now).limit(500).execute();
  let n = 0;
  for (const { id } of due) {
    try {
      const closed = await withTransaction((trx, fx) => closeSession(trx, id, "EXPIRED", fx, now));
      if (closed !== null) n++;
    } catch (err) {
      captureError(err, { where: "live.sweep", sessionId: id });
    }
  }
  return n;
}

/**
 * The SDP relay's gate: an OPEN OpenAI session minted with exactly this credential,
 * still inside its connection window, and not yet connected. Returns the session id.
 */
export async function claimRelay(credential: string): Promise<{ sessionId: string; baseUrl: string } | null> {
  const s = await db
    .selectFrom("live_sessions")
    .select(["id", "created_at", "model_id"])
    .where("credential_hash", "=", hashCredential(credential))
    .where("status", "=", "OPEN")
    .where("provider_kind", "=", "OPENAI")
    .where("provider_call_id", "is", null)
    .executeTakeFirst();
  if (!s) return null;
  if (Date.now() - s.created_at.getTime() > config.REALTIME_CONNECT_TTL_SECONDS * 1000) return null;
  // The same base URL the credential was minted on (a provider row may point at a proxy).
  const m = s.model_id ? await findModel(s.model_id) : null;
  return { sessionId: s.id, baseUrl: realtimeBaseUrl("openai", m?.provider.base_url ?? null) };
}

export async function rememberCall(sessionId: string, callId: string): Promise<void> {
  await db.updateTable("live_sessions").set({ provider_call_id: callId.slice(0, 200) }).where("id", "=", sessionId).execute();
}

/** Job: hang up the provider call of a closed session (best effort). */
export async function hangup(sessionId: string): Promise<void> {
  const s = await db.selectFrom("live_sessions").select(["provider_call_id", "model_id"]).where("id", "=", sessionId).executeTakeFirst();
  if (!s?.provider_call_id || !s.model_id) return;
  const m = await findModel(s.model_id);
  if (!m) return;
  const adapter = realtimeAdapter("openai");
  const endpoint = endpointFor(m.provider);
  await adapter.hangup?.(s.provider_call_id, endpoint?.apiKey ?? null, realtimeBaseUrl("openai", m.provider.base_url));
}
