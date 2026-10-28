/** /api/meta: public facts a client reads before anyone signs in. */
import { Router } from "express";
import * as ctrl from "../controllers/me.controller";

export const router = Router();
/** Public: name, features, limits and the minimum app version (`AppMeta`). Cached 30 seconds. */
router.get("/", ctrl.meta);
