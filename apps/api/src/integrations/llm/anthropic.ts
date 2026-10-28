/**
 * Anthropic's Messages API (native, not an OpenAI shim). The system prompt is a
 * top-level field, images are base64 `image` blocks, tool calls are `tool_use` blocks
 * and their results go back as `tool_result` blocks inside a user turn. Consecutive tool
 * results are merged into one user message, as the API requires.
 *
 * Stream events: message_start (input tokens), content_block_start (a tool_use begins),
 * content_block_delta (text_delta, input_json_delta, thinking_delta), message_delta
 * (stop_reason, output tokens), message_stop.
 */
import { ProviderError, providerFetch, readSse, withTimeout } from "../http";
import type { Endpoint, FinishReason, LlmAdapter, LlmEvent, LlmMessage, LlmRequest } from "./types";

const VERSION = "2023-06-01";

export const anthropic: LlmAdapter = {
  async *stream(req: LlmRequest, endpoint: Endpoint): AsyncGenerator<LlmEvent> {
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxOutputTokens,
      stream: true,
      messages: toWire(req.messages.filter((m) => m.role !== "system")),
    };
    if (system) body.system = system;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.tools?.length) body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));

    const res = await providerFetch(endpoint.provider, `${endpoint.baseUrl.replace(/\/$/, "")}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", "anthropic-version": VERSION, ...(endpoint.apiKey ? { "x-api-key": endpoint.apiKey } : {}) },
      body: JSON.stringify(body),
      signal: withTimeout(req.signal, 180_000),
    });

    const blocks = new Map<number, { id: string; name: string; json: string }>();
    let input = 0;
    let output = 0;
    let finish: FinishReason = "stop";
    for await (const ev of readSse(res.body)) {
      let e: AnthropicEvent;
      try {
        e = JSON.parse(ev.data) as AnthropicEvent;
      } catch {
        continue;
      }
      switch (e.type) {
        case "message_start":
          input = e.message?.usage?.input_tokens ?? 0;
          output = e.message?.usage?.output_tokens ?? 0;
          break;
        case "content_block_start":
          if (e.content_block?.type === "tool_use") blocks.set(e.index ?? 0, { id: e.content_block.id ?? "", name: e.content_block.name ?? "", json: "" });
          break;
        case "content_block_delta":
          if (e.delta?.type === "text_delta" && e.delta.text) yield { type: "text", text: e.delta.text };
          else if (e.delta?.type === "thinking_delta" && e.delta.thinking) yield { type: "reasoning", text: e.delta.thinking };
          else if (e.delta?.type === "input_json_delta") {
            const b = blocks.get(e.index ?? 0);
            if (b) b.json += e.delta.partial_json ?? "";
          }
          break;
        case "message_delta":
          if (e.usage?.output_tokens !== undefined) output = e.usage.output_tokens;
          if (e.delta?.stop_reason) finish = mapStop(e.delta.stop_reason);
          break;
        case "error":
          // Overloaded or failed mid-stream: the same stable failure as an HTTP error.
          throw new ProviderError("UNAVAILABLE", endpoint.provider);
      }
    }
    for (const b of [...blocks.entries()].sort((x, y) => x[0] - y[0]).map(([, v]) => v)) {
      yield { type: "tool_call", call: { id: b.id, name: b.name, arguments: b.json || "{}" } };
    }
    yield { type: "usage", inputTokens: input, outputTokens: output };
    yield { type: "finish", reason: blocks.size ? "tool_calls" : finish };
  },
};

interface AnthropicEvent {
  type: string;
  index?: number;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; stop_reason?: string };
  usage?: { output_tokens?: number };
}

function mapStop(r: string): FinishReason {
  if (r === "end_turn" || r === "stop_sequence") return "stop";
  if (r === "max_tokens") return "length";
  if (r === "tool_use") return "tool_calls";
  if (r === "refusal") return "content_filter";
  return "other";
}

type Block = Record<string, unknown>;

/** Map messages to Anthropic turns, merging consecutive tool results into one user turn. */
export function toWire(messages: LlmMessage[]): { role: "user" | "assistant"; content: Block[] }[] {
  const out: { role: "user" | "assistant"; content: Block[] }[] = [];
  const push = (role: "user" | "assistant", blocks: Block[]) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === "user") {
      push(
        "user",
        m.content.map((p) => (p.type === "text" ? { type: "text", text: p.text } : { type: "image", source: { type: "base64", media_type: p.mimeType, data: p.data } })),
      );
    } else if (m.role === "assistant") {
      const blocks: Block[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const c of m.toolCalls ?? []) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: safeJson(c.arguments) });
      if (blocks.length) push("assistant", blocks);
    } else if (m.role === "tool") {
      push("user", [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }]);
    }
  }
  return out;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
