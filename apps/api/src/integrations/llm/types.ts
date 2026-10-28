/**
 * One shape for every text model (ADR 0004). Adapters translate it to a provider's wire
 * format and translate the provider's stream back into LlmEvents. Nothing above this
 * layer knows which provider answered.
 */

export type LlmPart = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface LlmToolCall {
  id: string;
  name: string;
  /** JSON text, exactly as the model produced it (validated by the tool, not here). */
  arguments: string;
}

export type LlmMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: LlmPart[] }
  | { role: "assistant"; content: string; toolCalls?: LlmToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface LlmTool {
  name: string;
  description: string;
  /** JSON Schema of the arguments object. */
  parameters: Record<string, unknown>;
}

export interface LlmRequest {
  model: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  maxOutputTokens: number;
  temperature?: number;
  /** Ask for a single JSON object (OpenAI json_object, Gemini application/json; others follow the prompt). */
  json?: boolean;
  /** Ask a reasoning model to think a little ("low") or harder; ignored by others. */
  reasoningEffort?: "low" | "medium" | "high";
  signal?: AbortSignal;
}

export type FinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "other";

export type LlmEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; call: LlmToolCall }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "finish"; reason: FinishReason };

/** Where and how to reach a provider. The key is resolved from config per call, never stored. */
export interface Endpoint {
  /** The provider slug, for logs and errors. */
  provider: string;
  baseUrl: string;
  apiKey: string | null;
}

export interface LlmAdapter {
  stream(req: LlmRequest, endpoint: Endpoint): AsyncGenerator<LlmEvent>;
}
