/**
 * Interviews: create from a resume or a job description, read, edit the plan, answer,
 * report proctoring, finish, delete. Every read and write is scoped by owner: another
 * user's interview is a 404, never a 403 (it does not exist for them).
 *
 * Creation books one interview against the monthly quota inside a transaction holding
 * the user's quota lock; planning runs as a background job (interview.plan) and the
 * client polls until the interview is READY. A plan that fails gives the quota back.
 */
import type { AnswerInput, AnswerResult, Interview, InterviewPatch, InterviewSummary, JobDescriptionInput, Page, ProctorEventInput } from "@open-conversation/types";
import { sql } from "kysely";
import { type Actor, requireActive, requireActor } from "../../core/context";
import { withTransaction } from "../../core/effects";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../../core/errors";
import { newId } from "../../core/ids";
import { db, type Executor } from "../../db/kysely";
import { extractResumeText, sniffResume } from "../../integrations/extract";
import { config } from "../../core/config";
import { planOf, toAnswer, toInterview, toInterviewSummary, type InterviewRow, type InterviewStats } from "../../presenters/interview.presenter";
import { atKey, decodeTime, olderThan, timePage } from "../../repositories/keyset";
import { findModel, realtimeProviderOf, resolveTextModel } from "../models.service";
import { assertInterviewLeft, lockUserQuota, recordUsage } from "../quota.service";
import { getSettings } from "../settings.service";
import { nextPosition, normalisePlan, planSchema, questionAt, questionCount } from "./plan";
import { closeOpenSessions } from "./sessions";

/** Shortest resume text worth planning from; less is usually a scanned image. */
const MIN_RESUME_CHARS = 200;
const MAX_TRANSCRIPT_LINES = 200;
const MAX_TRANSCRIPT_CHARS = 30_000;
const MAX_PROCTOR_EVENTS = 2_000;

// ─── Loading ────────────────────────────────────────────────────────────────

