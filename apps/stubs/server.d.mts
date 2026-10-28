export interface StubRequest {
  method: string;
  path: string;
  at: string;
  body: unknown;
  headers: { authorization: "present" | "absent" };
}
export interface Stubs {
  handler(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): Promise<void>;
  config: { publicUrl: string };
  state: {
    requests: StubRequest[];
    /** Realtime client secrets and Gemini tokens minted, newest first, with the session config they carried. */
    realtime: { value: string; session: unknown; at: string }[];
    /** OpenAI call ids that were hung up, newest first. */
    hangups: string[];
  };
}
export function createStubs(options?: { port?: number; publicUrl?: string }): Stubs;
export function startStubs(options?: { port?: number; host?: string; publicUrl?: string }): Promise<Stubs & { url: string; close(): Promise<void> }>;
export function fenced(text: string, name: string): string;
export function stubPlan(userText: string): { domain: string; role: string; summary: string; rounds: unknown[] };
export function stubScore(userText: string): Record<string, unknown>;
export function decide(system: string, user: string): { text?: string; status?: number };
