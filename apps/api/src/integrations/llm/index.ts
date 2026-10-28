/** The adapter for each provider kind, and each kind's default endpoint. */
import type { ProviderKind } from "@open-conversation/types";
import { config } from "../../core/config";
import { anthropic } from "./anthropic";
import { gemini } from "./gemini";
import { openAiChat } from "./openai-chat";
import type { LlmAdapter } from "./types";

const ADAPTERS: Record<ProviderKind, LlmAdapter> = {
  OPENAI: openAiChat({ maxTokensField: "max_completion_tokens" }),
  OPENAI_COMPATIBLE: openAiChat({ maxTokensField: "max_tokens" }),
  STUB: openAiChat({ maxTokensField: "max_tokens" }),
  ANTHROPIC: anthropic,
  GEMINI: gemini,
};

let override: LlmAdapter | null = null;

/** Tests: route every call through a fake adapter (null restores the real ones). */
export function setLlmAdapterForTests(a: LlmAdapter | null): void {
  override = a;
}

export function adapterFor(kind: ProviderKind): LlmAdapter {
  return override ?? ADAPTERS[kind];
}

/** Where a provider kind lives when the admin left base_url empty. */
export function defaultBaseUrl(kind: ProviderKind): string | null {
  switch (kind) {
    case "OPENAI":
      return "https://api.openai.com/v1";
    case "ANTHROPIC":
      return "https://api.anthropic.com";
    case "GEMINI":
      return "https://generativelanguage.googleapis.com/v1beta";
    case "STUB":
      return `${config.STUBS_URL.replace(/\/$/, "")}/v1`;
    case "OPENAI_COMPATIBLE":
      return null;
  }
}

export type { Endpoint, LlmAdapter, LlmEvent, LlmMessage, LlmPart, LlmRequest, LlmTool, LlmToolCall } from "./types";
