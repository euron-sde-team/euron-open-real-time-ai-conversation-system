# Providers and models

Euron Open Conversation uses two kinds of model:

| Kind | Does | Providers |
| --- | --- | --- |
| `TEXT` | Writes the interview plan from a resume or job description, and scores every answer | OpenAI, Anthropic, Gemini, any OpenAI-compatible server (OpenRouter, Groq, Together, Ollama, vLLM, LM Studio), the stub |
| `REALTIME` | Holds the live voice conversation, one session per question | OpenAI Realtime, Gemini Live, the stub |

Both are rows in the `providers` and `models` tables, edited in `/admin/models`. Keys are
not: they come from the server's environment (or Secrets Manager on AWS), looked up by the
provider's slug on every call. How the realtime side works is in
[realtime-and-providers.md](../architecture/realtime-and-providers.md); the text adapters
are covered by [ADR 0004](../architecture/adr/0004-text-model-adapters.md).

## The starter catalogue

A brand-new database gets a starter catalogue on the API's first boot
([`apps/api/src/demo/catalog.ts`](../../apps/api/src/demo/catalog.ts)), so most installs
only need keys:

| Provider slug | Kind | Models (model ref) |
| --- | --- | --- |
| `openai` | `OPENAI` | `gpt-realtime` and `gpt-realtime-mini` (REALTIME), `gpt-5.4-mini` (TEXT) |
| `gemini` | `GEMINI` | `gemini-2.5-flash-native-audio-preview-09-2025` (REALTIME), `gemini-3.5-flash` (TEXT) |
| `anthropic` | `ANTHROPIC` | `claude-haiku-5-5` (TEXT) |
| `stub` | `STUB` | `stub-text` (TEXT) and `stub-voice` (REALTIME), both default. Outside production only |

Model ids change often. Treat these as a starting point: press **Test** on each and edit
the ref when a provider renames a model. Prices are left empty.

A model is offered only when it is enabled, its provider is enabled, and the provider is
usable: it has a key, or it is a kind that needs none (`STUB`, or an `OPENAI_COMPATIBLE`
server such as a local Ollama). So the OpenAI, Gemini and Anthropic rows stay invisible
until their key is set.

## Add a key

Locally, put the key in `deploy/compose/.env` and run `make up` again:

```bash
PROVIDER_KEYS={"openai":"<openai-key>","gemini":"<gemini-key>","anthropic":"<anthropic-key>"}
# or the single-key shortcuts
OPENAI_API_KEY=<openai-key>
GEMINI_API_KEY=<gemini-key>
ANTHROPIC_API_KEY=<anthropic-key>
```

The JSON keys are provider slugs, so a provider you create with slug `openrouter` reads
`PROVIDER_KEYS.openrouter` (or `OPENROUTER_API_KEY`). The shortcuts exist for `openai`,
`anthropic`, `gemini`, `openrouter` and `groq`; any other slug needs `PROVIDER_KEYS`.

On AWS, write the JSON into the `<name_prefix>/provider-keys` secret and roll the api and
worker services ([deploy-aws.md](deploy-aws.md#provider-keys)).

`/admin/models` shows "key configured" per provider. It never shows the key, and no API
response, log line or database row ever contains one.

## Providers

| Kind | Base URL when empty | Notes |
| --- | --- | --- |
| `OPENAI` | `https://api.openai.com/v1` | Text through Chat Completions; realtime through client secrets and WebRTC |
| `GEMINI` | `https://generativelanguage.googleapis.com/v1beta` (text) | Realtime tokens are minted at `GEMINI_LIVE_URL` (v1alpha) |
| `ANTHROPIC` | `https://api.anthropic.com` | Text only |
| `OPENAI_COMPATIBLE` | none: a base URL is required | Text only. Groq, OpenRouter, Together, Ollama (`http://host.docker.internal:11434/v1` from the compose containers), vLLM, LM Studio. Works without a key |
| `STUB` | `<STUBS_URL>/v1` | The deterministic fakes in `apps/stubs`. Refused in production (`400 STUB_IN_PRODUCTION`) |

A provider's slug is its id: lowercase letters, digits and hyphens, 3 to 40 characters,
and it is the name of its key.

## Models

| Field | Meaning |
| --- | --- |
| Kind | `TEXT` or `REALTIME`. A REALTIME model needs an OpenAI, Gemini or Stub provider (`400 REALTIME_PROVIDER_UNSUPPORTED`) |
| Model ref | The provider's model id, sent as is |
| Display name, description | What candidates see in the voice model picker |
| Max output tokens | Upper bound for one text call (the planner asks for up to 12,000, a score up to 3,000) |
| Voices | REALTIME only, at least one. The first is the default. OpenAI voices include `marin`, `cedar`, `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`; Gemini voices include `Kore`, `Puck`, `Charon`, `Aoede`, `Fenrir`, `Leda`, `Orus`, `Zephyr` |
| Input and output USD per million tokens | Optional. Only feed the estimated cost on the admin overview |
| USD per minute | REALTIME only, optional. Same purpose, multiplied by the server-measured voice seconds |
| Enabled, default, sort order | One default per kind |

Which model is used:

- **Planning and scoring**: the interview remembers the TEXT model that planned it and
  scores with the same one while it is usable; otherwise the default TEXT model, otherwise
  the first usable one. With none, creating an interview answers `503 NO_TEXT_MODEL`.
- **Live sessions**: the interview's voice model (chosen on the interview page), else the
  candidate's default in Settings, else the default REALTIME model. With none, starting a
  question answers `503 NO_REALTIME_MODEL`. The voice is the candidate's preference when
  the model lists it, else the model's first voice.

Nothing is billed. The cost estimate is `input_tokens x input price / 1e6 + output_tokens x
output price / 1e6 + voice_seconds x price per minute / 60`, summed from `usage_daily`.

## The Test button

`POST /api/admin/models/:id/test` makes one tiny real call and reports a short, key-free
result with the latency:

- a TEXT model is asked to reply with the word `ok`;
- a REALTIME model has a credential minted for it (no call is opened), which proves the key
  and the model ref.

Failures are mapped to plain messages ("The provider rejected the key", "check the model
id", "rate limiting this key"); provider error text never reaches the browser. The button
is rate limited to 20 calls a minute per admin.

## Local models

A local text model works for planning and scoring through `OPENAI_COMPATIBLE`. From the
compose containers, a server on your host answers at `http://host.docker.internal:<port>`
(on Linux too). Small local models often break the JSON format; the planner retries once,
then marks the interview `PLAN_FAILED`.

There is no local realtime voice provider. Without an OpenAI or Gemini key the stub voice
is the only option: the browser speaks the questions and the candidate types or dictates.
