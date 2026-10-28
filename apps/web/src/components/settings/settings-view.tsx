"use client";

/**
 * Settings: how your interviews run (voice model, voice, transcription language,
 * proctoring), the links you shared, how the app looks, and the account (profile,
 * security, your data).
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight } from "lucide-react";
import type { Preferences, ShareSummary } from "@open-conversation/types";
import { Button, Input, NativeSelect, Skeleton, Switch, toast } from "@open-conversation/ui";
import { PrivacySection } from "@/components/account/privacy-section";
import { SecuritySection } from "@/components/account/security-section";
import { PageBar } from "@/components/app/app-shell";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/states";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { api } from "@/lib/api";
import { useAuth, useMe } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { usePreferences, useRealtimeModels, useShares, useUsage } from "@/lib/interviews/queries";
import { useAppMeta } from "@/lib/meta";
import { qk } from "@/lib/query-keys";
import { useTheme, type ThemePref } from "@/lib/stores/theme";
import { effectiveModel, effectiveVoice, expiryLabel, languageOptions, modelPatch, viewsLabel, voiceLabel } from "./settings-lib";

type Tab = "interviews" | "shares" | "appearance" | "account";
const TABS: { value: Tab; label: string }[] = [
  { value: "interviews", label: "Interviews" },
  { value: "shares", label: "Shared links" },
  { value: "appearance", label: "Appearance" },
  { value: "account", label: "Account" },
];

function Row({ title, description, htmlFor, children, testId }: { title: string; description?: React.ReactNode; htmlFor?: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border py-5 sm:flex-row sm:items-center sm:justify-between" data-testid={testId}>
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-[14.5px] font-medium">
            {title}
          </label>
        ) : (
          <p className="text-[14.5px] font-medium">{title}</p>
        )}
        {description ? <p className="mt-0.5 max-w-md text-[13.5px] text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Saves a preference change, showing it at once and rolling back if the server says no. */
function usePrefsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Preferences>) => api().me.updatePreferences(patch),
    meta: { silent: true },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.preferences });
      const prev = qc.getQueryData<Preferences>(qk.preferences);
      qc.setQueryData<Preferences>(qk.preferences, (p) => (p ? { ...p, ...patch } : p));
      return { prev };
    },
    onSuccess: (p) => qc.setQueryData(qk.preferences, p),
    onError: (e, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.preferences, ctx.prev);
      toast.error({ title: errorMessage(e) });
    },
  });
}

function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-6 border-b border-border py-5">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5 w-64 max-w-full" />
          </div>
          <Skeleton className="h-10 w-48" />
        </div>
      ))}
    </div>
  );
}

// ─── Interviews ─────────────────────────────────────────────────────────────

