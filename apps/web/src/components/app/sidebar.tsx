"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Check, LogOut, Monitor, Moon, PanelLeftClose, Plus, Settings, Shield, Sun } from "lucide-react";
import type { InterviewSummary } from "@open-conversation/types";
import { Avatar, cn, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip } from "@open-conversation/ui";
import { LogoMark } from "@/components/common/wordmark";
import { useAuth } from "@/lib/auth";
import { groupByDate, useInterviews, useUsage } from "@/lib/interviews/queries";
import { useProductName } from "@/lib/meta";
import { useTheme } from "@/lib/stores/theme";
import { statusWord } from "@/components/interview/format";

function Row({ iv, active }: { iv: InterviewSummary; active: boolean }) {
  return (
    <Link
      href={`/i/${iv.id}`}
      aria-current={active ? "page" : undefined}
      title={iv.title}
      className={cn("flex items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-[14px]", active ? "bg-muted" : "hover:bg-muted/70")}
    >
      <span className="min-w-0 flex-1 truncate">{iv.title}</span>
      <span className="shrink-0 text-[12px] tabular-nums text-subtle-foreground">{iv.overallScore !== null ? iv.overallScore : statusWord(iv.status, true)}</span>
    </Link>
  );
}

/** This month's allowance as two quiet lines. Shown only when a limit is set. */
function UsageLines() {
  const { data } = useUsage();
  if (!data) return null;
  const lines = [
    data.interviews.limit !== null ? `${data.interviews.used} of ${data.interviews.limit} interviews` : null,
    data.voiceMinutes.limit !== null ? `${data.voiceMinutes.used} of ${data.voiceMinutes.limit} voice minutes` : null,
  ].filter(Boolean);
  if (!lines.length) return null;
  return (
    <p className="px-4 pb-2 text-[12px] leading-5 text-subtle-foreground" title={`Resets ${new Date(data.resetsAt).toLocaleDateString()}`}>
      This month: {lines.join(", ")}
    </p>
  );
}

export function Sidebar({ onCollapse, onNavigate }: { onCollapse?: () => void; onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const name = useProductName();
  const { user, isAdmin, logout } = useAuth();
  const { pref, setPref } = useTheme();
  const list = useInterviews();
  const sentinel = useRef<HTMLDivElement>(null);
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const groups = useMemo(() => groupByDate(items), [items]);
  const activeId = pathname.startsWith("/i/") ? pathname.split("/")[2] : null;

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [list]);

  // Close the phone sheet after navigating, but not when it first opens (mount).
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    onNavigate?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <nav aria-label="Interviews" className="flex h-full flex-col bg-ground-2/60">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <Link href="/" className="flex min-w-0 items-center gap-2 rounded-md" aria-label={`${name} home`}>
          <LogoMark className="size-7" />
          <span className="truncate font-display text-[14px] font-semibold tracking-[-0.01em]">{name}</span>
        </Link>
        {onCollapse ? (
          <Tooltip content="Close sidebar">
            <button type="button" onClick={onCollapse} aria-label="Close sidebar" className="inline-flex size-8 items-center justify-center rounded-lg text-subtle-foreground hover:bg-muted hover:text-foreground">
              <PanelLeftClose className="size-[18px]" />
            </button>
          </Tooltip>
        ) : null}
      </div>
      <div className="px-2">
        <Link href="/new" data-testid="new-interview" className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium hover:bg-muted", pathname === "/new" && "bg-muted")}>
          <Plus className="size-[18px]" /> New interview
        </Link>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-4 scrollbar-thin">
        {groups.map((g) => (
          <section key={g.label} className="mb-4">
            <h2 className="px-2.5 pb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">{g.label}</h2>
            {g.items.map((iv) => (
              <Row key={iv.id} iv={iv} active={iv.id === activeId} />
            ))}
          </section>
        ))}
        {list.isLoading ? (
          <div className="space-y-2 px-2.5">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-muted" style={{ width: `${55 + ((i * 17) % 40)}%` }} />
            ))}
          </div>
        ) : null}
        {!list.isLoading && !items.length ? <p className="px-2.5 text-[13px] text-subtle-foreground">Your interviews will appear here.</p> : null}
        <div ref={sentinel} className="h-4" />
      </div>

      <div className="border-t border-border pt-2">
        <UsageLines />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-testid="account-menu" aria-label="Account menu" className="mx-2 mb-2 flex w-[calc(100%-1rem)] items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-muted">
              <Avatar name={user?.displayName ?? "?"} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{user?.displayName}</span>
                <span className="block truncate text-[12px] text-subtle-foreground">{user?.email}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-60">
            <DropdownMenuItem onSelect={() => router.push("/settings")}>
              <Settings className="size-4" /> Settings
            </DropdownMenuItem>
            {isAdmin ? (
              <DropdownMenuItem onSelect={() => router.push("/admin")}>
                <Shield className="size-4" /> Admin
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[12px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">Theme</DropdownMenuLabel>
            {(
              [
                ["system", "System", Monitor],
                ["light", "Light", Sun],
                ["dark", "Dark", Moon],
              ] as const
            ).map(([v, label, Icon]) => (
              <DropdownMenuItem key={v} onSelect={(e) => (e.preventDefault(), setPref(v))}>
                <Icon className="size-4" /> {label}
                {pref === v ? <Check className="ml-auto size-4 text-primary" /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid="sign-out" onSelect={() => void logout()}>
              <LogOut className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  );
}