/** The interview if `userId` owns it, else a 404. */
export async function ownedInterview(userId: string, id: string, exec: Executor = db, lock = false): Promise<InterviewRow> {
  let q = exec.selectFrom("interviews").selectAll().where("id", "=", id).where("user_id", "=", userId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw notFound("Interview not found", "INTERVIEW_NOT_FOUND");
  return row;
}

/** Answered count and mean score per interview, in one query. */
export async function statsFor(ids: string[], exec: Executor = db): Promise<Map<string, InterviewStats>> {
  const out = new Map<string, InterviewStats>();
  if (!ids.length) return out;
  const rows = await exec
    .selectFrom("answers")
    .select([
      "interview_id",
      sql<number>`count(*)::int`.as("answered"),
      sql<number | null>`avg((domain_rating + communication_rating) / 2.0) filter (where status = 'SCORED')`.as("score"),
    ])
    .where("interview_id", "in", ids)
    .groupBy("interview_id")
    .execute();
  for (const r of rows) out.set(r.interview_id, { answered: Number(r.answered), score: r.score === null ? null : Number(r.score) });
  return out;
}

const NO_STATS: InterviewStats = { answered: 0, score: null };

async function present(row: InterviewRow, exec: Executor = db): Promise<Interview> {
  const [stats, answers, model] = await Promise.all([
    statsFor([row.id], exec),
    exec.selectFrom("answers").selectAll().where("interview_id", "=", row.id).orderBy("round_index").orderBy("question_index").execute(),
    row.realtime_model_id ? findModel(row.realtime_model_id) : Promise.resolve(null),
  ]);
  const provider = model ? realtimeProviderOf(model.provider.kind) : null;
  return toInterview(row, stats.get(row.id) ?? NO_STATS, answers, model && provider ? { id: model.model.id, displayName: model.model.display_name, provider } : null);
}

export async function getInterview(actor: Actor, id: string): Promise<Interview> {
  return present(await ownedInterview(requireActor(actor).id, id));
}

export async function listInterviews(actor: Actor, q: { cursor?: string; limit?: number; status?: string }): Promise<Page<InterviewSummary>> {
  const a = requireActor(actor);
  const limit = q.limit ?? 20;
  let query = db
    .selectFrom("interviews")
    .selectAll()
    .select(atKey("created_at"))
    .where("user_id", "=", a.id)
    .where(olderThan("created_at", "id", decodeTime(q.cursor)) as never)
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .limit(limit + 1);
  if (q.status) query = query.where("status", "=", q.status as InterviewRow["status"]);
  const page = timePage(await query.execute(), limit);
  const stats = await statsFor(page.items.map((r) => r.id));
  return { items: page.items.map((r) => toInterviewSummary(r, stats.get(r.id) ?? NO_STATS)), nextCursor: page.nextCursor };
}

// ─── Creating ───────────────────────────────────────────────────────────────

async function textModelOr503() {
  const model = await resolveTextModel();
  if (!model) throw Object.assign(unprocessable("No model is set up to plan interviews yet. Ask an admin to add one.", "NO_TEXT_MODEL"), { status: 503 });
  return model;
}

/**
 * Upload a resume. The file is read in memory, never stored: only the text goes to the
 * planner job, whose payload is deleted from the queue as soon as the job finishes.
 */
export async function createFromResume(actor: Actor, file: { data: Buffer; name: string }, opts: { proctoring?: boolean }): Promise<Interview> {
  const a = requireActive(actor);
  const settings = await getSettings();
  if (!settings.features.resumeUpload) throw forbidden("Resume upload is turned off on this server", "FEATURE_DISABLED");
  if (!file.data.length) throw badRequest("Choose a resume to upload", "FILE_REQUIRED");
  if (file.data.length > config.MAX_RESUME_MB * 1024 * 1024) throw badRequest(`Resumes can be up to ${config.MAX_RESUME_MB} MB`, "FILE_TOO_LARGE");
  const type = sniffResume(file.data);
  if (!type) throw badRequest("Upload a PDF or a Word (.docx) file", "FILE_TYPE");
  let text: string;
  try {
    text = await extractResumeText(type, file.data);
  } catch {
    throw unprocessable("This file could not be read. Try exporting it again as PDF.", "FILE_UNREADABLE");
  }
  if (text.length < MIN_RESUME_CHARS) throw unprocessable("This resume has too little text to read (a scanned image?). Upload a text PDF or a .docx.", "RESUME_TOO_SHORT");
  const model = await textModelOr503();
  const row = await withTransaction(async (trx, fx) => {
    await lockUserQuota(a.id, trx);
    await assertInterviewLeft(a.id, trx);
    const row = await trx
      .insertInto("interviews")
      .values({ id: newId(), user_id: a.id, source: "RESUME", status: "PLANNING", title: "Interview from your resume", proctoring: settings.features.proctoring && (opts.proctoring ?? false), text_model_id: model.model.id })
      .returningAll()
      .executeTakeFirstOrThrow();
    await recordUsage({ userId: a.id, modelId: model.model.id, interviews: 1 }, trx);
    fx.job("interview.plan", { interviewId: row.id, resumeText: text });
    return row;
  });
  return present((await db.selectFrom("interviews").selectAll().where("id", "=", row.id).executeTakeFirst()) ?? row);
}

export async function createFromJobDescription(actor: Actor, input: JobDescriptionInput): Promise<Interview> {
  const a = requireActive(actor);
  const settings = await getSettings();
  if (!settings.features.jobDescription) throw forbidden("Interviews from a job description are turned off on this server", "FEATURE_DISABLED");
  const model = await textModelOr503();
  const row = await withTransaction(async (trx, fx) => {
    await lockUserQuota(a.id, trx);
    await assertInterviewLeft(a.id, trx);
    const row = await trx
      .insertInto("interviews")
      .values({
        id: newId(),
        user_id: a.id,
        source: "JOB_DESCRIPTION",
        status: "PLANNING",
        title: `${input.role} at ${input.company}`.slice(0, 160),
        company: input.company,
        role: input.role,
        job_description: input.jobDescription,
        proctoring: settings.features.proctoring && (input.proctoring ?? false),
        text_model_id: model.model.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await recordUsage({ userId: a.id, modelId: model.model.id, interviews: 1 }, trx);
    fx.job("interview.plan", { interviewId: row.id });
    return row;
  });
  return present((await db.selectFrom("interviews").selectAll().where("id", "=", row.id).executeTakeFirst()) ?? row);
}

/** Plan again from the stored job description. Resumes are not kept, so they cannot be re-planned. */
export async function replan(actor: Actor, id: string): Promise<Interview> {
  const a = requireActive(actor);
  const row = await withTransaction(async (trx, fx) => {
    const row = await ownedInterview(a.id, id, trx, true);
    if (row.source !== "JOB_DESCRIPTION") throw conflict("Resumes are not kept, so this plan cannot be regenerated. Upload the resume again.", "REPLAN_UNAVAILABLE");
    if (row.started_at || (row.status !== "READY" && row.status !== "PLAN_FAILED")) throw conflict("This interview has already started", "INTERVIEW_STARTED");
    // A failed plan gave its interview back to the quota; planning again books it again.
    if (row.status === "PLAN_FAILED") {
      await lockUserQuota(a.id, trx);
      await assertInterviewLeft(a.id, trx);
      if (row.text_model_id) await recordUsage({ userId: a.id, modelId: row.text_model_id, interviews: 1 }, trx);
    }
    const updated = await trx.updateTable("interviews").set({ status: "PLANNING", plan_error: null, updated_at: new Date() }).where("id", "=", row.id).returningAll().executeTakeFirstOrThrow();
    fx.job("interview.plan", { interviewId: row.id });
    return updated;
  });
  return present((await db.selectFrom("interviews").selectAll().where("id", "=", row.id).executeTakeFirst()) ?? row);
}

/** Edit before the first live session: title, plan, proctoring, realtime model. */
export async function updateInterview(actor: Actor, id: string, patch: InterviewPatch): Promise<Interview> {
  const a = requireActive(actor);
  const row = await withTransaction(async (trx) => {
    const row = await ownedInterview(a.id, id, trx, true);
    const started = row.started_at !== null || row.status !== "READY";
    if (started && (patch.plan !== undefined || patch.proctoring !== undefined || patch.realtimeModelId !== undefined)) throw conflict("The plan is fixed once the interview starts", "INTERVIEW_STARTED");
    let plan: unknown = undefined;
    if (patch.plan !== undefined) {
      const parsed = planSchema.safeParse(patch.plan);
      if (!parsed.success) throw badRequest("The plan is not valid", "PLAN_INVALID", { issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })) });
      plan = normalisePlan(parsed.data);
    }
    if (patch.proctoring && !(await getSettings()).features.proctoring) throw forbidden("Proctoring is turned off on this server", "FEATURE_DISABLED");
    if (patch.realtimeModelId) {
      const m = await findModel(patch.realtimeModelId);
      if (!m || m.model.kind !== "REALTIME" || !m.model.enabled || !realtimeProviderOf(m.provider.kind)) throw badRequest("That voice model is not available", "MODEL_UNAVAILABLE");
    }
    return trx
      .updateTable("interviews")
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(plan !== undefined ? { plan: JSON.stringify(plan), current_round: 0, current_question: 0 } : {}),
        ...(patch.proctoring !== undefined ? { proctoring: patch.proctoring } : {}),
        ...(patch.realtimeModelId !== undefined ? { realtime_model_id: patch.realtimeModelId } : {}),
        updated_at: new Date(),
      })
      .where("id", "=", row.id)
      .returningAll()
      .executeTakeFirstOrThrow();
  });
  return present(row);
}

