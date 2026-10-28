/**
 * OpenAI Realtime over WebRTC. POST /realtime/client_secrets with the full session
 * (model, instructions, the end_question tool, voice, transcription, server VAD) returns
 * an `ek_...` secret the browser uses for the SDP handshake, which goes through this
 * API's relay (routes/realtime.routes.ts) so the call id is known here and the server
 * can hang the call up when the session's time is over.
 */
import { config } from "../../core/config";
import { providerFetch } from "../http";
import { RealtimeMintError, type RealtimeAdapter } from "./types";

export const openAiRealtime: RealtimeAdapter = {
  provider: "openai",
  async mint(req, apiKey, baseUrl) {
    if (!apiKey) throw new RealtimeMintError("No key is configured for this provider");
    const res = await providerFetch("openai", `${baseUrl.replace(/\/$/, "")}/realtime/client_secrets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: req.connectTtlSeconds },
        session: {
          type: "realtime",
          model: req.model,
          instructions: req.instructions,
          tools: [{ type: "function", name: req.tool.name, description: req.tool.description, parameters: req.tool.parameters }],
          tool_choice: "auto",
          audio: {
            input: {
              noise_reduction: { type: "near_field" },
              transcription: { model: "gpt-4o-mini-transcribe", ...(req.transcriptionLanguage !== "auto" ? { language: req.transcriptionLanguage } : {}) },
              turn_detection: { type: "server_vad", create_response: true, interrupt_response: true },
            },
            output: { voice: req.voice },
          },
        },
      }),
    });
    if (!res.ok) throw new RealtimeMintError(`The voice provider refused the session (HTTP ${res.status})`, res.status);
    const data = (await res.json()) as { value?: string; expires_at?: number; client_secret?: { value?: string; expires_at?: number } };
    const value = data.value ?? data.client_secret?.value;
    const expires = data.expires_at ?? data.client_secret?.expires_at;
    if (!value) throw new RealtimeMintError("The voice provider returned no credential");
    return {
      credential: value,
      expiresAt: expires ? new Date(expires * 1000) : new Date(Date.now() + req.connectTtlSeconds * 1000),
      connectUrl: `${config.PUBLIC_API_URL.replace(/\/$/, "")}/api/realtime/openai/calls`,
    };
  },
  async hangup(callId, apiKey, baseUrl) {
    if (!apiKey) return;
    await providerFetch("openai", `${baseUrl.replace(/\/$/, "")}/realtime/calls/${encodeURIComponent(callId)}/hangup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  },
};
