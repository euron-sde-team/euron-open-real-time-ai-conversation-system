/**
 * The Chat Completions wire format: OpenAI itself and everything that copies it (Groq,
 * OpenRouter, Together, DeepInfra, Ollama, vLLM, LM Studio, the local stub).
 *
 * Streaming details handled here:
 *   - tool call arguments arrive in fragments keyed by index; they are assembled and
 *     emitted whole when the stream ends;
 *   - `stream_options.include_usage` adds a final chunk with token counts (servers that
 *     ignore it simply report no usage, and the engine estimates);
 *   - reasoning text arrives as `delta.reasoning_content` (DeepSeek, Qwen on vLLM) or
 *     `delta.reasoning` (OpenRouter).
 */
import { providerFetch, readSse, withTimeout } from "../http";
import type { Endpoint, FinishReason, LlmAdapter, LlmEvent, LlmMessage, LlmRequest } from "./types";

/** OpenAI's own API wants max_completion_tokens; most compatible servers still read max_tokens. */
export function openAiChat(opts: { maxTokensField: "max_tokens" | "max_completion_tokens" }): LlmAdapter {
  return {
    async *stream(req: LlmRequest, endpoint: Endpoint): AsyncGenerator<LlmEvent> {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: req.messages.map(toWire),
        stream: true,
        stream_options: { include_usage: true },
        [opts.maxTokensField]: req.maxOutputTokens,
      };
      if (req.temperature !== undefined) body.temperature = req.temperature;
      if (req.tools?.length) body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
      if (req.reasoningEffort) body.reasoning_effort = req.reasoningEffort;
      if (req.json) body.response_format = { type: "json_object" };

      const res = await providerFetch(endpoint.provider, `${endpoint.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}) },
        body: JSON.stringify(body),
        signal: withTimeout(req.signal, 180_000),
      });

      const calls = new Map<number, { id: string; name: string; arguments: string }>();
      let finish: FinishReason | null = null;
      for await (const ev of readSse(res.body)) {
        if (ev.data === "[DONE]") break;
        let chunk: ChatChunk;
        try {
          chunk = JSON.parse(ev.data) as ChatChunk;
        } catch {
          continue;
        }
        if (chunk.usage) yield { type: "usage", inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const d = choice.delta ?? {};
        const reasoning = d.reasoning_content ?? d.reasoning;
        if (reasoning) yield { type: "reasoning", text: reasoning };
        if (d.content) yield { type: "text", text: d.content };
        for (const tc of d.tool_calls ?? []) {
          const i = tc.index ?? 0;
          const cur = calls.get(i) ?? { id: "", name: "", arguments: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.arguments += tc.function.arguments;
          calls.set(i, cur);
        }
        if (choice.finish_reason) finish = mapFinish(choice.finish_reason);
      }
      for (const [i, c] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
        if (c.name) yield { type: "tool_call", call: { id: c.id || `call_${i}`, name: c.name, arguments: c.arguments || "{}" } };
      }
      yield { type: "finish", reason: calls.size ? "tool_calls" : (finish ?? "stop") };
    },
  };
}

interface ChatChunk {
  choices?: { delta?: { content?: string | null; reasoning_content?: string; reasoning?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

function mapFinish(r: string): FinishReason {
  if (r === "stop" || r === "length" || r === "tool_calls" || r === "content_filter") return r;
  if (r === "function_call") return "tool_calls";
  return "other";
}

function toWire(m: LlmMessage): Record<string, unknown> {
  switch (m.role) {
    case "system":
      return { role: "system", content: m.content };
    case "user":
      return {
        role: "user",
        content: m.content.map((p) => (p.type === "text" ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: `data:${p.mimeType};base64,${p.data}` } })),
      };
    case "assistant":
      return {
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })) } : {}),
      };
    case "tool":
      return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
}
