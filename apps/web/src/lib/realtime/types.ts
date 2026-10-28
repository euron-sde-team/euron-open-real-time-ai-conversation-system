/**
 * One small interface over the three realtime transports (OpenAI WebRTC, Gemini Live,
 * the local stub). The room only ever talks to this. A transport connects with a
 * `LiveSessionGrant` minted by the API: the interviewer's instructions are already
 * locked inside the credential, so a transport never sends instructions of its own.
 */
import type { LiveSessionGrant } from "@open-conversation/types";

export type ConnectionStage = "idle" | "connecting" | "live" | "closed";

export type TransportEvent =
  | { type: "stage"; stage: ConnectionStage }
  /** A finished line of the conversation. `partial` updates the interviewer's line as it is spoken. */
  | { type: "line"; role: "interviewer" | "candidate"; text: string; partial?: boolean }
  | { type: "speaking"; who: "interviewer" | "candidate"; on: boolean }
  /** The interviewer called end_question: the question is done. */
  | { type: "end_question" }
  | { type: "error"; message: string };

export interface ConnectOptions {
  grant: LiveSessionGrant;
  /** The candidate's microphone, opened by the room with echo cancellation. */
  mic: MediaStream | null;
  /** Where the interviewer's voice plays (OpenAI attaches its remote track here). */
  audio: HTMLAudioElement;
  onEvent: (e: TransportEvent) => void;
}

export interface RealtimeTransport {
  connect(opts: ConnectOptions): Promise<void>;
  /** A typed message from the candidate, for when speaking is not possible. */
  sendText(text: string): void;
  setMuted(muted: boolean): void;
  close(): void;
}

export const BLOCKED_NETWORK = "The voice connection could not be opened. This is usually a VPN, firewall or network that blocks real-time audio; try another network (a phone hotspot works well) and retry.";
