"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { flattenPages, mapPages, nextCursor, filterPages } from "@open-conversation/api-client";
import { ArrowUpRight } from "lucide-react";
import { Button, Switch, toast } from "@open-conversation/ui";
import type { AdminShareRow, Page } from "@open-conversation/types";
import { api } from "@/lib/api";
import { formatCount, shortDate } from "@/lib/admin";
import { AdminPage, DataTable, ReasonDialog, StatusText, useUrlState, type Column } from "../shell";
import { ak, PersonAvatar } from "./common";

export function AdminShares() {
  const qc = useQueryClient();
  const url = useUrlState();
  const includeRevoked = url.get("revoked") === "1";
  const [revoking, setRevoking] = useState<AdminShareRow | null>(null);
  const f = { includeRevoked };
  const list = useInfiniteQuery({
    queryKey: ak.shares(f),
    queryFn: ({ pageParam }) => api().admin.shares({ includeRevoked: includeRevoked || undefined, cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
  });
  const rows = flattenPages(list.data?.pages);

  const columns = useMemo<Column<AdminShareRow>[]>(
    () => [
      {
        key: "title",
        header: "Interview",
        cell: (s) => (
          <div className="min-w-0">
            <p className={s.revoked ? "truncate text-muted-foreground line-through" : "truncate font-medium text-foreground"}>{s.title || "Untitled"}</p>
            {s.revoked ? <StatusText tone="muted" className="text-[12.5px]">Revoked</StatusText> : null}
          </div>
        ),
        className: "max-w-[220px] sm:max-w-[360px]",
      },
      {
        key: "owner",
        header: "Owner",
        cell: (s) => (
          <span className="flex min-w-0 items-center gap-2">
            <PersonAvatar user={s.owner} size="xs" />
            <span className="truncate text-muted-foreground">{s.owner.displayName}</span>
          </span>
        ),
        hideBelow: "md",
      },
      { key: "views", header: "Views", align: "right", cell: (s) => formatCount(s.viewCount), sortValue: (s) => s.viewCount, hideBelow: "sm" },
      { key: "created", header: "Created", align: "right", cell: (s) => <span className="text-muted-foreground">{shortDate(s.createdAt)}</span>, sortValue: (s) => s.createdAt, hideBelow: "sm" },
      {
        key: "actions",
        header: <span className="sr-only">Actions</span>,
        align: "right",
        cell: (s) => (
          <span className="inline-flex items-center justify-end gap-1">
            {!s.revoked ? (
              <>
                <Button asChild variant="ghost" size="sm">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" aria-label={`Open the shared link for ${s.title || "Untitled"}`}>
                    Open <ArrowUpRight />
                  </a>
                </Button>
                <Button variant="danger-ghost" size="sm" onClick={() => setRevoking(s)} data-testid={`share-revoke-${s.id}`}>
                  Revoke
                </Button>
              </>
            ) : null}
          </span>
        ),
      },
    ],
    [],
  );

  const revoked = (id: string) => {
    qc.setQueriesData<InfiniteData<Page<AdminShareRow>>>({ queryKey: ak.sharesPrefix }, (old) => {
      if (!old) return old;
      // Live-only lists drop the row; lists with revoked links keep it, marked.
      return { ...old, pages: includeRevoked ? mapPages(old.pages, (r) => (r.id === id ? { ...r, revoked: true } : r)) : filterPages(old.pages, (r) => r.id !== id) };
    });
    void qc.invalidateQueries({ queryKey: ak.sharesPrefix, refetchType: "none" });
  };

  return (
    <AdminPage
      title="Shared links"
      description="Read-only links people made to their interview reports. Revoking one takes it down for everyone at once."
      filters={
        <label className="flex items-center justify-end gap-2.5 border-b border-border pb-3 text-[13.5px] text-muted-foreground">
          Show revoked links
          <Switch checked={includeRevoked} onCheckedChange={(v) => url.set({ revoked: v ? "1" : null })} data-testid="shares-include-revoked" />
        </label>
      }
      testId="admin-shares"
    >
      <DataTable
        caption="Shared links"
        rows={rows}
        columns={columns}
        rowKey={(s) => s.id}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        hasMore={!!list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={() => void list.fetchNextPage()}
        empty={{ title: includeRevoked ? "No links have been shared yet." : "No live shared links." }}
        rowTestId={(s) => `share-row-${s.id}`}
        testId="shares-table"
      />
      <ReasonDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title="Revoke this link?"
        description={revoking ? `"${revoking.title || "Untitled"}" by ${revoking.owner.displayName} stops working for everyone. The interview and its report are kept.` : undefined}
        confirmLabel="Revoke link"
        destructive
        reason="required"
        onConfirm={async ({ reason }) => {
          await api().admin.revokeShare(revoking!.id, reason);
          revoked(revoking!.id);
          toast.success({ title: "Link revoked" });
        }}
        testId="share-revoke-dialog"
      />
    </AdminPage>
  );
}
