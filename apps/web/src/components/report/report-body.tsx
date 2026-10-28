"use client";

/**
 * The report body, shared by the owner's report and the public share page: the overall
 * scores in type, a row per round, then every question with its scores, feedback, the
 * corrected snippet for code, and (when present) the transcript and the submitted code.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { InterviewReport, QuestionReport } from "@open-conversation/types";
import { cn } from "@open-conversation/ui";
import { minutes, proctorWord, scoreTone, scoreWord } from "@/components/interview/format";

function Score({ label, value, big }: { label: string; value: number | null; big?: boolean }) {
  return (
    <div>
      <p className={cn("font-display font-semibold tabular-nums tracking-[-0.02em]", big ? "text-[56px] leading-none" : "text-[30px] leading-none", scoreTone(value))}>{value ?? "n/a"}</p>
      <p className="mt-1.5 text-[13px] text-subtle-foreground">
        {label}
        {big && value !== null ? ` · ${scoreWord(value)}` : ""}
      </p>
    </div>
  );
}

export function ReportBody({ report }: { report: InterviewReport }) {
  const scoring = report.questions.filter((q) => q.answer?.status === "SCORING").length;
  return (
    <div>
      <div className="mt-8 flex flex-wrap items-end gap-x-12 gap-y-6 border-b border-border pb-8">
        <Score label="Overall" value={report.overallRating} big />
        <Score label="Domain knowledge" value={report.domainRating} />
        <Score label="Communication" value={report.communicationRating} />
        <p className="text-[13px] leading-6 text-subtle-foreground sm:ml-auto sm:text-right">
          {report.interview.answeredCount} of {report.interview.questionCount} questions answered
          <br />
          {minutes(report.voiceSeconds)} of live voice
        </p>
      </div>
      {scoring ? (
        <p className="mt-4 text-[14px] text-muted-foreground" role="status">
          Scoring {scoring === 1 ? "one answer" : `${scoring} answers`}. This page updates by itself.
        </p>
      ) : null}

      <h2 className="mt-10 font-display text-[19px] font-semibold tracking-[-0.01em]">Rounds</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-[14px]">
          <thead>
            <tr className="border-b border-border text-[12px] uppercase tracking-[0.06em] text-subtle-foreground">
              <th className="py-2 pr-4 font-semibold">Round</th>
              <th className="px-3 py-2 text-right font-semibold">Overall</th>
              <th className="px-3 py-2 text-right font-semibold">Domain</th>
              <th className="px-3 py-2 text-right font-semibold">Communication</th>
              <th className="py-2 pl-3 text-right font-semibold">Answered</th>
            </tr>
          </thead>
          <tbody>
            {report.rounds.map((r, i) => (
              <tr key={i} className="border-b border-border last:border-b-0">
                <td className="py-3 pr-4">
                  <span className="font-medium">{r.name}</span>
                  {r.focus ? <span className="block text-[12.5px] text-subtle-foreground">{r.focus}</span> : null}
                </td>
                <td className={cn("px-3 py-3 text-right font-semibold tabular-nums", scoreTone(r.overallRating))}>{r.overallRating ?? "n/a"}</td>
                <td className="px-3 py-3 text-right tabular-nums">{r.domainRating ?? "n/a"}</td>
                <td className="px-3 py-3 text-right tabular-nums">{r.communicationRating ?? "n/a"}</td>
                <td className="py-3 pl-3 text-right tabular-nums text-subtle-foreground">
                  {r.answeredCount}/{r.questionCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-12 font-display text-[19px] font-semibold tracking-[-0.01em]">Question by question</h2>
      <div className="mt-2">
        {report.rounds.map((r, ri) => (
          <section key={ri} className="mt-6">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">
              Round {ri + 1} · {r.name}
            </h3>
            <ol className="mt-1 divide-y divide-border border-b border-border">
              {report.questions
                .filter((q) => q.round === ri)
                .map((q) => (
                  <QuestionRow key={`${q.round}:${q.question}`} q={q} />
                ))}
            </ol>
          </section>
        ))}
      </div>

      {report.proctoring ? (
        <section className="mt-12">
          <h2 className="font-display text-[19px] font-semibold tracking-[-0.01em]">Proctoring</h2>
          {report.proctoring.events.length ? (
            <ul className="mt-3 divide-y divide-border text-[14px]">
              {report.proctoring.events.map((e, i) => (
                <li key={i} className="flex gap-4 py-2">
                  <span className="w-20 shrink-0 tabular-nums text-subtle-foreground">{new Date(e.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="flex-1">{proctorWord(e.kind)}</span>
                  <span className="text-[13px] text-subtle-foreground">{e.round !== null && e.question !== null ? `Question ${e.round + 1}.${e.question + 1}` : ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[14px] text-muted-foreground">Nothing was flagged: in view of the camera and on the tab throughout.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

function QuestionRow({ q }: { q: QuestionReport }) {
  const [open, setOpen] = useState(false);
  const a = q.answer;
  const score = a?.status === "SCORED" && a.domainRating !== null && a.communicationRating !== null ? Math.round((a.domainRating + a.communicationRating) / 2) : null;
  const f = a?.feedback;
  return (
    <li className="py-4" data-testid={`report-question-${q.round}-${q.question}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-4 text-left">
        <span className="w-8 shrink-0 pt-0.5 text-[13px] tabular-nums text-subtle-foreground">
          {q.round + 1}.{q.question + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[15px] font-medium leading-snug">{q.code ? q.text.split(/(?=Hints?:)/)[0] : q.text}</span>
          <span className="mt-0.5 block text-[12.5px] text-subtle-foreground">
            {!a ? "Not answered" : a.status === "SCORING" ? "Being scored" : a.status === "FAILED" ? "Could not be scored" : `Domain ${a.domainRating} · Communication ${a.communicationRating}${q.code ? " · Code" : ""}`}
          </span>
        </span>
        <span className={cn("w-10 shrink-0 text-right font-display text-[20px] font-semibold tabular-nums", scoreTone(score))}>{score ?? ""}</span>
        <ChevronDown className={cn("mt-1 size-4 shrink-0 text-subtle-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div className="ml-12 mt-4 space-y-5 text-[14.5px] leading-relaxed">
          {q.code ? <p className="whitespace-pre-line text-muted-foreground">{q.text}</p> : null}
          {f?.analysis ? <p className="whitespace-pre-line">{f.analysis}</p> : null}
          {f ? (
            <div className="grid gap-5 sm:grid-cols-3">
              <List title="Strengths" items={f.strengths} />
              <List title="To improve" items={f.weaknesses} />
              <List title="Try next time" items={f.suggestions} />
            </div>
          ) : null}
          {f?.correctedSnippet ? (
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">A corrected version</p>
              <pre className="mt-2 overflow-x-auto rounded-[10px] bg-muted px-4 py-3 font-mono text-[13px] leading-relaxed">{f.correctedSnippet}</pre>
            </div>
          ) : null}
          {q.submittedCode ? (
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">Submitted code</p>
              <pre className="mt-2 overflow-x-auto rounded-[10px] bg-muted px-4 py-3 font-mono text-[13px] leading-relaxed">{q.submittedCode}</pre>
            </div>
          ) : null}
          {q.transcript?.length ? (
            <details>
              <summary className="cursor-pointer text-[13px] font-medium text-subtle-foreground">Transcript</summary>
              <div className="mt-3 space-y-3 border-l border-border pl-4">
                {q.transcript.map((l, i) => (
                  <p key={i} className="text-[14px]">
                    <span className={cn("mr-2 text-[12px] font-semibold", l.role === "interviewer" ? "text-primary" : "text-foreground")}>{l.role === "interviewer" ? "Interviewer" : "Candidate"}</span>
                    {l.text}
                  </p>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-[14px]">
            <span className="mt-[9px] size-1 shrink-0 rounded-full bg-subtle-foreground" aria-hidden />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
