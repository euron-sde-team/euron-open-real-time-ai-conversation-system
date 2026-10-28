"use client";

import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { flattenPages, nextCursor } from "@open-conversation/api-client";
import { Button } from "@open-conversation/ui";
import type { AdminInterviewRow, InterviewStatus } from "@open-conversation/types";
import { api } from "@/lib/api";
import { INTERVIEW_SOURCE_LABEL, INTERVIEW_STATUS_LABEL, INTERVIEW_STATUS_TONE, formatCount, formatMinutes, scoreLabel, shortDate } from "@/lib/admin";
import { AdminPage, DataTable, FilterBar, StatusText, useUrlState, type Column } from "../shell";
import { ak, PersonAvatar } from "./common";

const STATUS_TABS: { value: "all" | InterviewStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "READY", label: "Ready" },
  { value: "PLANNING", label: "Planning" },
  { value: "PLAN_FAILED", label: "Plan failed" },
];

const isStatus = (v: string): v is InterviewStatus => STATUS_TABS.some((t) => t.value === v && v !== "all");

/** Every interview on the deployment, as metadata only. Transcripts, answers and feedback stay with their owner. */
export function AdminInterviews() {
  const url = useUrlState();
  const q = url.get("q");
  const statusParam = url.get("status");
  const status = isStatus(statusParam) ? statusParam : undefined;
  const userId = url.get("user") || undefined;
  const setUrl = url.set;
  const f = { q, status, userId };

  const list = useInfiniteQuery({
    queryKey: ak.interviews(f),
    queryFn: ({ pageParam }) => api().admin.interviews({ q: q || undefined, status, userId, cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    placeholderData: (p) => p,
  });
  const rows = flattenPages(list.data?.pages);

  const columns = useMemo<Column<AdminInterviewRow>[]>(
    () => [
      {
        key: "title",
        header: "Interview",
        cell: (r) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{r.title || "Untitled"}</p>
            <p className="truncate text-[12.5px] text-muted-foreground">{INTERVIEW_SOURCE_LABEL[r.source]}</p>
          </div>
        ),
        className: "max-w-[220px] sm:max-w-[320px]",
      },
      {
        key: "owner",
        header: "Owner",
        cell: (r) => (
          <button
            type="button"
            onClick={() => setUrl({ user: r.owner.id })}
            className="flex min-w-0 items-center gap-2 rounded-md text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={`Show only ${r.owner.displayName}'s interviews`}
          >
            <PersonAvatar user={r.owner} size="xs" />
            <span className="truncate text-muted-foreground">{r.owner.displayName}</span>
          </button>
        ),
        hideBelow: "md",
      },
      { key: "status", header: "Status", cell: (r) => <StatusText tone={INTERVIEW_STATUS_TONE[r.status]}>{INTERVIEW_STATUS_LABEL[r.status]}</StatusText> },
      {
        key: "answered",
        header: "Answered",
        align: "right",
        cell: (r) => (r.questionCount ? `${formatCount(r.answeredCount)} of ${formatCount(r.questionCount)}` : <span className="text-subtle-foreground">No plan</span>),
        sortValue: (r) => r.answeredCount,
        hideBelow: "sm",
      },
      {
        key: "score",
        header: "Score",
        align: "right",
        cell: (r) => (r.overallScore === null ? <span className="text-subtle-foreground">{scoreLabel(null)}</span> : <span className="font-medium text-foreground">{scoreLabel(r.overallScore)}</span>),
        sortValue: (r) => r.overallScore,
      },
      { key: "voice", header: "Voice", align: "right", cell: (r) => formatMinutes(r.voiceMinutes), sortValue: (r) => r.voiceMinutes, hideBelow: "md" },
      { key: "created", header: "Created", align: "right", cell: (r) => <span className="text-muted-foreground">{shortDate(r.createdAt)}</span>, sortValue: (r) => r.createdAt, hideBelow: "lg" },
    ],
    [setUrl],
  );

  const ownerName = userId ? rows.find((r) => r.owner.id === userId)?.owner.displayName : undefined;
  const filtered = !!(q || status || userId);

  return (
    <AdminPage
      title="Interviews"
      description="Every interview on this deployment. Titles, progress and scores only: transcripts, answers and feedback stay private to their owner."
      filters={
        <>
          <FilterBar
            tabs={STATUS_TABS}
            tab={status ?? "all"}
            onTabChange={(v) => url.set({ status: v === "all" ? null : v })}
            tabsLabel="Status"
            search={q}
            onSearchChange={(v) => url.set({ q: v.trim() })}
            searchPlaceholder="Search titles"
            testId="interviews-filter"
          />
          {userId ? (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[13.5px] text-muted-foreground" data-testid="interviews-owner-filter">
              Showing interviews by {ownerName ?? "one account"}.
              <Button variant="link" size="sm" className="h-auto p-0 text-[13.5px]" onClick={() => url.set({ user: null })}>
                Show everyone
              </Button>
            </p>
          ) : null}
        </>
      }
      testId="admin-interviews"
    >
      <DataTable
        caption="Interviews"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        hasMore={!!list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={() => void list.fetchNextPage()}
        empty={{ title: filtered ? "No interviews match these filters." : "No interviews yet." }}
        rowTestId={(r) => `interview-row-${r.id}`}
        testId="interviews-table"
      />
    </AdminPage>
  );
}
