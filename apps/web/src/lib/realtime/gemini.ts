/**
 * Gemini Live over its WebSocket, with the one-use ephemeral token from the API. The
 * token carries `liveConnectConstraints`, so the model, instructions, voice and tool
 * are fixed by the server; the config passed here is ignored by the Live API and only
 * keeps the SDK's types happy.
 *
 * Audio: the microphone is resampled to 16 kHz PCM16 and streamed; the model's 24 kHz
 * PCM16 is scheduled gap-free on an AudioContext and dropped at once on interruption.
 */
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import type { ConnectOptions, RealtimeTransport, TransportEvent } from "./types";
import { BLOCKED_NETWORK } from "./types";

const IN_RATE = 16_000;
const OUT_RATE = 24_000;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function downsample(input: Float32Array, fromRate: number): Int16Array {
  const ratio = fromRate / IN_RATE;
  const out = new Int16Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const v = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)] ?? 0));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

export function geminiTransport(): RealtimeTransport {
  let session: Session | null = null;
  let ctx: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let playAt = 0;
  const playing = new Set<AudioBufferSourceNode>();
  let muted = false;
  let emit: (e: TransportEvent) => void = () => undefined;
  let interviewerLine = "";
  let candidateLine = "";

  const stopPlayback = () => {
    for (const n of playing) {
      try {
        n.stop();
      } catch {
        /* already stopped */
      }
    }
    playing.clear();
    playAt = 0;
    emit({ type: "speaking", who: "interviewer", on: false });
  };

  const play = (b64: string) => {
    if (!ctx) return;
    const bin = atob(b64);
    const pcm = new Int16Array(bin.length / 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) << 16 >> 16;
    const buf = ctx.createBuffer(1, pcm.length, OUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i]! / 0x8000;
    const node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(ctx.destination);
    playAt = Math.max(playAt, ctx.currentTime);
    node.start(playAt);
    playAt += buf.duration;
    playing.add(node);
    emit({ type: "speaking", who: "interviewer", on: true });
    node.onended = () => {
      playing.delete(node);
      if (!playing.size) emit({ type: "speaking", who: "interviewer", on: false });
    };
  };

  const flushCandidate = () => {
    if (candidateLine.trim()) emit({ type: "line", role: "candidate", text: candidateLine.trim() });
    candidateLine = "";
  };

  const onMessage = (m: LiveServerMessage) => {
    const sc = m.serverContent;
    if (sc?.interrupted) stopPlayback();
    for (const part of sc?.modelTurn?.parts ?? []) if (part.inlineData?.data) play(part.inlineData.data);
    if (sc?.inputTranscription?.text) {
      candidateLine += sc.inputTranscription.text;
      emit({ type: "speaking", who: "candidate", on: true });
    }
    if (sc?.outputTranscription?.text) {
      flushCandidate();
      emit({ type: "speaking", who: "candidate", on: false });
      interviewerLine += sc.outputTranscription.text;
      emit({ type: "line", role: "interviewer", text: interviewerLine, partial: true });
    }
    if (sc?.turnComplete) {
      if (interviewerLine.trim()) emit({ type: "line", role: "interviewer", text: interviewerLine.trim() });
      interviewerLine = "";
    }
    for (const call of m.toolCall?.functionCalls ?? []) {
      if (call.name === "end_question") {
        session?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: { ok: true } }] });
        flushCandidate();
        emit({ type: "end_question" });
      }
    }
  };

  return {
    async connect({ grant, mic, onEvent }: ConnectOptions) {
      emit = onEvent;
      emit({ type: "stage", stage: "connecting" });
      ctx = new AudioContext();
      await ctx.resume();
      const ai = new GoogleGenAI({ apiKey: grant.credential, httpOptions: { apiVersion: "v1alpha" } });
      const opened = new Promise<void>((resolve, reject) => {
        void ai.live
          .connect({
            model: grant.model,
            config: { responseModalities: [Modality.AUDIO] },
            callbacks: {
              onopen: () => resolve(),
              onmessage: onMessage,
              onerror: () => (emit({ type: "error", message: BLOCKED_NETWORK }), reject(new Error(BLOCKED_NETWORK))),
              onclose: () => emit({ type: "stage", stage: "closed" }),
            },
          })
          .then((s) => (session = s))
          .catch(reject);
      });
      await Promise.race([opened, new Promise((_, reject) => setTimeout(() => reject(new Error(BLOCKED_NETWORK)), 15_000))]);
      if (mic) {
        source = ctx.createMediaStreamSource(mic);
        processor = ctx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e) => {
          if (muted || !session) return;
          const pcm = downsample(e.inputBuffer.getChannelData(0), ctx!.sampleRate);
          session.sendRealtimeInput({ audio: { data: toBase64(new Uint8Array(pcm.buffer)), mimeType: `audio/pcm;rate=${IN_RATE}` } });
        };
        source.connect(processor);
        processor.connect(ctx.destination);
      }
      emit({ type: "stage", stage: "live" });
      // The interviewer speaks first.
      session?.sendClientContent({ turns: [{ role: "user", parts: [{ text: "(The candidate has joined and is ready.)" }] }], turnComplete: true });
    },
    sendText(text) {
      session?.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete: true });
      emit({ type: "line", role: "candidate", text });
    },
    setMuted(m) {
      muted = m;
    },
    close() {
      stopPlayback();
      try {
        processor?.disconnect();
        source?.disconnect();
        session?.close();
        void ctx?.close();
      } catch {
        /* already closed */
      }
      session = null;
      ctx = null;
      emit({ type: "stage", stage: "closed" });
    },
  };
}
