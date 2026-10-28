# Realtime and providers

Two kinds of models run an interview ([data-model.md](data-model.md), `model_kind`):

| Kind | Job | Providers |
| --- | --- | --- |
| `TEXT` | Write the plan, score answers, answer the admin "Test" button | OpenAI, Anthropic, Gemini, any OpenAI-compatible server (Groq, OpenRouter, Together, Ollama, vLLM, ...), the stub |
| `REALTIME` | Hold the live voice conversation, one session per question | OpenAI Realtime, Gemini Live, the stub |

Both kinds come from the same `providers` and `models` tables, edited in Admin, Models.
Keys never live in the database: they are looked up by provider slug in `PROVIDER_KEYS`
(or the single-key shortcuts such as `OPENAI_API_KEY`) on every call
([ADR 0004](adr/0004-text-model-adapters.md), [configuration](../guides/configuration.md)).
A model is offered only when it is enabled, its provider is enabled, and the provider has
a key (or is a kind that needs none: `STUB`, `OPENAI_COMPATIBLE`).

## 1. Text model adapters

[`apps/api/src/integrations/llm/`](../../apps/api/src/integrations/llm/index.ts) defines one
`LlmAdapter` interface: `stream(request, endpoint)` yields `text`, `usage` and `finish`
events. The interview engine reads only the text and the usage.

| Provider kind | Adapter | Default base URL | JSON mode |
| --- | --- | --- | --- |
| `OPENAI` | `openai-chat.ts` (`max_completion_tokens`) | `https://api.openai.com/v1` | native |
| `OPENAI_COMPATIBLE` | `openai-chat.ts` (`max_tokens`) | none: the admin must set one | native where the server supports it |
| `ANTHROPIC` | `anthropic.ts` | `https://api.anthropic.com` | follows the prompt |
| `GEMINI` | `gemini.ts` | `https://generativelanguage.googleapis.com/v1beta` | native (`application/json`) |
| `STUB` | `openai-chat.ts` | `STUBS_URL/v1` | follows the prompt |

## 2. The realtime adapter interface

[`apps/api/src/integrations/realtime/types.ts`](../../apps/api/src/integrations/realtime/types.ts):

```ts
interface MintRequest {
  model: string; voice: string; instructions: string;
  tool: { name: string; description: string; parameters: Record<string, unknown> };
  transcriptionLanguage: string; // ISO-639-1 or "auto"
  connectTtlSeconds: number;     // how long the credential may be used to connect
  maxSeconds: number;            // how long the conversation may last
  script: string[];              // stub only
}
interface RealtimeAdapter {
  provider: "openai" | "gemini" | "stub";
  mint(req: MintRequest, apiKey: string | null, baseUrl: string): Promise<MintResult>;
  hangup?(callId: string, apiKey: string | null, baseUrl: string): Promise<void>;
}
```

`MintResult` is `{ credential, expiresAt, connectUrl }`. The API turns it into a
`LiveSessionGrant` ([realtime.md](../api/realtime.md)).

The browser has a matching `RealtimeTransport` interface
([`apps/web/src/lib/realtime/types.ts`](../../apps/web/src/lib/realtime/types.ts)):
`connect`, `sendText` (a typed message from the candidate), `setMuted`, `close`, and
events for transcript lines, who is speaking, `end_question` and errors.

To add a provider: implement `RealtimeAdapter` on the server, a `RealtimeTransport` in the
web app, extend `RealtimeProvider` in `packages/types`, and map a provider kind to it in
`realtimeProviderOf` ([`services/models.service.ts`](../../apps/api/src/services/models.service.ts)).

## 3. Server-built, locked instructions

The interviewer's instructions are built on the server from the stored plan
([interview-engine.md](interview-engine.md)) and placed in the provider session when the
credential is minted ([ADR 0003](adr/0003-server-built-locked-realtime-instructions.md)).
The browser receives a credential, never the instructions (except the stub's `script`,
which is just the question text). The browser cannot pick the instructions, the tool, the
model or the voice through the API: `POST /live` takes only `{ round, question }`, and
the integration test "locks server-built instructions into the OpenAI client secret,
whatever the request carries" checks it against the stubs' record of what was minted.

### OpenAI Realtime

`openai.ts` posts to `{base}/realtime/client_secrets`:

- `expires_after: { anchor: "created_at", seconds: REALTIME_CONNECT_TTL_SECONDS }`;
- `session`: `type: "realtime"`, the model, the instructions, the `end_question` function,
  `tool_choice: "auto"`, input noise reduction (`near_field`), input transcription with
  `gpt-4o-mini-transcribe` (and the language when not `auto`), server VAD turn detection
  that creates and interrupts responses, and the output voice.

The returned `ek_...` value is the credential. `connectUrl` is the API's relay,
`{PUBLIC_API_URL}/api/realtime/openai/calls`.

### Gemini Live

`gemini.ts` calls `authTokens.create` on the v1alpha API with:

