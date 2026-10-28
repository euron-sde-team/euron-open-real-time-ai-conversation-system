/**
 * /api/admin: the control plane. Admins only (403 FORBIDDEN_ADMIN otherwise). Admins see
 * accounts, usage, interview metadata and configuration, never anyone's answers or transcripts.
 */
import { Router } from "express";
import * as ctrl from "../controllers/admin.controller";
import { authenticate } from "../middleware/auth";
import { rateLimit } from "../middleware/rate-limit";

export const router = Router();
router.use(authenticate);

/** `AdminSession`. */
router.get("/me", ctrl.me);
/** The overview (`AdminStats`) for `?from=&to=` (UTC dates, default the last 30 days, at most a year). */
router.get("/stats", ctrl.stats);

/** Accounts (`Page<AdminUserRow>`): `?q&status&role&tierId&cursor&limit`. */
router.get("/users", ctrl.users);
/** One account (`AdminUserDetail`): tier, override, totals, 30 days of usage. */
router.get("/users/:id", ctrl.user);
/** `{ role: USER | ADMIN }`. 403 SELF_ACTION; 409 LAST_ADMIN. Demoting signs the account out of admin at once. */
router.patch("/users/:id/role", ctrl.setRole);
/** `{ days, reason? }` (1 to 365): read-only until it ends. 403 TARGET_PROTECTED for admins. */
router.post("/users/:id/suspend", ctrl.status("suspend"));
router.post("/users/:id/unsuspend", ctrl.status("unsuspend"));
/** `{ reason? }`: signed out everywhere, shared links revoked. */
router.post("/users/:id/ban", ctrl.status("ban"));
router.post("/users/:id/unban", ctrl.status("unban"));
/** Erase now `{ reason }`: identity anonymised, every interview, answer, transcript and share link deleted. 204. */
router.post("/users/:id/erase", rateLimit("admin-erase", 20, 3600), ctrl.erase);
/** Put an account on a tier `{ tierId }` (null = the default tier). */
router.put("/users/:id/tier", ctrl.setTier);
/** One account's own limits on top of the tier `{ monthlyInterviews, monthlyVoiceMinutes, note }` (null fields fall back to the tier). */
router.put("/users/:id/quota", ctrl.setOverride);
/** Remove the account's own limits: the tier applies again. `AdminUserDetail`. */
router.delete("/users/:id/quota", ctrl.removeOverride);

/** Quota tiers (`QuotaTier[]`) with how many accounts use each. */
router.get("/tiers", ctrl.tiers);
/** `{ name, monthlyInterviews, monthlyVoiceMinutes, maxSessionMinutes, isDefault? }` (null = unlimited). Returns every tier. */
router.post("/tiers", ctrl.createTier);
router.put("/tiers/:id", ctrl.updateTier);
/** Delete a tier (its accounts fall back to the default). 409 TIER_IS_DEFAULT. */
router.delete("/tiers/:id", ctrl.deleteTier);

/** Providers (`AdminProvider[]`) with `keyConfigured` (never the key). */
router.get("/providers", ctrl.providers);
/** `{ id (slug), kind, displayName, baseUrl, enabled }`. The key is set on the server as PROVIDER_KEYS[slug]. */
router.post("/providers", ctrl.createProvider);
router.put("/providers/:id", ctrl.updateProvider);
router.delete("/providers/:id", ctrl.deleteProvider);
/** The model catalogue (`AdminModel[]`): TEXT models plan and score, REALTIME models hold the live voice interview. */
router.get("/models", ctrl.models);
router.post("/models", ctrl.createModel);
router.put("/models/:id", ctrl.updateModel);
router.delete("/models/:id", ctrl.deleteModel);
/** One tiny call through the provider (`ModelTestResult`): a text completion, or minting a voice credential. */
router.post("/models/:id/test", rateLimit("admin-model-test", 20, 60), ctrl.testModel);

/** Deployment settings (`AppSettings`). */
router.get("/settings", ctrl.getSettings);
/** Any subset of `AppSettings` (groups merge key by key). Audited with before and after. */
router.patch("/settings", ctrl.patchSettings);
/** What the server has configured (`IntegrationStatus`): mail, realtime providers with keys and models, text models. Never a key. */
router.get("/integrations", ctrl.integrations);

/** Every interview, metadata only (`Page<AdminInterviewRow>`): `?q&status&userId`. Never answers or transcripts. */
router.get("/interviews", ctrl.interviews);

/** Every live shared link (`Page<AdminShareRow>`): `?includeRevoked=true` for all. */
router.get("/shares", ctrl.shares);
/** Take a link down `{ reason }`. 204. */
router.post("/shares/:id/revoke", ctrl.revokeShare);

/** The audit trail (`Page<AuditEntry>`), newest first: `?action=` (a prefix) `&actorId&entityType&entityId`. */
router.get("/audit", ctrl.audit);
