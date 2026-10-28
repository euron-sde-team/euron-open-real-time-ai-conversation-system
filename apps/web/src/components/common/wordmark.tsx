"use client";

import Link from "next/link";
import { cn } from "@open-conversation/ui";
import { useProductName } from "@/lib/meta";

/** Split for the two-tone wordmark: all but the last word strong, the last word muted. */
export function splitName(name: string): { lead: string; tail: string } {
  const t = name.trim();
  const i = t.lastIndexOf(" ");
  return i < 0 ? { lead: t, tail: "" } : { lead: t.slice(0, i), tail: t.slice(i + 1) };
}

export function LogoMark({ className }: { className?: string }) {
  // A voice waveform: a conversation held out loud.
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-8 shrink-0", className)}>
      <rect width="32" height="32" rx="9" className="fill-ink" />
      <rect x="8" y="13" width="2.6" height="6" rx="1.3" className="fill-ink-foreground" />
      <rect x="12.4" y="9.5" width="2.6" height="13" rx="1.3" className="fill-ink-foreground" />
      <rect x="16.8" y="7" width="2.6" height="18" rx="1.3" className="fill-brand" />
      <rect x="21.2" y="11.5" width="2.6" height="9" rx="1.3" className="fill-ink-foreground" />
    </svg>
  );
}

export function Wordmark({ compact, className, textClassName }: { compact?: boolean; className?: string; textClassName?: string }) {
  const name = useProductName();
  const { lead, tail } = splitName(name);
  return (
    <Link href="/" className={cn("flex min-w-0 items-center gap-2 rounded-md focus-visible:ring-2", className)} aria-label={`${name} home`}>
      <LogoMark />
      {compact ? null : (
        <span className={cn("truncate font-display text-[17px] font-semibold tracking-[-0.02em] text-foreground", textClassName)}>
          {lead}
          {tail ? <span className="font-semibold text-muted-foreground"> {tail}</span> : null}
        </span>
      )}
    </Link>
  );
}
