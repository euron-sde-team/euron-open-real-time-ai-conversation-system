/** Rows to DTOs for interviews and answers. Never includes another user's data: callers load by owner. */
import type { AnswerFeedback, AnswerResult, Interview, InterviewSummary, PlanRound, RealtimeProvider } from "@open-conversation/types";
import type { Selectable } from "kysely";
import type { Answers, Interviews } from "../db/types";
import { questionCount } from "../services/interview/plan";

export type InterviewRow = Selectable<Interviews>;
export type AnswerRow = Selectable<Answers>;

/** Aggregates computed in SQL next to the row (services/interview/interview.service.ts). */
export interface InterviewStats {
  answered: number;
  /** Mean of (domain + communication) / 2 over scored answers, or null. */
  score: number | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function planOf(row: InterviewRow): PlanRound[] | null {
  return Array.isArray(row.plan) ? (row.plan as unknown as PlanRound[]) : null;
}

export function toInterviewSummary(row: InterviewRow, stats: InterviewStats): InterviewSummary {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    status: row.status,
    company: row.company,
    role: row.role,
    domain: row.domain,
    overallScore: stats.score === null ? null : Math.round(stats.score),
    questionCount: questionCount(planOf(row)),
    answeredCount: stats.answered,
    createdAt: row.created_at.toISOString(),
    completedAt: iso(row.completed_at),
  };
}

export function toAnswer(a: AnswerRow): AnswerResult {
  return {
    round: a.round_index,
    question: a.question_index,
    kind: a.kind,
    status: a.status,
    domainRating: a.domain_rating,
    communicationRating: a.communication_rating,
    feedback: (a.feedback as AnswerFeedback | null) ?? null,
    updatedAt: a.updated_at.toISOString(),
  };
}

export function toInterview(
  row: InterviewRow,
  stats: InterviewStats,
  answers: AnswerRow[],
  realtimeModel: { id: string; displayName: string; provider: RealtimeProvider } | null,
): Interview {
  return {
    ...toInterviewSummary(row, stats),
    summary: row.summary,
    plan: planOf(row),
    planError: row.plan_error,
    proctoring: row.proctoring,
    position: { round: row.current_round, question: row.current_question },
    editable: row.status === "READY" && row.started_at === null,
    realtimeModel,
    answers: answers.map(toAnswer),
  };
}
