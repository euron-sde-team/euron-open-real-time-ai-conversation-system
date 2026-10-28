/** /api/admin. Admins only; every service call starts with requireAdmin. */
import type { Request, Response } from "express";
import { z } from "zod";
import { badRequest } from "../core/errors";
import { id, idParam, parse } from "../core/validate";
import { actorOf, meta } from "../middleware/http";
import * as admin from "../services/admin.service";
import { SHARE_ID } from "../services/share.service";
import { listAudit } from "../services/audit.service";
import { requireAdmin } from "../core/context";

const page = { cursor: z.string().max(300).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableCount = z.number().int().min(0).max(1_000_000_000_000).nullable();

export async function me(req: Request, res: Response) {
  const a = requireAdmin(actorOf(req));
  res.json({ role: a.role });
}

export async function stats(req: Request, res: Response) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const q = parse(z.object({ from: day.default(monthAgo), to: day.default(today) }), req.query);
  if (q.from > q.to) throw badRequest("from must be before to", "RANGE_INVALID");
  if ((Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 > 366) throw badRequest("At most a year at a time", "RANGE_TOO_LONG");
  res.json(await admin.stats(actorOf(req), q.from, q.to));
}

export async function users(req: Request, res: Response) {
  const q = parse(z.object({ ...page, q: z.string().max(200).optional(), status: z.enum(["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED", "BANNED", "DEACTIVATED"]).optional(), role: z.enum(["USER", "ADMIN"]).optional(), tierId: id().optional() }), req.query);
  res.json(await admin.listUsers(actorOf(req), q));
}
export async function user(req: Request, res: Response) {
  res.json(await admin.userDetail(actorOf(req), parse(idParam, req.params).id));
}
export async function setRole(req: Request, res: Response) {
  res.json(await admin.setRole(actorOf(req), parse(idParam, req.params).id, parse(z.object({ role: z.enum(["USER", "ADMIN"]) }).strict(), req.body).role, meta(req)));
}
export function status(action: "suspend" | "unsuspend" | "ban" | "unban") {
  return async (req: Request, res: Response) => {
    const body = parse(z.object({ days: z.number().int().min(1).max(365).optional(), reason: z.string().trim().max(300).optional() }).strict(), req.body);
    res.json(await admin.setStatus(actorOf(req), parse(idParam, req.params).id, action, body, meta(req)));
  };
}
export async function erase(req: Request, res: Response) {
  const body = parse(z.object({ reason: z.string().trim().min(3).max(300) }).strict(), req.body);
  await admin.eraseUser(actorOf(req), parse(idParam, req.params).id, body.reason, meta(req));
  res.status(204).end();
}
export async function setTier(req: Request, res: Response) {
  res.json(await admin.setUserTier(actorOf(req), parse(idParam, req.params).id, parse(z.object({ tierId: id().nullable() }).strict(), req.body).tierId, meta(req)));
}
export async function setOverride(req: Request, res: Response) {
  const body = parse(z.object({ monthlyInterviews: nullableCount, monthlyVoiceMinutes: nullableCount, note: z.string().trim().max(300).nullable() }).strict(), req.body);
  res.json(await admin.setOverride(actorOf(req), parse(idParam, req.params).id, body, meta(req)));
}
export async function removeOverride(req: Request, res: Response) {
  res.json(await admin.setOverride(actorOf(req), parse(idParam, req.params).id, null, meta(req)));
}

const tierBody = z.object({ name: z.string().trim().min(1).max(60), monthlyInterviews: nullableCount, monthlyVoiceMinutes: nullableCount, maxSessionMinutes: z.number().int().min(1).max(120), isDefault: z.boolean().optional() }).strict();
export async function tiers(req: Request, res: Response) {
  res.json(await admin.listTiers(actorOf(req)));
}
export async function createTier(req: Request, res: Response) {
  res.status(201).json(await admin.saveTier(actorOf(req), null, parse(tierBody, req.body), meta(req)));
}
export async function updateTier(req: Request, res: Response) {
  res.json(await admin.saveTier(actorOf(req), parse(idParam, req.params).id, parse(tierBody, req.body), meta(req)));
}
export async function deleteTier(req: Request, res: Response) {
  res.json(await admin.deleteTier(actorOf(req), parse(idParam, req.params).id, meta(req)));
}

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, "lowercase letters, digits and hyphens");
const providerBody = z.object({ kind: z.enum(["OPENAI", "ANTHROPIC", "GEMINI", "OPENAI_COMPATIBLE", "STUB"]), displayName: z.string().trim().min(1).max(60), baseUrl: z.string().trim().max(300).nullable(), enabled: z.boolean() }).strict();
export async function providers(req: Request, res: Response) {
  res.json(await admin.listProviders(actorOf(req)));
}
export async function createProvider(req: Request, res: Response) {
  const body = parse(providerBody.extend({ id: slug }), req.body);
  res.status(201).json(await admin.saveProvider(actorOf(req), body, true, meta(req)));
}
export async function updateProvider(req: Request, res: Response) {
  const { id: providerId } = parse(z.object({ id: slug }), req.params);
  res.json(await admin.saveProvider(actorOf(req), { ...parse(providerBody, req.body), id: providerId }, false, meta(req)));
}
export async function deleteProvider(req: Request, res: Response) {
  res.json(await admin.deleteProvider(actorOf(req), parse(z.object({ id: slug }), req.params).id, meta(req)));
}

