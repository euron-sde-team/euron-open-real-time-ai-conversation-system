/** /api/interviews: plan, edit, hold and review mock interviews. Every route is owner-scoped. */
import { Router } from "express";
import * as ctrl from "../controllers/interview.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();

/** Your interviews, newest first (`Page<InterviewSummary>`). `?status=` filters. */
router.get("/", authenticate, ctrl.list);
/**
 * Upload a resume (multipart field `file`, PDF or DOCX, optional `proctoring=true`). The file is read in memory and never
 * stored. Books one interview against this month's quota and returns the `Interview` in PLANNING; poll until READY.
 * 400 FILE_TYPE, 422 RESUME_TOO_SHORT, 429 QUOTA_EXCEEDED, 503 NO_TEXT_MODEL.
 */
router.post("/from-resume", authenticate, rateLimit("interview-create", 10, 3600), ctrl.resumeUpload, ctrl.fromResume);
/** Plan from `{ company, role, jobDescription, proctoring? }`. Same quota and polling as a resume. */
router.post("/from-job-description", authenticate, rateLimit("interview-create", 10, 3600), ctrl.fromJobDescription);
/** One interview with its plan, position and answers (`Interview`). 404 when it is not yours. */
router.get("/:id", authenticate, ctrl.get);
/** Before the first live session: `{ title?, plan?, proctoring?, realtimeModelId? }`. After: only `title`. 409 INTERVIEW_STARTED. */
router.patch("/:id", authenticate, ctrl.update);
/** Plan again from the stored job description (resumes are not kept). 409 REPLAN_UNAVAILABLE. */
router.post("/:id/replan", authenticate, rateLimit("interview-replan", 5, 3600), ctrl.replan);
/** Delete the interview, its answers, transcripts and share links. Does not give quota back. 204. */
router.delete("/:id", authenticate, ctrl.remove);
/**
 * Open a live voice session for the current question (or `{ round, question }`): returns a `LiveSessionGrant` with a
 * short-lived credential that has the interviewer's instructions locked inside. Closes any other open session of yours.
 * 409 PLAN_NOT_READY, 429 QUOTA_EXCEEDED, 502 REALTIME_UNAVAILABLE, 503 NO_REALTIME_MODEL.
 */
router.post("/:id/live", authenticate, rateLimit("interview-live", 40, 3600), ctrl.startLive);
/** Close a live session and book its server-measured time (`LiveSessionEnd`). Idempotent. */
router.post("/:id/live/:sid/end", authenticate, ctrl.endLive);
/**
 * Submit the answer to one question: `{ round, question, transcript? | code?, language?, advance? }`. Queues scoring and,
 * by default, moves to the next question (finishing after the last). Ratings cannot be sent. 202 `AnswerResult`.
 */
router.post("/:id/answers", authenticate, rateLimit("interview-answer", 120, 3600), ctrl.answer);
/** Proctoring events from the browser: `{ events: [{ kind, occurredAt, round?, question? }] }`. 409 PROCTORING_OFF. */
router.post("/:id/proctor-events", authenticate, rateLimit("interview-proctor", 300, 3600), ctrl.proctorEvents);
/** Finish now; unanswered questions stay unanswered. Returns `Interview`. */
router.post("/:id/complete", authenticate, ctrl.complete);
/** The full report with transcripts (`InterviewReport`). */
router.get("/:id/report", authenticate, ctrl.report);
/** The report as a PDF download. 30 per hour. */
router.get("/:id/report.pdf", authenticate, rateLimit("interview-pdf", 30, 3600), ctrl.reportPdf);
/** Create a read-only link: `{ includeTranscript?, expiresInDays? }` (`ShareSummary`). */
router.post("/:id/shares", authenticate, rateLimit("share-create", 30, 3600), ctrl.createShare);
