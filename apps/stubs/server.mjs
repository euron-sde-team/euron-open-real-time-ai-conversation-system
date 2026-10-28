/* global process, Buffer, URL, console, setTimeout */
/**
 * Deterministic stand-ins for every third party the interview system talks to, in one
 * dependency-free Node process (node:http, node:crypto). Development, CI and the
 * integration tests run the API's real provider adapters against it: only the base URL
 * differs from production.
 *
 *   OpenAI-compatible  POST /v1/chat/completions (streaming and not)
 *   Anthropic          POST /anthropic/v1/messages (streaming)
 *   Gemini             POST /gemini/v1beta/models/<m>:streamGenerateContent and :generateContent
 *   OpenAI Realtime    POST /v1/realtime/client_secrets (an ek_ secret, recording the session
 *                      config it was given), POST /v1/realtime/calls (an SDP answer with a
 *                      Location header), POST /v1/realtime/calls/<id>/hangup
 *   Gemini Live        POST /gemini/v1alpha/auth_tokens (an ephemeral token name)
 *
 * What the text model returns depends on the "Output format:" line of the system prompt
 * (services/interview/prompts.ts):
 *   interview_plan   a plan with an introduction, a depth round, a coding round when the
 *                    input looks technical, and a goals round
 *   answer_score     ratings that grow with how much the candidate said (or wrote), and
 *                    feedback; code with a "return" scores higher and gets a snippet
 * Anything else gets a short plain answer. "STUB_FAIL" anywhere in the user text answers
 * 500, "STUB_RATELIMIT" 429, "STUB_GARBAGE" returns text that is not JSON.
 *
 * Every request is recorded for GET /__/requests (newest first) and cleared by
 * POST /__/reset; realtime client secrets are listed at GET /__/realtime.
 *
 *   PORT=5139 node server.mjs
 */
import { randomBytes } from "node:crypto";
import http from "node:http";
import { pathToFileURL } from "node:url";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── HTTP helpers ──────────────────────────────────────────────────────────────

function readBody(req, limit = 5_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function sse(res) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  return {
    data: (obj) => res.write(`data: ${typeof obj === "string" ? obj : JSON.stringify(obj)}\n\n`),
    event: (name, obj) => res.write(`event: ${name}\ndata: ${JSON.stringify(obj)}\n\n`),
    end: () => res.end(),
  };
}

// ─── The text model ────────────────────────────────────────────────────────────

/** The text inside <untrusted source="name"> ... </untrusted>, or "". */
export function fenced(text, name) {
  const m = new RegExp(`<untrusted source="${name}[^"]*">\\n([\\s\\S]*?)\\n</untrusted>`).exec(text);
  return m ? m[1].trim() : "";
}

const TECH = /(engineer|developer|software|programm|backend|frontend|full[- ]stack|data scien|machine learning|devops|python|javascript|typescript|java\b|react|node)/i;

