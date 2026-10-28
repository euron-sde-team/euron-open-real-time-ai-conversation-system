/**
 * Share links: a read-only copy of one interview's report at a random URL. The owner
 * chooses whether the transcript and code are included, may set an expiry, and can
 * revoke the link at any time (so can an admin). A revoked, expired or unknown link is
 * the same 404. Opening a link needs no account.
 */
import crypto from "node:crypto";
import type { Page, SharedReport, ShareSummary } from "@open-conversation/types";
import { config } from "../core/config";
import { type Actor, requireActive, requireActor } from "../core/context";
import { forbidden, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { db } from "../db/kysely";
import { atKey, decodeTime, olderThan, timePage } from "../repositories/keyset";
import { ownedInterview } from "./interview/interview.service";
import { buildReport } from "./interview/report.service";
import { getSettings } from "./settings.service";

/** A ULID plus 22 random base64url characters (132 bits): not guessable, not enumerable. */
export const SHARE_ID = /^[0-9A-HJKMNP-TV-Z]{26}-[A-Za-z0-9_-]{22}$/;

export const shareUrl = (id: string) => `${config.APP_WEB_URL.replace(/\/$/, "")}/s/${id}`;

const MAX_LINKS_PER_INTERVIEW = 10;

const gone = () => notFound("This link does not exist or was removed", "SHARE_NOT_FOUND");

export async function createShare(actor: Actor, interviewId: string, opts: { includeTranscript?: boolean; expiresInDays?: number | null }): Promise<ShareSummary> {
  const a = requireActive(actor);
  if (!(await getSettings()).features.sharing) throw forbidden("Sharing is turned off on this server", "FEATURE_DISABLED");
  const row = await ownedInterview(a.id, interviewId);
  const live = await db.selectFrom("shares").select(db.fn.countAll<number>().as("n")).where("interview_id", "=", row.id).where("revoked_at", "is", null).executeTakeFirst();
  if (Number(live?.n ?? 0) >= MAX_LINKS_PER_INTERVIEW) throw forbidden(`An interview can have at most ${MAX_LINKS_PER_INTERVIEW} active links; revoke one first`, "SHARE_LIMIT");
  const id = `${newId()}-${crypto.randomBytes(16).toString("base64url").slice(0, 22)}`;
  const share = await db
    .insertInto("shares")
    .values({
      id,
      user_id: a.id,
      interview_id: row.id,
      include_transcript: opts.includeTranscript ?? false,
      expires_at: opts.expiresInDays ? new Date(Date.now() + opts.expiresInDays * 86_400_000) : null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { id: share.id, interviewId: row.id, interviewTitle: row.title, url: shareUrl(share.id), includeTranscript: share.include_transcript, viewCount: 0, expiresAt: share.expires_at?.toISOString() ?? null, createdAt: share.created_at.toISOString() };
}

export async function listShares(actor: Actor, q: { cursor?: string; limit?: number }): Promise<Page<ShareSummary>> {
  const a = requireActor(actor);
  const limit = q.limit ?? 20;
  const rows = await db
    .selectFrom("shares as s")
    .innerJoin("interviews as i", "i.id", "s.interview_id")
    .select(["s.id", "s.interview_id", "s.include_transcript", "s.view_count", "s.expires_at", "s.created_at", "i.title", atKey("s.created_at")])
    .where("s.user_id", "=", a.id)
    .where("s.revoked_at", "is", null)
    .where(olderThan("s.created_at", "s.id", decodeTime(q.cursor)) as never)
    .orderBy("s.created_at", "desc")
    .orderBy("s.id", "desc")
    .limit(limit + 1)
    .execute();
  const page = timePage(rows, limit);
  return {
    items: page.items.map((r) => ({ id: r.id, interviewId: r.interview_id, interviewTitle: r.title, url: shareUrl(r.id), includeTranscript: r.include_transcript, viewCount: r.view_count, expiresAt: r.expires_at?.toISOString() ?? null, createdAt: r.created_at.toISOString() })),
    nextCursor: page.nextCursor,
  };
}

export async function revokeShare(actor: Actor, id: string): Promise<void> {
  const a = requireActor(actor);
  const res = await db.updateTable("shares").set({ revoked_at: new Date(), revoked_by: a.id }).where("id", "=", id).where("user_id", "=", a.id).where("revoked_at", "is", null).executeTakeFirst();
  if (!res.numUpdatedRows) throw gone();
}

export async function readShared(id: string): Promise<SharedReport> {
  if (!(await getSettings()).features.sharing) throw gone();
  const share = await db
    .updateTable("shares")
    .set((eb) => ({ view_count: eb("view_count", "+", 1) }))
    .where("id", "=", id)
    .where("revoked_at", "is", null)
    .where((eb) => eb.or([eb("expires_at", "is", null), eb("expires_at", ">", new Date())]))
    .returningAll()
    .executeTakeFirst();
  if (!share) throw gone();
  const row = await db.selectFrom("interviews").selectAll().where("id", "=", share.interview_id).executeTakeFirst();
  if (!row) throw gone();
  const report = await buildReport(row, { includeTranscript: share.include_transcript });
  return { ...report, sharedAt: share.created_at.toISOString() };
}
