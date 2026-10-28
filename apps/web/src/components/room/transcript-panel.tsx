"use client";

/** The live transcript: the interviewer's and the candidate's lines, a divider per question, kept scrolled to the end while the reader is there. */
import { useEffect, useRef } from "react";
import { cn } from "@open-conversation/ui";

export type ShownLine = { role: "interviewer" | "candidate"; text: string; partial?: boolean } | { role: "divider"; text: string; partial?: undefined };

export function TranscriptPanel({ lines, name }: { lines: ShownLine[]; name: string }) {
  const box = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <div className="flex h-full w-full flex-col" data-testid="transcript">
      <h2 className="shrink-0 border-b border-border px-4 py-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground">Transcript</h2>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 scrollbar-thin"
        aria-live="polite"
        aria-relevant="additions"
      >
        {!lines.length ? <p className="text-[13px] text-subtle-foreground">What you and {name} say appears here.</p> : null}
        {lines.map((l, i) =>
          l.role === "divider" ? (
            <p key={i} className="pt-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-subtle-foreground">
              Question {l.text}
            </p>
          ) : (
            <div key={i}>
              <p className={cn("text-[12px] font-semibold", l.role === "interviewer" ? "text-primary" : "text-foreground")}>{l.role === "interviewer" ? name : "You"}</p>
              <p className={cn("whitespace-pre-line text-[14px] leading-relaxed", l.partial && "text-muted-foreground")}>{l.text}</p>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
