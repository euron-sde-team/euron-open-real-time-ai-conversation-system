/** The realtime adapter for each provider, and each provider's default REST base. */
import type { RealtimeProvider } from "@open-conversation/types";
import { config } from "../../core/config";
import { geminiLive } from "./gemini";
import { openAiRealtime } from "./openai";
import { stubRealtime } from "./stub";
import type { RealtimeAdapter } from "./types";

const ADAPTERS: Record<RealtimeProvider, RealtimeAdapter> = { openai: openAiRealtime, gemini: geminiLive, stub: stubRealtime };

let override: Partial<Record<RealtimeProvider, RealtimeAdapter>> | null = null;

/** Tests: replace one or more adapters (null restores the real ones). */
export function setRealtimeAdaptersForTests(a: Partial<Record<RealtimeProvider, RealtimeAdapter>> | null): void {
  override = a;
}

export function realtimeAdapter(p: RealtimeProvider): RealtimeAdapter {
  return override?.[p] ?? ADAPTERS[p];
}

/** Where minting goes when the provider row has no base URL. */
export function realtimeBaseUrl(p: RealtimeProvider, providerBaseUrl: string | null): string {
  if (p === "openai") return providerBaseUrl?.trim() || config.OPENAI_REALTIME_URL;
  if (p === "gemini") return config.GEMINI_LIVE_URL;
  return config.STUBS_URL;
}

export type { MintRequest, MintResult, RealtimeAdapter } from "./types";
export { RealtimeMintError } from "./types";