function InterviewPreferences() {
  const prefs = usePreferences();
  const models = useRealtimeModels();
  const usage = useUsage();
  const meta = useAppMeta();
  const save = usePrefsMutation();
  const p = prefs.data;
  if (prefs.isError && !p) return <ErrorState error={prefs.error} onRetry={() => void prefs.refetch()} compact className="py-5" />;
  if (!p || models.isPending) return <RowsSkeleton />;
  const list = models.data ?? [];
  const model = effectiveModel(list, p);
  const voice = effectiveVoice(model, p.voice);
  const fallback = list.find((m) => m.isDefault) ?? list[0];
  const interviewer = meta.data?.interviewerName ?? "The interviewer";
  const u = usage.data;

  return (
    <div data-testid="settings-interviews">
      <Row title="Voice model" htmlFor="pref-model" description="Runs the live interview. You can still pick another one when you start.">
        {list.length ? (
          <NativeSelect
            id="pref-model"
            value={p.defaultRealtimeModelId && list.some((m) => m.id === p.defaultRealtimeModelId) ? p.defaultRealtimeModelId : ""}
            onChange={(e) => save.mutate(modelPatch(list, e.target.value || null, p.voice))}
            className="w-64"
            data-testid="pref-model"
          >
            <option value="">{fallback ? `The default (${fallback.displayName})` : "The default"}</option>
            {list.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <p className="text-[13.5px] text-muted-foreground">No voice models are set up yet.</p>
        )}
      </Row>
      {model && model.voices.length ? (
        <Row title="Voice" htmlFor="pref-voice" description={`How ${interviewer} sounds. The voices offered by ${model.displayName}.`}>
          <NativeSelect id="pref-voice" value={voice} onChange={(e) => save.mutate({ voice: e.target.value })} className="w-64" data-testid="pref-voice">
            {model.voices.map((v) => (
              <option key={v} value={v}>
                {voiceLabel(v)}
              </option>
            ))}
          </NativeSelect>
        </Row>
      ) : null}
      <Row title="Transcription language" htmlFor="pref-language" description="The language you answer in, for the transcript and the scoring. Detecting it works for most people.">
        <NativeSelect id="pref-language" value={p.transcriptionLanguage} onChange={(e) => save.mutate({ transcriptionLanguage: e.target.value })} className="w-64" data-testid="pref-language">
          {languageOptions(p.transcriptionLanguage).map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </NativeSelect>
      </Row>
      {meta.data?.features.proctoring !== false ? (
        <Row title="Proctoring on by default" description="New interviews start with camera and tab checks turned on. What they notice appears only in your own report.">
          <Switch checked={p.proctoringDefault} onCheckedChange={(v) => save.mutate({ proctoringDefault: v })} aria-label="Proctoring on by default" data-testid="pref-proctoring" />
        </Row>
      ) : null}
      {u ? (
        <Row title="This month" description={`Resets on ${new Date(u.resetsAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })}. A live session runs up to ${u.maxSessionMinutes} minutes.`} testId="settings-usage">
          <div className="text-right text-[13.5px] tabular-nums">
            <p>{u.interviews.limit === null ? `${u.interviews.used.toLocaleString()} interviews` : `${u.interviews.used.toLocaleString()} of ${u.interviews.limit.toLocaleString()} interviews`}</p>
            <p className="text-muted-foreground">
              {u.voiceMinutes.limit === null ? `${u.voiceMinutes.used.toLocaleString()} voice minutes` : `${u.voiceMinutes.used.toLocaleString()} of ${u.voiceMinutes.limit.toLocaleString()} voice minutes`}
            </p>
          </div>
        </Row>
      ) : null}
    </div>
  );
}

// ─── Shared links ───────────────────────────────────────────────────────────

function SharedLinks() {
  const qc = useQueryClient();
  const shares = useShares();
  const [revoking, setRevoking] = useState<ShareSummary | null>(null);
  const revoke = async (s: ShareSummary) => {
    // Instant: the row leaves now and comes back if the server refuses.
    const prev = qc.getQueryData<ShareSummary[]>(qk.shares);
    qc.setQueryData<ShareSummary[]>(qk.shares, (list) => list?.filter((x) => x.id !== s.id));
    try {
      await api().shares.revoke(s.id);
      toast.success({ title: "Link revoked" });
    } catch (e) {
      qc.setQueryData(qk.shares, prev);
      toast.error({ title: errorMessage(e) });
    }
  };
  return (
    <div className="py-5" data-testid="settings-shares">
      <p className="text-[14.5px] font-medium">Shared links</p>
      <p className="mt-0.5 max-w-xl text-[13.5px] text-muted-foreground">Anyone with a link can read that report. Transcripts are included only where you chose to include them.</p>
      {shares.isError && !shares.data ? (
        <ErrorState error={shares.error} onRetry={() => void shares.refetch()} compact className="mt-3" />
      ) : !shares.data ? (
        <div className="mt-3 space-y-2" aria-busy>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border border-y border-border" data-testid="shares-list">
          {shares.data.map((s) => (
            <li key={s.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:gap-3" data-testid={`share-${s.id}`}>
              <div className="min-w-0 flex-1">
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-[14.5px] font-medium hover:underline">
                  <span className="truncate">{s.interviewTitle || "Untitled interview"}</span>
                  <ArrowUpRight className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden />
                </a>
                <p className="text-[13px] text-muted-foreground">
                  {[s.includeTranscript ? "Transcript included" : "Scores only, no transcript", viewsLabel(s.viewCount), expiryLabel(s)].join(" · ")}
                </p>
              </div>
              <Button size="sm" variant="ghost" className="self-start sm:self-center" onClick={() => setRevoking(s)} data-testid={`share-revoke-${s.id}`}>
                Revoke
              </Button>
            </li>
          ))}
          {!shares.data.length ? <li className="py-3 text-[14px] text-subtle-foreground">No shared links. Share a report from its page.</li> : null}
        </ul>
      )}
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke this link?"
        description={revoking ? `The link to "${revoking.interviewTitle || "Untitled interview"}" stops working for everyone. The interview and its report stay with you.` : undefined}
        confirmLabel="Revoke link"
        destructive
        onConfirm={() => {
          const s = revoking!;
          setRevoking(null);
          return revoke(s);
        }}
      />
    </div>
  );
}

// ─── Appearance ─────────────────────────────────────────────────────────────

function Appearance() {
  const { pref, setPref } = useTheme();
  return (
    <div data-testid="settings-appearance">
      <Row title="Theme" htmlFor="pref-theme" description="System follows your device's light or dark setting. Saved on this device only.">
        <NativeSelect id="pref-theme" value={pref} onChange={(e) => setPref(e.target.value as ThemePref)} className="w-40" data-testid="pref-theme">
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </NativeSelect>
      </Row>
    </div>
  );
}

// ─── Account ────────────────────────────────────────────────────────────────

function Profile() {
  const me = useMe();
  const { setUser } = useAuth();
  const [name, setName] = useState(me.displayName);
  useEffect(() => setName(me.displayName), [me.displayName]);
  const save = useMutation({
    mutationFn: () => api().users.updateMe({ displayName: name.trim() }),
    meta: { silent: true },
    onSuccess: (u) => {
      setUser(u);
      toast.success({ title: "Name saved" });
    },
    onError: (e) => toast.error({ title: errorMessage(e) }),
  });
  const dirty = !!name.trim() && name.trim() !== me.displayName;
  return (
    <form
      className="border-b border-border pb-8"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) save.mutate();
      }}
      data-testid="settings-profile"
    >
      <h2 className="font-display text-[20px] font-semibold tracking-[-0.01em]">Profile</h2>
      <p className="mt-1 max-w-[620px] text-[14px] text-muted-foreground">
        Your name appears in the room and on your reports, including shared ones. You sign in as <span className="text-foreground">{me.email}</span>.
      </p>
      <label htmlFor="profile-name" className="mt-5 block text-[13px] font-medium">
        Display name
      </label>
      <div className="mt-1.5 flex gap-2">
        <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="name" className="max-w-xs" data-testid="profile-name" />
        <Button type="submit" variant="outline" disabled={!dirty} loading={save.isPending} data-testid="profile-save">
          Save
        </Button>
      </div>
    </form>
  );
}

export function SettingsView() {
  const [tab, setTab] = useState<Tab>("interviews");
  return (
    <div>
      <PageBar />
      <div className="mx-auto w-full max-w-[860px] px-4 pb-20 sm:px-6">
        <h1 className="font-display text-[30px] font-semibold tracking-[-0.02em]">Settings</h1>
        <UnderlineTabs tabs={TABS} value={tab} onChange={setTab} label="Settings sections" className="mt-6" />
        <div role="tabpanel" aria-label={TABS.find((t) => t.value === tab)?.label} className="mt-2">
          {tab === "interviews" ? <InterviewPreferences /> : null}
          {tab === "shares" ? <SharedLinks /> : null}
          {tab === "appearance" ? <Appearance /> : null}
          {tab === "account" ? (
            <div className="pt-6">
              <Profile />
              <div className="pt-8">
                <SecuritySection />
              </div>
              <div className="pt-10">
                <PrivacySection />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
