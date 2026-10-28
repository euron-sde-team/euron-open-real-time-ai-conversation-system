/** /api/shared: public, read-only reports behind share links. */
import { Router } from "express";
import * as ctrl from "../controllers/interview.controller";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();
/** Public: the shared report (`SharedReport`); transcripts only when the owner included them. 404 when revoked or expired. */
router.get("/:id", rateLimit("shared-read", 120, 60, "ip"), ctrl.readShared);
