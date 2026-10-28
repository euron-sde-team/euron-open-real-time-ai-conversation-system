/**
 * Account lifecycle: deleting your own account (with a grace period), an admin erasing
 * one, and exporting your own data.
 *
 * Delete (DELETE /api/users/me) marks the account `deletion_requested_at` and signs it
 * out everywhere. Signing in again within the grace period cancels the request; after
 * it, the maintenance.purge-accounts job runs `anonymiseUser`. An admin erase (POST
 * /api/admin/users/:id/erase) runs it at once.
 *
 * `anonymiseUser` keeps the users row (usage totals and the audit log point at it) but
 * removes the person and everything they wrote:
 *   - users: status DEACTIVATED, email deleted+<id>@invalid.example, username
 *     deleted-<id tail>, display name "Deleted user", two-factor removed, password
 *     replaced with an unknown one, every session revoked;
 *   - interviews (with their answers, transcripts, live sessions and proctoring
 *     events), preferences and shared links are deleted.
 * Being the last active admin blocks deletion (409 LAST_ADMIN).
 *
 * Export (GET /api/users/me/export) streams one JSON document of the caller's own data,
 * read in pages of EXPORT_PAGE rows so a large account never sits in memory at once.
 */
import type { Response } from "express";
import type { Actor, RequestMeta } from "../core/context";
import { withTransaction } from "../core/effects";
import { conflict } from "../core/errors";
import { db, type Executor } from "../db/kysely";
import { toMe } from "../presenters/user.presenter";
import { recoveryCodeRepo } from "../repositories/recovery-code.repository";
import { sessionRepo } from "../repositories/session.repository";
import { userRepo } from "../repositories/user.repository";
import { hashPassword } from "../security/passwords";
import { randomToken } from "../security/tokens";
import { audit } from "./audit.service";
import { confirmIdentity } from "./auth.service";

export const DELETED_DISPLAY_NAME = "Deleted user";
/** Days between asking to delete an account and the purge. */
export const DELETION_GRACE_DAYS = 14;

export async function assertNotLastAdmin(userId: string, role: string, exec: Executor = db): Promise<void> {
  if (role !== "ADMIN") return;
  const others = await exec.selectFrom("users").select("id").where("role", "=", "ADMIN").where("status", "=", "ACTIVE").where("id", "<>", userId).executeTakeFirst();
  if (!others) throw conflict("You are the last administrator; make someone else an admin first", "LAST_ADMIN");
}

/** Ask for deletion: signed out everywhere now, erased after the grace period. */
export async function requestDeletion(actor: Actor, input: { password: string; totp?: string; recoveryCode?: string }, meta: RequestMeta): Promise<{ purgeAfter: string }> {
  const user = await confirmIdentity(actor, input);
  await assertNotLastAdmin(user.id, user.role);
  const now = new Date();
  await withTransaction(async (trx) => {
    await trx.updateTable("users").set({ deletion_requested_at: now, updated_at: now }).where("id", "=", user.id).execute();
    await sessionRepo.revokeAllForUser(user.id, trx);
    await userRepo.bumpTokenVersion(user.id, trx);
    await audit({ actorId: user.id, action: "user.deletion_requested", entityType: "user", entityId: user.id, ip: meta.ip }, trx);
  });
  return { purgeAfter: new Date(now.getTime() + DELETION_GRACE_DAYS * 86_400_000).toISOString() };
}

/** Signing in during the grace period keeps the account. Called by auth.service on a successful login. */
export async function cancelDeletionOnSignIn(userId: string, exec: Executor = db): Promise<boolean> {
  const r = await exec.updateTable("users").set({ deletion_requested_at: null }).where("id", "=", userId).where("deletion_requested_at", "is not", null).executeTakeFirst();
  const cancelled = Number(r.numUpdatedRows) > 0;
  if (cancelled) await audit({ actorId: userId, action: "user.deletion_cancelled", entityType: "user", entityId: userId }, exec);
  return cancelled;
}

/** Strip everything that identifies a person (see the header). Runs inside the caller's transaction. */
export async function anonymiseUser(id: string, trx: Executor): Promise<void> {
  const now = new Date();
  const unusable = await hashPassword(randomToken());
  await trx
    .updateTable("users")
    .set({
      status: "DEACTIVATED",
      role: "USER",
      email: `deleted+${id.toLowerCase()}@invalid.example`,
      username: `deleted-${id.slice(-12).toLowerCase()}`,
      display_name: DELETED_DISPLAY_NAME,
      quota_tier_id: null,
      password_hash: unusable,
      totp_enabled: false,
      totp_secret: null,
      totp_last_step: null,
      suspended_until: null,
      deletion_requested_at: null,
      updated_at: now,
    })
    .where("id", "=", id)
    .execute();
  await recoveryCodeRepo.deleteAll(id, trx);
  await trx.deleteFrom("auth_tokens").where("user_id", "=", id).execute();
  await sessionRepo.revokeAllForUser(id, trx);
  await userRepo.bumpTokenVersion(id, trx);

  await trx.deleteFrom("shares").where("user_id", "=", id).execute();
  await trx.deleteFrom("live_sessions").where("user_id", "=", id).where("status", "<>", "OPEN").execute();
  await trx.deleteFrom("interviews").where("user_id", "=", id).execute();
  await trx.deleteFrom("user_preferences").where("user_id", "=", id).execute();
  await trx.deleteFrom("user_quota_overrides").where("user_id", "=", id).execute();
}

