# Contributing

Thanks for helping improve Euron Open Conversation. This guide covers the workflow, the bar a
change has to clear, and the conventions the codebase follows.

## Ground rules

- **Open an issue first** for anything larger than a bug fix or a docs tweak, so we can
  agree on the approach before you invest time.
- **One concern per pull request.** A refactor and a feature are two PRs.
- **Security issues go through private reporting**, never a public issue. See
  [SECURITY.md](SECURITY.md).
- By contributing you agree your work is released under the [MIT License](LICENSE).

## Development setup

Requirements: Docker, Node 22+, pnpm 9 (`corepack enable`).

```bash
pnpm install
make up          # Postgres, Redis, the AWS emulator (provisioned by Terraform), Mailpit,
                 # the stubs (text models and realtime credentials),
                 # then migrate, api, worker and web
make demo        # an admin, four people, sample interviews and reports on the Stub
                 # provider (prints the logins and the demo password)
make test        # unit tests across every package
```

The app is at http://localhost:3550 and every mail it sends is readable at
http://localhost:8066. No provider key is needed: the Stub provider plans and scores
deterministically, and the stub voice speaks with the browser's own speech synthesis while
you type. [docs/guides/quickstart-local.md](docs/guides/quickstart-local.md)
lists every port and how to add a real key.

## Before you open a pull request

Each of these must pass:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
make test-integration            # API (HTTP) against a real Postgres and Redis, stubs in-process
make test-matrix                 # when you touched the mail backends
make e2e                         # when you touched a user flow or infrastructure
make tf-validate tf-lint tf-security   # when you touched infra/terraform
pnpm openapi --check             # when you touched a route (pnpm openapi regenerates)
make sanitize                    # no credentials, account ids, real emails or IPs
```

[docs/guides/testing.md](docs/guides/testing.md) explains each layer and the stub trigger
words that steer the fake text model.

## Conventions

**Layers (api).** Routes declare endpoints and guards; controllers parse the request with
strict zod schemas and write the response; services hold the business rules and take an
`Actor`, never a request; repositories hold the Kysely queries; presenters build DTOs field
by field. Background work (planning, scoring, hang-ups, the live session sweeper,
maintenance) is a BullMQ job enqueued after the transaction commits. Pure rules (plan
normalisation, prompts, display names) live next to their service or in
`apps/api/src/domain` and have unit tests ([LLD.md](docs/architecture/LLD.md)).

**Every query is scoped to its owner.** An interview, answer, live session, proctoring
event or share is read with the actor's id in the query, and another account's id is a 404.
A new endpoint that returns user content gets an integration test proving a second account
cannot read it. Admin endpoints never return answers, transcripts or plans.

**Resumes are never stored.** A resume is read in memory; only its text rides in the planner
job, which leaves Redis when it finishes. Never write a resume to disk, S3, the database or
a log ([ADR 0005](docs/architecture/adr/0005-resumes-never-stored.md)).

**Provider keys stay in the environment.** Never add a key column, a key field to a DTO, or
a log line that could carry one. Provider failures reach users only as a stable code, never as
provider text ([ADR 0004](docs/architecture/adr/0004-text-model-adapters.md)).

**Outside content is data.** Resume text, job descriptions, transcripts and submitted code
go to a model only inside `fence()` (an `<untrusted>` block the prompt says to read as
material), and every model output is checked by a schema before it is stored
([interview-engine.md](docs/architecture/interview-engine.md)).

**The server writes the interviewer's instructions.** Realtime instructions are built from
the stored plan and locked into the minted credential. Never let a request body, a query
parameter or the browser contribute to them, and never let a client send ratings
([ADR 0003](docs/architecture/adr/0003-server-built-locked-realtime-instructions.md),
[ADR 0007](docs/architecture/adr/0007-browser-transcript-server-scoring.md)).

**No interview text in logs or usage rows.** Log ids, counts and statuses; never resume
text, transcripts or instructions. The logger redacts some field names, but do not rely on
it ([ADR 0006](docs/architecture/adr/0006-monthly-quotas-counts-only-usage.md)).

**The DTOs are a contract.** `packages/types` is read by the web app and by native clients
that vendor it. Add fields, do not rename or remove them, and update
[docs/api/rest-contract.md](docs/api/rest-contract.md) (and
[docs/api/realtime.md](docs/api/realtime.md) for live sessions) in the same PR.

**Routes stay declarative.** One `router.<method>("<path>", ...guards, ctrl.fn);` per
endpoint with a `/** doc comment */` above: `scripts/gen-openapi.ts` builds
docs/api/openapi.yaml from exactly that shape.

**Configuration is validated.** Every environment variable is declared in
`apps/api/src/core/config.ts` and nowhere else; a new one is documented in
[docs/guides/configuration.md](docs/guides/configuration.md) in the same PR, and
security-relevant ones are enforced at boot by `assertProductionConfig`.

**Database changes are new migrations.** Add `db/migrations/NNNN_description.sql` and update
`apps/api/src/db/types.ts`. Never edit an applied migration: the runner refuses to start
when a checksum changes.

**New providers get stubs.** Teach `apps/stubs/server.mjs` to speak the new wire format or
realtime credential endpoint, so the integration suite stays hermetic
([realtime-and-providers.md](docs/architecture/realtime-and-providers.md)).

**Comments explain why.** The code says what it does. Comments are for the constraint, the
incident, or the trade-off that made it this way.

**Style.** Prettier and ESLint settle formatting. TypeScript strict mode everywhere.

## Commit messages

Imperative mood with an optional scope: `interview: keep the plan frozen after the first
session`, `web: keep the transcript when the connection drops`. Explain the *why* in the body when it is not
obvious.

## Architecture decisions

A change that alters a documented decision (the stack, single tenant, server-built locked
realtime instructions, text model adapters and keys, resumes never stored, monthly quotas
and counts-only usage, server-side scoring, browser-only proctoring, native token mode,
deployment topology) needs a new or updated ADR in
[docs/architecture/adr/](docs/architecture/adr/README.md) explaining the trade-off, linked
from the pull request.
