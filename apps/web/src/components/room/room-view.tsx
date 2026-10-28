"use client";

/**
 * The live interview room. One realtime session per question:
 *
 *   preflight   microphone (and camera, with proctoring) checked, one tap to join
 *   connecting  POST /interviews/:id/live, then the transport connects with the grant
 *   live        the interviewer asks and follows up; the candidate speaks, types or codes
 *   submitting  the question's transcript (or code) goes to the API, which scores it later
 *   between     a short pause naming the next question, then the next session
 *   done        the last answer is in: on to the report
 *
 * A question ends when the interviewer calls end_question, when the candidate presses
 * Next question (or Submit code), or when the session's time runs out.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, CameraOff, ChevronRight, Keyboard, MessageSquareText, Mic, MicOff } from "lucide-react";
import type { Interview, LiveSessionGrant, TranscriptLine } from "@open-conversation/types";
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, IconButton, Sheet, SheetContent, Spinner, toast } from "@open-conversation/ui";
import { RequireAuth } from "@/components/common/require-auth";
import { ErrorState } from "@/components/common/states";
import { LogoMark } from "@/components/common/wordmark";
import { clock } from "@/components/interview/format";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { useInterview } from "@/lib/interviews/queries";
import { useAppMeta } from "@/lib/meta";
import { qk } from "@/lib/query-keys";
import { transportFor, type RealtimeTransport, type TransportEvent } from "@/lib/realtime";
import { useFaceCheck, useProctorEvents, type FaceState } from "@/lib/realtime/proctor";
import { CodeEditor } from "./code-editor";
import { InterviewerOrb } from "./interviewer-orb";
import { TranscriptPanel, type ShownLine } from "./transcript-panel";

type Phase = "preflight" | "connecting" | "live" | "submitting" | "between" | "done";

export function RoomView({ id }: { id: string }) {
  return (
    <RequireAuth>
      <Room id={id} />
    </RequireAuth>
  );
}

function Room({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: meta } = useAppMeta();
  const { data: iv, error, refetch } = useInterview(id);
  const name = meta?.interviewerName ?? "Avani";

  const [phase, setPhase] = useState<Phase>("preflight");
  const [grant, setGrant] = useState<LiveSessionGrant | null>(null);
  const [lines, setLines] = useState<ShownLine[]>([]);
  const [speaking, setSpeaking] = useState<{ interviewer: boolean; candidate: boolean }>({ interviewer: false, candidate: false });
  const [muted, setMuted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState("");
  const [language, setLanguage] = useState("python");
  const [showTranscript, setShowTranscript] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [nextLabel, setNextLabel] = useState<string>("");
  const [devices, setDevices] = useState<{ mic: MediaStream | null; camera: MediaStream | null; error: string | null }>({ mic: null, camera: null, error: null });

  const transport = useRef<RealtimeTransport | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const questionLines = useRef<TranscriptLine[]>([]);
  const finishing = useRef(false);
  const ivRef = useRef<Interview | undefined>(iv);
  ivRef.current = iv;

  const position = grant ? { round: grant.question.round, question: grant.question.index } : (iv?.position ?? { round: 0, question: 0 });
  const plan = iv?.plan ?? [];
  const round = plan[position.round];
  const total = plan.reduce((n, r) => n + r.questions.length, 0);
  const number = plan.slice(0, position.round).reduce((n, r) => n + r.questions.length, 0) + position.question + 1;
  const isCode = !!grant?.question.code && meta?.features.codeQuestions !== false;

  // Proctoring
  const proctoring = !!iv?.proctoring && phase !== "preflight" && phase !== "done";
  const face = useFaceCheck(video, proctoring && !!devices.camera);
  const { tabStrikes } = useProctorEvents(id, proctoring, devices.camera ? face : "off", position, !devices.camera);

  useEffect(() => {
    if (video.current && devices.camera) video.current.srcObject = devices.camera;
  }, [devices.camera, phase]);

  // Release devices and the session when leaving the page.
  useEffect(
    () => () => {
      transport.current?.close();
      devices.mic?.getTracks().forEach((t) => t.stop());
      devices.camera?.getTracks().forEach((t) => t.stop());
    },
    [devices.mic, devices.camera],
  );

  const onEvent = useCallback((e: TransportEvent) => {
    if (e.type === "line") {
      setLines((all) => {
        const last = all[all.length - 1];
        if (last && last.role === e.role && last.partial) return [...all.slice(0, -1), { role: e.role, text: e.text, partial: e.partial }];
        return [...all, { role: e.role, text: e.text, partial: e.partial }];
      });
      if (!e.partial) questionLines.current.push({ role: e.role, text: e.text });
    } else if (e.type === "speaking") setSpeaking((s) => ({ ...s, [e.who]: e.on }));
    else if (e.type === "end_question") void finishRef.current?.("interviewer");
    else if (e.type === "error") setProblem(e.message);
  }, []);

  const startQuestion = useCallback(
    async (at?: { round: number; question: number }) => {
      setPhase("connecting");
      setProblem(null);
      questionLines.current = [];
      finishing.current = false;
      try {
        const g = await api().interviews.startLive(id, at ?? {});
        setGrant(g);
        setLines((all) => [...all, { role: "divider", text: `${g.question.round + 1}.${g.question.index + 1}` }]);
        setRemaining(g.maxSeconds);
        if (g.question.code) {
          setCode("");
          setLanguage(g.question.language ?? "python");
        }
        const t = await transportFor(g.provider);
        transport.current = t;
        await t.connect({ grant: g, mic: devices.mic, audio: audio.current!, onEvent });
        t.setMuted(muted);
        setPhase("live");
      } catch (e) {
        transport.current?.close();
        setPhase("live");
        setProblem(e instanceof Error && !("code" in e) ? e.message : errorMessage(e));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, devices.mic, onEvent],
  );

  const finish = useCallback(
    async (by: "interviewer" | "candidate" | "timeout") => {
      if (finishing.current || !grant) return;
      finishing.current = true;
      setPhase("submitting");
      // Let the interviewer's last words finish before closing the line.
      if (by === "interviewer") await new Promise((r) => setTimeout(r, 1200));
      transport.current?.close();
      transport.current = null;
      setSpeaking({ interviewer: false, candidate: false });
      try {
        await api().interviews.endLive(id, grant.id).catch(() => undefined);
        await api().interviews.answer(id, {
          round: grant.question.round,
          question: grant.question.index,
          transcript: questionLines.current,
          ...(grant.question.code ? { code, language: language as never } : {}),
        });
        const next = await refetch();
        void qc.invalidateQueries({ queryKey: qk.interviewsAll });
        void qc.invalidateQueries({ queryKey: qk.usage });
        const nextIv = next.data;
        if (!nextIv || nextIv.status === "COMPLETED") {
          setPhase("done");
          setTimeout(() => router.push(`/i/${id}/report`), 1400);
          return;
        }
        const r = nextIv.plan?.[nextIv.position.round];
        setNextLabel(nextIv.position.question === 0 && r ? `Round ${nextIv.position.round + 1}: ${r.name}` : `Question ${nextIv.position.question + 1} of ${r?.questions.length ?? 0}`);
        setGrant(null);
        setPhase("between");
        setTimeout(() => void startQuestion(nextIv.position), 2600);
      } catch (e) {
        finishing.current = false;
        setPhase("live");
        toast.error({ title: "Your answer was not saved", description: errorMessage(e) });
      }
    },
    [grant, id, code, language, refetch, qc, router, startQuestion],
  );
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // The session clock.
  useEffect(() => {
    if (phase !== "live" || remaining === null) return;
    if (remaining <= 0) {
      void finish("timeout");
      return;
    }
    const t = setTimeout(() => setRemaining((r) => (r === null ? r : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [phase, remaining, finish]);

  const join = async () => {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      let camera: MediaStream | null = null;
      if (iv?.proctoring) camera = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } }).catch(() => null);
      setDevices({ mic, camera, error: null });
      // Wait one tick so the transport sees the stream.
      setTimeout(() => void startQuestion(), 0);
    } catch {
      setDevices({ mic: null, camera: null, error: "The microphone is blocked. Allow it in the browser's address bar, then try again. You can also continue by typing." });
    }
  };
  const joinTyping = () => {
    setTyping(true);
    setDevices({ mic: null, camera: null, error: null });
    setTimeout(() => void startQuestion(), 0);
  };

  const leave = async (how: "pause" | "finish") => {
    transport.current?.close();
    if (grant) await api().interviews.endLive(id, grant.id).catch(() => undefined);
    if (how === "finish") {
      await api().interviews.complete(id).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: qk.interviewsAll });
      router.push(`/i/${id}/report`);
    } else router.push(`/i/${id}`);
  };

  const sendTyped = () => {
    const text = typed.trim();
    if (!text || !transport.current) return;
    transport.current.sendText(text);
    setTyped("");
  };

  const status = useMemo(() => {
    if (phase === "connecting") return "Connecting";
    if (phase === "submitting") return "Saving your answer";
    if (phase === "between") return "Next question";
    if (phase === "done") return "That was the last question";
    if (speaking.interviewer) return `${name} is speaking`;
    if (speaking.candidate) return "Listening";
    return isCode ? "Write your solution, then submit" : "Your turn";
  }, [phase, speaking, name, isCode]);

  if (error) return <ErrorState error={error} onRetry={() => void refetch()} className="mt-24" />;
  if (!iv)
    return (
      <div className="flex h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  if (iv.status === "COMPLETED" && phase === "preflight")
    return (
      <div className="mx-auto max-w-md px-6 pt-24 text-center">
        <h1 className="font-display text-[24px] font-semibold">This interview is finished</h1>
        <Button asChild className="mt-6">
          <Link href={`/i/${id}/report`}>See the report</Link>
        </Button>
      </div>
    );
  if (iv.status === "PLANNING" || iv.status === "PLAN_FAILED")
    return (
      <div className="mx-auto max-w-md px-6 pt-24 text-center">
        <h1 className="font-display text-[24px] font-semibold">The plan is not ready</h1>
        <Button asChild className="mt-6">
          <Link href={`/i/${id}`}>Back to the plan</Link>
        </Button>
      </div>
    );

  return (
    <div className="flex h-dvh flex-col bg-background">
      <audio ref={audio} autoPlay className="hidden" />
      {/* Header: where we are, the clock, and the way out */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6">
        <LogoMark className="size-7" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{iv.title}</p>
          <p className="truncate text-[12.5px] text-subtle-foreground">
            {round ? `Round ${position.round + 1} of ${plan.length} · ${round.name} · Question ${number} of ${total}` : ""}
          </p>
        </div>
        {remaining !== null && phase === "live" ? (
          <span className={cn("text-[13px] tabular-nums", remaining <= 30 ? "font-semibold text-warning" : "text-subtle-foreground")} aria-live="off" title="Time left for this question">
            {clock(remaining)}
          </span>
        ) : null}
        <IconButton label="Transcript" className="lg:hidden" onClick={() => setShowTranscript(true)}>
          <MessageSquareText />
        </IconButton>
        <Button variant="outline" size="sm" onClick={() => (phase === "preflight" ? router.push(`/i/${id}`) : setLeaving(true))}>
          {phase === "preflight" ? "Back" : "End"}
        </Button>
      </header>
      <RoundProgress plan={plan} position={position} answered={iv.answers.map((a) => `${a.round}:${a.question}`)} />

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          {phase === "preflight" ? (
            <Preflight name={name} proctoring={iv.proctoring} error={devices.error} onJoin={join} onTyping={joinTyping} resumed={iv.status === "IN_PROGRESS"} />
          ) : (
            <div className={cn("flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 sm:px-8", isCode && phase === "live" ? "lg:flex-row" : "items-center justify-center")}>
              <section className={cn("flex flex-col items-center text-center", isCode && phase === "live" ? "lg:w-[38%] lg:shrink-0 lg:items-start lg:text-left" : "w-full max-w-[640px]")}>
                <InterviewerOrb speaking={speaking.interviewer} listening={speaking.candidate} busy={phase === "connecting" || phase === "submitting" || phase === "between"} size={isCode && phase === "live" ? "sm" : "lg"} />
                <p className="mt-5 font-display text-[22px] font-semibold tracking-[-0.01em]">{name}</p>
                <p className="mt-1 text-[14px] text-muted-foreground" role="status" aria-live="polite">
                  {phase === "between" ? nextLabel : status}
                </p>
                {grant && phase !== "between" ? (
                  <details className="mt-6 w-full max-w-[640px] text-left" open={isCode}>
                    <summary className="cursor-pointer text-[13px] font-medium text-subtle-foreground">The question</summary>
                    <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed">{grant.question.text}</p>
                  </details>
                ) : null}
                {problem ? (
                  <div className="mt-6 w-full max-w-[640px] border-l-2 border-danger pl-3 text-left">
                    <p className="text-[14px] text-foreground">{problem}</p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => void startQuestion(position)}>
                        Reconnect
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => (setProblem(null), setTyping(true))}>
                        Continue by typing
                      </Button>
                    </div>
                  </div>
                ) : null}
                {phase === "done" ? (
                  <p className="mt-6 text-[15px] text-muted-foreground">Scoring your answers. Taking you to the report.</p>
                ) : null}
              </section>
              {isCode && phase === "live" ? (
                <section className="min-h-[360px] min-w-0 flex-1">
                  <CodeEditor value={code} onChange={setCode} language={language} onLanguage={setLanguage} />
                </section>
              ) : null}
            </div>
          )}

          {phase !== "preflight" && phase !== "done" ? (
            <ProctorLine face={iv.proctoring ? (devices.camera ? face : "off") : "off"} tabStrikes={iv.proctoring ? tabStrikes : 0} cameraMissing={iv.proctoring && !devices.camera} />
          ) : null}

          {/* Control bar */}
          {phase !== "preflight" && phase !== "done" ? (
            <div className="shrink-0 border-t border-border px-4 py-3 sm:px-6">
              <div className="mx-auto flex max-w-[1100px] items-center gap-2">
                {devices.mic ? (
                  <IconButton
                    label={muted ? "Unmute microphone" : "Mute microphone"}
                    variant={muted ? "muted" : "outline"}
                    onClick={() => {
                      transport.current?.setMuted(!muted);
                      setMuted(!muted);
                    }}
                  >
                    {muted ? <MicOff /> : <Mic className={speaking.candidate ? "text-primary" : undefined} />}
                  </IconButton>
                ) : null}
                {iv.proctoring ? (
                  <div className="relative hidden h-10 w-14 overflow-hidden rounded-[10px] bg-muted sm:block" title="Your camera stays on this device">
                    {devices.camera ? <video ref={video} autoPlay muted playsInline className="size-full scale-x-[-1] object-cover" /> : <CameraOff className="m-auto mt-2.5 size-5 text-subtle-foreground" />}
                  </div>
                ) : null}
                {typing || !devices.mic ? (
                  <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(e) => (e.preventDefault(), sendTyped())}>
                    <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your answer and press Enter" aria-label="Type your answer" className="h-10 min-w-0 flex-1 rounded-[10px] border border-input bg-card px-3 text-[14px] outline-none focus-visible:border-ring" disabled={phase !== "live"} />
                  </form>
                ) : (
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => setTyping(true)} className="inline-flex items-center gap-1.5 text-[13px] text-subtle-foreground hover:text-foreground">
                      <Keyboard className="size-4" /> Type instead
                    </button>
                  </div>
                )}
                <Button data-testid="next-question" size="md" disabled={phase !== "live" || !grant} onClick={() => void finish("candidate")}>
                  {isCode ? "Submit code" : number >= total ? "Finish" : "Next question"} <ChevronRight />
                </Button>
              </div>
            </div>
          ) : null}
        </main>

        <aside className="hidden w-[340px] shrink-0 border-l border-border lg:flex">
          <TranscriptPanel lines={lines} name={name} />
        </aside>
      </div>

      <Sheet open={showTranscript} onOpenChange={setShowTranscript}>
        <SheetContent side="right" width="max-w-[380px]" className="w-[90vw] p-0" aria-label="Transcript">
          <TranscriptPanel lines={lines} name={name} />
        </SheetContent>
      </Sheet>

      <Dialog open={leaving} onOpenChange={setLeaving}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Leave the interview?</DialogTitle>
            <DialogDescription>Pause to come back to this question later, or finish now and see the report. Unanswered questions stay unanswered.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLeaving(false)}>
              Stay
            </Button>
            <Button variant="outline" onClick={() => void leave("pause")}>
              Pause and leave
            </Button>
            <Button onClick={() => void leave("finish")}>Finish and see report</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Preflight({ name, proctoring, error, onJoin, onTyping, resumed }: { name: string; proctoring: boolean; error: string | null; onJoin: () => void; onTyping: () => void; resumed: boolean }) {
  const [joining, setJoining] = useState(false);
  return (
    <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center px-6 py-10">
      <InterviewerOrb speaking={false} listening={false} busy={false} size="md" />
      <h1 className="mt-8 font-display text-[28px] font-semibold tracking-[-0.02em]">{resumed ? "Pick up where you left off" : `${name} is ready for you`}</h1>
      <ul className="mt-4 space-y-2 text-[15px] text-muted-foreground">
        <li className="flex gap-2">
          <Mic className="mt-0.5 size-4 shrink-0 text-primary" /> Speak naturally. {name} listens, asks follow-ups and moves on when you are done.
        </li>
        {proctoring ? (
          <li className="flex gap-2">
            <Camera className="mt-0.5 size-4 shrink-0 text-primary" /> Proctoring is on: stay in view of the camera and on this tab. Video never leaves your device.
          </li>
        ) : null}
        <li className="flex gap-2">
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-primary" /> Press Next question any time, or say so. Each answer is scored after the interview.
        </li>
      </ul>
      {error ? <p className="mt-5 border-l-2 border-danger pl-3 text-[14px]">{error}</p> : null}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button size="lg" data-testid="join-interview" loading={joining} onClick={() => (setJoining(true), onJoin())}>
          {resumed ? "Continue" : "Join the interview"}
        </Button>
        <Button variant="ghost" onClick={onTyping}>
          Type instead of speaking
        </Button>
      </div>
      <p className="mt-4 text-[12.5px] text-subtle-foreground">Your browser will ask for the microphone{proctoring ? " and the camera" : ""}. Use headphones if you can.</p>
    </div>
  );
}