// ─── Export ─────────────────────────────────────────────────────────────────

const EXPORT_PAGE = 500;

type Section = { name: string; query: (after: string | null) => Promise<{ id: string }[]> };

function sections(userId: string): Section[] {
  const after = <Q extends { where: (...a: any[]) => Q }>(q: Q, col: string, cursor: string | null): Q => (cursor ? q.where(col, ">", cursor) : q);
  return [
    {
      name: "interviews",
      query: (c) =>
        after(
          db
            .selectFrom("interviews")
            .select(["id", "source", "status", "title", "company", "role", "domain", "summary", "job_description", "plan", "proctoring", "started_at", "completed_at", "created_at"])
            .where("user_id", "=", userId),
          "id",
          c,
        )
          .orderBy("id")
          .limit(EXPORT_PAGE)
          .execute(),
    },
    {
      name: "answers",
      query: (c) =>
        after(
          db
            .selectFrom("answers as a")
            .innerJoin("interviews as i", "i.id", "a.interview_id")
            .select(["a.id", "a.interview_id", "a.round_index", "a.question_index", "a.kind", "a.transcript", "a.code", "a.language", "a.status", "a.domain_rating", "a.communication_rating", "a.feedback", "a.created_at", "a.updated_at"])
            .where("i.user_id", "=", userId),
          "a.id",
          c,
        )
          .orderBy("a.id")
          .limit(EXPORT_PAGE)
          .execute(),
    },
    {
      name: "proctorEvents",
      query: (c) =>
        after(db.selectFrom("proctor_events as p").innerJoin("interviews as i", "i.id", "p.interview_id").select(["p.id", "p.interview_id", "p.kind", "p.round_index", "p.question_index", "p.occurred_at"]).where("i.user_id", "=", userId), "p.id", c)
          .orderBy("p.id")
          .limit(EXPORT_PAGE)
          .execute(),
    },
    {
      name: "liveSessions",
      query: (c) => after(db.selectFrom("live_sessions").select(["id", "interview_id", "provider_kind", "round_index", "question_index", "status", "seconds", "created_at", "ended_at"]).where("user_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute(),
    },
    { name: "sharedLinks", query: (c) => after(db.selectFrom("shares").select(["id", "interview_id", "include_transcript", "view_count", "revoked_at", "expires_at", "created_at"]).where("user_id", "=", userId), "id", c).orderBy("id").limit(EXPORT_PAGE).execute() },
  ];
}

/** Stream the caller's data as one JSON document: { exportedAt, account, preferences, interviews: [...], answers: [...], ... }. */
export async function exportAccount(actor: Actor, res: Response): Promise<void> {
  const user = await userRepo.findById(actor.id);
  if (!user) return void res.status(404).end();
  const account = { ...(await toMe(user)), createdAt: user.created_at.toISOString() };
  const prefs = await db.selectFrom("user_preferences").select(["voice", "transcription_language", "proctoring_default", "default_realtime_model_id"]).where("user_id", "=", user.id).executeTakeFirst();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${user.username}-export.json"`);
  res.setHeader("Cache-Control", "no-store");
  const write = (chunk: string) => new Promise<void>((resolve) => (res.write(chunk) ? resolve() : res.once("drain", resolve)));
  await write(`{"exportedAt":${JSON.stringify(new Date().toISOString())},"account":${JSON.stringify(account)},"preferences":${JSON.stringify(prefs ?? null)}`);
  for (const section of sections(user.id)) {
    await write(`,${JSON.stringify(section.name)}:[`);
    let cursor: string | null = null;
    let first = true;
    for (;;) {
      const rows = await section.query(cursor);
      for (const row of rows) {
        await write(`${first ? "" : ","}${JSON.stringify(row)}`);
        first = false;
      }
      if (rows.length < EXPORT_PAGE) break;
      cursor = rows[rows.length - 1]!.id;
    }
    await write("]");
  }
  await write("}");
  res.end();
  await audit({ actorId: user.id, action: "user.export", entityType: "user", entityId: user.id });
}
