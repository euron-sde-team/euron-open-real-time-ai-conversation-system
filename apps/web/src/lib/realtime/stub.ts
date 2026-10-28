/**
 * The stub transport: no network and no provider key. The interviewer's lines (sent by
 * the server with a stub grant) are spoken with the browser's speech synthesis when it
 * has one and shown in the transcript; the candidate types, or dictates where the
 * browser offers speech recognition. Used for local development and the end-to-end
 * tests; a server in production never hands out stub grants.
 */
import type { ConnectOptions, RealtimeTransport, TransportEvent } from "./types";

type Recognition = { continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>; resultIndex: number }) => void) | null; onend: (() => void) | null; start(): void; stop(): void };

export function stubTransport(): RealtimeTransport {
  let emit: (e: TransportEvent) => void = () => undefined;
  let closed = false;
  let recognition: Recognition | null = null;
  let muted = false;

  const speak = (text: string) =>
    new Promise<void>((resolve) => {
      emit({ type: "line", role: "interviewer", text });
      const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
      if (!synth || navigator.webdriver) {
        // Automated browsers: no audio, keep the pace quick.
        emit({ type: "speaking", who: "interviewer", on: true });
        setTimeout(() => (emit({ type: "speaking", who: "interviewer", on: false }), resolve()), 400);
        return;
      }
      const u = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, "").slice(0, 600));
      u.onstart = () => emit({ type: "speaking", who: "interviewer", on: true });
      u.onend = u.onerror = () => (emit({ type: "speaking", who: "interviewer", on: false }), resolve());
      synth.speak(u);
    });

  return {
    async connect({ grant, onEvent }: ConnectOptions) {
      emit = onEvent;
      emit({ type: "stage", stage: "connecting" });
      if (!grant.credential.startsWith("stub_")) throw new Error("Not a stub credential");
      emit({ type: "stage", stage: "live" });
      for (const line of grant.script ?? []) {
        if (closed) return;
        await speak(line);
      }
      const Ctor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
      if (Ctor && !navigator.webdriver && !closed) {
        recognition = new Ctor();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = navigator.language || "en-US";
        recognition.onresult = (e) => {
          if (muted) return;
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i]!;
            if (r.isFinal && r[0].transcript.trim()) emit({ type: "line", role: "candidate", text: r[0].transcript.trim() });
          }
        };
        recognition.onend = () => {
          if (!closed) {
            try {
              recognition?.start();
            } catch {
              /* already running */
            }
          }
        };
        try {
          recognition.start();
        } catch {
          recognition = null;
        }
      }
    },
    sendText(text) {
      emit({ type: "line", role: "candidate", text });
      setTimeout(() => !closed && void speak("Thanks. Tell me a little more, or press Next question when you are done."), 300);
    },
    setMuted(m) {
      muted = m;
    },
    close() {
      closed = true;
      try {
        recognition?.stop();
        window.speechSynthesis?.cancel();
      } catch {
        /* nothing to stop */
      }
      emit({ type: "stage", stage: "closed" });
    },
  };
}
