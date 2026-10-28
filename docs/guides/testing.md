# Testing

Four layers, from fast to slow:

| Layer | Command | Needs | Count |
| --- | --- | --- | --- |
| Unit tests (every package) | `make test` (`pnpm test`) | Node only | 232: API 84, web 95, api-client 29, ui 18, stubs 6 |
| API integration tests | `make test-integration` | Postgres and Redis (started from compose if needed) | 150 |
| Integration under each mail backend | `make test-matrix` | The local stack (`make up`) | 3 runs of the integration suite |
| Browser end-to-end | `make e2e` | The local stack plus the demo | 8 |

Every layer runs against the deterministic stubs in [`apps/stubs`](../../apps/stubs/README.md),
so no test calls a real model provider and no test needs a key.

## Unit tests

```bash
make test                                    # every package, through turbo
pnpm --filter @open-conversation/api test    # one package
```

Vitest, no database, no network. What they cover:

| Package | Files | Covers |
| --- | --- | --- |
| `apps/api` | [`test/unit`](../../apps/api/test/unit) | Plan normalisation and code language detection, prompt fencing, next-position logic, server-measured seconds (`interview.test.ts`), the text model adapters' wire formats (`llm-adapters.test.ts`), logger redaction, display name and username rules, HTTP helpers, production config guards (`hardening.test.ts`) |
| `apps/web` | [`test`](../../apps/web/test) | The CSP builder and `REALTIME_ORIGINS` parsing (`lib/csp.test.ts`), error code mapping, session handling, auth forms, settings, admin pages and charts |
| `packages/api-client` | [`test`](../../packages/api-client/test) | The HTTP client: refresh and retry, native token mode, errors, pagination |
| `packages/ui` | [`test`](../../packages/ui/test) | Shared components |
| `apps/stubs` | [`test`](../../apps/stubs/test) | The stubs' wire formats and decisions |

## Integration tests

```bash
make test-integration
```

This runs [`scripts/test-db.sh`](../../scripts/test-db.sh) (starts the compose Postgres and
Redis when nothing listens on 5512 and 6449), then:

```bash
TEST_DATABASE_URL=postgres://conv:conv@localhost:5512/conv_test \
TEST_REDIS_URL=redis://localhost:6449/1 pnpm test:integration
```

The suite mounts the real Express app in-process with supertest against a real Postgres and
Redis ([`vitest.integration.config.mts`](../../vitest.integration.config.mts)):

- **Safety.** `TEST_DATABASE_URL` is required and must name a database ending in `_test`
  ([`guard.ts`](../../apps/api/test/integration/guard.ts)). The global setup drops,
  recreates and migrates it once per run, and flushes only a numbered, non-zero Redis
  database.
- **Hermetic providers.** The stubs start in-process on an ephemeral port. `STUBS_URL`,
  `OPENAI_REALTIME_URL` and `GEMINI_LIVE_URL` point at them, so minting a realtime
  credential, the SDP relay and the hang-up all hit the stubs
  ([`env.ts`](../../apps/api/test/integration/env.ts)).
- **Deterministic jobs.** `JOBS_MODE=inline` runs planning and scoring right after commit,
  so a test can assert the result of the request it just made. Rate limits are off unless a
  test turns them on.
- **Shared database.** Files run one at a time. Every test creates its own users, and a
  test that changes shared state (settings, the default tier, the model catalogue) restores
  it.

What the suite proves, among other things:

| File | Proves |
| --- | --- |
| `interviews.int.test.ts` | Planning from a job description; the JD is fenced as untrusted in the planner prompt; a failed plan becomes `PLAN_FAILED` and gives the interview back; resumes are refused by their bytes, not their name; plan edits freeze after the start; the instructions locked into an OpenAI client secret come from the stored plan, whatever the request carries; one open live session per user; seconds measured on the server and capped; the sweeper books abandoned sessions; posted ratings are ignored; an empty answer gets the floor; another user gets 404 on every interview route; proctoring events only when proctoring is on |
| `quotas.int.test.ts` | The default tier, tiers and field-by-field overrides, 429 `QUOTA_EXCEEDED` at the limit, of 5 parallel creations with 2 left exactly 2 succeed, deleting an interview does not give quota back, voice minutes cap the next session, usage rows hold counts only |
| `shares.int.test.ts` | Long random ids, at most ten live links per interview, transcript and code hidden unless included, revoked, expired, unknown and malformed ids are the same 404, admin takedown, the sharing switch |
| `admin.int.test.ts` | 403 `FORBIDDEN_ADMIN` for users, role changes and `LAST_ADMIN`, suspend, ban, erase, tiers, providers report `keyConfigured` never a key, model tests with key-free messages, settings audited, the interview list is metadata only |
| `secrets.int.test.ts` | The provider key canary (below) |
| `auth.int.test.ts`, `native-auth.int.test.ts`, `account.int.test.ts`, `me.int.test.ts`, `hardening.int.test.ts` | Sign-up, sign-in, two-factor, sessions and rotation, native token mode, export and deletion, headers and limits |

