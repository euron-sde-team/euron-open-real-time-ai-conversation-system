/** Words for statuses, scores and durations, shared by the list, the plan page and the report. */
import type { InterviewStatus, ProctorEventKind } from "@open-conversation/types";

export function statusWord(s: InterviewStatus, short = false): string {
  switch (s) {
    case "PLANNING":
      return short ? "Preparing" : "Preparing questions";
    case "PLAN_FAILED":
      return short ? "Failed" : "Could not prepare";
    case "READY":
      return short ? "Ready" : "Ready to start";
    case "IN_PROGRESS":
      return short ? "Started" : "In progress";
    case "COMPLETED":
      return "Finished";
  }
}

/** A score band in words, so colour is never the only signal. */
export function scoreWord(n: number | null): string {
  if (n === null) return "Not scored";
  if (n >= 90) return "Exceptional";
  if (n >= 75) return "Strong";
  if (n >= 60) return "Adequate";
  if (n >= 40) return "Needs work";
  return "Weak";
}

export function scoreTone(n: number | null): string {
  if (n === null) return "text-subtle-foreground";
  if (n >= 75) return "text-success";
  if (n >= 60) return "text-foreground";
  if (n >= 40) return "text-warning";
  return "text-danger";
}

export function minutes(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m < 1 ? "under a minute" : m === 1 ? "1 minute" : `${m} minutes`;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function proctorWord(k: ProctorEventKind): string {
  switch (k) {
    case "NO_FACE":
      return "No face in view";
    case "MULTIPLE_FACES":
      return "More than one face";
    case "FACE_BACK":
      return "Face back in view";
    case "TAB_HIDDEN":
      return "Left the tab";
    case "TAB_VISIBLE":
      return "Came back to the tab";
    case "CAMERA_OFF":
      return "Camera off";
  }
}

export const LANGUAGE_LABEL: Record<string, string> = { python: "Python", javascript: "JavaScript", typescript: "TypeScript", java: "Java", cpp: "C++", go: "Go", sql: "SQL" };
