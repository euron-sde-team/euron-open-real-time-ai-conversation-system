"use client";

import Link from "next/link";
import type { InterviewSummary } from "@open-conversation/types";
import { cn } from "@open-conversation/ui";
import { relativeTime } from "@/lib/time";
import { scoreTone, statusWord } from "./format";

/** Interviews as hairline rows: title, what it was based on, when, progress, and the score as a number. */
export function InterviewRows({ items, loading, empty }: { items: InterviewSummary[]; loading?: boolean; empty: string }) {
  if (loading)
    return (
      <div className="mt-3 divide-y divide-border">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 py-4">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="ml-auto h-4 w-10 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  if (!items.length) return <p className="mt-3 text-[14px] text-subtle-foreground">{empty}</p>;
  return (
    <ul className="mt-3 divide-y divide-border">
      {items.map((iv) => (
        <li key={iv.id}>
          <Link href={iv.status === "COMPLETED" ? `/i/${iv.id}/report` : `/i/${iv.id}`} className="flex items-center gap-4 py-3.5 hover:bg-muted/40 sm:px-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium">{iv.title}</span>
              <span className="block truncate text-[13px] text-subtle-foreground">
                {[iv.source === "RESUME" ? "From a resume" : "From a job description", relativeTime(iv.createdAt), iv.questionCount ? `${iv.answeredCount} of ${iv.questionCount} answered` : null].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="shrink-0 text-right">
              {iv.overallScore !== null ? (
                <span className={cn("font-display text-[22px] font-semibold tabular-nums", scoreTone(iv.overallScore))}>{iv.overallScore}</span>
              ) : (
                <span className="text-[13px] text-subtle-foreground">{statusWord(iv.status)}</span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
