"use client";

/**
 * One interview before and during the live part:
 *   PLANNING     the interviewer is writing questions (skeleton, polls)
 *   PLAN_FAILED  the reason, and a way to try again
 *   READY        the plan to review and edit, the voice model, proctoring, and Start
 *   IN_PROGRESS  the plan with answered questions ticked, Continue and Finish now
 *   COMPLETED    goes to the report
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Code2, Pencil, Plus, Trash2 } from "lucide-react";
import type { Interview, PlanRound } from "@open-conversation/types";
import { Button, cn, NativeSelect, Switch, Textarea, toast } from "@open-conversation/ui";
import { PageBar } from "@/components/app/app-shell";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/states";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useInterview, useRealtimeModels } from "@/lib/interviews/queries";
import { useAppMeta } from "@/lib/meta";
import { qk } from "@/lib/query-keys";
import { LANGUAGE_LABEL, statusWord } from "./format";

export function InterviewView({ id }: { id: string }) {
  const router = useRouter();
  const { data: iv, error, refetch, isLoading } = useInterview(id);

  useEffect(() => {
    if (iv?.status === "COMPLETED") router.replace(`/i/${id}/report`);
  }, [iv?.status, id, router]);

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} className="mt-24" />;
  if (isLoading || !iv) return <PlanSkeleton title="" />;
  if (iv.status === "PLANNING") return <PlanSkeleton title={iv.title} planning />;
  if (iv.status === "PLAN_FAILED") return <PlanFailed iv={iv} />;
  return <PlanReview iv={iv} />;
}

function PlanSkeleton({ title, planning }: { title: string; planning?: boolean }) {
  const { data: meta } = useAppMeta();
  return (
    <div>
      <PageBar title={title} />
      <div className="mx-auto max-w-[780px] px-4 pb-16 pt-4 sm:px-6 sm:pt-8" aria-busy="true">
        {planning ? (
          <>
            <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em]">{title}</h1>
            <p className="mt-1.5 text-[15px] text-muted-foreground" role="status">
              {meta?.interviewerName ?? "Avani"} is preparing your questions. This usually takes under a minute.
            </p>
          </>
        ) : (
          <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
        )}
        <div className="mt-10 space-y-10">
          {Array.from({ length: 3 }, (_, r) => (
            <div key={r}>
              <div className="h-5 w-1/3 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-muted/70" />
              <div className="mt-5 space-y-3">
                {Array.from({ length: 3 }, (_, q) => (
                  <div key={q} className="h-4 animate-pulse rounded bg-muted/70" style={{ width: `${70 + ((r * 3 + q) * 7) % 25}%` }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlanFailed({ iv }: { iv: Interview }) {
  const qc = useQueryClient();
  const replan = useMutation({
    mutationFn: () => api().interviews.replan(iv.id),
    onSuccess: (next) => qc.setQueryData(qk.interview(iv.id), next),
    meta: { silent: true },
    onError: (e) => toast.error({ title: "Could not try again", description: errorMessage(e) }),
  });
  return (
    <div>
      <PageBar title={iv.title} />
      <div className="mx-auto max-w-[680px] px-4 pb-16 pt-8 sm:px-6 sm:pt-16">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.02em]">The questions could not be prepared</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">{iv.planError ?? "Something went wrong while writing the plan."} This interview did not count against your allowance.</p>
        <div className="mt-6 flex gap-3">
          {iv.source === "JOB_DESCRIPTION" ? (
            <Button onClick={() => replan.mutate()} loading={replan.isPending}>
              Try again
            </Button>
          ) : (
            <Button asChild>
              <Link href="/new?from=resume">Upload the resume again</Link>
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link href="/">Home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function PlanReview({ iv }: { iv: Interview }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: meta } = useAppMeta();
  const models = useRealtimeModels();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PlanRound[]>(iv.plan ?? []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const started = iv.status === "IN_PROGRESS";
  const answered = new Set(iv.answers.map((a) => `${a.round}:${a.question}`));
  const plan = editing ? draft : (iv.plan ?? []);
  const codeOn = meta?.features.codeQuestions !== false;

  const save = useMutation({
    mutationFn: (patch: Parameters<ReturnType<typeof api>["interviews"]["update"]>[1]) => api().interviews.update(iv.id, patch),
    onSuccess: (next) => {
      qc.setQueryData(qk.interview(iv.id), next);
      void qc.invalidateQueries({ queryKey: qk.interviewsAll });
    },
    meta: { silent: true },
    onError: (e) => toast.error({ title: "Not saved", description: errorMessage(e) }),
  });
  const finish = useMutation({
    mutationFn: () => api().interviews.complete(iv.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.interviewsAll });
      router.push(`/i/${iv.id}/report`);
    },
  });
  const remove = async () => {
    await api().interviews.remove(iv.id);
    void qc.invalidateQueries({ queryKey: qk.interviewsAll });
    router.push("/");
  };

  const editQuestion = (r: number, q: number, text: string) => setDraft((d) => d.map((round, ri) => (ri !== r ? round : { ...round, questions: round.questions.map((x, qi) => (qi === q ? { ...x, text } : x)) })));
  const removeQuestion = (r: number, q: number) => setDraft((d) => d.map((round, ri) => (ri !== r ? round : { ...round, questions: round.questions.filter((_, qi) => qi !== q) })).filter((round) => round.questions.length));
  const addQuestion = (r: number) => setDraft((d) => d.map((round, ri) => (ri !== r ? round : { ...round, questions: [...round.questions, { text: "", code: false, language: null }] })));

  const total = plan.reduce((n, r) => n + r.questions.length, 0);
  const selected = iv.realtimeModel?.id ?? models.data?.find((m) => m.isDefault)?.id ?? models.data?.[0]?.id ?? "";

  return (
    <div>
      <PageBar
        title={iv.title}
        actions={
          !started ? (
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          ) : null
        }
      />
      <div className="mx-auto max-w-[780px] px-4 pb-32 pt-4 sm:px-6 sm:pt-8">
        <p className="text-[13px] font-medium uppercase tracking-[0.06em] text-primary">{statusWord(iv.status)}</p>
        <h1 className="mt-1 font-display text-[28px] font-semibold leading-tight tracking-[-0.02em]">{iv.title}</h1>
        <p className="mt-2 text-[14px] text-subtle-foreground">
          {[iv.source === "RESUME" ? "From your resume" : `From the ${iv.company ?? ""} job description`.replace("  ", " "), iv.domain, `${iv.plan?.length ?? 0} rounds`, `${iv.questionCount} questions`, started ? `${iv.answeredCount} answered` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {iv.summary ? <p className="mt-4 max-w-[640px] text-[15px] leading-relaxed text-muted-foreground">{iv.summary}</p> : null}

        <div className="mt-8 flex items-center justify-between border-b border-border pb-2">
          <h2 className="font-display text-[19px] font-semibold tracking-[-0.01em]">The plan</h2>
          {iv.editable ? (
            editing ? (
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => (setEditing(false), setDraft(iv.plan ?? []))}>
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  loading={save.isPending}
                  disabled={!draft.length || draft.some((r) => r.questions.some((q) => q.text.trim().length < 5))}
                  onClick={() => save.mutate({ plan: draft }, { onSuccess: () => setEditing(false) })}
                >
                  Save plan
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => (setDraft(iv.plan ?? []), setEditing(true))}>
                <Pencil /> Edit questions
              </Button>
            )
          ) : null}
        </div>

        <ol className="mt-2">
          {plan.map((round, r) => (
            <li key={r} className="border-b border-border py-6 last:border-b-0">
              <div className="flex items-baseline gap-3">
                <span className="w-6 shrink-0 font-display text-[15px] font-semibold tabular-nums text-subtle-foreground">{r + 1}</span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[16px] font-semibold">{round.name}</h3>
                  {round.focus ? <p className="text-[13.5px] text-subtle-foreground">{round.focus}</p> : null}
                </div>
              </div>
              <ol className="ml-9 mt-3 space-y-3">
                {round.questions.map((q, qi) => {
                  const done = answered.has(`${r}:${qi}`);
                  const current = started && iv.position.round === r && iv.position.question === qi;
                  return (
                    <li key={qi} className="flex gap-3">
                      <span className={cn("mt-1 flex size-4 shrink-0 items-center justify-center", done ? "text-success" : "text-subtle-foreground")} aria-hidden>
                        {done ? <Check className="size-4" /> : <span className="text-[12px] tabular-nums">{qi + 1}.</span>}
                      </span>
                      {editing ? (
                        <div className="min-w-0 flex-1">
                          <Textarea value={q.text} onChange={(e) => editQuestion(r, qi, e.target.value)} rows={q.code ? 6 : 2} maxLength={2500} aria-label={`Round ${r + 1}, question ${qi + 1}`} />
                          <button type="button" onClick={() => removeQuestion(r, qi)} className="mt-1 inline-flex items-center gap-1 text-[12.5px] text-subtle-foreground hover:text-danger">
                            <Trash2 className="size-3.5" /> Remove question
                          </button>
                        </div>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <p className={cn("whitespace-pre-line text-[15px] leading-relaxed", current && "font-medium")}>{q.code ? q.text.split(/(?=Hints?:|Sample:|Dataset:)/)[0] : q.text}</p>
                          <p className="mt-0.5 text-[12.5px] text-subtle-foreground">
                            {[q.code ? `Code${q.language ? `, ${LANGUAGE_LABEL[q.language] ?? q.language}` : ""}` : null, current ? "Up next" : null, done ? "Answered" : null].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                      )}
                      {q.code && !editing ? <Code2 className="mt-1 size-4 shrink-0 text-subtle-foreground" aria-label="Code question" /> : null}
                    </li>
                  );
                })}
                {editing ? (
                  <li>
                    <button type="button" onClick={() => addQuestion(r)} className="ml-7 inline-flex items-center gap-1 text-[13px] text-link hover:underline">
                      <Plus className="size-3.5" /> Add a question
                    </button>
                  </li>
                ) : null}
              </ol>
            </li>
          ))}
        </ol>
        {editing && !codeOn ? <p className="text-[13px] text-subtle-foreground">Code questions are turned off on this server and will be asked by voice.</p> : null}

        {!started && !editing ? (
          <section className="mt-6 space-y-5 border-t border-border pt-6">
            <h2 className="font-display text-[19px] font-semibold tracking-[-0.01em]">Before you start</h2>
            {models.data && models.data.length > 1 ? (
              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor="voice-model" className="w-40 text-[14px] font-medium">
                  Interviewer voice
                </label>
                <NativeSelect id="voice-model" value={selected} onChange={(e) => save.mutate({ realtimeModelId: e.target.value })} className="w-64">
                  {models.data.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}
            {meta?.features.proctoring !== false ? (
              <div className="flex items-start gap-3">
                <Switch id="proctor" checked={iv.proctoring} onCheckedChange={(v) => save.mutate({ proctoring: v })} />
                <label htmlFor="proctor" className="text-[14px]">
                  <span className="block font-medium">Proctoring</span>
                  <span className="block text-[13px] text-subtle-foreground">Camera presence and tab checks. Video never leaves your device.</span>
                </label>
              </div>
            ) : null}
            <p className="text-[13px] text-subtle-foreground">You need a microphone{iv.proctoring ? " and a camera" : ""}. Find a quiet room; each question takes two to five minutes.</p>
          </section>
        ) : null}
      </div>

      {!editing ? (
        <div className="sticky bottom-0 border-t border-border bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-[780px] items-center gap-3 px-4 py-3 sm:px-6">
            <p className="min-w-0 flex-1 truncate text-[13px] text-subtle-foreground">{started ? `Question ${countBefore(plan, iv.position) + 1} of ${total} next` : `${total} questions in ${plan.length} rounds`}</p>
            {started ? (
              <Button variant="ghost" onClick={() => setConfirmFinish(true)}>
                Finish now
              </Button>
            ) : null}
            <Button size="lg" data-testid="start-interview" onClick={() => router.push(`/room/${iv.id}`)} disabled={!total}>
              {started ? "Continue interview" : "Start interview"}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title="Delete this interview?" description={`"${iv.title}" and its plan will be deleted. It still counts towards this month's allowance.`} confirmLabel="Delete" destructive onConfirm={remove} />
      <ConfirmDialog open={confirmFinish} onOpenChange={setConfirmFinish} title="Finish the interview now?" description="Unanswered questions stay unanswered in your report. You cannot continue afterwards." confirmLabel="Finish and see report" onConfirm={() => finish.mutateAsync().then(() => undefined)} />
    </div>
  );
}

function countBefore(plan: PlanRound[], pos: { round: number; question: number }): number {
  return plan.slice(0, pos.round).reduce((n, r) => n + r.questions.length, 0) + pos.question;
}
