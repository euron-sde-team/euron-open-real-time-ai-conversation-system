"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AdminStats } from "@open-conversation/types";
import { api } from "@/lib/api";
import { RANGE_PRESETS, formatCompact, formatCount, formatMinutes, formatUsd, parsePreset, presetRange, scoreLabel, type RangePreset } from "@/lib/admin";
import { qk } from "@/lib/query-keys";
import { ErrorState } from "@/components/common/states";
import { UnderlineTabs } from "@/components/common/underline-tabs";
import { AdminPage, AdminSection, Chart, DataTable, StatLine, useUrlState, type Column, type StatItem } from "../shell";

type ModelRow = AdminStats["byModel"][number];

export function AdminOverview() {
  const url = useUrlState();
  const preset = parsePreset(url.get("range"));
  const range = useMemo(() => presetRange(preset), [preset]);
  const q = useQuery({
    queryKey: qk.admin.list("stats", range),
    queryFn: () => api().admin.stats(range),
    placeholderData: (p) => p,
  });
  const s = q.data;

  return (
    <AdminPage
      title="Overview"
      description="Accounts, interviews and voice time across the deployment. Days are counted in UTC. Costs are estimates from the prices on the Models page."
      filters={
        <UnderlineTabs<`${RangePreset}`>
          tabs={RANGE_PRESETS.map((d) => ({ value: `${d}` as const, label: `Last ${d} days` }))}
          value={`${preset}`}
          onChange={(v) => url.set({ range: v === "30" ? null : v })}
          label="Date range"
        />
      }
      testId="admin-overview"
    >
      {q.isError && !s ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className={q.isPlaceholderData ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <StatLine loading={!s} size="lg" items={totals(s)} testId="overview-totals" />
          <AdminSection title="By day" id="daily" className="mt-10">
            {s ? (
              <Chart
                data={s.daily}
                series={[
                  { key: "interviews", label: "Interviews", tone: "primary" },
                  { key: "voiceMinutes", label: "Voice minutes", tone: "muted" },
                ]}
                title="Interviews and voice minutes per day"
                testId="overview-chart"
              />
            ) : (
              <div className="h-[240px] animate-shimmer rounded-md bg-muted" aria-hidden />
            )}
          </AdminSection>
          <ByModel stats={s} />
        </div>
      )}
    </AdminPage>
  );
}

function totals(s: AdminStats | undefined): StatItem[] {
  const t = s?.totals;
  const v = (x: number | undefined) => (x === undefined ? "" : formatCount(x));
  return [
    { label: "Users", value: v(t?.users), testId: "stat-users" },
    { label: "Active users", value: v(t?.activeUsers), testId: "stat-active" },
    { label: "Interviews", value: v(t?.interviews), testId: "stat-interviews" },
    { label: "Completed", value: v(t?.completedInterviews), testId: "stat-completed" },
    { label: "Answers", value: v(t?.answers), testId: "stat-answers" },
    { label: "Voice minutes", value: t ? formatMinutes(t.voiceMinutes) : "", testId: "stat-voice" },
    { label: "Estimated cost", value: t ? formatUsd(t.estimatedCostUsd) : "", testId: "stat-cost" },
    { label: "Average score", value: s ? scoreLabel(s.averageScore) : "", testId: "stat-score" },
  ];
}

function ByModel({ stats }: { stats: AdminStats | undefined }) {
  const columns = useMemo<Column<ModelRow>[]>(
    () => [
      { key: "model", header: "Model", cell: (r) => <span className="font-medium text-foreground">{r.displayName}</span>, sortValue: (r) => r.displayName },
      { key: "kind", header: "Kind", cell: (r) => <span className="text-muted-foreground">{r.kind === "REALTIME" ? "Voice" : "Text"}</span>, sortValue: (r) => r.kind, hideBelow: "sm" },
      { key: "calls", header: "Calls", align: "right", cell: (r) => formatCount(r.calls), sortValue: (r) => r.calls },
      { key: "in", header: "Input tokens", align: "right", cell: (r) => formatCompact(r.inputTokens), sortValue: (r) => r.inputTokens, hideBelow: "md" },
      { key: "out", header: "Output tokens", align: "right", cell: (r) => formatCompact(r.outputTokens), sortValue: (r) => r.outputTokens, hideBelow: "md" },
      { key: "voice", header: "Voice minutes", align: "right", cell: (r) => (r.kind === "REALTIME" ? formatMinutes(r.voiceMinutes) : <span className="text-subtle-foreground">None</span>), sortValue: (r) => r.voiceMinutes, hideBelow: "sm" },
      { key: "cost", header: "Estimated cost", align: "right", cell: (r) => formatUsd(r.estimatedCostUsd), sortValue: (r) => r.estimatedCostUsd },
    ],
    [],
  );
  return (
    <AdminSection title="Usage by model" description="Text calls write plans and score answers; voice calls are live interview sessions." id="by-model" className="mt-10">
      <DataTable
        caption="Usage by model"
        rows={stats?.byModel ?? []}
        columns={columns}
        rowKey={(r) => r.modelId}
        loading={!stats}
        skeletonRows={4}
        empty={{ title: "No model calls in this range." }}
        testId="overview-by-model"
      />
    </AdminSection>
  );
}