export function stubPlan(userText) {
  const source = fenced(userText, "resume") || fenced(userText, "job-description");
  const role = fenced(userText, "role") || (/(senior|lead|junior)?\s*(backend|frontend|software|data|product|machine learning)\s+(engineer|manager|scientist|analyst|developer)/i.exec(source)?.[0] ?? "Software Engineer");
  const company = fenced(userText, "company");
  const technical = TECH.test(`${role} ${source}`);
  const topic = /react|frontend/i.test(source) ? "React & Frontend" : /data|sql|analyt/i.test(source) ? "Data & SQL" : technical ? "Systems & Design" : "Role Depth";
  const rounds = [
    {
      name: "Introduction & Background",
      focus: "Communication and motivation",
      description: "How clearly the candidate tells their story and why this role fits.",
      questions: [
        { text: `Please introduce yourself and walk me through your background${company ? `, and tell me why ${company} interests you` : ""}.`, code: false, language: null },
        { text: "What has been the most meaningful project of your career so far, and what was your part in it?", code: false, language: null },
      ],
    },
    {
      name: topic,
      focus: `Depth for the ${role} role`,
      description: "Hands-on depth, trade-offs and real examples.",
      questions: [
        { text: `Tell me about a hard ${technical ? "technical" : "professional"} decision you made recently. What options did you consider?`, code: false, language: null },
        { text: "How do you check that your work actually achieved what it was meant to?", code: false, language: null },
      ],
    },
  ];
  if (technical) {
    rounds.push({
      name: "Coding & Problem-Solving",
      focus: "Implementation ability",
      description: "Correct, readable code. Judged on correctness, complexity and edge cases.",
      questions: [
        {
          text: "Problem: Write a function that returns the two indices of numbers in an array that add up to a target. Input: nums = [2, 7, 11, 15], target = 9. Output: [0, 1]. Hints: A single pass with a hash map is enough. Sample: twoSum([3, 3], 6) returns [0, 1]. Write your solution in Python.",
          code: true,
          language: "python",
        },
      ],
    });
  }
  rounds.push({
    name: "Goals & Culture Fit",
    focus: "Motivation and expectations",
    description: "Where the candidate wants to grow.",
    questions: [{ text: "Where do you want to be in two years, and how would this role help?", code: false, language: null }],
  });
  return {
    domain: technical ? "Software Engineering" : "Business",
    role,
    summary: source ? `Based on the ${fenced(userText, "resume") ? "resume" : "job description"}: ${source.replace(/\s+/g, " ").slice(0, 220)}` : `A ${role} interview.`,
    rounds,
  };
}

export function stubScore(userText) {
  const code = /<untrusted source="code/.test(userText) ? (/<untrusted source="code[^"]*">\n([\s\S]*?)\n<\/untrusted>/.exec(userText)?.[1] ?? "") : null;
  if (code !== null) {
    const good = /return/.test(code) && code.trim().length > 20;
    return {
      domainRating: good ? 80 : 40,
      communicationRating: good ? 76 : 45,
      strengths: good ? ["Returns a result", "Readable structure"] : ["Attempted the problem"],
      weaknesses: good ? ["No tests for edge cases"] : ["The solution is incomplete"],
      suggestions: ["Handle empty input", "State the time complexity"],
      analysis: good ? "A working approach with clear structure. Consider edge cases and complexity." : "The code does not yet solve the problem. Start from the hint and return the indices.",
      correctedSnippet: good ? null : "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i",
    };
  }
  const convo = fenced(userText, "conversation");
  const said = convo
    .split("\n")
    .filter((l) => l.startsWith("Candidate:"))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  const base = Math.min(92, 35 + said);
  return {
    domainRating: base,
    communicationRating: Math.min(95, base + 4),
    strengths: said > 20 ? ["Concrete example", "Clear structure"] : ["Answered directly"],
    weaknesses: said > 20 ? ["Could quantify the outcome"] : ["Very brief", "No example"],
    suggestions: ["Use a situation, action, result structure", "Add one measurable outcome"],
    analysis: said > 20 ? "A clear answer with a concrete example. Adding a measurable result would make it stronger." : "The answer was short. Give a specific example and explain your reasoning.",
    correctedSnippet: null,
  };
}

/** What the model says, given the system prompt and the last user text. */
export function decide(system, user) {
  if (/STUB_FAIL/.test(user)) return { status: 500 };
  if (/STUB_RATELIMIT/.test(user)) return { status: 429 };
  if (/STUB_GARBAGE/.test(user)) return { text: "I am not going to answer in JSON today." };
  if (/Output format: interview_plan/.test(system)) return { text: JSON.stringify(stubPlan(user)) };
  if (/Output format: answer_score/.test(system)) return { text: JSON.stringify(stubScore(user)) };
  if (/single word: ok/i.test(user)) return { text: "ok" };
  return { text: `This is a stub answer to: "${user.slice(0, 120)}".` };
}