- `uses: 1`;
- `newSessionExpireTime`: now plus the connection window;
- `expireTime`: now plus the connection window plus `maxSeconds`;
- `liveConnectConstraints`: the model and a config with audio responses, the system
  instruction, the `end_question` function, the prebuilt voice (and language code when
  not `auto`), and input and output audio transcription;
- `lockAdditionalFields: []`.

The token name is the credential. With constraints set, the Live API uses the
constrained model and config for the session; the config the browser passes to
`live.connect` is only there to satisfy the SDK's types.

### Stub

`stub.ts` returns a `stub_<payload>.<hmac>` token signed with `JWT_SECRET` and makes no
network call. The grant carries `script`: the greeting (first question only) and the
question text.

## 4. What is and is not enforceable

| Control | OpenAI | Gemini | Stub |
| --- | --- | --- | --- |
| Instructions, tool, model and voice set by the server at mint | yes | yes | n/a |
| The browser cannot change them later | **no**: a client secret does not lock the session; a client can send `session.update` on the data channel | yes, by the token's constraints (v1alpha) | n/a |
| Credential use is limited | the relay accepts it once, inside the connection window | `uses: 1`, `newSessionExpireTime` | shape only |
| Conversation length is bounded by the provider | no; the server hangs up | yes, `expireTime` | no |
| Server can end the call | yes, `POST /realtime/calls/{id}/hangup` with the call id learned at the relay | no API used; the token expires | n/a |

Our own web client never sends `session.update`
([`apps/web/src/lib/realtime/openai.ts`](../../apps/web/src/lib/realtime/openai.ts)). A
candidate with developer tools could, and turn the OpenAI session into a general voice
assistant until it is closed. That is a residual risk, bounded by the session length and
the hang-up below ([threat-model.md](threat-model.md)).

The transcript the server scores is reported by the browser either way
([ADR 0007](adr/0007-browser-transcript-server-scoring.md)).

## 5. Session length and hang-up

`max_seconds` for each session is the smaller of the tier's `max_session_minutes` (default
15) and the voice time left this month. Time is measured by the server, from minting to
the close, capped at `max_seconds` ([quotas.md](quotas.md)).

A session is closed, its seconds booked and (for OpenAI with a known call id) an
`interview.hangup` job queued, when:

1. the browser ends it (`POST /live/:sid/end`): after `end_question`, Next question,
   Submit code, Pause or Finish, or when the room's countdown from `maxSeconds` runs out;
2. the same user mints a new session (only one open session per user);
3. the interview is finished (`POST /complete`);
4. the sweeper finds it past `expires_at`, which is minting time plus
   `REALTIME_CONNECT_TTL_SECONDS` (default 120) plus `max_seconds` plus
   `REALTIME_GRACE_SECONDS` (default 60). The sweeper runs every minute and books the full
   `max_seconds`.

So a client that ignores its own countdown and never calls end keeps an OpenAI call open
at most about connect window plus session length plus grace plus one sweep interval, and
is charged the full session length against its monthly minutes.

## 6. Why OpenAI uses raw WebRTC through a relay

- **No SDK, no `session.update`.** The session is fully configured at mint. A thin
  transport (one peer connection, the microphone track, the `oai-events` data channel)
  has nothing that could send configuration, and nothing to keep in step with SDK
  releases.
- **Blocked networks.** Some corporate and campus networks block `api.openai.com`. The
  browser only talks to this API for the handshake; media then uses WebRTC, which often
  still works. Networks that also block UDP need another network
  ([troubleshooting](../guides/troubleshooting.md)).
- **Hang-up.** The relay sees the `Location` header of OpenAI's answer, so the server
  learns the call id and can end the call later.
- **The relay is not an open proxy.** It accepts only `ek_` credentials whose SHA-256
  matches an `OPEN` OpenAI session minted here, inside the connection window and not yet
  used, with an SDP body up to 64 KB, at 30 requests a minute per IP.

The CSP allows this without listing OpenAI: the SDP POST goes to this origin, and WebRTC
media is not governed by `connect-src`. Gemini Live is a WebSocket to
`wss://generativelanguage.googleapis.com`, so that origin is in the default
`REALTIME_ORIGINS` ([security.md](security.md)).

## 7. Testing a model

Admin, Models, Test (`POST /api/admin/models/:id/test`, 20 a minute):

- `TEXT`: one completion asking for the word "ok" with 16 output tokens.
- `REALTIME`: mints a credential with "Connection test." instructions, without opening a
  call. It proves the key and the model id.

The result is `{ ok, latencyMs, message }` with a key-free message.

## 8. Versions and churn

Realtime APIs change quickly. The OpenAI transport accepts both the current
`response.output_audio_transcript.*` and the older `response.audio_transcript.*` event
names. Gemini ephemeral tokens are a v1alpha API. Both sit behind the small interfaces
above, so a change stays inside one adapter and one transport.
