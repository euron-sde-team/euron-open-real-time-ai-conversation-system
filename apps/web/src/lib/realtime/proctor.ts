"use client";

/**
 * Proctoring in the browser: face presence from the camera (MediaPipe face detector,
 * loaded from this origin, one frame every 1.5 s) and tab visibility. Video never leaves
 * the device; only events (no face, more than one face, face back, left the tab, came
 * back) are sent to the API, in small batches. If the detector cannot load, the face
 * check reports `unavailable` and the interview carries on.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import type { ProctorEventInput, ProctorEventKind } from "@open-conversation/types";
import { api } from "../api";

export type FaceState = "off" | "loading" | "ok" | "no-face" | "multiple" | "unavailable";

const DETECT_EVERY_MS = 1500;
/** A state must hold this long before it becomes an event (a turned head is not "no face"). */
const SETTLE_MS = 3000;

export function useFaceCheck(video: RefObject<HTMLVideoElement | null>, active: boolean): FaceState {
  const [state, setState] = useState<FaceState>("off");
  const detector = useRef<{ detectForVideo: (v: HTMLVideoElement, t: number) => { detections: unknown[] }; close: () => void } | null>(null);
  const failed = useRef(false);

  useEffect(() => {
    if (!active || failed.current) {
      setState(failed.current ? "unavailable" : "off");
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    setState("loading");
    (async () => {
      try {
        if (!detector.current) {
          const vision = await import("@mediapipe/tasks-vision");
          const files = await vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
          detector.current = await vision.FaceDetector.createFromOptions(files, {
            baseOptions: { modelAssetPath: "/mediapipe/blaze_face_short_range.tflite" },
            runningMode: "VIDEO",
            minDetectionConfidence: 0.5,
          });
        }
        if (cancelled) return;
        timer = setInterval(() => {
          const v = video.current;
          if (!v || v.readyState < 2 || !detector.current) return;
          const n = detector.current.detectForVideo(v, performance.now()).detections.length;
          setState(n === 0 ? "no-face" : n > 1 ? "multiple" : "ok");
        }, DETECT_EVERY_MS);
      } catch {
        failed.current = true;
        if (!cancelled) setState("unavailable");
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [active, video]);

  useEffect(() => () => detector.current?.close(), []);
  return state;
}

/**
 * Turns face states and tab visibility into events and sends them every 10 s (and when
 * the page hides). Returns how many times the candidate left the tab.
 */
export function useProctorEvents(interviewId: string, active: boolean, face: FaceState, where: { round: number; question: number }, cameraOff = false): { tabStrikes: number } {
  const queue = useRef<ProctorEventInput[]>([]);
  const [tabStrikes, setTabStrikes] = useState(0);
  const whereRef = useRef(where);
  whereRef.current = where;

  const push = (kind: ProctorEventKind) => queue.current.push({ kind, occurredAt: new Date().toISOString(), round: whereRef.current.round, question: whereRef.current.question });

  useEffect(() => {
    if (!active) return;
    const flush = () => {
      const batch = queue.current.splice(0, 100);
      if (batch.length) void api().interviews.proctorEvents(interviewId, batch).catch(() => queue.current.unshift(...batch));
    };
    const onVis = () => {
      if (document.hidden) {
        push("TAB_HIDDEN");
        setTabStrikes((n) => n + 1);
        flush();
      } else push("TAB_VISIBLE");
    };
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(flush, 10_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(t);
      flush();
    };
  }, [active, interviewId]);

  // Proctoring without a camera is noted once, so the report says why there are no face events.
  useEffect(() => {
    if (active && cameraOff) push("CAMERA_OFF");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, cameraOff]);

  // Settled face states become events: no face, more than one, and back to one.
  const settled = useRef<FaceState>("ok");
  useEffect(() => {
    if (!active || face === "loading" || face === "off" || face === "unavailable") return;
    const t = setTimeout(() => {
      if (face === settled.current) return;
      if (face === "no-face") push("NO_FACE");
      else if (face === "multiple") push("MULTIPLE_FACES");
      else if (face === "ok" && settled.current !== "ok") push("FACE_BACK");
      settled.current = face;
    }, SETTLE_MS);
    return () => clearTimeout(t);
  }, [active, face]);

  return { tabStrikes };
}
