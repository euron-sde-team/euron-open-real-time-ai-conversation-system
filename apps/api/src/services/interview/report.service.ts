/**
 * Reports: per-round and overall ratings, every question with its answer and feedback,
 * the transcript, voice time and proctoring events. Averages are computed in SQL over
 * scored answers only (an unscored answer is not a zero).
 */
import type { InterviewReport, ProctorEventKind, QuestionReport, RoundReport, TranscriptLine } from "@open-conversation/types";
import { sql } from "kysely";
import { type Actor, requireActor } from "../../core/context";
import { db } from "../../db/kysely";
import { planOf, toAnswer, toInterviewSummary, type InterviewRow } from "../../presenters/interview.presenter";
import { ownedInterview, statsFor } from "./interview.service";

const round1 = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));

/** Build the report for an interview row the caller is entitled to see. */
export async function buildReport(row: InterviewRow, opts: { includeTranscript: boolean }): Promise<InterviewReport> {
  const plan = planOf(row) ?? [];
  const [answers, byRound, overall, voice, events, owner, stats] = await Promise.all([
    db.selectFrom("answers").selectAll().where("interview_id", "=", row.id).execute(),
    db
      .selectFrom("answers")
      .select([
        "round_index",
        sql<number>`count(*)::int`.as("answered"),
        sql<number | null>`avg(domain_rating) filter (where status = 'SCORED')`.as("domain"),
        sql<number | null>`avg(communication_rating) filter (where status = 'SCORED')`.as("communication"),
        sql<number | null>`avg((domain_rating + communication_rating) / 2.0) filter (where status = 'SCORED')`.as("overall"),
      ])
      .where("interview_id", "=", row.id)
      .groupBy("round_index")
      .execute(),
    db
      .selectFrom("answers")
      .select([
        sql<number | null>`avg(domain_rating) filter (where status = 'SCORED')`.as("domain"),
        sql<number | null>`avg(communication_rating) filter (where status = 'SCORED')`.as("communication"),
        sql<number | null>`avg((domain_rating + communication_rating) / 2.0) filter (where status = 'SCORED')`.as("overall"),
      ])
      .where("interview_id", "=", row.id)
      .executeTakeFirst(),
    db.selectFrom("live_sessions").select(sql<number>`coalesce(sum(seconds), 0)::int`.as("s")).where("interview_id", "=", row.id).executeTakeFirst(),
    row.proctoring
      ? db.selectFrom("proctor_events").select(["kind", "occurred_at", "round_index", "question_index"]).where("interview_id", "=", row.id).orderBy("occurred_at").limit(500).execute()
      : Promise.resolve([]),
    db.selectFrom("users").select("display_name").where("id", "=", row.user_id).executeTakeFirst(),
    statsFor([row.id]),
  ]);
  const roundStats = new Map(byRound.map((r) => [r.round_index, r]));
  const answerAt = new Map(answers.map((a) => [`${a.round_index}:${a.question_index}`, a]));

  const rounds: RoundReport[] = plan.map((r, i) => {
    const s = roundStats.get(i);
    return {
      name: r.name,
      focus: r.focus,
      domainRating: round1(s?.domain),
      communicationRating: round1(s?.communication),
      overallRating: round1(s?.overall),
      questionCount: r.questions.length,
      answeredCount: Number(s?.answered ?? 0),
    };
  });

  const questions: QuestionReport[] = plan.flatMap((r, ri) =>
    r.questions.map((q, qi) => {
      const a = answerAt.get(`${ri}:${qi}`) ?? null;
      return {
        round: ri,
        question: qi,
        text: q.text,
        code: q.code,
        answer: a ? toAnswer(a) : null,
        transcript: a && opts.includeTranscript ? ((a.transcript as unknown as TranscriptLine[]) ?? []) : null,
        submittedCode: a && opts.includeTranscript ? a.code : null,
      };
    }),
  );

  return {
    interview: toInterviewSummary(row, stats.get(row.id) ?? { answered: 0, score: null }),
    candidateName: owner?.display_name ?? "Candidate",
    domainRating: round1(overall?.domain),
    communicationRating: round1(overall?.communication),
    overallRating: round1(overall?.overall),
    voiceSeconds: Number(voice?.s ?? 0),
    rounds,
    questions,
    proctoring: row.proctoring
      ? {
          enabled: true,
          events: events.map((e) => ({ kind: e.kind as ProctorEventKind, occurredAt: e.occurred_at.toISOString(), round: e.round_index, question: e.question_index })),
        }
      : null,
  };
}

export async function getReport(actor: Actor, id: string): Promise<InterviewReport> {
  const row = await ownedInterview(requireActor(actor).id, id);
  return buildReport(row, { includeTranscript: true });
}
