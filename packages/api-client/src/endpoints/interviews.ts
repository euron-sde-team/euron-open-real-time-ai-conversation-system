/** Interviews, live voice sessions, answers, reports, share links and your usage. */
import type {
  AnswerInput,
  AnswerResult,
  Interview,
  InterviewPatch,
  InterviewReport,
  InterviewSummary,
  JobDescriptionInput,
  LiveSessionEnd,
  LiveSessionGrant,
  Page,
  Preferences,
  ProctorEventInput,
  RealtimeModelOption,
  ShareInput,
  ShareSummary,
  SharedReport,
  Usage,
} from "@open-conversation/types";
import { enc, type Helpers, type PageQuery } from "./helpers";

/** A resume to plan from. `file` is a Blob/File on the web, or `{ uri, name, type }` in React Native. */
export interface ResumeInput {
  file: Blob | { uri: string; name: string; type: string };
  fileName?: string;
  proctoring?: boolean;
}

export function interviewEndpoints(h: Helpers) {
  const { get, post, patch, del, pq, pub, download } = h;

  const interviews = {
    list: (q: PageQuery & { status?: string } = {}) => get<Page<InterviewSummary>>("/interviews", pq(q)),
    get: (id: string, signal?: AbortSignal) => get<Interview>(`/interviews/${enc(id)}`, undefined, signal),
    /** Upload a resume (PDF or DOCX). Planning runs in the background: poll `get` until READY. */
    fromResume: (input: ResumeInput) => {
      const form = new FormData();
      form.append("file", input.file as Blob, input.fileName);
      if (input.proctoring !== undefined) form.append("proctoring", String(input.proctoring));
      return post<Interview>("/interviews/from-resume", form);
    },
    fromJobDescription: (body: JobDescriptionInput) => post<Interview>("/interviews/from-job-description", body),
    update: (id: string, body: InterviewPatch) => patch<Interview>(`/interviews/${enc(id)}`, body),
    /** Plan again from the same job description (not available for resumes, which are not kept). */
    replan: (id: string) => post<Interview>(`/interviews/${enc(id)}/replan`),
    remove: (id: string) => del(`/interviews/${enc(id)}`),
    /** Mint a locked realtime credential for the current question (closes any other open session of yours). 409 PLAN_NOT_READY, 429 QUOTA_EXCEEDED, 503 NO_REALTIME_MODEL. */
    startLive: (id: string, body: { round?: number; question?: number } = {}) => post<LiveSessionGrant>(`/interviews/${enc(id)}/live`, body),
    endLive: (id: string, sessionId: string) => post<LiveSessionEnd>(`/interviews/${enc(id)}/live/${enc(sessionId)}/end`),
    /** Report a question's answer. The server scores it; ratings are never sent from here. */
    answer: (id: string, body: AnswerInput) => post<AnswerResult>(`/interviews/${enc(id)}/answers`, body),
    proctorEvents: (id: string, events: ProctorEventInput[]) => post(`/interviews/${enc(id)}/proctor-events`, { events }),
    /** Finish now; unanswered questions stay unanswered in the report. */
    complete: (id: string) => post<Interview>(`/interviews/${enc(id)}/complete`),
    report: (id: string) => get<InterviewReport>(`/interviews/${enc(id)}/report`),
    reportPdf: (id: string) => download(`/interviews/${enc(id)}/report.pdf`),
    share: (id: string, body: ShareInput = {}) => post<ShareSummary>(`/interviews/${enc(id)}/shares`, body),
  };

  const shares = {
    list: (q: PageQuery = {}) => get<Page<ShareSummary>>("/shares", pq(q)),
    revoke: (id: string) => del(`/shares/${enc(id)}`),
    /** Public: no sign-in needed. */
    open: (id: string, signal?: AbortSignal) => pub<SharedReport>(`/shared/${enc(id)}`, undefined, signal),
  };

  const me = {
    usage: () => get<Usage>("/me/usage"),
    realtimeModels: () => get<RealtimeModelOption[]>("/me/realtime-models"),
    preferences: () => get<Preferences>("/me/preferences"),
    updatePreferences: (body: Partial<Preferences>) => patch<Preferences>("/me/preferences", body),
  };

  return { interviews, shares, me };
}
