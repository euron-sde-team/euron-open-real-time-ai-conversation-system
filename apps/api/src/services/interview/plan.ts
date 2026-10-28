/**
 * The interview plan: its bounds, its schema, and the clean-up applied to whatever a
 * model (or a candidate editing it) produces. One plan shape everywhere: the planner's
 * output, PATCH /interviews/:id, the stored `interviews.plan` column and the API DTO.
 */
import type { PlanRound } from "@open-conversation/types";
import { z } from "zod";

export const MAX_JOB_DESCRIPTION_CHARS = 12_000;
export const MAX_ROUNDS = 8;
export const MAX_QUESTIONS_PER_ROUND = 8;
export const MAX_QUESTION_CHARS = 2_500;

/** Languages the code editor knows; anything else opens as plain text. */
export const CODE_LANGUAGES = ["python", "javascript", "typescript", "java", "cpp", "go", "sql"] as const;

const question = z.object({
  text: z.string().trim().min(5).max(MAX_QUESTION_CHARS),
  code: z.boolean().default(false),
  language: z.string().trim().toLowerCase().max(20).nullish(),
});

const round = z.object({
  name: z.string().trim().min(2).max(80),
  focus: z.string().trim().max(300).default(""),
  description: z.string().trim().max(1000).default(""),
  questions: z.array(question).min(1).max(MAX_QUESTIONS_PER_ROUND),
});

export const planSchema = z.array(round).min(1).max(MAX_ROUNDS);

/** What the planner model must return. */
export const plannerOutput = z.object({
  domain: z.string().trim().max(120).default(""),
  role: z.string().trim().max(120).default(""),
  summary: z.string().trim().max(2000).default(""),
  rounds: z.array(z.unknown()),
});

/**
 * Normalise a plan: keep valid rounds and questions, drop the rest, fill the code
 * language from the question text when the model forgot it, and cap the sizes. Throws
 * when nothing usable is left.
 */
export function normalisePlan(raw: unknown): PlanRound[] {
  const list = Array.isArray(raw) ? raw : [];
  const rounds: PlanRound[] = [];
  for (const r of list.slice(0, MAX_ROUNDS)) {
    if (!r || typeof r !== "object") continue;
    const rr = r as Record<string, unknown>;
    const questions = (Array.isArray(rr.questions) ? rr.questions : [])
      .map((q) => question.safeParse(typeof q === "string" ? { text: q } : q))
      .filter((p) => p.success)
      .map((p) => {
        const q = p.data;
        const language = q.code ? normaliseLanguage(q.language ?? null, q.text) : null;
        return { text: q.text, code: q.code, language };
      })
      .slice(0, MAX_QUESTIONS_PER_ROUND);
    const parsed = round.safeParse({ ...rr, name: rr.name ?? rr.round, questions });
    if (parsed.success) rounds.push({ name: parsed.data.name, focus: parsed.data.focus, description: parsed.data.description, questions });
  }
  if (!rounds.length) throw new Error("The plan has no usable rounds");
  return rounds;
}

/** "Write your solution in Python." and friends decide the editor language. */
export function normaliseLanguage(given: string | null, text: string): string {
  const pick = (v: string) => {
    const s = v.toLowerCase();
    if (s.includes("typescript")) return "typescript";
    if (s.includes("javascript") || s === "js" || s.includes("node")) return "javascript";
    if (s.includes("python")) return "python";
    if (s.includes("java")) return "java";
    if (s.includes("c++") || s === "cpp") return "cpp";
    if (s === "go" || s.includes("golang") || /\bin go\b/.test(s)) return "go";
    if (s.includes("sql")) return "sql";
    return null;
  };
  return (given && pick(given)) || pick(text.match(/(?:solution|answer|code) in ([A-Za-z+#]+)/i)?.[1] ?? "") || pick(text) || "python";
}

export function questionAt(plan: PlanRound[], roundIndex: number, questionIndex: number) {
  return plan[roundIndex]?.questions[questionIndex] ?? null;
}

export function questionCount(plan: PlanRound[] | null): number {
  return (plan ?? []).reduce((n, r) => n + r.questions.length, 0);
}

/** The position after (round, question), or null when that was the last question. */
export function nextPosition(plan: PlanRound[], roundIndex: number, questionIndex: number): { round: number; question: number } | null {
  if (questionIndex + 1 < (plan[roundIndex]?.questions.length ?? 0)) return { round: roundIndex, question: questionIndex + 1 };
  for (let r = roundIndex + 1; r < plan.length; r++) if (plan[r].questions.length) return { round: r, question: 0 };
  return null;
}
