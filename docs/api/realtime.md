# Realtime API

How a client holds one question of a live voice interview. The design and its limits are
in [realtime-and-providers.md](../architecture/realtime-and-providers.md); this page is the
wire contract for a client (the web room today, a native app later).

## Lifecycle of one question

```text
POST /api/interviews/:id/live            -> LiveSessionGrant
connect to the provider with the grant   (openai | gemini | stub)
... interviewer asks, candidate answers ...
interviewer calls end_question, or the candidate presses Next, or maxSeconds runs out
close the provider connection
POST /api/interviews/:id/live/:sid/end   -> LiveSessionEnd
POST /api/interviews/:id/answers         -> 202 AnswerResult (scoring queued)
GET  /api/interviews/:id                 -> next position, or COMPLETED
```

One session per question. Only one session per user can be open: minting a new one closes
the previous one.

## 1. Mint: `POST /api/interviews/:id/live`

Body (optional, strict): `{ "round": 0, "question": 1 }`. Without it the server uses the
interview's current position. Nothing else is accepted; the instructions, model and voice
are chosen on the server.

Response **201** `LiveSessionGrant` (`Cache-Control: no-store`):

```json
{
  "id": "01JE2Q7H3XK4M5N6P7R8S9T0VW",
  "provider": "openai",
  "credential": "ek_...",
  "model": "gpt-realtime",
  "voice": "alloy",
  "connectUrl": "https://app.example.com/api/realtime/openai/calls",
  "expiresAt": "2026-10-28T10:02:00.000Z",
  "maxSeconds": 900,
  "question": { "round": 0, "index": 1, "text": "Walk me through ...", "code": false, "language": null }
}
```

| Field | Meaning |
| --- | --- |
| `id` | The live session id, for `.../live/:sid/end` |
| `provider` | Which transport to open: `openai`, `gemini` or `stub` |
| `credential` | Short-lived, never a provider API key. OpenAI: a client secret (`ek_...`). Gemini: an ephemeral token name. Stub: a signed `stub_...` token |
| `model`, `voice` | What the credential is bound to (for display) |
| `connectUrl` | OpenAI: the API's SDP relay. Others: `null` |
| `expiresAt` | After this the credential cannot open a new connection |
| `maxSeconds` | End the session by then. The server books at most this many seconds |
| `question` | What the interviewer is about to ask, for the screen |
| `script` | Stub only: the lines the local interviewer speaks |

Errors: `409 PLAN_NOT_READY`, `409 INTERVIEW_COMPLETED`, `400 QUESTION_NOT_FOUND`,
`429 QUOTA_EXCEEDED` (under 30 seconds of voice left this month), `502
REALTIME_UNAVAILABLE` (the provider refused; nothing is booked), `503 NO_REALTIME_MODEL`.
Rate limit: 40 an hour per user.

## 2. Connect

### OpenAI (`provider: "openai"`)

WebRTC, no SDK required:

1. Create an `RTCPeerConnection`. Add the microphone track (or a receive-only audio
   transceiver when typing). Create a data channel named `oai-events`.
2. Create an offer and set it as the local description.
3. `POST {connectUrl}` with `Content-Type: application/sdp`,
   `Authorization: Bearer {credential}`, body = the offer SDP (max 64 KB). Send no cookies.
4. Set the response body as the remote answer.
5. When the data channel opens, send `{ "type": "response.create" }` so the interviewer
   speaks first.

Relay responses: the SDP answer with a `Location` header (exposed to the browser);
`401 REALTIME_SESSION_INVALID` when the credential is unknown, already used, outside its
connection window or not an OpenAI session; `400 SDP_REQUIRED` when the body is not an SDP
offer; `502` when OpenAI refused or could not be reached. Rate limit: 30 a minute per IP.

Events to read on the data channel:

| Event | Use |
| --- | --- |
| `input_audio_buffer.speech_started` / `speech_stopped` | Candidate speaking indicator |
| `conversation.item.input_audio_transcription.completed` | A finished candidate line (`transcript`) |
| `response.output_audio_transcript.delta` / `.done` (older: `response.audio_transcript.*`) | The interviewer's line as it is spoken, then final |
| `output_audio_buffer.stopped`, `response.done` | Interviewer stopped speaking |
| `response.function_call_arguments.done` with `name: "end_question"` | The question is over. Reply with a `function_call_output` item (`{"ok":true}`) and do not request another response |
| `error` | Show the message |

To send a typed answer: a `conversation.item.create` with a user `input_text` message,
then `response.create`.

Do **not** send `session.update`. The session was configured at mint; the official client
never changes it.

### Gemini Live (`provider: "gemini"`)

Open a live session with `@google/genai` using the credential as the API key and
`apiVersion: "v1alpha"`, model = `grant.model`. The token's constraints fix the model,
instructions, tool, voice and transcription; any config the client passes is ignored.

- Stream microphone audio as 16 kHz PCM16.
- Play the model's 24 kHz PCM16; stop playback at once on `interrupted`.
- Read input and output transcriptions for the transcript.
- On a `toolCall` for `end_question`, send a tool response (`{ ok: true }`) and end the
  question.
- To make the interviewer speak first, send a short user turn such as
  "(The candidate has joined and is ready.)".

The token works once and only until `expiresAt` for a new connection; the provider ends
the session at the end of its allowed length.

### Stub (`provider: "stub"`)

No network. Show and (optionally) speak each line of `script`, then let the candidate type
or dictate. The stub never calls `end_question`: the candidate ends the question. Only
available where an admin configured a stub provider, which is refused in production.

## 3. End: `POST /api/interviews/:id/live/:sid/end`

No body. Response `LiveSessionEnd`:

```json
{ "seconds": 214, "voiceMinutesLeft": 96 }
```

`seconds` is measured on the server from minting to now, capped at `maxSeconds`.
`voiceMinutesLeft` is `null` when unlimited. Calling it again returns the same seconds.
A session that is never ended is expired by the server about
`REALTIME_CONNECT_TTL_SECONDS + maxSeconds + REALTIME_GRACE_SECONDS` after minting and
charged its full `maxSeconds`, so always end sessions, including when the user leaves.

## 4. Submit the answer: `POST /api/interviews/:id/answers`

```json
{
  "round": 0,
  "question": 1,
  "transcript": [
    { "role": "interviewer", "text": "Walk me through ..." },
    { "role": "candidate", "text": "Sure. At my last job ..." }
  ]
}
```

For a code question add `"code"` and optionally `"language"`. `"advance": false` keeps the
interview on the same question. Ratings cannot be sent. Response **202** `AnswerResult`
with `status: "SCORING"`; poll `GET /api/interviews/:id` (its `answers`) or fetch the
report later.

## 5. Proctoring events (optional)

When `Interview.proctoring` is true, send what the client observed:

```json
POST /api/interviews/:id/proctor-events
{ "events": [ { "kind": "TAB_HIDDEN", "occurredAt": "2026-10-28T10:04:12.000Z", "round": 0, "question": 1 } ] }
```

Kinds: `NO_FACE`, `MULTIPLE_FACES`, `FACE_BACK`, `TAB_HIDDEN`, `TAB_VISIBLE`, `CAMERA_OFF`.
1 to 100 events per request, 300 requests an hour. Response `{ "recorded": n }`;
`409 PROCTORING_OFF` when the interview has proctoring off. Never send video.