function RoundProgress({ plan, position, answered }: { plan: Interview["plan"]; position: { round: number; question: number }; answered: string[] }) {
  if (!plan?.length) return null;
  const done = new Set(answered);
  return (
    <div className="flex h-[3px] shrink-0 gap-[3px] bg-background" aria-hidden>
      {plan.map((r, ri) => {
        const n = r.questions.length;
        const finished = r.questions.filter((_, qi) => done.has(`${ri}:${qi}`)).length;
        return (
          <div key={ri} className="relative flex-1 bg-border" style={{ flexGrow: n }}>
            <div className={cn("absolute inset-y-0 left-0", ri === position.round ? "bg-primary" : "bg-primary/60")} style={{ width: `${(finished / n) * 100}%` }} />
          </div>
        );
      })}
    </div>
  );
}

function ProctorLine({ face, tabStrikes, cameraMissing }: { face: FaceState; tabStrikes: number; cameraMissing: boolean }) {
  const message =
    face === "no-face"
      ? "We cannot see you. Stay in view of the camera."
      : face === "multiple"
        ? "More than one person is in view."
        : cameraMissing
          ? "The camera is off, so presence is not checked."
          : face === "unavailable"
            ? "The face check could not start in this browser. Tab checks are still on."
            : tabStrikes > 0
              ? `You left this tab ${tabStrikes === 1 ? "once" : `${tabStrikes} times`}. It is noted in your report.`
              : null;
  if (!message) return null;
  return (
    <p className="shrink-0 border-t border-warning/40 bg-warning-soft px-4 py-2 text-center text-[13px] text-warning-soft-foreground sm:px-6" role="status">
      {message}
    </p>
  );
}

