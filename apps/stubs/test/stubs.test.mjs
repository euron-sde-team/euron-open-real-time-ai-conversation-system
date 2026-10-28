/* global fetch, TextDecoder */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decide, fenced, startStubs, stubPlan, stubScore } from "../server.mjs";

const PLAN_SYSTEM = "You are Avani...\nOutput format: interview_plan\nReturn one JSON object";
const SCORE_SYSTEM = "Score...\nOutput format: answer_score\nReturn one JSON object";

describe("the text model", () => {
  it("reads fenced material", () => {
    expect(fenced('x\n<untrusted source="role">\nData Analyst\n</untrusted>\ny', "role")).toBe("Data Analyst");
    expect(fenced("nothing here", "role")).toBe("");
  });

  it("plans a coding round for technical roles and not for others", () => {
    const tech = stubPlan('<untrusted source="resume">\nBackend engineer, Node.js and Postgres.\n</untrusted>');
    expect(tech.rounds.some((r) => r.questions.every((q) => q.code))).toBe(true);
    const pm = stubPlan('<untrusted source="company">\nExample Labs\n</untrusted>\n<untrusted source="role">\nOperations Manager\n</untrusted>\n<untrusted source="job-description">\nRun the warehouse team.\n</untrusted>');
    expect(pm.role).toBe("Operations Manager");
    expect(pm.rounds.some((r) => r.questions.some((q) => q.code))).toBe(false);
    expect(pm.rounds[0].questions[0].text).toContain("Example Labs");
  });

  it("scores longer answers higher and gives code a snippet when it is incomplete", () => {
    const short = stubScore('<untrusted source="conversation">\nCandidate: yes\n</untrusted>');
    const long = stubScore(`<untrusted source="conversation">\nCandidate: ${"word ".repeat(40)}\n</untrusted>`);
    expect(long.domainRating).toBeGreaterThan(short.domainRating);
    const bad = stubScore('<untrusted source="code:python">\npass\n</untrusted>');
    expect(bad.correctedSnippet).toContain("def two_sum");
    const good = stubScore('<untrusted source="code:python">\ndef f(nums):\n    return [0, 1]\n</untrusted>');
    expect(good.domainRating).toBe(80);
  });

  it("routes on the output format and the failure words", () => {
    expect(JSON.parse(decide(PLAN_SYSTEM, "plan").text).rounds.length).toBeGreaterThan(1);
    expect(JSON.parse(decide(SCORE_SYSTEM, "x").text).domainRating).toBeTypeOf("number");
    expect(decide(SCORE_SYSTEM, "STUB_FAIL").status).toBe(500);
    expect(() => JSON.parse(decide(PLAN_SYSTEM, "STUB_GARBAGE").text)).toThrow();
  });
});

describe("server", () => {
  let stubs;
  beforeAll(async () => {
    stubs = await startStubs();
  });
  afterAll(async () => {
    await stubs.close();
  });
  beforeEach(async () => {
    await fetch(`${stubs.url}/__/reset`, { method: "POST" });
  });

  it("streams chat completions", async () => {
    const res = await fetch(`${stubs.url}/v1/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stream: true, messages: [{ role: "system", content: SCORE_SYSTEM }, { role: "user", content: "hi" }] }) });
    const text = new TextDecoder().decode(await res.arrayBuffer());
    expect(text).toContain("domainRating");
    expect(text).toContain("[DONE]");
  });

  it("mints realtime client secrets, accepts the SDP offer with them, and records hang-ups", async () => {
    const mint = await fetch(`${stubs.url}/v1/realtime/client_secrets`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer sk-test" }, body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 60 }, session: { type: "realtime", instructions: "Ask the question." } }) });
    const { value } = await mint.json();
    expect(value).toMatch(/^ek_stub/);
    const call = await fetch(`${stubs.url}/v1/realtime/calls`, { method: "POST", headers: { "Content-Type": "application/sdp", Authorization: `Bearer ${value}` }, body: "v=0\r\n" });
    expect(call.status).toBe(201);
    const callId = call.headers.get("location").split("/").pop();
    const unknown = await fetch(`${stubs.url}/v1/realtime/calls`, { method: "POST", headers: { Authorization: "Bearer ek_nope" }, body: "v=0" });
    expect(unknown.status).toBe(401);
    await fetch(`${stubs.url}/v1/realtime/calls/${callId}/hangup`, { method: "POST" });
    const seen = await (await fetch(`${stubs.url}/__/realtime`)).json();
    expect(seen.secrets[0].session.instructions).toBe("Ask the question.");
    expect(seen.hangups).toEqual([callId]);
  });
});