export async function deleteInterview(actor: Actor, id: string): Promise<void> {
  const a = requireActor(actor);
  const res = await db.deleteFrom("interviews").where("id", "=", id).where("user_id", "=", a.id).executeTakeFirst();
  if (!res.numDeletedRows) throw notFound("Interview not found", "INTERVIEW_NOT_FOUND");
}

export async function completeInterview(actor: Actor, id: string): Promise<Interview> {
  const a = requireActive(actor);
  const row = await withTransaction(async (trx, fx) => {
    const row = await ownedInterview(a.id, id, trx, true);
    if (row.status === "COMPLETED") return row;
    if (row.status !== "IN_PROGRESS" && row.status !== "READY") throw conflict("This interview cannot be finished yet", "INTERVIEW_NOT_STARTED");
    await closeOpenSessions(trx, a.id, fx);
    return trx.updateTable("interviews").set({ status: "COMPLETED", completed_at: new Date(), updated_at: new Date() }).where("id", "=", row.id).returningAll().executeTakeFirstOrThrow();
  });
  return present(row);
}

// ─── Answers ────────────────────────────────────────────────────────────────

function cleanTranscript(lines: AnswerInput["transcript"]) {
  const out: { role: "interviewer" | "candidate"; text: string }[] = [];
  let total = 0;
  for (const l of (lines ?? []).slice(-MAX_TRANSCRIPT_LINES)) {
    const text = l.text.replaceAll("\u0000", "").trim();
    if (!text) continue;
    total += text.length;
    if (total > MAX_TRANSCRIPT_CHARS) break;
    out.push({ role: l.role, text });
  }
  return out;
}

