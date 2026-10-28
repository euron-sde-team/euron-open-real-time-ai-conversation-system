/** /api/me: your usage, voice models and preferences. */
import { Router } from "express";
import * as ctrl from "../controllers/me.controller";
import { authenticate } from "../middleware/auth";

export const router = Router();
/** This month's use against your allowance (`Usage`): interviews and minutes of live voice. Resets on the 1st, UTC. */
router.get("/usage", authenticate, ctrl.usage);
/** The voice models you can interview with (`RealtimeModelOption[]`). */
router.get("/realtime-models", authenticate, ctrl.realtimeModels);
/** Your `Preferences`. */
router.get("/preferences", authenticate, ctrl.getPreferences);
/** Change preferences: any of `{ voice, transcriptionLanguage, proctoringDefault, defaultRealtimeModelId }`. */
router.patch("/preferences", authenticate, ctrl.updatePreferences);
