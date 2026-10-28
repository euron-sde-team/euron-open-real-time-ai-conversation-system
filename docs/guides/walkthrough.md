# Walkthrough: one interview, end to end

A reading order for a new contributor: what lives where, then one mock interview followed
from the start screen to the report, naming every file and function on the way. Start the
stack ([quickstart-local.md](quickstart-local.md)) so you can try each step as you read. The
design behind each step is in [interview-engine.md](../architecture/interview-engine.md) and
[realtime-and-providers.md](../architecture/realtime-and-providers.md).

## 0. The map

```
apps/
  api/         Express 5 API and BullMQ worker (one image, entry points: index, worker, cli, migrate)
  web/         Next.js web app: home, new interview, the room, reports, shares, settings, /admin
  stubs/       deterministic text model and realtime credential stand-ins
packages/
  types/       DTOs and enums shared by api, web and any native client
  api-client/  the typed, DOM-free HTTP client (refresh, native token mode, uploads)
  ui/          components and design tokens
db/            migrate.ts and migrations/0001_init.sql
deploy/        docker compose for local development
infra/         Dockerfiles and Terraform (AWS, and the local AWS emulator)
e2e/           Playwright tests
```

Inside the API the layers are always the same: `routes/` (paths, guards, rate limits) ->
`controllers/` (strict zod parsing) -> `services/` (rules, take an `Actor`) -> Kysely ->
`presenters/` (DTOs field by field). Background work is a job in `jobs/`, enqueued through
`Effects` so nothing is queued for a transaction that rolled back
([`core/effects.ts`](../../apps/api/src/core/effects.ts)).

## 1. Starting from a job description

The candidate opens `/new` ([`components/interview/new-interview.tsx`](../../apps/web/src/components/interview/new-interview.tsx))
and submits company, role and job description. The client calls
`api().interviews.fromJobDescription()` ([`packages/api-client/src/endpoints/interviews.ts`](../../packages/api-client/src/endpoints/interviews.ts)).

- Route: `POST /api/interviews/from-job-description` in
  [`routes/interviews.routes.ts`](../../apps/api/src/routes/interviews.routes.ts), 10 per hour.
- Controller: `fromJobDescription` in [`controllers/interview.controller.ts`](../../apps/api/src/controllers/interview.controller.ts)
  (company 1 to 120 characters, role 2 to 120, job description 80 to 12,000).
- Service: `createFromJobDescription` in
  [`services/interview/interview.service.ts`](../../apps/api/src/services/interview/interview.service.ts).
  In one transaction it takes the user's quota lock (`lockUserQuota`, a Postgres advisory
  lock), checks the month's interviews (`assertInterviewLeft`), inserts the interview as
  `PLANNING`, books one interview in `usage_daily`, and queues `interview.plan`.

A resume takes the same path through `POST /api/interviews/from-resume`: multer keeps the file
in memory, `sniffResume` checks the bytes are a PDF or DOCX, `extractResumeText` reads it, and
only the text rides in the job payload, which leaves Redis when the job finishes
([ADR 0005](../architecture/adr/0005-resumes-never-stored.md)).

## 2. The planner job

The worker ([`worker.ts`](../../apps/api/src/worker.ts)) runs `planInterview` in
[`jobs/interview.jobs.ts`](../../apps/api/src/jobs/interview.jobs.ts):

1. `plannerFromJobDescription` (or `plannerFromResume`) in
   [`services/interview/prompts.ts`](../../apps/api/src/services/interview/prompts.ts) builds the
   prompt. The untrusted text is wrapped by `fence()` in an `<untrusted>` block the model is
   told to read as material, never as instructions.
2. `generateJson` in [`services/interview/ai.ts`](../../apps/api/src/services/interview/ai.ts)
   calls the text model through its adapter, parses the first JSON object, checks it against
   the schema, retries once, and books tokens.
3. `normalisePlan` in [`services/interview/plan.ts`](../../apps/api/src/services/interview/plan.ts)
   keeps valid rounds and questions (at most 8 of each) and fills a code question's language.
4. The interview becomes `READY` with its plan, or `PLAN_FAILED` with a plain reason, in
   which case the booked interview is given back.

Meanwhile the web app polls `GET /api/interviews/:id` every 1.5 s while the interview is
`PLANNING` ([`lib/interviews/queries.ts`](../../apps/web/src/lib/interviews/queries.ts)).

## 3. Reviewing the plan

`/i/[id]` ([`components/interview/interview-view.tsx`](../../apps/web/src/components/interview/interview-view.tsx))
shows the rounds. Edits go to `PATCH /api/interviews/:id` (`updateInterview`), which
validates the plan again and refuses with `409 INTERVIEW_STARTED` once a live session has
opened. The candidate can also pick a voice model here and turn proctoring on.

## 4. Opening a live session

**Start interview** leads to `/room/[id]` ([`components/room/room-view.tsx`](../../apps/web/src/components/room/room-view.tsx)).
After the preflight (microphone, camera when proctoring is on, or "continue by typing"),
`startQuestion` calls `POST /api/interviews/:id/live`.

`startLive` in [`services/interview/live.service.ts`](../../apps/api/src/services/interview/live.service.ts):

