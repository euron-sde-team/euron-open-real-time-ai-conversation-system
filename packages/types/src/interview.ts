/** Mock interviews: plans, live voice sessions, answers, reports and share links. Re-exported from index.ts. */

export type InterviewSource = "RESUME" | "JOB_DESCRIPTION";
export type InterviewStatus = "PLANNING" | "PLAN_FAILED" | "READY" | "IN_PROGRESS" | "COMPLETED";
export type AnswerKind = "VOICE" | "CODE";
export type AnswerStatus = "SCORING" | "SCORED" | "FAILED";
/** The realtime transport the browser opens. `stub` runs locally with no provider key. */
export type RealtimeProvider = "openai" | "gemini" | "stub";
export type ProctorEventKind = "NO_FACE" | "MULTIPLE_FACES" | "FACE_BACK" | "TAB_HIDDEN" | "TAB_VISIBLE" | "CAMERA_OFF";

// ─── Plans ──────────────────────────────────────────────────────────────────

export interface PlanQuestion {
  text: string;
  /** The candidate answers in the code editor instead of by voice. */
  code: boolean;
  /** For code questions: the language the editor opens in ("python", "javascript", ...). */
  language: string | null;
}

export interface PlanRound {
  /** A short, descriptive name ("System Design", "Coding & Problem-Solving"). */
  name: string;
  focus: string;
  description: string;
  questions: PlanQuestion[];
}

// ─── Interviews ─────────────────────────────────────────────────────────────

export interface InterviewSummary {
  id: string;
  title: string;
  source: InterviewSource;
  status: InterviewStatus;
  company: string | null;
  role: string | null;
  domain: string | null;
  /** 1 to 100, the mean of every scored answer; null until one is scored. */
  overallScore: number | null;
  questionCount: number;
  answeredCount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface Interview extends InterviewSummary {
  summary: string | null;
  /** Null while PLANNING or after PLAN_FAILED. */
  plan: PlanRound[] | null;
  /** Why planning failed, in plain words. */
  planError: string | null;
  proctoring: boolean;
  /** The next question to ask. */
  position: { round: number; question: number };
  /** Whether the plan may still be edited (no live session has opened yet). */
  editable: boolean;
  realtimeModel: { id: string; displayName: string; provider: RealtimeProvider } | null;
  answers: AnswerResult[];
}

/** POST /api/interviews/from-job-description. */
export interface JobDescriptionInput {
  company: string;
  role: string;
  jobDescription: string;
  proctoring?: boolean;
}

/** PATCH /api/interviews/:id: edit the plan before the first live session. */
export interface InterviewPatch {
  title?: string;
  plan?: PlanRound[];
  proctoring?: boolean;
  realtimeModelId?: string | null;
}

// ─── Live sessions ──────────────────────────────────────────────────────────

/** POST /api/interviews/:id/live: what the browser needs to open one realtime session. */
export interface LiveSessionGrant {
  id: string;
  provider: RealtimeProvider;
  /**
   * A short-lived credential with the interviewer's instructions locked inside it by the
   * server. OpenAI: a client secret (`ek_...`). Gemini: an ephemeral token name. Stub: a
   * signed token. Never your provider API key.
   */
  credential: string;
  /** The provider model the credential is bound to. */
  model: string;
  voice: string;
  /** Where the browser connects (the API's SDP relay for OpenAI). */
  connectUrl: string | null;
  /** ISO: the credential stops working for new connections after this. */
  expiresAt: string;
  /** The server ends the session and books the minutes after this many seconds. */
  maxSeconds: number;
  /** What the interviewer is about to ask (shown in the room). */
  question: { round: number; index: number; text: string; code: boolean; language: string | null };
  /**
   * Stub only: the lines the local interviewer speaks. Real providers never get this;
   * their instructions stay on the server.
   */
  script?: string[];
}

/** POST /api/interviews/:id/live/:sid/end. */
export interface LiveSessionEnd {
  seconds: number;
  /** Minutes left this month after this session; null means unlimited. */
  voiceMinutesLeft: number | null;
}

// ─── Answers and scores ─────────────────────────────────────────────────────

export interface TranscriptLine {
  role: "interviewer" | "candidate";
  text: string;
}

/** POST /api/interviews/:id/answers. Ratings are never accepted from the client. */
export interface AnswerInput {
  round: number;
  question: number;
  /** For voice answers: the conversation for this question, as transcribed in the browser. */
  transcript?: TranscriptLine[];
  /** For code answers. */
  code?: string;
  language?: string;
  /** Move the interview on to the next question (default true). */
  advance?: boolean;
}

export interface AnswerFeedback {
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  analysis: string;
  /** Code answers: a short corrected or clearer version, when one helps. */
  correctedSnippet: string | null;
}

export interface AnswerResult {
  round: number;
  question: number;
  kind: AnswerKind;
  status: AnswerStatus;
  domainRating: number | null;
  communicationRating: number | null;
  feedback: AnswerFeedback | null;
  updatedAt: string;
}

// ─── Proctoring ─────────────────────────────────────────────────────────────

export interface ProctorEventInput {
  kind: ProctorEventKind;
  /** ISO time the browser saw it. */
  occurredAt: string;
  round?: number;
  question?: number;
}

// ─── Reports ────────────────────────────────────────────────────────────────

export interface RoundReport {
  name: string;
  focus: string;
  domainRating: number | null;
  communicationRating: number | null;
  overallRating: number | null;
  questionCount: number;
  answeredCount: number;
}

export interface QuestionReport {
  round: number;
  question: number;
  text: string;
  code: boolean;
  answer: AnswerResult | null;
  /** Included for the owner, and on a share link only when the owner opted in. */
  transcript: TranscriptLine[] | null;
  submittedCode: string | null;
}

export interface InterviewReport {
  interview: InterviewSummary;
  candidateName: string;
  domainRating: number | null;
  communicationRating: number | null;
  overallRating: number | null;
  /** Total live voice time, in seconds. */
  voiceSeconds: number;
  rounds: RoundReport[];
  questions: QuestionReport[];
  proctoring: { enabled: boolean; events: { kind: ProctorEventKind; occurredAt: string; round: number | null; question: number | null }[] } | null;
}

// ─── Shares ─────────────────────────────────────────────────────────────────

export interface ShareInput {
  includeTranscript?: boolean;
  /** Days until the link stops working; omit for no expiry. */
  expiresInDays?: number | null;
}

export interface ShareSummary {
  id: string;
  interviewId: string;
  interviewTitle: string;
  url: string;
  includeTranscript: boolean;
  viewCount: number;
  expiresAt: string | null;
  createdAt: string;
}

/** GET /api/shared/:id: a report without the owner's account details. */
export interface SharedReport extends InterviewReport {
  sharedAt: string;
}

// ─── Usage ──────────────────────────────────────────────────────────────────

/** GET /api/me/usage: this calendar month (UTC). Null limits mean unlimited. */
export interface Usage {
  month: string;
  interviews: { used: number; limit: number | null };
  voiceMinutes: { used: number; limit: number | null };
  maxSessionMinutes: number;
  /** ISO: when the counters reset. */
  resetsAt: string;
}

/** What the start screen offers. */
export interface RealtimeModelOption {
  id: string;
  displayName: string;
  description: string;
  provider: RealtimeProvider;
  voices: string[];
  isDefault: boolean;
}

export interface Preferences {
  voice: string;
  /** ISO-639-1, or "auto". */
  transcriptionLanguage: string;
  proctoringDefault: boolean;
  defaultRealtimeModelId: string | null;
}
