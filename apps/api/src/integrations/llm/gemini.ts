/**
 * Google's Gemini API (generateContent, native). The system prompt is
 * `systemInstruction`, images are `inlineData` parts, tools are `functionDeclarations`,
 * a model's call is a `functionCall` part and the result goes back as a
 * `functionResponse` part in a user turn. Gemini's function calls may carry no id, so one
 * is made up and kept stable for the turn.
 *
 * Gemini rejects a few JSON Schema keywords in function declarations; they are removed.
 */
import { providerFetch, readSse, withTimeout } from "../http";
import type { Endpoint, FinishReason, LlmAdapter, LlmEvent, LlmMessage, LlmRequest } from "./types";

export const gemini: LlmAdapter = {
  async *stream(req: LlmRequest, endpoint: Endpoint): AsyncGenerator<LlmEvent> {
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const body: Record<string, unknown> = {
      contents: toWire(req.messages.filter((m) => m.role !== "system")),
      generationConfig: { maxOutputTokens: req.maxOutputTokens, ...(req.temperature !== undefined ? { temperature: req.temperature } : {}), ...(req.json ? { responseMimeType: "application/json" } : {}) },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (req.tools?.length) body.tools = [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: cleanSchema(t.parameters) })) }];

    const url = `${endpoint.baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`;
    const res = await providerFetch(endpoint.provider, url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(endpoint.apiKey ? { "x-goog-api-key": endpoint.apiKey } : {}) },
      body: JSON.stringify(body),
      signal: withTimeout(req.signal, 180_000),
    });

    let input = 0;
    let output = 0;
    let finish: FinishReason = "stop";
    let calls = 0;
    for await (const ev of readSse(res.body)) {
      let chunk: GeminiChunk;
      try {
        chunk = JSON.parse(ev.data) as GeminiChunk;
      } catch {
        continue;
      }
      if (chunk.usageMetadata) {
        input = chunk.usageMetadata.promptTokenCount ?? input;
        output = (chunk.usageMetadata.candidatesTokenCount ?? 0) + (chunk.usageMetadata.thoughtsTokenCount ?? 0) || output;
      }
      if (chunk.promptFeedback?.blockReason) finish = "content_filter";
      const cand = chunk.candidates?.[0];
      for (const part of cand?.content?.parts ?? []) {
        if (part.functionCall) {
          calls++;
          yield { type: "tool_call", call: { id: part.functionCall.id ?? `gemini_call_${calls}`, name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) } };
        } else if (part.text) {
          yield part.thought ? { type: "reasoning", text: part.text } : { type: "text", text: part.text };
        }
      }
      if (cand?.finishReason) finish = mapFinish(cand.finishReason);
    }
    yield { type: "usage", inputTokens: input, outputTokens: output };
    yield { type: "finish", reason: calls ? "tool_calls" : finish };
  },
};

interface GeminiChunk {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean; functionCall?: { id?: string; name: string; args?: unknown } }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}

function mapFinish(r: string): FinishReason {
  if (r === "STOP") return "stop";
  if (r === "MAX_TOKENS") return "length";
  if (r === "SAFETY" || r === "PROHIBITED_CONTENT" || r === "BLOCKLIST" || r === "SPII" || r === "RECITATION") return "content_filter";
  return "other";
}

const UNSUPPORTED = new Set(["additionalProperties", "$schema", "default", "examples", "$id", "$ref"]);

/** Drop schema keywords Gemini's function declarations refuse, at every depth. */
export function cleanSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(cleanSchema);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(
    Object.entries(schema as Record<string, unknown>)
      .filter(([k]) => !UNSUPPORTED.has(k))
      .map(([k, v]) => [k, cleanSchema(v)]),
  );
}

type Part = Record<string, unknown>;

export function toWire(messages: LlmMessage[]): { role: "user" | "model"; parts: Part[] }[] {
  const out: { role: "user" | "model"; parts: Part[] }[] = [];
  const push = (role: "user" | "model", parts: Part[]) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  };
  for (const m of messages) {
    if (m.role === "user") {
      push("user", m.content.map((p) => (p.type === "text" ? { text: p.text } : { inlineData: { mimeType: p.mimeType, data: p.data } })));
    } else if (m.role === "assistant") {
      const parts: Part[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const c of m.toolCalls ?? []) parts.push({ functionCall: { name: c.name, args: safeJson(c.arguments) } });
      if (parts.length) push("model", parts);
    } else if (m.role === "tool") {
      push("user", [{ functionResponse: { name: m.name, response: { content: m.content } } }]);
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