const modelBody = z
  .object({
    providerId: slug,
    kind: z.enum(["TEXT", "REALTIME"]),
    modelRef: z.string().trim().min(1).max(120),
    displayName: z.string().trim().min(1).max(60),
    description: z.string().trim().max(200).default(""),
    maxOutputTokens: z.number().int().min(16).max(1_000_000).default(8192),
    voices: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    inputUsdPerMtok: z.number().min(0).max(10_000).nullable().default(null),
    outputUsdPerMtok: z.number().min(0).max(10_000).nullable().default(null),
    usdPerMinute: z.number().min(0).max(100).nullable().default(null),
    enabled: z.boolean().default(true),
    isDefault: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(10000).default(0),
  })
  .strict();
export async function models(req: Request, res: Response) {
  res.json(await admin.listModels(actorOf(req)));
}
export async function createModel(req: Request, res: Response) {
  res.status(201).json(await admin.saveModel(actorOf(req), null, parse(modelBody, req.body), meta(req)));
}
export async function updateModel(req: Request, res: Response) {
  res.json(await admin.saveModel(actorOf(req), parse(idParam, req.params).id, parse(modelBody, req.body), meta(req)));
}
export async function deleteModel(req: Request, res: Response) {
  res.json(await admin.deleteModel(actorOf(req), parse(idParam, req.params).id, meta(req)));
}
export async function testModel(req: Request, res: Response) {
  res.json(await admin.testModel(actorOf(req), parse(idParam, req.params).id));
}

const settingsBody = z
  .object({
    appName: z.string().trim().min(1).max(60),
    tagline: z.string().trim().max(160),
    registration: z.enum(["OPEN", "INVITE_ONLY", "CLOSED"]),
    allowedEmailDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(100),
    supportEmail: z.string().trim().email().max(200).nullable(),
    interviewerName: z.string().trim().min(1).max(40),
    interviewerAddendum: z.string().max(2000),
    features: z.object({ resumeUpload: z.boolean(), jobDescription: z.boolean(), codeQuestions: z.boolean(), proctoring: z.boolean(), sharing: z.boolean(), pdfExport: z.boolean() }).partial().strict(),
    retentionDays: z.number().int().min(7).max(3650).nullable(),
    minSupportedVersion: z.string().regex(/^\d+\.\d+\.\d+$/).nullable(),
  })
  .partial()
  .strict();
export async function getSettings(req: Request, res: Response) {
  res.json(await admin.readSettings(actorOf(req)));
}
export async function patchSettings(req: Request, res: Response) {
  res.json(await admin.updateSettings(actorOf(req), parse(settingsBody, req.body) as admin.SettingsPatch, meta(req)));
}
export async function integrations(req: Request, res: Response) {
  res.json(await admin.integrations(actorOf(req)));
}

export async function shares(req: Request, res: Response) {
  const q = parse(z.object({ ...page, includeRevoked: z.enum(["true", "false"]).transform((v) => v === "true").optional() }), req.query);
  res.json(await admin.listAllShares(actorOf(req), q));
}
export async function revokeShare(req: Request, res: Response) {
  const p = parse(z.object({ id: z.string().regex(SHARE_ID) }), req.params);
  await admin.adminRevokeShare(actorOf(req), p.id, parse(z.object({ reason: z.string().trim().min(3).max(300) }).strict(), req.body).reason, meta(req));
  res.status(204).end();
}

export async function interviews(req: Request, res: Response) {
  const q = parse(z.object({ ...page, q: z.string().max(100).optional(), status: z.enum(["PLANNING", "PLAN_FAILED", "READY", "IN_PROGRESS", "COMPLETED"]).optional(), userId: id().optional() }), req.query);
  res.json(await admin.listAllInterviews(actorOf(req), q));
}

export async function audit(req: Request, res: Response) {
  const q = parse(z.object({ ...page, action: z.string().max(80).optional(), actorId: id().optional(), entityType: z.string().max(40).optional(), entityId: z.string().max(64).optional() }), req.query);
  res.json(await listAudit(actorOf(req), q));
}
