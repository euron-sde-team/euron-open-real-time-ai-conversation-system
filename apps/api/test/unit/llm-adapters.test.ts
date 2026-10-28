/** Each provider adapter's wire mapping and stream parsing, against a fake fetch. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { anthropic, toWire as anthropicWire } from "../../src/integrations/llm/anthropic";
import { cleanSchema, gemini, toWire as geminiWire } from "../../src/integrations/llm/gemini";
import { openAiChat } from "../../src/integrations/llm/openai-chat";
import type { Endpoint, LlmAdapter, LlmEvent, LlmMessage, LlmRequest } from "../../src/integrations/llm/types";
import { ProviderError } from "../../src/integrations/http";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: any;
}

/** Replace fetch with one that records the request and answers with an SSE body made of `frames`. */
function fakeFetch(frames: string[], status = 200): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>)), body: JSON.parse(String(init.body)) });
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const f of frames) c.enqueue(enc.encode(f));
        c.close();
      },
    });
    return new Response(status === 200 ? body : JSON.stringify({ error: { message: "boom from the provider" } }), { status, headers: { "Content-Type": status === 200 ? "text/event-stream" : "application/json" } });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function run(adapter: LlmAdapter, req: LlmRequest, endpoint: Endpoint): Promise<LlmEvent[]> {
  const out: LlmEvent[] = [];
  for await (const ev of adapter.stream(req, endpoint)) out.push(ev);
  return out;
}

const PNG_B64 = "iVBORw0KGgo=";
const conversation: LlmMessage[] = [
  { role: "system", content: "You are helpful." },
  { role: "user", content: [{ type: "image", data: PNG_B64, mimeType: "image/png" }, { type: "text", text: "What is this?" }] },
  { role: "assistant", content: "Let me look.", toolCalls: [{ id: "call_9", name: "web_search", arguments: '{"query":"cats"}' }] },
  { role: "tool", toolCallId: "call_9", name: "web_search", content: '{"results":[]}' },
];
const tool = { name: "web_search", description: "Search", parameters: { type: "object", properties: { query: { type: "string", default: "x" } }, required: ["query"], additionalProperties: false } };

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

