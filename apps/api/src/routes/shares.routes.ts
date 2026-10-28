/** /api/shares: your share links. */
import { Router } from "express";
import * as ctrl from "../controllers/interview.controller";
import { authenticate } from "../middleware/auth";

export const router = Router();
/** Your active share links (`Page<ShareSummary>`). */
router.get("/", authenticate, ctrl.listShares);
/** Revoke a link; it stops working at once. 204. */
router.delete("/:id", authenticate, ctrl.revokeShare);
