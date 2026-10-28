import type { RealtimeProvider } from "@open-conversation/types";
import type { RealtimeTransport } from "./types";

/** Each transport is loaded only when its provider is used (the Gemini SDK alone is large). */
export async function transportFor(provider: RealtimeProvider): Promise<RealtimeTransport> {
  if (provider === "openai") return (await import("./openai")).openAiTransport();
  if (provider === "gemini") return (await import("./gemini")).geminiTransport();
  return (await import("./stub")).stubTransport();
}

export type { ConnectionStage, RealtimeTransport, TransportEvent } from "./types";
export { BLOCKED_NETWORK } from "./types";
