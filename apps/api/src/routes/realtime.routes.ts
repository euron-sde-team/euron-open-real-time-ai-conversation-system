/** /api/realtime: the WebRTC handshake relay for OpenAI Realtime. */
import express, { Router } from "express";
import * as ctrl from "../controllers/interview.controller";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();
/**
 * The SDP offer (`application/sdp`, max 64 KB) with `Authorization: Bearer ek_...` from a `LiveSessionGrant`. Returns the
 * SDP answer and the call `Location`. A credential works once, inside its connection window. 401 REALTIME_SESSION_INVALID.
 */
router.post("/openai/calls", rateLimit("realtime-relay", 30, 60, "ip"), express.text({ type: "application/sdp", limit: "64kb" }), ctrl.relayOpenAiSdp);
