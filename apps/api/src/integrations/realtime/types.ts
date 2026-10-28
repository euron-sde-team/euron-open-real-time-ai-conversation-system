/**
 * Realtime voice providers (ADR 0003). The server mints a short-lived credential with the
 * interviewer's instructions inside it; the browser connects to the provider with that
 * credential and never sees a provider API key or writes the instructions itself.
 */
import type { RealtimeProvider } from "@open-conversation/types";

export interface MintRequest {
  /** The provider's model id ("gpt-realtime", "gemini-live-2.5-flash-preview", ...). */
  model: string;
  voice: string;
  instructions: string;
  tool: { name: string; description: string; parameters: Record<string, unknown> };
  /** ISO-639-1, or "auto". */
  transcriptionLanguage: string;
  /** Seconds the credential may be used to open a connection. */
  connectTtlSeconds: number;
  /** Seconds the conversation may last; providers that support it stop the session after. */
  maxSeconds: number;
  /** Stub only: the lines the local interviewer speaks. */
  script: string[];
}

export interface MintResult {
  credential: string;
  expiresAt: Date;
  /** Where the browser connects, when the provider needs a URL (the SDP relay). */
  connectUrl: string | null;
}

export interface RealtimeAdapter {
  readonly provider: RealtimeProvider;
  mint(req: MintRequest, apiKey: string | null, baseUrl: string): Promise<MintResult>;
  /** Ends a live call on the provider side when it can (OpenAI WebRTC calls). */
  hangup?(callId: string, apiKey: string | null, baseUrl: string): Promise<void>;
}

export class RealtimeMintError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}
