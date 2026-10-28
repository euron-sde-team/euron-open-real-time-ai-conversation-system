/** Interviews, live sessions, answers, reports, shares and the OpenAI SDP relay. Thin controllers. */
import type { Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { config } from "../core/config";
import { badRequest, notFound } from "../core/errors";
import { captureError } from "../core/logger";
import { id, idParam, pageQuery, parse, text } from "../core/validate";
import { actorOf } from "../middleware/http";
import * as interviews from "../services/interview/interview.service";
import * as live from "../services/interview/live.service";
import { CODE_LANGUAGES, MAX_JOB_DESCRIPTION_CHARS, MAX_QUESTION_CHARS, MAX_QUESTIONS_PER_ROUND, MAX_ROUNDS } from "../services/interview/plan";
import { renderReportPdf } from "../services/interview/pdf";
import { getReport } from "../services/interview/report.service";
import * as shares from "../services/share.service";
import { appName, getSettings } from "../services/settings.service";

/** The resume, in memory only (never written to disk). */
export const resumeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_RESUME_MB * 1024 * 1024, files: 1, fields: 4 } }).single("file");

const planInput = z
  .array(
    z.object({
      name: text(80, 2),
      focus: z.string().max(300).default(""),
      description: z.string().max(1000).default(""),
      questions: z
        .array(z.object({ text: text(MAX_QUESTION_CHARS, 5), code: z.boolean().default(false), language: z.enum(CODE_LANGUAGES).nullable().default(null) }))
        .min(1)
        .max(MAX_QUESTIONS_PER_ROUND),
    }),
  )
  .min(1)
  .max(MAX_ROUNDS);

const position = z.object({ round: z.number().int().min(0).max(MAX_ROUNDS), question: z.number().int().min(0).max(MAX_QUESTIONS_PER_ROUND) });

export async function list(req: Request, res: Response) {
  const q = parse(pageQuery.extend({ status: z.enum(["PLANNING", "PLAN_FAILED", "READY", "IN_PROGRESS", "COMPLETED"]).optional() }), req.query);
  res.json(await interviews.listInterviews(actorOf(req), q));
}

export async function get(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.json(await interviews.getInterview(actorOf(req), parse(idParam, req.params).id));
}

export async function fromResume(req: Request, res: Response) {
  const file = req.file;
  if (!file) throw badRequest("Choose a resume to upload", "FILE_REQUIRED");
  const body = parse(z.object({ proctoring: z.enum(["true", "false"]).optional() }), req.body);
  res.status(201).json(await interviews.createFromResume(actorOf(req), { data: file.buffer, name: file.originalname }, { proctoring: body.proctoring === "true" }));
}

export async function fromJobDescription(req: Request, res: Response) {
  const body = parse(
    z.object({ company: text(120, 1), role: text(120, 2), jobDescription: text(MAX_JOB_DESCRIPTION_CHARS, 80), proctoring: z.boolean().optional() }).strict(),
    req.body,
  );
  res.status(201).json(await interviews.createFromJobDescription(actorOf(req), body));
}

export async function update(req: Request, res: Response) {
  const body = parse(z.object({ title: text(160, 1), plan: planInput, proctoring: z.boolean(), realtimeModelId: id().nullable() }).partial().strict(), req.body);
  res.json(await interviews.updateInterview(actorOf(req), parse(idParam, req.params).id, body));
}

export async function replan(req: Request, res: Response) {
  res.json(await interviews.replan(actorOf(req), parse(idParam, req.params).id));
}

export async function remove(req: Request, res: Response) {
  await interviews.deleteInterview(actorOf(req), parse(idParam, req.params).id);
  res.status(204).end();
}

export async function complete(req: Request, res: Response) {
  res.json(await interviews.completeInterview(actorOf(req), parse(idParam, req.params).id));
}

export async function startLive(req: Request, res: Response) {
  const body = parse(position.partial().strict(), req.body);
  res.setHeader("Cache-Control", "no-store");
  res.status(201).json(await live.startLive(actorOf(req), parse(idParam, req.params).id, body));
}

export async function endLive(req: Request, res: Response) {
  const p = parse(z.object({ id: id(), sid: id() }), req.params);
  res.json(await live.endLive(actorOf(req), p.id, p.sid));
}

export async function answer(req: Request, res: Response) {
  // Ratings are not part of the schema: `.strict()` rejects a client that tries to send them.
  const body = parse(
    position
      .extend({
        transcript: z.array(z.object({ role: z.enum(["interviewer", "candidate"]), text: z.string().max(8000) })).max(400).optional(),
        code: z.string().max(40_000).optional(),
        language: z.enum(CODE_LANGUAGES).optional(),
        advance: z.boolean().optional(),
      })
      .strict(),
    req.body,
  );
  res.status(202).json(await interviews.submitAnswer(actorOf(req), parse(idParam, req.params).id, body));
}

