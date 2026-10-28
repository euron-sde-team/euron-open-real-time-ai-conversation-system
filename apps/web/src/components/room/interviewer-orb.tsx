"use client";

/**
 * The interviewer's presence: a calm orb. It breathes slowly when idle, rings outward
 * while the interviewer speaks, tightens while the candidate speaks, and turns while a
 * connection or save is in flight. Motion respects prefers-reduced-motion.
 */
import { cn } from "@open-conversation/ui";

const SIZES = { sm: "size-24", md: "size-32", lg: "size-44 sm:size-52" } as const;

export function InterviewerOrb({ speaking, listening, busy, size = "lg" }: { speaking: boolean; listening: boolean; busy: boolean; size?: keyof typeof SIZES }) {
  return (
    <div className={cn("relative shrink-0", SIZES[size])} aria-hidden>
      {speaking ? (
        <>
          <span className="absolute inset-0 rounded-full bg-brand/25 motion-safe:animate-[orb-ring_1.6s_ease-out_infinite]" />
          <span className="absolute inset-0 rounded-full bg-brand/20 motion-safe:animate-[orb-ring_1.6s_ease-out_0.8s_infinite]" />
        </>
      ) : null}
      <span
        className={cn(
          "absolute inset-0 rounded-full bg-[radial-gradient(circle_at_35%_30%,hsl(var(--brand)/0.95),hsl(var(--primary))_55%,hsl(var(--ink)/0.9))] shadow-[0_20px_60px_-20px_hsl(var(--brand)/0.7)] transition-transform duration-500",
          speaking ? "scale-105" : listening ? "scale-95" : "motion-safe:animate-[orb-breathe_5s_ease-in-out_infinite]",
        )}
      />
      {busy ? <span className="absolute inset-[-6px] rounded-full border-2 border-transparent border-t-brand motion-safe:animate-spin" /> : null}
      <span className="absolute inset-[18%] rounded-full bg-[radial-gradient(circle_at_40%_35%,hsl(0_0%_100%/0.35),transparent_60%)]" />
    </div>
  );
}
