# Quickstart: run Euron Open Conversation locally

Start the whole stack on your machine with emulated AWS, seed demo accounts and interviews,
and hold a mock interview against a local stand-in interviewer. No cloud account and no
model API key are needed; adding a real key later is one line.

What runs ([`deploy/compose/compose.yaml`](../../deploy/compose/compose.yaml) plus
[`compose.floci.yaml`](../../deploy/compose/compose.floci.yaml)): Postgres 16, Redis 7,
Mailpit, the Floci AWS emulator provisioned by the production Terraform modules, the stubs
(text model and realtime credential stand-ins, [`apps/stubs`](../../apps/stubs/README.md)),
then a one-shot `migrate`, the `api`, the `worker` and the `web` app.

## Prerequisites

- Docker with Compose v2 (Docker Desktop, OrbStack, Colima or plain Docker Engine).
- `make`, `bash` and `openssl` (for `make env`).
- A browser with a microphone for a voice interview. Without one you can still answer by
  typing.
- For the tests and for running apps outside Docker: Node 22 (`.nvmrc`) and pnpm 9
  (`corepack enable`), then `pnpm install`.

## Start the stack

```bash
make up
```

`make up` runs `make env` first: it writes `deploy/compose/.env` with random, local-only
secrets (JWT and refresh secrets, the TOTP key, the demo password) and never overwrites a
value ([`scripts/gen-local-env.sh`](../../scripts/gen-local-env.sh)). Then it builds the
images, waits for the `terraform` one-shot to provision Floci, runs the migration and waits
until every service is healthy. The first build takes a few minutes. When it is done it
prints the URLs:

```
  app      http://localhost:3550
  api      http://localhost:5046/api/ready
  mail     http://localhost:8066
  ses      http://localhost:4617  (Floci)
  stubs    http://localhost:5139  (model and realtime stand-ins)
```

Check the API: `curl -s localhost:5046/api/ready` answers `{"ok":true}` when Postgres and
Redis respond.

On first boot the API creates the starter model catalogue
([`apps/api/src/demo/catalog.ts`](../../apps/api/src/demo/catalog.ts)): OpenAI, Gemini and
Anthropic models (hidden until their key is set) and, outside production, the **Local stub**
provider with `Stub planner` (TEXT) and `Stub voice` (REALTIME), both defaults. So the app
works before you seed anything.

## Ports

Every host port binds to `127.0.0.1` and can be moved in `deploy/compose/.env` (or your
shell) if it clashes with something else:

| Service | Host port | Variable |
| --- | --- | --- |
| Web app (and the `/api` proxy) | 3550 | `CONV_WEB_PORT` |
| API | 5046 | `CONV_API_PORT` |
| Postgres | 5512 | `CONV_PG_PORT` |
| Redis | 6449 | `CONV_REDIS_PORT` |
| Mailpit web UI / SMTP | 8066 / 1066 | `CONV_MAILPIT_PORT` / `CONV_SMTP_PORT` |
| Floci (SES, KMS, Secrets Manager) | 4617 | `CONV_FLOCI_PORT` |
| Stubs | 5139 | `CONV_STUB_PORT` |

The browser only ever talks to the web app: Next proxies `/api/*` to the API
(`API_INTERNAL_URL`), including the OpenAI WebRTC handshake relay, so the refresh cookie is
first-party exactly as behind the load balancer on AWS. The API port is published for curl
and the integration tools.

## Seed the demo

```bash
make demo
```

This runs `node dist/cli.js demo:seed` inside the API container
([`apps/api/src/demo/seed.ts`](../../apps/api/src/demo/seed.ts)) with `DEMO_PASSWORD` set
to `CONV_DEMO_PASSWORD` from `deploy/compose/.env`. It creates:

- the starter catalogue with the stub provider (if it is not there yet);
- an admin and four people, a `Coaching cohort` quota tier (30 interviews, 600 voice
  minutes, 20 minute sessions) that Priya and Sam are on, and thirty days of usage for the
  admin overview;