### The provider key canary

`env.ts` sets `OPENAI_API_KEY` to a known canary value. `secrets.int.test.ts` fails if the
canary appears in any response a user or an admin can fetch, or anywhere in the database.

## The stubs

[`apps/stubs/server.mjs`](../../apps/stubs/server.mjs) is one dependency-free Node script
that speaks the OpenAI-compatible, Anthropic and Gemini text wire formats and the realtime
credential endpoints (OpenAI client secrets, the WebRTC call handshake and hang-up, Gemini
ephemeral tokens). The text model reads the `Output format:` line of the system prompt:

| Output format | Answer |
| --- | --- |
| `interview_plan` | Introduction, a depth round, a coding round when the input looks technical, a goals round |
| `answer_score` | Ratings that grow with the candidate's word count; code containing `return` scores 80/76, other code 40/45 with a corrected snippet |

Trigger words in the user text: `STUB_FAIL` (HTTP 500), `STUB_RATELIMIT` (429),
`STUB_GARBAGE` (not JSON). Tests read what the API sent through `state` (or
`GET /__/requests` and `GET /__/realtime` over HTTP), which is how they assert the exact
instructions the server locked into a credential.

The web app has a matching **stub transport**: the interviewer's lines arrive in the grant's
`script`, are spoken with the browser's speech synthesis (skipped in automated browsers) and
the candidate types. That is what the e2e tests drive.

## Backend matrix

```bash
make up
make test-matrix                 # MAIL_MODE outbox, smtp (Mailpit) and ses (Floci)
ONLY=ses make test-matrix        # one row
FILTER=auth make test-matrix     # only matching test files
```

[`scripts/test-matrix.sh`](../../scripts/test-matrix.sh) runs the whole integration suite
once per mail backend, each on a fresh `_test` database and its own Redis logical database,
and prints a table.

## End-to-end tests

```bash
make e2e
```

Playwright against the local stack and the demo ([`e2e/playwright.config.ts`](../../e2e/playwright.config.ts)).
The specs live in [`e2e/tests`](../../e2e/tests): sign-up and sign-in, an interview from a job
description (plan edit, the room by typing, finish, report), a coding question in the editor, a
resume upload (and a fake PDF refused), share and revoke, the admin console and quotas, and an
axe accessibility check of the home, plan and report pages. Each test creates its own users. Useful variables: `E2E_BASE_URL`,
`E2E_API_URL`, `E2E_DEMO_PASSWORD` (defaults to `CONV_DEMO_PASSWORD`), `E2E_HEADED=1`.

## Static gates

| Gate | Command |
| --- | --- |
| Lint, typecheck | `pnpm lint`, `pnpm typecheck` |
| OpenAPI reference matches the routes | `pnpm openapi --check` (`pnpm openapi` regenerates [`docs/api/openapi.yaml`](../api/openapi.yaml)) |
| Sanitization (credentials, account ids, real emails, IPs) | `make sanitize` |
| Terraform | `make tf-validate`, `make tf-lint`, `make tf-security` |

## CI

[`.github/workflows/checks.yml`](../../.github/workflows/checks.yml) runs on every push and
pull request: lint, typecheck, unit tests, the OpenAPI check, the sanitization scan, and
Terraform format and validate. The full pipeline (integration tests on Postgres and Redis,
image builds, Terraform security, gitleaks, e2e) is in
[`.github/workflows-full/`](../../.github/workflows-full/README.md); enable it in your fork.