const piecesOf = (text) => text.match(/.{1,40}/gs) ?? [text];

function failure(res, d) {
  if (d.status === 500) return send(res, 500, { error: { message: "stub failure" } }), true;
  if (d.status === 429) return send(res, 429, { error: { message: "rate limited (stub)" } }), true;
  return false;
}

async function openAiChat(res, body) {
  const msgs = body.messages ?? [];
  const system = msgs.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const lu = [...msgs].reverse().find((m) => m.role === "user");
  const parts = Array.isArray(lu?.content) ? lu.content : [{ type: "text", text: lu?.content ?? "" }];
  const user = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n");
  const d = decide(system, user);
  if (failure(res, d)) return;
  const id = `chatcmpl-${randomBytes(6).toString("hex")}`;
  const usage = { prompt_tokens: Math.ceil(JSON.stringify(msgs).length / 4), completion_tokens: Math.ceil(d.text.length / 4) + 5 };
  if (!body.stream) return send(res, 200, { id, object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: d.text }, finish_reason: "stop" }], usage });
  const s = sse(res);
  for (const piece of piecesOf(d.text)) {
    if (res.destroyed) return;
    s.data({ id, choices: [{ index: 0, delta: { content: piece } }] });
    await sleep(2);
  }
  s.data({ id, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  if (body.stream_options?.include_usage) s.data({ id, choices: [], usage });
  s.data("[DONE]");
  s.end();
}

async function anthropicMessages(res, body) {
  const lu = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
  const blocks = Array.isArray(lu?.content) ? lu.content : [{ type: "text", text: lu?.content ?? "" }];
  const d = decide(typeof body.system === "string" ? body.system : "", blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n"));
  if (failure(res, d)) return;
  const s = sse(res);
  s.event("message_start", { type: "message_start", message: { id: "msg_stub", usage: { input_tokens: 42, output_tokens: 1 } } });
  s.event("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  for (const piece of piecesOf(d.text)) s.event("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } });
  s.event("content_block_stop", { type: "content_block_stop", index: 0 });
  s.event("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: Math.ceil(d.text.length / 4) } });
  s.event("message_stop", { type: "message_stop" });
  s.end();
}

async function gemini(res, body, stream) {
  const contents = body.contents ?? [];
  const lu = [...contents].reverse().find((c) => c.role === "user");
  const d = decide((body.systemInstruction?.parts ?? []).map((p) => p.text).join("\n"), (lu?.parts ?? []).filter((p) => p.text).map((p) => p.text).join("\n"));
  if (failure(res, d)) return;
  const usageMetadata = { promptTokenCount: 40, candidatesTokenCount: Math.ceil(d.text.length / 4) + 3 };
  if (!stream) return send(res, 200, { candidates: [{ content: { role: "model", parts: [{ text: d.text }] }, finishReason: "STOP" }], usageMetadata });
  const s = sse(res);
  const pieces = piecesOf(d.text);
  for (let i = 0; i < pieces.length; i++) s.data({ candidates: [{ content: { role: "model", parts: [{ text: pieces[i] }] }, ...(i === pieces.length - 1 ? { finishReason: "STOP" } : {}) }], ...(i === pieces.length - 1 ? { usageMetadata } : {}) });
  s.end();
}

// ─── Server ────────────────────────────────────────────────────────────────────

export function createStubs(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 5139);
  const config = { publicUrl: options.publicUrl ?? process.env.STUB_PUBLIC_URL ?? `http://localhost:${port}` };
  const state = { requests: [], realtime: [], hangups: [] };

  async function handler(req, res) {
    const url = new URL(req.url ?? "/", "http://stub");
    const p = url.pathname;
    try {
      const raw = req.method === "POST" || req.method === "PUT" ? await readBody(req) : Buffer.alloc(0);
      const type = req.headers["content-type"] ?? "";
      const body = raw.length && type.includes("application/json") ? JSON.parse(raw.toString("utf8")) : {};
      if (!p.startsWith("/__/") && p !== "/up") {
        state.requests.unshift({ method: req.method, path: p, at: new Date().toISOString(), body: type.includes("json") ? body : null, headers: { authorization: req.headers.authorization ? "present" : "absent" } });
        state.requests.length = Math.min(state.requests.length, 200);
      }

      if (p === "/up") return send(res, 200, { ok: true });
      if (p === "/__/requests") return send(res, 200, state.requests);
      if (p === "/__/realtime") return send(res, 200, { secrets: state.realtime, hangups: state.hangups });
      if (p === "/__/reset" && req.method === "POST") return (state.requests.length = 0), (state.realtime.length = 0), (state.hangups.length = 0), send(res, 200, { ok: true });

      if (p === "/v1/chat/completions" && req.method === "POST") return openAiChat(res, body);
      if (p === "/anthropic/v1/messages" && req.method === "POST") return anthropicMessages(res, body);
      const gm = /^\/gemini\/v1beta\/models\/([^:]+):(streamGenerateContent|generateContent)$/.exec(p);
      if (gm && req.method === "POST") return gemini(res, body, gm[2] === "streamGenerateContent");

      if (p === "/v1/realtime/client_secrets" && req.method === "POST") {
        if (!String(req.headers.authorization ?? "").startsWith("Bearer ")) return send(res, 401, { error: { message: "missing key" } });
        if (/STUB_FAIL/.test(body.session?.instructions ?? "")) return send(res, 500, { error: { message: "stub failure" } });
        const value = `ek_stub${randomBytes(16).toString("hex")}`;
        const expires_at = Math.floor(Date.now() / 1000) + (body.expires_after?.seconds ?? 60);
        state.realtime.unshift({ value, session: body.session, at: new Date().toISOString() });
        state.realtime.length = Math.min(state.realtime.length, 100);
        return send(res, 200, { value, expires_at, session: body.session });
      }
      if (p === "/v1/realtime/calls" && req.method === "POST") {
        const auth = String(req.headers.authorization ?? "");
        if (!state.realtime.some((r) => `Bearer ${r.value}` === auth)) return send(res, 401, { error: { message: "unknown client secret" } });
        const callId = `rtc_stub${randomBytes(8).toString("hex")}`;
        res.writeHead(201, { "Content-Type": "application/sdp", Location: `/v1/realtime/calls/${callId}` });
        return res.end("v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=stub\r\nt=0 0\r\n");
      }
      const hang = /^\/v1\/realtime\/calls\/([\w-]+)\/hangup$/.exec(p);
      if (hang && req.method === "POST") return state.hangups.unshift(hang[1]), send(res, 200, {});
      if (p === "/gemini/v1alpha/auth_tokens" && req.method === "POST") {
        const name = `auth_tokens/stub${randomBytes(12).toString("hex")}`;
        state.realtime.unshift({ value: name, session: body, at: new Date().toISOString() });
        return send(res, 200, { name });
      }

      return send(res, 404, { error: { message: `no stub for ${req.method} ${p}` } });
    } catch (err) {
      if (!res.headersSent) send(res, 500, { error: { message: String(err?.message ?? err) } });
    }
  }

  return { handler, config, state };
}

/** Tests: listen on an ephemeral port. Returns the base URL and a close function. */
export async function startStubs(options = {}) {
  const stubs = createStubs({ ...options, port: options.port ?? 0 });
  const server = http.createServer((req, res) => void stubs.handler(req, res));
  await new Promise((resolve) => server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://${options.host ?? "127.0.0.1"}:${address.port}`;
  if (!options.publicUrl) stubs.config.publicUrl = url;
  return { ...stubs, url, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const stubs = createStubs();
  const port = Number(process.env.PORT ?? 5139);
  http.createServer((req, res) => void stubs.handler(req, res)).listen(port, "0.0.0.0", () => console.log(`stubs listening on ${port}`));
}
