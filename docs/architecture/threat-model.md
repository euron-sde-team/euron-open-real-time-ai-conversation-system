# Threat model

A STRIDE pass over Euron Open Conversation as built. Controls are described in
[security.md](security.md); this page ties threats to them and lists what remains.

## Assets

| Asset | Why it matters |
| --- | --- |
| Interview content: summaries, plans, transcripts, code, scores, feedback | Personal and career information |
| Resume text | Highly personal; exists only in memory and briefly in a queue payload |
| Accounts and sessions | Access to the above |
| Provider API keys | Direct spend on the operator's provider accounts |
| Voice minutes and model tokens | Cost |
| Admin powers | Control of the whole deployment |

## Trust boundaries

1. Browser to web app and API (the internet).
2. Browser to realtime provider (credential issued by the API, media direct).
3. API and worker to text and realtime providers (operator's keys).
4. API and worker to Postgres and Redis (private network).
5. Admin to `/admin` (a privileged user inside boundary 1).

Every input that crosses boundary 1 or 3 into a prompt (resume, job description,
transcript, code, model output) is untrusted.

## STRIDE

| Threat | Example | Controls | Residual |
| --- | --- | --- | --- |
| **Spoofing** | Stolen or guessed credentials | bcrypt, failure budgets, TOTP with recovery codes, email verification | Phishing; no SSO |
| Spoofing | Replayed refresh token | Rotation with family revocation, hashes only | A token stolen and used before the owner's next refresh works until then |
| Spoofing | Calling the relay with someone else's or a forged credential | The relay matches the credential's hash to an open session minted here, inside its window, once | None known |
| **Tampering** | Posting your own scores | Strict answer schema has no rating fields; only the scoring job writes ratings | Fake transcript (see residual risks) |
| Tampering | Changing the interviewer's instructions through the API | `POST /live` takes only a position; instructions are built from the stored plan | OpenAI `session.update` from developer tools (see residual risks) |
| Tampering | Editing the plan after the interview started to change questions | Plan frozen once the first live session opens (`409 INTERVIEW_STARTED`) | None known |
| Tampering | Prompt injection in a resume, job description or transcript | `<untrusted>` fences that input cannot close, explicit "ignore instructions" rules, zod-validated outputs, the empty-answer floor | A model may still be swayed within the valid output shape (for example a generous score) |
| Tampering | A stale scoring job overwriting a newer answer | Version check on `updated_at` for read and write | None known |
| **Repudiation** | An admin denies changing a quota or banning a user | Audit log with actor, action, entity, IP and before/after data for settings | Audit rows live in the same database an admin of the infrastructure can edit |
| **Information disclosure** | Reading another user's interview by id | Owner-scoped queries, 404 for others | None known |
| Information disclosure | An admin reading transcripts | No admin endpoint returns answers, transcripts, code, summaries or plans | Anyone with database access can read them |
| Information disclosure | Resume retained | Memory-only parsing, nothing stored, queue payload removed on completion or failure | Resume text sits in Redis while the planner job waits or runs |
| Information disclosure | Interview text in logs | Logs carry method, path and ids; secret and content field names redacted | A future log line that adds a new field name would not be redacted by name |
| Information disclosure | Guessing share links | 132 random bits, rate limited reads, `noindex` | Anyone the owner sends the link to can forward it until it is revoked or expires |
| Information disclosure | Provider key leak | Keys only in env or Secrets Manager, never returned, masked in logs, canary test | Anyone with task environment access sees them |
| Information disclosure | Camera video leaving the device | Face detection runs in the browser; only events are sent | None known |
| **Denial of service** | Flooding creation or minting | Rate limits per user and IP, monthly quotas under an advisory lock, one open session per user | Many accounts on open registration; use `INVITE_ONLY` or `CLOSED` |
| Denial of service | Large uploads or bodies | Resume size cap in memory, 2 MB JSON cap, 64 KB SDP cap, transcript and code caps | Text extraction of a crafted PDF within the size cap still costs CPU |
| Denial of service | Redis outage | Rate limits fall back to memory per task | Jobs pause until Redis returns |
| **Elevation of privilege** | A user calling admin routes | `requireAdmin` in every admin service function | None known |
| Elevation of privilege | Demoting or locking out the last admin | `409 LAST_ADMIN`, `403 SELF_ACTION`, `403 TARGET_PROTECTED` | An admin can promote others; admins are trusted |
| Elevation of privilege | Mass assignment of `role`, `status`, `user_id` | Strict schemas and explicit field lists | None known |

## Residual risks

### A candidate can fake their own transcript

The transcript of each question is assembled in the browser from the provider's
transcription events and posted to `POST /api/interviews/:id/answers`. A candidate who
edits the request can submit any text as their answer, and the scorer will score it. The
server guarantees that ratings come from its own model and that silence scores 1, but it
cannot prove what was said aloud.

This is acceptable because the product is for self-practice: the only person misled is the
one faking. A deployment that needs evidence (hiring, certification) would need a server
sideband that receives the provider's own transcript (OpenAI offers a server WebSocket to
an existing call), which is not built ([ADR 0007](adr/0007-browser-transcript-server-scoring.md)).

### OpenAI `session.update` from developer tools

OpenAI client secrets carry a full session configuration, but they do not lock it: a
client holding the WebRTC data channel can send `session.update` and replace the
instructions or tools. Our client never does, but a candidate with developer tools could,
turning the session into a general voice assistant at the operator's expense.

Mitigations:

- the credential works for one connection, through the relay, only inside its connection
  window;
- each session is capped at `max_seconds` (the tier's session length or the minutes left,
  whichever is smaller) and charged against the user's monthly minutes, measured on the
  server;
- the server hangs the call up when the session closes: on the browser's end call, a new
  session, finishing, or at the latest when the sweeper expires it (connect window plus
  `max_seconds` plus `REALTIME_GRACE_SECONDS` after minting) and books the full length;
- only one session per user can be open.

So the abuse is bounded per user by the monthly voice minutes. Gemini does not have this
gap because its token's `liveConnectConstraints` fix the configuration
([realtime-and-providers.md](realtime-and-providers.md#4-what-is-and-is-not-enforceable)).

### Gemini v1alpha ephemeral tokens

Gemini Live ephemeral tokens and `liveConnectConstraints` are a v1alpha API. Their
behaviour (including which fields are locked) may change without notice. Pin the SDK,
watch release notes, and re-run the realtime model Test after upgrades.

### Proctoring is advisory only

Face presence and tab visibility are checked in the candidate's browser. A candidate can
disable the script, feed a still image, use a second device, or block the events request.
The events are hints on the report, not evidence ([ADR 0008](adr/0008-proctoring-in-browser-only.md)).

### Other

- **Admins are trusted.** They can point a provider's base URL anywhere (sending plans and
  scoring prompts there), edit house rules that reach every interviewer prompt, and erase
  accounts.
- **Open registration costs money.** Each account gets the default tier's minutes. Use
  invite-only registration or a small default tier for public deployments.
- **Scores are model judgements.** They can be wrong, and they can vary between runs and
  between models.
