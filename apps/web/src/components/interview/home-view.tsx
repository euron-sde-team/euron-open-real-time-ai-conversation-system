"use client";

/**
 * Home: one greeting, the two ways to start (as plain rows, not cards), this month's
 * allowance when one is set, and the most recent interviews.
 */
import Link from "next/link";
import { ArrowRight, FileText, ScrollText } from "lucide-react";
import { useMemo } from "react";
import { PageBar } from "@/components/app/app-shell";
import { useAuth } from "@/lib/auth";
import { useInterviews, useUsage } from "@/lib/interviews/queries";
import { useAppMeta } from "@/lib/meta";
import { InterviewRows } from "./interview-rows";

export function HomeView() {
  const { user } = useAuth();
  const { data: meta } = useAppMeta();
  const usage = useUsage();
  const list = useInterviews();
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const first = user?.displayName?.split(" ")[0];
  const interviewer = meta?.interviewerName ?? "Avani";
  const starts = [
    meta?.features.resumeUpload !== false && { href: "/new?from=resume", icon: FileText, title: "From your resume", text: `${interviewer} reads it and asks about your own projects, stack and experience.` },
    meta?.features.jobDescription !== false && { href: "/new?from=jd", icon: ScrollText, title: "From a job description", text: "Paste a posting and practise the interview for that exact role." },
  ].filter(Boolean) as { href: string; icon: typeof FileText; title: string; text: string }[];

  return (
    <div>
      <PageBar />
      <div className="mx-auto max-w-[780px] px-4 pb-16 pt-6 sm:px-6 sm:pt-12">
        <h1 className="font-display text-[30px] font-semibold leading-tight tracking-[-0.02em] sm:text-[36px]">{first ? `Ready when you are, ${first}.` : "Ready when you are."}</h1>
        <p className="mt-2 max-w-[560px] text-[15.5px] leading-relaxed text-muted-foreground">
          {interviewer} holds a live voice interview, asks follow-ups like a real interviewer, and scores every answer afterwards.
        </p>

        <div className="mt-8 divide-y divide-border border-y border-border">
          {starts.map((s) => (
            <Link key={s.href} href={s.href} className="group flex items-center gap-4 py-4 hover:bg-muted/40 sm:px-2">
              <s.icon className="size-5 shrink-0 text-primary" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[15.5px] font-semibold">{s.title}</span>
                <span className="block text-[13.5px] text-muted-foreground">{s.text}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-subtle-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          ))}
        </div>
        {usage.data && (usage.data.interviews.limit !== null || usage.data.voiceMinutes.limit !== null) ? (
          <p className="mt-3 text-[13px] text-subtle-foreground">
            This month you have used {usage.data.interviews.used}
            {usage.data.interviews.limit !== null ? ` of ${usage.data.interviews.limit}` : ""} interviews and {usage.data.voiceMinutes.used}
            {usage.data.voiceMinutes.limit !== null ? ` of ${usage.data.voiceMinutes.limit}` : ""} minutes of live voice.
          </p>
        ) : null}

        <h2 className="mt-12 font-display text-[19px] font-semibold tracking-[-0.01em]">Recent interviews</h2>
        <InterviewRows items={items.slice(0, 8)} loading={list.isLoading} empty="Nothing yet. Your first interview takes about twenty minutes." />
      </div>
    </div>
  );
}
