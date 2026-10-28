"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { mapPages } from "@open-conversation/api-client";
import { Button, Field, Input, Select, Textarea, toast } from "@open-conversation/ui";
import type { AdminUserDetail, AdminUserRow, Page, QuotaTier, UserRole } from "@open-conversation/types";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ROLE_LABEL, STATUS_LABEL, STATUS_TONE, accountActions, adminErrorMessage, formatCount, formatMinutes, limitLabel, limitText, parseLimit, shortDate } from "@/lib/admin";
import { fullTimestamp } from "@/lib/time";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Chart, DetailSection, DetailSheet, FactList, ReasonDialog, StatusText } from "../shell";
import { adminMutation, ak, LineItem, PersonAvatar } from "./common";

const DEFAULT_TIER = "__default";

type Dialog = null | "makeAdmin" | "removeAdmin" | "suspend" | "unsuspend" | "ban" | "unban" | "erase" | "removeOverride";

export function UserSheet({ userId, tiers, onClose }: { userId: string | null; tiers: QuotaTier[]; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useAuth().user;
  const [dialog, setDialog] = useState<Dialog>(null);
  const q = useQuery({ queryKey: ak.user(userId ?? ""), queryFn: () => api().admin.user(userId!), enabled: !!userId });
  const u = q.data;

  /** Put a changed row everywhere it shows: the open detail and every loaded list page. */
  const applyRow = (row: AdminUserRow) => {
    qc.setQueryData<AdminUserDetail>(ak.user(row.id), (d) => (d ? { ...d, ...row } : d));
    qc.setQueriesData<InfiniteData<Page<AdminUserRow>>>({ queryKey: ak.usersPrefix }, (old) => (old ? { ...old, pages: mapPages(old.pages, (r) => (r.id === row.id ? { ...r, ...row } : r)) } : old));
  };
  const refreshLists = () => void qc.invalidateQueries({ queryKey: ak.usersPrefix });

  const role = useMutation({
    mutationFn: (next: UserRole) => api().admin.setRole(userId!, next),
    ...adminMutation(),
    onSuccess: (row) => {
      applyRow(row);
      toast.success({ title: row.role === "ADMIN" ? `${row.displayName} is now an admin` : `${row.displayName} is no longer an admin` });
    },
  });
  const tier = useMutation({
    mutationFn: (tierId: string | null) => api().admin.setTier(userId!, tierId),
    ...adminMutation(),
    onMutate: (tierId) => {
      // Instant: show the new tier while the request runs.
      const prev = qc.getQueryData<AdminUserDetail>(ak.user(userId!));
      const t = tiers.find((x) => x.id === tierId);
      if (prev) qc.setQueryData<AdminUserDetail>(ak.user(userId!), { ...prev, quotaTier: t ? { id: t.id, name: t.name } : null });
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(ak.user(userId!), ctx.prev);
      toast.error({ title: adminErrorMessage(e) });
    },
    onSuccess: (row) => {
      applyRow(row);
      void qc.invalidateQueries({ queryKey: ak.tiers });
    },
  });
  const simple = useMutation({
    mutationFn: (action: "unsuspend" | "unban") => (action === "unsuspend" ? api().admin.unsuspend(userId!) : api().admin.unban(userId!)),
    ...adminMutation(),
    onSuccess: (row) => applyRow(row),
  });

  if (!userId) return <DetailSheet open={false} onOpenChange={() => onClose()} title="" />;
  const can = u ? accountActions(u, me?.id) : null;

  return (
    <DetailSheet
      open={!!userId}
      onOpenChange={(o) => !o && onClose()}
      title={u?.displayName ?? ""}
      description={u ? `@${u.username} · ${u.email}` : undefined}
      leading={u ? <PersonAvatar user={u} size="lg" /> : undefined}
      loading={q.isPending}
      error={q.error}
      onRetry={() => void q.refetch()}
      testId="user-sheet"
    >
      {u && can ? (
        <>
          <DetailSection title="Account">
            <FactList
              items={[
                { label: "Status", value: <StatusText tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}{u.status === "SUSPENDED" && u.suspendedUntil ? ` until ${shortDate(u.suspendedUntil)}` : ""}</StatusText> },
                { label: "Role", value: ROLE_LABEL[u.role] },
                { label: "Joined", value: <span title={fullTimestamp(u.createdAt)}>{shortDate(u.createdAt)}</span> },
                { label: "Last seen", value: u.lastSeenAt ? <span title={fullTimestamp(u.lastSeenAt)}>{shortDate(u.lastSeenAt)}</span> : "Never" },
              ]}
            />
          </DetailSection>

          <DetailSection title="Tier">
            <Select
              aria-label="Quota tier"
              value={u.quotaTier?.id ?? DEFAULT_TIER}
              onValueChange={(v) => tier.mutate(v === DEFAULT_TIER ? null : v)}
              disabled={can.erased || tier.isPending}
              options={[
                { value: DEFAULT_TIER, label: `Whichever tier is the default${defaultName(tiers)}` },
                ...tiers.map((t) => ({ value: t.id, label: t.name })),
              ]}
              data-testid="user-tier"
            />
            <TierLimits tier={u.quotaTier ? tiers.find((t) => t.id === u.quotaTier!.id) : tiers.find((t) => t.isDefault)} />
          </DetailSection>

          <DetailSection
            title="Own limits"
            action={
              u.override ? (
                <Button variant="link" size="sm" className="text-[13px] text-danger" onClick={() => setDialog("removeOverride")} data-testid="override-remove">
                  Remove
                </Button>
              ) : null
            }
          >
            <OverrideEditor user={u} disabled={can.erased} onSaved={(d) => qc.setQueryData(ak.user(d.id), d)} />
          </DetailSection>

          <DetailSection
            title="Last 30 days"
            action={
              <Button asChild variant="link" size="sm" className="text-[13px]">
                <Link href={`/admin/interviews?user=${encodeURIComponent(u.id)}`} data-testid="user-interviews-link">
                  See their interviews
                </Link>
              </Button>
            }
          >
            {u.usage.some((d) => d.interviews > 0 || d.voiceMinutes > 0) ? (
              <Chart
                data={u.usage}
                series={[
                  { key: "voiceMinutes", label: "Voice minutes", tone: "primary" },
                  { key: "interviews", label: "Interviews", tone: "muted" },
                ]}
                type="bar"
                height={150}
                title="Voice minutes and interviews per day, last 30 days"
                testId="user-usage"
              />
            ) : (
              <p className="text-[13.5px] text-muted-foreground">No usage in the last 30 days.</p>
            )}
            <FactList
              className="mt-4"
              items={[
                { label: "Interviews this month", value: formatCount(u.interviewsThisMonth) },
                { label: "Voice this month", value: formatMinutes(u.voiceMinutesThisMonth) },
                { label: "Interviews in total", value: formatCount(u.totals.interviews) },
                { label: "Completed", value: formatCount(u.totals.completedInterviews) },
                { label: "Answers", value: formatCount(u.totals.answers) },
                { label: "Voice in total", value: formatMinutes(u.totals.voiceMinutes) },
              ]}
            />
          </DetailSection>

          <DetailSection title="Access">
            {can.self ? (
              <p className="text-[13.5px] text-muted-foreground">This is your account. Another admin can change its role or access.</p>
            ) : can.erased ? (
              <p className="text-[13.5px] text-muted-foreground">This account was erased. Nothing else can be done with it.</p>
            ) : (
              <div>
                {can.makeAdmin ? <LineItem title="Make admin" description="Opens this control plane to them." control={<Button variant="outline" size="sm" onClick={() => setDialog("makeAdmin")} data-testid="user-make-admin">Make admin</Button>} /> : null}
                {can.removeAdmin ? <LineItem title="Remove admin" description="Signs them out of the admin area at once." control={<Button variant="outline" size="sm" onClick={() => setDialog("removeAdmin")} data-testid="user-remove-admin">Remove admin</Button>} /> : null}
                {can.suspend ? <LineItem title="Suspend" description="Read-only for a number of days: they can sign in and read their reports but not start or continue an interview." control={<Button variant="outline" size="sm" onClick={() => setDialog("suspend")} data-testid="user-suspend">Suspend</Button>} /> : null}
                {can.unsuspend ? <LineItem title="Lift the suspension" description={u.suspendedUntil ? `Ends on its own on ${shortDate(u.suspendedUntil)}.` : undefined} control={<Button variant="outline" size="sm" onClick={() => setDialog("unsuspend")} data-testid="user-unsuspend">Unsuspend</Button>} /> : null}
                {can.ban ? <LineItem title="Ban" description="Signs them out everywhere and revokes their shared links." control={<Button variant="danger-ghost" size="sm" onClick={() => setDialog("ban")} data-testid="user-ban">Ban</Button>} /> : null}
                {can.unban ? <LineItem title="Unban" description="They can sign in again. Revoked links stay revoked." control={<Button variant="outline" size="sm" onClick={() => setDialog("unban")} data-testid="user-unban">Unban</Button>} /> : null}
                {can.erase ? <LineItem title="Erase" description="Deletes every interview, answer, transcript and shared link, and anonymises the account. This cannot be undone." control={<Button variant="danger-ghost" size="sm" onClick={() => setDialog("erase")} data-testid="user-erase">Erase</Button>} /> : null}
                {u.role === "ADMIN" ? <p className="pt-3 text-[13px] text-muted-foreground">Admins cannot be suspended, banned or erased. Remove admin first.</p> : null}
              </div>
            )}
          </DetailSection>

          <ConfirmDialog
            open={dialog === "makeAdmin" || dialog === "removeAdmin"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={dialog === "makeAdmin" ? `Make ${u.displayName} an admin?` : `Remove admin from ${u.displayName}?`}
            description={dialog === "makeAdmin" ? "They will see every account, the model catalogue and the settings. Never anyone's transcripts or answers." : "They keep their account and interviews, and lose the admin area right away."}
            confirmLabel={dialog === "makeAdmin" ? "Make admin" : "Remove admin"}
            destructive={dialog === "removeAdmin"}
            onConfirm={() => role.mutateAsync(dialog === "makeAdmin" ? "ADMIN" : "USER")}
          />
          <ConfirmDialog
            open={dialog === "unsuspend" || dialog === "unban"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={dialog === "unsuspend" ? `Lift ${u.displayName}'s suspension?` : `Unban ${u.displayName}?`}
            description={dialog === "unsuspend" ? "They can start interviews again right away." : "They can sign in again."}
            confirmLabel={dialog === "unsuspend" ? "Unsuspend" : "Unban"}
            onConfirm={() => simple.mutateAsync(dialog === "unsuspend" ? "unsuspend" : "unban")}
          />
          <ConfirmDialog
            open={dialog === "removeOverride"}
            onOpenChange={(o) => !o && setDialog(null)}
            title="Remove their own limits?"
            description="They go back to the limits of their tier."
            confirmLabel="Remove"
            destructive
            onConfirm={async () => {
              try {
                qc.setQueryData(ak.user(u.id), await api().admin.setQuota(u.id, null));
              } catch (e) {
                toast.error({ title: adminErrorMessage(e) });
                throw e;
              }
            }}
          />
          <ReasonDialog
            open={dialog === "suspend"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={`Suspend ${u.displayName}`}
            description="They can read their reports but not start or continue an interview until it ends."
            confirmLabel="Suspend"
            days={7}
            maxDays={365}
            reason="optional"
            onConfirm={async ({ days, reason }) => applyRow(await api().admin.suspend(u.id, days, reason || undefined))}
            testId="suspend-dialog"
          />
          <ReasonDialog
            open={dialog === "ban"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={`Ban ${u.displayName}`}
            description="They are signed out everywhere and their shared links stop working."
            confirmLabel="Ban"
            destructive
            reason="optional"
            onConfirm={async ({ reason }) => applyRow(await api().admin.ban(u.id, reason || undefined))}
            testId="ban-dialog"
          />
          <ReasonDialog
            open={dialog === "erase"}
            onOpenChange={(o) => !o && setDialog(null)}
            title={`Erase ${u.displayName}`}
            description="Every interview, answer, transcript and shared link is deleted now and the account is anonymised. This cannot be undone."
            confirmLabel="Erase account"
            destructive
            reason="required"
            typeToConfirm={u.username}
            onConfirm={async ({ reason }) => {
              await api().admin.erase(u.id, reason);
              await q.refetch();
              refreshLists();
              toast.success({ title: "Account erased" });
            }}
            testId="erase-dialog"
          />
        </>
      ) : null}
    </DetailSheet>
  );
}

const defaultName = (tiers: QuotaTier[]) => {
  const d = tiers.find((t) => t.isDefault);
  return d ? ` (${d.name})` : "";
};

function TierLimits({ tier }: { tier: QuotaTier | undefined }) {
  if (!tier) return null;
  return (
    <p className="mt-2 text-[13px] text-muted-foreground">
      {limitLabel(tier.monthlyInterviews)} interviews and {limitLabel(tier.monthlyVoiceMinutes).toLowerCase()} voice minutes a month, sessions up to {tier.maxSessionMinutes} minutes.
    </p>
  );
}

function OverrideEditor({ user, disabled, onSaved }: { user: AdminUserDetail; disabled: boolean; onSaved: (d: AdminUserDetail) => void }) {
  const id = useId();
  const o = user.override;
  const init = () => ({ interviews: limitText(o?.monthlyInterviews), minutes: limitText(o?.monthlyVoiceMinutes), note: o?.note ?? "" });
  const [draft, setDraft] = useState(init);
  // Reset when the saved override changes (another save, a removal).
  useEffect(() => setDraft(init()), [o?.updatedAt, user.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const interviews = parseLimit(draft.interviews);
  const minutes = parseLimit(draft.minutes);
  const dirty = JSON.stringify(draft) !== JSON.stringify(init());
  const valid = interviews !== undefined && minutes !== undefined && draft.note.length <= 300;
  const save = useMutation({
    mutationFn: () => api().admin.setQuota(user.id, { monthlyInterviews: interviews ?? null, monthlyVoiceMinutes: minutes ?? null, note: draft.note.trim() || null }),
    ...adminMutation(),
    onSuccess: (d) => {
      onSaved(d);
      toast.success({ title: "Limits saved" });
    },
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && dirty) save.mutate();
      }}
      data-testid="override-form"
    >
      <p className="text-[13px] text-muted-foreground">Limits for this account only, on top of the tier. Leave a field empty to use the tier&apos;s limit.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Interviews a month" htmlFor={`${id}-i`} error={interviews === undefined ? "Use a whole number." : undefined}>
          <Input id={`${id}-i`} inputMode="numeric" placeholder="Tier limit" value={draft.interviews} onChange={(e) => setDraft((d) => ({ ...d, interviews: e.target.value }))} disabled={disabled} data-testid="override-interviews" />
        </Field>
        <Field label="Voice minutes a month" htmlFor={`${id}-m`} error={minutes === undefined ? "Use a whole number." : undefined}>
          <Input id={`${id}-m`} inputMode="numeric" placeholder="Tier limit" value={draft.minutes} onChange={(e) => setDraft((d) => ({ ...d, minutes: e.target.value }))} disabled={disabled} data-testid="override-voice-minutes" />
        </Field>
      </div>
      <Field label="Note" htmlFor={`${id}-n`} optional hint="Why this account has its own limits. Only admins see it.">
        <Textarea id={`${id}-n`} rows={2} maxLength={300} value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} disabled={disabled} data-testid="override-note" />
      </Field>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-subtle-foreground">{o ? `Last changed ${shortDate(o.updatedAt)}` : "No own limits yet."}</p>
        <Button type="submit" size="sm" disabled={!dirty || !valid || disabled} loading={save.isPending} data-testid="override-save">
          Save limits
        </Button>
      </div>
    </form>
  );
}