describe("openai-chat", () => {
  const endpoint: Endpoint = { provider: "openai", baseUrl: "https://api.example.com/v1/", apiKey: "sk-test-key-123456" };

  test("maps messages, tools and limits to the Chat Completions wire format", async () => {
    const calls = fakeFetch([sse({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }), "data: [DONE]\n\n"]);
    await run(openAiChat({ maxTokensField: "max_completion_tokens" }), { model: "gpt-x", messages: conversation, tools: [tool], maxOutputTokens: 321, temperature: 0.2, reasoningEffort: "low" }, endpoint);
    const { url, headers, body } = calls[0]!;
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect(headers.Authorization).toBe("Bearer sk-test-key-123456");
    expect(body).toMatchObject({ model: "gpt-x", stream: true, stream_options: { include_usage: true }, max_completion_tokens: 321, temperature: 0.2, reasoning_effort: "low" });
    expect(body.max_tokens).toBeUndefined();
    expect(body.messages).toEqual([
      { role: "system", content: "You are helpful." },
      { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG_B64}` } }, { type: "text", text: "What is this?" }] },
      { role: "assistant", content: "Let me look.", tool_calls: [{ id: "call_9", type: "function", function: { name: "web_search", arguments: '{"query":"cats"}' } }] },
      { role: "tool", tool_call_id: "call_9", content: '{"results":[]}' },
    ]);
    expect(body.tools).toEqual([{ type: "function", function: { name: "web_search", description: "Search", parameters: tool.parameters } }]);
  });

  test("compatible servers get max_tokens; no key means no Authorization header; an empty assistant turn sends null content", async () => {
    const calls = fakeFetch(["data: [DONE]\n\n"]);
    await run(openAiChat({ maxTokensField: "max_tokens" }), { model: "m", messages: [{ role: "assistant", content: "" }], maxOutputTokens: 50 }, { provider: "local", baseUrl: "http://llm.example.com/v1", apiKey: null });
    expect(calls[0]!.body.max_tokens).toBe(50);
    expect(calls[0]!.body.max_completion_tokens).toBeUndefined();
    expect(calls[0]!.headers.Authorization).toBeUndefined();
    expect(calls[0]!.body.messages).toEqual([{ role: "assistant", content: null }]);
    expect(calls[0]!.body.tools).toBeUndefined();
  });

  test("streams text, reasoning and usage; finish maps", async () => {
    fakeFetch([
      sse({ choices: [{ delta: { reasoning_content: "thinking" } }] }),
      sse({ choices: [{ delta: { content: "Hel" } }] }),
      sse({ choices: [{ delta: { content: "lo" }, finish_reason: "length" }] }),
      "data: not json\n\n",
      sse({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } }),
      "data: [DONE]\n\n",
    ]);
    const events = await run(openAiChat({ maxTokensField: "max_tokens" }), { model: "m", messages: [], maxOutputTokens: 10 }, endpoint);
    expect(events).toEqual([
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "Hel" },
      { type: "text", text: "lo" },
      { type: "usage", inputTokens: 11, outputTokens: 7 },
      { type: "finish", reason: "length" },
    ]);
  });

  test("fragmented tool call arguments are assembled into one tool_call per index, in order", async () => {
    fakeFetch([
      sse({ choices: [{ delta: { tool_calls: [{ index: 1, id: "call_b", function: { name: "open_url", arguments: "" } }] } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_a", function: { name: "web_", arguments: '{"que' } }] } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "search", arguments: 'ry":"ca' } }] } }] }),
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ts"}' } }, { index: 1, function: { arguments: '{"url":"https://example.com"}' } }] } }] }),
      sse({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      "data: [DONE]\n\n",
    ]);
    const events = await run(openAiChat({ maxTokensField: "max_tokens" }), { model: "m", messages: [], maxOutputTokens: 10 }, endpoint);
    expect(events).toEqual([
      { type: "tool_call", call: { id: "call_a", name: "web_search", arguments: '{"query":"cats"}' } },
      { type: "tool_call", call: { id: "call_b", name: "open_url", arguments: '{"url":"https://example.com"}' } },
      { type: "finish", reason: "tool_calls" },
    ]);
  });

  test("a tool call without an id or arguments gets a stable id and an empty object", async () => {
    fakeFetch([sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "remember" } }] }, finish_reason: "stop" }] }), "data: [DONE]\n\n"]);
    const events = await run(openAiChat({ maxTokensField: "max_tokens" }), { model: "m", messages: [], maxOutputTokens: 10 }, endpoint);
    expect(events[0]).toEqual({ type: "tool_call", call: { id: "call_0", name: "remember", arguments: "{}" } });
    expect(events.at(-1)).toEqual({ type: "finish", reason: "tool_calls" });
  });

  test("a provider error becomes a ProviderError without the provider's text", async () => {
    fakeFetch([], 429);
    const err = await run(openAiChat({ maxTokensField: "max_tokens" }), { model: "m", messages: [], maxOutputTokens: 10 }, endpoint).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).failure).toBe("RATE_LIMITED");
    expect((err as Error).message).not.toMatch(/boom/);
  });
});

describe("anthropic", () => {
  test("toWire: system dropped by the caller, images as base64 blocks, tool_use blocks, consecutive tool results merged into one user turn", () => {
    const wire = anthropicWire([
      { role: "user", content: [{ type: "image", data: PNG_B64, mimeType: "image/png" }, { type: "text", text: "Two lookups please" }] },
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "web_search", arguments: '{"query":"a"}' }, { id: "t2", name: "open_url", arguments: "not json" }] },
      { role: "tool", toolCallId: "t1", name: "web_search", content: "r1" },
      { role: "tool", toolCallId: "t2", name: "open_url", content: "r2" },
      { role: "user", content: [{ type: "text", text: "Thanks" }] },
      { role: "assistant", content: "" },
    ]);
    expect(wire).toEqual([
      { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG_B64 } }, { type: "text", text: "Two lookups please" }] },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "web_search", input: { query: "a" } },
          { type: "tool_use", id: "t2", name: "open_url", input: {} },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "r1" },
          { type: "tool_result", tool_use_id: "t2", content: "r2" },
          { type: "text", text: "Thanks" },
        ],
      },
    ]);
  });

  test("request: system is top level, tools use input_schema, key in x-api-key", async () => {
    const calls = fakeFetch(['event: message_stop\ndata: {"type":"message_stop"}\n\n']);
    await run(anthropic, { model: "claude-x", messages: conversation, tools: [tool], maxOutputTokens: 99 }, { provider: "anthropic", baseUrl: "https://anthropic.example.com/", apiKey: "sk-ant-123456789" });
    const { url, headers, body } = calls[0]!;
    expect(url).toBe("https://anthropic.example.com/v1/messages");
    expect(headers["x-api-key"]).toBe("sk-ant-123456789");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(body.system).toBe("You are helpful.");
    expect(body.max_tokens).toBe(99);
    expect(body.messages.some((m: { role: string }) => m.role === "system")).toBe(false);
    expect(body.tools).toEqual([{ name: "web_search", description: "Search", input_schema: tool.parameters }]);
  });

  test("stream: text deltas, thinking, a tool_use assembled from input_json_delta, usage and finish", async () => {
    const ev = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
    fakeFetch([
      ev("message_start", { type: "message_start", message: { usage: { input_tokens: 42, output_tokens: 1 } } }),
      ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } }),
      ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me check." } }),
      ev("content_block_start", { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "web_search", input: {} } }),
      ev("content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"query":' } }),
      ev("content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '"cats"}' } }),
      ev("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 12 } }),
      ev("message_stop", { type: "message_stop" }),
    ]);
    const events = await run(anthropic, { model: "c", messages: [], maxOutputTokens: 10 }, { provider: "anthropic", baseUrl: "https://a.example.com", apiKey: null });
    expect(events).toEqual([
      { type: "reasoning", text: "hmm" },
      { type: "text", text: "Let me check." },
      { type: "tool_call", call: { id: "toolu_1", name: "web_search", arguments: '{"query":"cats"}' } },
      { type: "usage", inputTokens: 42, outputTokens: 12 },
      { type: "finish", reason: "tool_calls" },
    ]);
  });

  test("stop reasons map: max_tokens is length, refusal is content_filter", async () => {
    fakeFetch([`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "max_tokens" } })}\n\n`]);
    expect((await run(anthropic, { model: "c", messages: [], maxOutputTokens: 10 }, { provider: "a", baseUrl: "https://a.example.com", apiKey: null })).at(-1)).toEqual({ type: "finish", reason: "length" });
    fakeFetch([`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "refusal" } })}\n\n`]);
    expect((await run(anthropic, { model: "c", messages: [], maxOutputTokens: 10 }, { provider: "a", baseUrl: "https://a.example.com", apiKey: null })).at(-1)).toEqual({ type: "finish", reason: "content_filter" });
  });

  test("an error event in the stream becomes a ProviderError without the provider's text", async () => {
    fakeFetch([`event: error\ndata: ${JSON.stringify({ type: "error", error: { message: "overloaded" } })}\n\n`]);
    const err = await run(anthropic, { model: "c", messages: [], maxOutputTokens: 10 }, { provider: "a", baseUrl: "https://a.example.com", apiKey: null }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).failure).toBe("UNAVAILABLE");
    expect(String(err)).not.toContain("overloaded");
  });
});

describe("gemini", () => {
  test("cleanSchema drops the keywords Gemini refuses at every depth and keeps the rest", () => {
    expect(
      cleanSchema({
        $schema: "x",
        type: "object",
        additionalProperties: false,
        properties: { q: { type: "string", default: "a", examples: ["b"], description: "d" }, list: { type: "array", items: [{ $ref: "#/x", type: "string" }] } },
        required: ["q"],
      }),
    ).toEqual({ type: "object", properties: { q: { type: "string", description: "d" }, list: { type: "array", items: [{ type: "string" }] } }, required: ["q"] });
    expect(cleanSchema("plain")).toBe("plain");
    expect(cleanSchema(null)).toBeNull();
  });

  test("toWire: user parts, model turns with functionCall, tool results as functionResponse in a user turn (merged)", () => {
    expect(
      geminiWire([
        { role: "user", content: [{ type: "text", text: "Hi" }, { type: "image", data: PNG_B64, mimeType: "image/jpeg" }] },
        { role: "assistant", content: "Looking", toolCalls: [{ id: "g1", name: "web_search", arguments: '{"query":"q"}' }] },
        { role: "tool", toolCallId: "g1", name: "web_search", content: "r1" },
        { role: "user", content: [{ type: "text", text: "and?" }] },
      ]),
    ).toEqual([
      { role: "user", parts: [{ text: "Hi" }, { inlineData: { mimeType: "image/jpeg", data: PNG_B64 } }] },
      { role: "model", parts: [{ text: "Looking" }, { functionCall: { name: "web_search", args: { query: "q" } } }] },
      { role: "user", parts: [{ functionResponse: { name: "web_search", response: { content: "r1" } } }, { text: "and?" }] },
    ]);
  });

  test("request: systemInstruction, cleaned function declarations, key header, SSE URL", async () => {
    const calls = fakeFetch([sse({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] })]);
    await run(gemini, { model: "gemini-x", messages: conversation, tools: [tool], maxOutputTokens: 77, temperature: 0 }, { provider: "gemini", baseUrl: "https://g.example.com/v1beta", apiKey: "AIza-test" });
    const { url, headers, body } = calls[0]!;
    expect(url).toBe("https://g.example.com/v1beta/models/gemini-x:streamGenerateContent?alt=sse");
    expect(headers["x-goog-api-key"]).toBe("AIza-test");
    expect(body.systemInstruction).toEqual({ parts: [{ text: "You are helpful." }] });
    expect(body.generationConfig).toEqual({ maxOutputTokens: 77, temperature: 0 });
    expect(body.tools).toEqual([{ functionDeclarations: [{ name: "web_search", description: "Search", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }] }]);
  });

  test("stream: text, thoughts as reasoning, function calls with made-up ids, usage and finish", async () => {
    fakeFetch([
      sse({ candidates: [{ content: { parts: [{ text: "pondering", thought: true }, { text: "Hello " }] } }] }),
      sse({ candidates: [{ content: { parts: [{ functionCall: { name: "web_search", args: { query: "cats" } } }, { functionCall: { id: "own", name: "remember", args: {} } }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 5, thoughtsTokenCount: 2 } }),
    ]);
    const events = await run(gemini, { model: "g", messages: [], maxOutputTokens: 10 }, { provider: "gemini", baseUrl: "https://g.example.com", apiKey: null });
    expect(events).toEqual([
      { type: "reasoning", text: "pondering" },
      { type: "text", text: "Hello " },
      { type: "tool_call", call: { id: "gemini_call_1", name: "web_search", arguments: '{"query":"cats"}' } },
      { type: "tool_call", call: { id: "own", name: "remember", arguments: "{}" } },
      { type: "usage", inputTokens: 40, outputTokens: 7 },
      { type: "finish", reason: "tool_calls" },
    ]);
  });

  test("safety finishes and blocked prompts are content_filter", async () => {
    fakeFetch([sse({ candidates: [{ content: { parts: [{ text: "x" }] }, finishReason: "SAFETY" }] })]);
    expect((await run(gemini, { model: "g", messages: [], maxOutputTokens: 10 }, { provider: "g", baseUrl: "https://g.example.com", apiKey: null })).at(-1)).toEqual({ type: "finish", reason: "content_filter" });
    fakeFetch([sse({ promptFeedback: { blockReason: "SAFETY" } })]);
    expect((await run(gemini, { model: "g", messages: [], maxOutputTokens: 10 }, { provider: "g", baseUrl: "https://g.example.com", apiKey: null })).at(-1)).toEqual({ type: "finish", reason: "content_filter" });
  });
});