/**
 * Record the answer to one question and queue its scoring. The client sends what was
 * said (or the code); scores are written only by the scoring job. Answering a question
 * again replaces the earlier answer. With `advance` (the default) the interview moves
 * to the next question, and finishes after the last one.
 */
export async function submitAnswer(actor: Actor, id: string, input: AnswerInput): Promise<AnswerResult> {
  const a = requireActive(actor);
  return withTransaction(async (trx, fx) => {
    const row = await ownedInterview(a.id, id, trx, true);
    if (row.status !== "IN_PROGRESS") throw conflict(row.status === "COMPLETED" ? "This interview is finished" : "Start the interview first", "INTERVIEW_NOT_IN_PROGRESS");
    const plan = planOf(row) ?? [];
    const asked = questionAt(plan, input.round, input.question);
    if (!asked) throw badRequest("There is no such question", "QUESTION_NOT_FOUND");
    // With code questions switched off, every answer is a voice answer.
    const q = (await getSettings()).features.codeQuestions ? asked : { ...asked, code: false, language: null };
    const kind = q.code ? "CODE" : "VOICE";
    const transcript = cleanTranscript(input.transcript);
    const code = q.code ? (input.code ?? "").slice(0, 40_000) : null;
    if (q.code && !code?.trim() && !transcript.length) throw badRequest("Write some code, or say why you are skipping", "ANSWER_EMPTY");
    const now = new Date();
    const answer = await trx
      .insertInto("answers")
      .values({
        id: newId(),
        interview_id: row.id,
        round_index: input.round,
        question_index: input.question,
        kind,
        transcript: JSON.stringify(transcript),
        code,
        language: q.code ? (input.language ?? q.language ?? null) : null,
        status: "SCORING",
      })
      .onConflict((oc) =>
        oc.columns(["interview_id", "round_index", "question_index"]).doUpdateSet({
          transcript: JSON.stringify(transcript),
          code,
          language: q.code ? (input.language ?? q.language ?? null) : null,
          status: "SCORING",
          domain_rating: null,
          communication_rating: null,
          feedback: null,
          scored_at: null,
          updated_at: now,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    if (input.advance !== false) {
      const next = nextPosition(plan, input.round, input.question);
      await trx
        .updateTable("interviews")
        .set(next ? { current_round: next.round, current_question: next.question, updated_at: now } : { status: "COMPLETED", completed_at: now, updated_at: now })
        .where("id", "=", row.id)
        .execute();
    }
    fx.job("interview.score", { answerId: answer.id, version: answer.updated_at.toISOString() });
    return toAnswer(answer);
  });
}

// ─── Proctoring ─────────────────────────────────────────────────────────────

export async function recordProctorEvents(actor: Actor, id: string, events: ProctorEventInput[]): Promise<{ recorded: number }> {
  const a = requireActor(actor);
  const row = await ownedInterview(a.id, id);
  if (!row.proctoring || !(await getSettings()).features.proctoring) throw conflict("Proctoring is off for this interview", "PROCTORING_OFF");
  if (row.status === "COMPLETED" || !row.started_at) return { recorded: 0 };
  const existing = await db.selectFrom("proctor_events").select(sql<number>`count(*)::int`.as("n")).where("interview_id", "=", row.id).executeTakeFirst();
  const room = Math.max(0, MAX_PROCTOR_EVENTS - Number(existing?.n ?? 0));
  const now = Date.now();
  const rows = events.slice(0, Math.min(room, 100)).map((e) => {
    // A browser clock can be wrong; keep its time unless it is in the future or before the start.
    const t = new Date(e.occurredAt).getTime();
    const at = Number.isFinite(t) && t <= now && t >= row.started_at!.getTime() ? new Date(t) : new Date(now);
    return { id: newId(), interview_id: row.id, kind: e.kind, round_index: e.round ?? null, question_index: e.question ?? null, occurred_at: at };
  });
  if (rows.length) await db.insertInto("proctor_events").values(rows).execute();
  return { recorded: rows.length };
}

export { questionCount };