- for Priya: a finished "Senior Backend Engineer interview" from a resume (with a coding
  round, proctoring events and a share link), a finished "Senior Product Manager at Example
  Labs" interview from a job description, and a "Data Analyst interview" that is planned and
  ready to start;
- a finished interview for each of the others.

It refuses to run with `NODE_ENV=production`. If the demo admin already exists it only
prints the logins.

| Account | Email | Role |
| --- | --- | --- |
| Morgan Ellis | `admin@example.com` | ADMIN: `/admin` |
| Priya Nair | `priya.nair@example.com` | USER, the full demo history, `Coaching cohort` tier |
| Leo Marquez | `leo.marquez@example.com` | USER |
| Sam Kowalski | `sam.kowalski@example.com` | USER, `Coaching cohort` tier |
| Amara Okafor | `amara.okafor@example.com` | USER |

Every demo account signs in with the password `make demo` prints (`CONV_DEMO_PASSWORD` in
`deploy/compose/.env`).

## A first interview

Sign in at http://localhost:3550 as Priya.

1. Open the "Data Analyst interview" (or start one from **New interview**: paste a job
   description of at least 80 characters, or upload a PDF or DOCX resume).
2. Review the plan: rename or drop rounds, edit questions. The plan is fixed once the first
   live session opens.
3. Press **Start interview**, then **Join the interview**. The room asks for the microphone (and the camera when proctoring is on).
4. With the stub voice, the interviewer's lines are spoken with your browser's own speech
   synthesis and shown in the transcript. Type your answer (or dictate, where the browser
   supports speech recognition) and press **Next question** (or **Submit code** on a code question).
5. After the last question you land on the report. Scores appear as the scoring jobs
   finish (a second or two with the stub).

The stub text model is deterministic ([`apps/stubs/README.md`](../../apps/stubs/README.md)):
a plan always has an introduction, a depth round, a coding round when the input looks
technical, and a goals round; ratings grow with how many words you said, and code
containing `return` scores higher. The words `STUB_FAIL`, `STUB_RATELIMIT` and `STUB_GARBAGE`
in a job description make planning fail, so you can see the `PLAN_FAILED` path.

Every mail the stack sends (verification, password reset, the admin set-password link) is at
http://localhost:8066. `GET http://localhost:5139/__/requests` lists every request the API
sent to the stubs, and `GET http://localhost:5139/__/realtime` shows each minted realtime
credential with the instructions the server locked into it.

## The admin control plane

Sign in as `admin@example.com` and open `/admin`: the overview (usage and estimated cost),
users (roles, suspend, ban, erase, tier and per-user limits), quotas, models (providers,
models, the **Test** button), interviews (metadata only), shared links, settings and the
audit trail. Admins never see anyone's answers or transcripts.

## Use a real voice model

Add a key to `deploy/compose/.env`, either as one JSON object keyed by provider slug or with
a single-key shortcut (placeholders shown):

```bash
PROVIDER_KEYS={"openai":"<openai-key>","gemini":"<gemini-key>"}
# or
OPENAI_API_KEY=<openai-key>
```

then `make up` again (compose recreates the API and worker with the new environment). The
starter OpenAI and Gemini models appear: pick the voice model in the interview or in
Settings, and make a real TEXT model the default in `/admin/models` if you want real plans
and scores. Model ids change often: check one with **Test** and edit it there
([providers.md](providers.md)).

A real voice interview needs a microphone and a network that allows WebRTC (OpenAI) or a
WebSocket to Google (Gemini). See [troubleshooting.md](troubleshooting.md) when it does not
connect.

## Stop and reset

```bash
make down                 # stop everything and delete the volumes (database, emulator state)
make logs SERVICE=api     # tail one service: api, worker, web, stubs, migrate, floci, terraform
make ps                   # status
```

`deploy/compose/.env` survives `make down`; delete it to generate new secrets.

## Next

- Run the tests: [testing.md](testing.md).
- Follow one interview through the code: [walkthrough.md](walkthrough.md).
- Every setting: [configuration.md](configuration.md).
- Deploy it: [deploy-aws.md](deploy-aws.md).
