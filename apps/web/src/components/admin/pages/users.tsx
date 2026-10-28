"use client";

import { useMemo } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { flattenPages, nextCursor } from "@open-conversation/api-client";
import { Select } from "@open-conversation/ui";
import type { AdminUserRow, UserRole, UserStatus } from "@open-conversation/types";
import { api } from "@/lib/api";
import { ROLE_LABEL, STATUS_LABEL, STATUS_TONE, formatCount, formatMinutes, shortDate } from "@/lib/admin";
import { TimeAgo } from "@/components/common/time-ago";
import { AdminPage, DataTable, FilterBar, StatusText, useUrlState, type Column } from "../shell";
import { ak, PersonAvatar } from "./common";
import { UserSheet } from "./user-sheet";

const STATUS_TABS: { value: "all" | UserStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "BANNED", label: "Banned" },
  { value: "PENDING_VERIFICATION", label: "Not verified" },
  { value: "DEACTIVATED", label: "Erased" },
];

const isStatus = (v: string): v is UserStatus => STATUS_TABS.some((t) => t.value === v && v !== "all");
const isRole = (v: string): v is UserRole => v === "USER" || v === "ADMIN";

export function AdminUsers() {
  const url = useUrlState();
  const q = url.get("q");
  const statusParam = url.get("status");
  const status = isStatus(statusParam) ? statusParam : undefined;
  const roleParam = url.get("role");
  const role = isRole(roleParam) ? roleParam : undefined;
  const tierId = url.get("tier") || undefined;
  const open = url.get("open") || null;
  const f = { q, status, role, tierId };

  const tiers = useQuery({ queryKey: ak.tiers, queryFn: () => api().admin.tiers(), staleTime: 60_000 });
  const list = useInfiniteQuery({
    queryKey: ak.users(f),
    queryFn: ({ pageParam }) => api().admin.users({ q: q || undefined, status, role, tierId, cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor,
    placeholderData: (p) => p,
  });
  const rows = flattenPages(list.data?.pages);

  const columns = useMemo<Column<AdminUserRow>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        cell: (u) => (
          <div className="flex min-w-0 items-center gap-3">
            <PersonAvatar user={u} size="sm" />
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{u.displayName}</p>
              <p className="truncate text-[12.5px] text-muted-foreground">{u.email}</p>
            </div>
          </div>
        ),
        className: "max-w-[260px] sm:max-w-none",
      },
      { key: "status", header: "Status", cell: (u) => <StatusText tone={STATUS_TONE[u.status]}>{STATUS_LABEL[u.status]}</StatusText>, hideBelow: "sm" },
      { key: "role", header: "Role", cell: (u) => <span className={u.role === "ADMIN" ? "font-medium text-foreground" : "text-muted-foreground"}>{ROLE_LABEL[u.role]}</span>, hideBelow: "md" },
      { key: "tier", header: "Tier", cell: (u) => <span className="text-muted-foreground">{u.quotaTier?.name ?? "Default"}</span>, hideBelow: "lg" },
      { key: "interviews", header: "Interviews this month", align: "right", cell: (u) => formatCount(u.interviewsThisMonth) },
      { key: "voice", header: "Voice this month", align: "right", cell: (u) => formatMinutes(u.voiceMinutesThisMonth), hideBelow: "sm" },
      {
        key: "seen",
        header: "Last seen",
        align: "right",
        cell: (u) => (u.lastSeenAt ? <TimeAgo value={u.lastSeenAt} className="text-muted-foreground" /> : <span className="text-subtle-foreground">Never</span>),
        hideBelow: "md",
      },
      { key: "joined", header: "Joined", align: "right", cell: (u) => <span className="text-muted-foreground">{shortDate(u.createdAt)}</span>, hideBelow: "lg" },
    ],
    [],
  );

  const filtered = !!(q || status || role || tierId);
  const tierOptions = [{ value: "all", label: "Any tier" }, ...(tiers.data ?? []).map((t) => ({ value: t.id, label: t.name }))];

  return (
    <AdminPage
      title="Users"
      description="Everyone with an account. Open a row to change a tier, set limits or restrict access. Months are counted in UTC. Transcripts and answers stay private."
      filters={
        <FilterBar
          tabs={STATUS_TABS}
          tab={status ?? "all"}
          onTabChange={(v) => url.set({ status: v === "all" ? null : v })}
          tabsLabel="Status"
          search={q}
          onSearchChange={(v) => url.set({ q: v.trim() })}
          searchPlaceholder="Search name, username or email"
          testId="users-filter"
        >
          <Select
            aria-label="Role"
            value={role ?? "all"}
            onValueChange={(v) => url.set({ role: v === "all" ? null : v })}
            options={[
              { value: "all", label: "Any role" },
              { value: "USER", label: "Users" },
              { value: "ADMIN", label: "Admins" },
            ]}
            className="h-9 w-[124px]"
            data-testid="users-role"
          />
          <Select aria-label="Tier" value={tierId ?? "all"} onValueChange={(v) => url.set({ tier: v === "all" ? null : v })} options={tierOptions} className="h-9 w-[136px]" data-testid="users-tier" />
        </FilterBar>
      }
      testId="admin-users"
    >
      <DataTable
        caption="Users"
        rows={rows}
        columns={columns}
        rowKey={(u) => u.id}
        onRowClick={(u) => url.set({ open: u.id })}
        selectedKey={open}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        hasMore={!!list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={() => void list.fetchNextPage()}
        empty={{ title: filtered ? "No accounts match these filters." : "No accounts yet." }}
        rowTestId={(u) => `user-row-${u.username}`}
        testId="users-table"
      />
      <UserSheet userId={open} tiers={tiers.data ?? []} onClose={() => url.set({ open: null })} />
    </AdminPage>
  );
}
