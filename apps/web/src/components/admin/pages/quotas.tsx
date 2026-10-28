"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TierInput } from "@open-conversation/api-client";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Field, IconButton, Input, Switch, toast } from "@open-conversation/ui";
import { MoreHorizontal } from "lucide-react";
import type { QuotaTier } from "@open-conversation/types";
import { api } from "@/lib/api";
import { adminErrorMessage, formatCount, limitLabel, limitText, parseLimit } from "@/lib/admin";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { AdminPage, DataTable, Dot, type Column } from "../shell";
import { adminMutation, ak } from "./common";

export function AdminQuotas() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ak.tiers, queryFn: () => api().admin.tiers() });
  const [editing, setEditing] = useState<QuotaTier | "new" | null>(null);
  const [deleting, setDeleting] = useState<QuotaTier | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api().admin.deleteTier(id),
    ...adminMutation(),
    onSuccess: (list) => {
      qc.setQueryData(ak.tiers, list);
      void qc.invalidateQueries({ queryKey: ak.usersPrefix });
      toast.success({ title: "Tier deleted" });
    },
  });
  const columns = useMemo<Column<QuotaTier>[]>(
    () => [
      {
        key: "name",
        header: "Tier",
        cell: (t) => (
          <span className="inline-flex items-center gap-2">
            <span className="font-medium text-foreground">{t.name}</span>
            {t.isDefault ? (
              <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <Dot tone="primary" /> Default
              </span>
            ) : null}
          </span>
        ),
        sortValue: (t) => t.name,
      },
      { key: "interviews", header: "Interviews a month", align: "right", cell: (t) => limitLabel(t.monthlyInterviews), sortValue: (t) => t.monthlyInterviews ?? Number.MAX_SAFE_INTEGER },
      { key: "minutes", header: "Voice minutes a month", align: "right", cell: (t) => limitLabel(t.monthlyVoiceMinutes), sortValue: (t) => t.monthlyVoiceMinutes ?? Number.MAX_SAFE_INTEGER, hideBelow: "sm" },
      { key: "session", header: "Longest session", align: "right", cell: (t) => `${t.maxSessionMinutes} min`, sortValue: (t) => t.maxSessionMinutes, hideBelow: "md" },
      { key: "users", header: "Users", align: "right", cell: (t) => formatCount(t.userCount), sortValue: (t) => t.userCount, hideBelow: "sm" },
      {
        key: "menu",
        header: <span className="sr-only">Actions</span>,
        align: "right",
        className: "w-10",
        cell: (t) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label={`Actions for ${t.name}`} size="sm" data-testid={`tier-menu-${t.name}`}>
                <MoreHorizontal />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(t)}>Edit</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDeleting(t)} disabled={t.isDefault} className="text-danger">
                {t.isDefault ? "Default tier cannot be deleted" : "Delete"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [],
  );
  return (
    <AdminPage
      title="Quotas"
      description="Monthly allowances per tier, counted in UTC calendar months, and the longest a single live session may run. Every account is on the default tier unless you move it."
      actions={
        <Button onClick={() => setEditing("new")} data-testid="tier-add">
          Add tier
        </Button>
      }
      testId="admin-quotas"
    >
      <DataTable
        caption="Quota tiers"
        rows={q.data ?? []}
        columns={columns}
        rowKey={(t) => t.id}
        onRowClick={(t) => setEditing(t)}
        loading={q.isPending}
        error={q.error}
        onRetry={() => void q.refetch()}
        skeletonRows={3}
        empty={{ title: "No tiers yet." }}
        rowTestId={(t) => `tier-row-${t.name}`}
        testId="tiers-table"
      />
      <p className="mt-4 text-[13px] text-muted-foreground">To give one account its own limits, open it on the Users page.</p>
      <TierDialog value={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete the ${deleting?.name ?? ""} tier?`}
        description={deleting?.userCount ? `Its ${formatCount(deleting.userCount)} ${deleting.userCount === 1 ? "account moves" : "accounts move"} to the default tier.` : "No accounts use it."}
        confirmLabel="Delete tier"
        destructive
        onConfirm={() => del.mutateAsync(deleting!.id)}
      />
    </AdminPage>
  );
}

/** Field errors for a tier draft, matching the API's limits. */
type TierDraft = { name: string; interviews: string; minutes: string; maxSessionMinutes: string };

export function tierDraftErrors(d: TierDraft): Partial<Record<keyof TierDraft, string>> {
  const e: Partial<Record<keyof TierDraft, string>> = {};
  if (!d.name.trim()) e.name = "Give the tier a name.";
  else if (d.name.trim().length > 60) e.name = "Use 60 characters or fewer.";
  if (parseLimit(d.interviews) === undefined) e.interviews = "Use a whole number, or leave it empty for unlimited.";
  if (parseLimit(d.minutes) === undefined) e.minutes = "Use a whole number, or leave it empty for unlimited.";
  const max = Number(d.maxSessionMinutes);
  if (!/^\d+$/.test(d.maxSessionMinutes.trim()) || max < 1 || max > 120) e.maxSessionMinutes = "Between 1 and 120 minutes.";
  return e;
}

const BLANK = { name: "", interviews: "", minutes: "", maxSessionMinutes: "30", isDefault: false };

function TierDialog({ value, onClose }: { value: QuotaTier | "new" | null; onClose: () => void }) {
  const id = useId();
  const qc = useQueryClient();
  const existing = value && value !== "new" ? value : null;
  const [d, setD] = useState(BLANK);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!value) return;
    setError(null);
    setD(
      existing
        ? { name: existing.name, interviews: limitText(existing.monthlyInterviews), minutes: limitText(existing.monthlyVoiceMinutes), maxSessionMinutes: String(existing.maxSessionMinutes), isDefault: existing.isDefault }
        : BLANK,
    );
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const errs = tierDraftErrors(d);
  const ok = Object.keys(errs).length === 0;
  const save = useMutation({
    mutationFn: () => {
      const body: TierInput = {
        name: d.name.trim(),
        monthlyInterviews: parseLimit(d.interviews) ?? null,
        monthlyVoiceMinutes: parseLimit(d.minutes) ?? null,
        maxSessionMinutes: Number(d.maxSessionMinutes),
        isDefault: d.isDefault,
      };
      return existing ? api().admin.updateTier(existing.id, body) : api().admin.createTier(body);
    },
    ...adminMutation({ inline: true }),
    onError: (e) => setError(adminErrorMessage(e)),
    onSuccess: (list) => {
      qc.setQueryData(ak.tiers, list);
      void qc.invalidateQueries({ queryKey: ak.usersPrefix });
      toast.success({ title: existing ? "Tier saved" : "Tier added" });
      onClose();
    },
  });
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent size="md" data-testid="tier-dialog">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok) save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{existing ? `Edit ${existing.name}` : "Add a tier"}</DialogTitle>
            <DialogDescription>Leave a limit empty for unlimited.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field label="Name" htmlFor={`${id}-name`} error={d.name ? errs.name : undefined}>
              <Input id={`${id}-name`} value={d.name} maxLength={60} onChange={(e) => setD((x) => ({ ...x, name: e.target.value }))} data-testid="tier-name" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Interviews a month" htmlFor={`${id}-i`} error={errs.interviews}>
                <Input id={`${id}-i`} inputMode="numeric" placeholder="Unlimited" value={d.interviews} onChange={(e) => setD((x) => ({ ...x, interviews: e.target.value }))} data-testid="tier-interviews" />
              </Field>
              <Field label="Voice minutes a month" htmlFor={`${id}-m`} error={errs.minutes}>
                <Input id={`${id}-m`} inputMode="numeric" placeholder="Unlimited" value={d.minutes} onChange={(e) => setD((x) => ({ ...x, minutes: e.target.value }))} data-testid="tier-voice-minutes" />
              </Field>
            </div>
            <Field label="Longest live session, in minutes" htmlFor={`${id}-s`} error={errs.maxSessionMinutes} hint="The server ends a session and books its minutes after this long.">
              <Input id={`${id}-s`} inputMode="numeric" value={d.maxSessionMinutes} onChange={(e) => setD((x) => ({ ...x, maxSessionMinutes: e.target.value }))} className="w-32" data-testid="tier-max-session" />
            </Field>
            <label className="flex items-center justify-between gap-4 border-t border-border pt-4 text-[14px]">
              <span>
                <span className="font-medium">Default tier</span>
                <span className="block text-[13px] text-muted-foreground">
                  {existing?.isDefault ? "To change the default, make another tier the default." : "New accounts and accounts without a tier use it. There is always exactly one default."}
                </span>
              </span>
              <Switch checked={d.isDefault} onCheckedChange={(v) => setD((x) => ({ ...x, isDefault: v }))} disabled={!!existing?.isDefault} data-testid="tier-default" />
            </label>
            {error ? (
              <p role="alert" className="text-[13px] font-medium text-danger">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ok} loading={save.isPending} data-testid="tier-save">
              {existing ? "Save" : "Add tier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
