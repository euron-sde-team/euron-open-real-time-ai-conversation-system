"use client";

/** Reads for interviews, usage, voice models and preferences. */
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { Interview } from "@open-conversation/types";
import { api } from "../api";
import { qk } from "../query-keys";

export function useUsage() {
  return useQuery({ queryKey: qk.usage, queryFn: () => api().me.usage(), staleTime: 15_000, meta: { silent: true } });
}

export function usePreferences() {
  return useQuery({ queryKey: qk.preferences, queryFn: () => api().me.preferences(), staleTime: 60_000 });
}

export function useRealtimeModels() {
  return useQuery({ queryKey: qk.realtimeModels, queryFn: () => api().me.realtimeModels(), staleTime: 60_000 });
}

/** Your interviews, newest first, paged by cursor. */
export function useInterviews(filter: { status?: string } = {}) {
  return useInfiniteQuery({
    queryKey: qk.interviews(filter),
    queryFn: ({ pageParam }) => api().interviews.list({ ...filter, cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 10_000,
  });
}

/** One interview. Polls every 1.5 s while the plan is being written or answers are being scored. */
export function useInterview(id: string) {
  return useQuery({
    queryKey: qk.interview(id),
    queryFn: ({ signal }) => api().interviews.get(id, signal),
    refetchInterval: (q) => (busy(q.state.data) ? 1500 : false),
    staleTime: 5_000,
  });
}

export function busy(iv: Interview | undefined): boolean {
  return !!iv && (iv.status === "PLANNING" || iv.answers.some((a) => a.status === "SCORING"));
}

export function useReport(id: string, enabled = true) {
  return useQuery({ queryKey: qk.report(id), queryFn: () => api().interviews.report(id), enabled, staleTime: 5_000 });
}

export function useShares() {
  return useQuery({ queryKey: qk.shares, queryFn: () => api().shares.list({ limit: 50 }).then((p) => p.items) });
}

/** Group interviews under Today, Yesterday, Previous 7 days, Previous 30 days, then months. */
export function groupByDate<T extends { createdAt: string }>(items: T[], now = new Date()): { label: string; items: T[] }[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const groups = new Map<string, T[]>();
  for (const c of items) {
    const t = new Date(c.createdAt).getTime();
    let label: string;
    if (t >= startOfToday) label = "Today";
    else if (t >= startOfToday - day) label = "Yesterday";
    else if (t >= startOfToday - 7 * day) label = "Previous 7 days";
    else if (t >= startOfToday - 30 * day) label = "Previous 30 days";
    else label = new Date(t).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    groups.set(label, [...(groups.get(label) ?? []), c]);
  }
  return [...groups.entries()].map(([label, list]) => ({ label, items: list }));
}