1. Loads the interview by owner (`ownedInterview`: another user's interview is a 404).
2. Resolves the voice model and voice, and builds the instructions with
   `interviewerInstructions` from the **stored** plan, summary and settings. Nothing from the
   request goes into them ([ADR 0003](../architecture/adr/0003-server-built-locked-realtime-instructions.md)).
3. In one transaction under the quota lock: closes any other open session of the user,
   computes the session's `max_seconds` (`voiceSecondsAllowed`: the tier's session length,
   capped by the minutes left this month), inserts a `live_sessions` row and moves the
   interview to `IN_PROGRESS`.
4. After commit, asks the realtime adapter to mint a short-lived credential
   ([`integrations/realtime/`](../../apps/api/src/integrations/realtime/index.ts)) with the
   instructions, the `end_question` tool, the voice and transcription inside it, and stores
   the credential's hash.

The answer is a `LiveSessionGrant`: provider, credential, model, voice, `connectUrl`,
`expiresAt`, `maxSeconds` and the question.

## 5. Talking to the interviewer

The room loads one transport for the grant's provider (`transportFor` in
[`lib/realtime/index.ts`](../../apps/web/src/lib/realtime/index.ts)):

| Provider | Transport | How it connects |
| --- | --- | --- |
| `openai` | [`lib/realtime/openai.ts`](../../apps/web/src/lib/realtime/openai.ts) | Plain WebRTC. The SDP offer goes to the API relay (`relayOpenAiSdp`), which checks the credential was minted for an open session (`claimRelay`), forwards it to OpenAI, remembers the call id for a later hang-up, and returns the answer. The client never sends `session.update` |
| `gemini` | [`lib/realtime/gemini.ts`](../../apps/web/src/lib/realtime/gemini.ts) | `@google/genai` Live over a WebSocket with the one-use ephemeral token, whose constraints fix the model, instructions, voice and tool |
| `stub` | [`lib/realtime/stub.ts`](../../apps/web/src/lib/realtime/stub.ts) | No network. Speaks the grant's `script` with the browser's speech synthesis; the candidate types or dictates |

Each transport emits the same events (`line`, `speaking`, `end_question`, `error`), and the
room collects the finished lines of the question into a transcript. The session clock counts
down from `maxSeconds`.

## 6. Ending a question

A question ends when the interviewer calls `end_question`, the candidate presses **Next
question** (or **Submit code**), or the clock runs out. `finish` in the room then:

1. closes the transport and calls `POST /api/interviews/:id/live/:sid/end` (`endLive`), which
   books the seconds measured on the server (`measuredSeconds` in
   [`services/interview/sessions.ts`](../../apps/api/src/services/interview/sessions.ts):
   mint to close, capped at `max_seconds`) and queues `interview.hangup` for an OpenAI call;
2. posts the transcript (or code) to `POST /api/interviews/:id/answers` (`submitAnswer`). The
   body schema is strict, so a client that tries to send ratings gets a 400. The answer is
   stored as `SCORING`, the interview moves to the next question (or `COMPLETED` after the
   last), and `interview.score` is queued with the answer's `updated_at` as its version;
3. after a short pause, opens the next live session.

## 7. Scoring

`scoreAnswer` in [`jobs/interview.jobs.ts`](../../apps/api/src/jobs/interview.jobs.ts) runs only
if the answer is still the version it was queued for (answering again replaces it). It uses
`voiceScorer` or `codeScorer` with the rubric, clamps ratings to 1 to 100, gives the floor (1)
when the candidate said nothing, and writes the feedback
([ADR 0007](../architecture/adr/0007-browser-transcript-server-scoring.md)).

## 8. The report and sharing

`/i/[id]/report` ([`components/report/report-view.tsx`](../../apps/web/src/components/report/report-view.tsx))
reads `GET /api/interviews/:id/report`. `buildReport` in
[`services/interview/report.service.ts`](../../apps/api/src/services/interview/report.service.ts)
computes round and overall averages in SQL over scored answers only, adds the transcript, the
voice time and the proctoring events. `GET /api/interviews/:id/report.pdf` renders the same
report as a PDF ([`services/interview/pdf.ts`](../../apps/api/src/services/interview/pdf.ts)).

**Share** creates a link (`createShare` in
[`services/share.service.ts`](../../apps/api/src/services/share.service.ts)): a ULID plus 22
random characters, optional expiry, transcript only when the owner includes it. Anyone with
the link opens `/s/[id]`, which reads `GET /api/shared/:id`.

## 9. Proctoring, when on

[`lib/realtime/proctor.ts`](../../apps/web/src/lib/realtime/proctor.ts) runs the MediaPipe face
detector from `/mediapipe/` on this origin every 1.5 s and watches tab visibility. A state
that holds for 3 s becomes an event (`NO_FACE`, `MULTIPLE_FACES`, `FACE_BACK`, `TAB_HIDDEN`,
`TAB_VISIBLE`); batches go to `POST /api/interviews/:id/proctor-events` every 10 s and show on
the report. Video never leaves the device ([ADR 0008](../architecture/adr/0008-proctoring-in-browser-only.md)).

## 10. Behind the scenes

The worker runs `interview.sweep` every minute: an `OPEN` session past its `expires_at`
(connect window plus `max_seconds` plus grace) becomes `EXPIRED`, books its full length and,
for OpenAI, is hung up. The admin overview at `/admin` sums `usage_daily` into counts, minutes
and an estimated cost; admins see interview metadata, never answers or transcripts.

## Where to go next

- The tables: [data-model.md](../architecture/data-model.md).
- The endpoints: [rest-contract.md](../api/rest-contract.md) and [realtime.md](../api/realtime.md).
- The tests that pin all of this down: [testing.md](testing.md).