export async function proctorEvents(req: Request, res: Response) {
  const body = parse(
    z
      .object({
        events: z
          .array(
            z.object({
              kind: z.enum(["NO_FACE", "MULTIPLE_FACES", "FACE_BACK", "TAB_HIDDEN", "TAB_VISIBLE", "CAMERA_OFF"]),
              occurredAt: z.string().datetime(),
              round: z.number().int().min(0).max(MAX_ROUNDS).optional(),
              question: z.number().int().min(0).max(MAX_QUESTIONS_PER_ROUND).optional(),
            }),
          )
          .min(1)
          .max(100),
      })
      .strict(),
    req.body,
  );
  res.json(await interviews.recordProctorEvents(actorOf(req), parse(idParam, req.params).id, body.events));
}

export async function report(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.json(await getReport(actorOf(req), parse(idParam, req.params).id));
}

export async function reportPdf(req: Request, res: Response) {
  if (!(await getSettings()).features.pdfExport) throw notFound();
  const r = await getReport(actorOf(req), parse(idParam, req.params).id);
  const pdf = await renderReportPdf(r, await appName());
  const name = r.interview.title.replace(/[^A-Za-z0-9 _-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "interview";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${name}-report.pdf"`);
  res.setHeader("Cache-Control", "no-store");
  res.end(pdf);
}

// ─── Shares ─────────────────────────────────────────────────────────────────

/** A malformed share id is just a link that does not exist. */
function shareId(req: Request): string {
  const v = String(req.params.id ?? "");
  if (!shares.SHARE_ID.test(v)) throw notFound("This link does not exist or was removed", "SHARE_NOT_FOUND");
  return v;
}

export async function createShare(req: Request, res: Response) {
  const body = parse(z.object({ includeTranscript: z.boolean().optional(), expiresInDays: z.number().int().min(1).max(365).nullable().optional() }).strict(), req.body);
  res.status(201).json(await shares.createShare(actorOf(req), parse(idParam, req.params).id, body));
}

export async function listShares(req: Request, res: Response) {
  res.json(await shares.listShares(actorOf(req), parse(pageQuery, req.query)));
}

export async function revokeShare(req: Request, res: Response) {
  await shares.revokeShare(actorOf(req), shareId(req));
  res.status(204).end();
}

export async function readShared(req: Request, res: Response) {
  const v = shareId(req);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  res.json(await shares.readShared(v));
}

// ─── OpenAI SDP relay ───────────────────────────────────────────────────────

/**
 * POST /api/realtime/openai/calls: forwards the browser's WebRTC SDP offer to OpenAI and
 * returns the answer. It exists for two reasons: networks that block api.openai.com can
 * still hold an interview (the browser only talks to this API for the handshake), and the
 * server learns the call id so it can hang up when the session's time is over. Only a
 * credential minted by POST /interviews/:id/live, still in its connection window and not
 * used before, is relayed.
 */
export async function relayOpenAiSdp(req: Request, res: Response) {
  const auth = req.get("authorization") ?? "";
  const credential = auth.match(/^Bearer\s+(ek_[A-Za-z0-9_-]{8,400})$/)?.[1];
  const claim = credential ? await live.claimRelay(credential) : null;
  if (!credential || !claim) {
    res.status(401).json({ error: "This voice session is not valid or has expired", code: "REALTIME_SESSION_INVALID" });
    return;
  }
  const offer = typeof req.body === "string" ? req.body : "";
  if (!offer.startsWith("v=0")) throw badRequest("Missing SDP offer", "SDP_REQUIRED");
  try {
    const upstream = await fetch(`${claim.baseUrl.replace(/\/$/, "")}/realtime/calls`, {
      method: "POST",
      headers: { "Content-Type": "application/sdp", Authorization: `Bearer ${credential}` },
      body: offer,
      signal: AbortSignal.timeout(20_000),
    });
    const answer = await upstream.text();
    const location = upstream.headers.get("location");
    const callId = location?.split("/").filter(Boolean).pop();
    if (upstream.ok && callId) await live.rememberCall(claim.sessionId, callId);
    if (location) res.setHeader("Location", location);
    res.setHeader("Access-Control-Expose-Headers", "Location");
    res.status(upstream.ok ? upstream.status : 502).type("application/sdp").send(upstream.ok ? answer : "");
  } catch (err) {
    captureError(err, { where: "realtime.relay" });
    res.status(502).json({ error: "The voice service could not be reached", code: "REALTIME_UNAVAILABLE" });
  }
}
