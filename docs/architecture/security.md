# Security architecture

The controls Euron Open Conversation relies on, where each lives in the code, and what it
does not cover. The STRIDE analysis is [threat-model.md](threat-model.md). How to report a
vulnerability: [SECURITY.md](../../SECURITY.md). Paths are relative to the repository root.

## 1. Authentication

| Control | Where | Detail |
| --- | --- | --- |
| Password hashing | [`apps/api/src/security/passwords.ts`](../../apps/api/src/security/passwords.ts) | bcrypt, cost `BCRYPT_ROUNDS` (12; below 12 refused in production) |
| Password policy | same | 10 to 128 characters, not one repeated character, not containing the email local part or the username (`WEAK_PASSWORD` otherwise) |
| Sign-in throttling | [`apps/api/src/services/auth.service.ts`](../../apps/api/src/services/auth.service.ts) | 5 failures per account and IP per 15 minutes, 50 per account per hour; once spent, every attempt is `429` whether the password is right or not |
| Generic answers | same | `INVALID_CREDENTIALS` for an unknown login and a wrong password alike; resend verification and forgot password always answer the same |
| Email verification | same | On by default (`REQUIRE_EMAIL_VERIFICATION`); single-use links valid 24 hours, stored as hashes |
| Password reset | same | Single-use links valid 1 hour, stored as hashes; a reset revokes every session |
| Two-factor | [`apps/api/src/security/totp.ts`](../../apps/api/src/security/totp.ts) | TOTP secret AES-256-GCM encrypted under `TOTP_ENCRYPTION_KEY`; each code works once; ten single-use recovery codes stored as HMACs |
| Registration control | [`apps/api/src/services/settings.service.ts`](../../apps/api/src/services/settings.service.ts) | `OPEN`, `INVITE_ONLY` (allowed email domains), `CLOSED` |
| Bootstrap admin | [`apps/api/src/cli.ts`](../../apps/api/src/cli.ts) | `admin:create` emails a set-password link and prints a password only with `--print-password` |

## 2. Sessions, cookies and CSRF

- **Access token**: HS256 JWT signed with `JWT_SECRET`, 15 minutes
  (`ACCESS_TOKEN_TTL_SECONDS`), with audience and issuer checked. The web app keeps it in
  memory only ([`apps/web/src/lib/session.ts`](../../apps/web/src/lib/session.ts)).
- **Refresh token**: random, 30 days (`REFRESH_TOKEN_TTL_DAYS`), in the `conv_refresh`
  cookie (`httpOnly`, `SameSite=Lax`, `Path=/api/auth`, `Secure` on https). Only its
  SHA-256 is stored.
- **Rotation and reuse detection**: every refresh rotates within a family; a rotated
  token presented 10 seconds or more after its rotation revokes the family.
- **Every request reloads the user**: a `token_version` mismatch (sign out everywhere,
  password change, ban, erase) invalidates outstanding access tokens at once.
- **Native token mode**: with `X-Client: native` the refresh token travels in the body
  instead of a cookie, through the same rotation code ([ADR 0009](adr/0009-native-token-mode.md)).
- **CSRF**: only `/api/auth/refresh` and `/api/auth/logout` use the cookie. They are covered
  by `SameSite=Lax`, the path scope, CORS (credentials only for allowed origins) and a
  check that refuses any non-GET request with a foreign `Origin`
  (`403 CORS_ORIGIN_DENIED`, [`apps/api/src/app.ts`](../../apps/api/src/app.ts)). Every
  other endpoint needs the bearer token.

## 3. Authorisation

### Roles

`USER` and `ADMIN`. Every admin service function starts with `requireAdmin`
(`403 FORBIDDEN_ADMIN`; a suspended admin has no powers)
([`apps/api/src/core/context.ts`](../../apps/api/src/core/context.ts)). Accounts that are
not `ACTIVE` can read but not write (`403 ACCOUNT_RESTRICTED`).

### Ownership is a 404

Every interview route loads the row with `WHERE id = ? AND user_id = ?`
(`ownedInterview`). Another user's interview, report, PDF, answers, live session,
proctoring events and share links answer `404`, indistinguishable from a missing id. The
integration test "another user gets 404 on every interview route" walks all of them.

### Admins cannot read transcripts

No admin endpoint returns an answer, a transcript, submitted code, a resume summary or a
plan. `GET /api/admin/interviews` returns metadata only: title, owner, status, counts,
score and voice minutes ([`apps/api/src/services/admin.service.ts`](../../apps/api/src/services/admin.service.ts)).
Erasing an account deletes its interviews without reading them. The only interview text an
outsider can see is a share link the owner created, and its transcript only if the owner
chose to include it.

### Strict bodies

Every body schema is `.strict()`: an unknown key is `400 VALIDATION_FAILED`. In
particular the answer endpoint has no rating fields, so a client cannot send a score, and
`POST /live` accepts only `{ round, question }`, so a client cannot send instructions,
a model or a voice.

## 4. Live voice

| Control | Detail |
| --- | --- |
| Server-built instructions | Built from the stored plan and locked into the provider credential at mint ([ADR 0003](adr/0003-server-built-locked-realtime-instructions.md)) |
| No provider key in the browser | The browser gets a short-lived credential: OpenAI `ek_...` (connection window `REALTIME_CONNECT_TTL_SECONDS`, default 120 s), a one-use Gemini token, or a signed stub token |
| One open session per user | Partial unique index; a new session closes the old one |
| Server-measured time | Minutes are booked from mint to close, never from a browser report ([quotas.md](quotas.md)) |
| Server hang-up | OpenAI calls are hung up when their session is closed, including by the sweeper ([realtime-and-providers.md](realtime-and-providers.md#5-session-length-and-hang-up)) |
| Bound SDP relay | Accepts only a credential whose hash matches an open OpenAI session minted here, inside its window, once; 64 KB body; 30 a minute per IP |
| Server scoring | The browser reports the transcript; only the scoring job writes ratings ([ADR 0007](adr/0007-browser-transcript-server-scoring.md)) |

## 5. Untrusted model input

Resume text, job descriptions, questions, summaries, transcripts and code are fenced in
`<untrusted>` blocks that input cannot close, and the prompts tell the model to treat them
as data. Every model output is validated by a zod schema before it is stored. Empty answers
get the floor score whatever the model says ([interview-engine.md](interview-engine.md)).

## 6. Resumes and personal data

- **Resumes are never stored** ([ADR 0005](adr/0005-resumes-never-stored.md)). The upload is
  read with multer's memory storage, the type is decided by magic bytes, the text is
  extracted in memory (no macros, scripts or external references followed), and the buffer
  is dropped. Only the planner's summary and plan persist.
- **The job payload leaves Redis.** The resume text travels to the worker in the
  `interview.plan` job, which is configured with `removeOnComplete: true` and
  `removeOnFail: true`, so it is deleted from Redis as soon as the job finishes either way.
  A resume interview therefore cannot be replanned; the user uploads again.
- **No interview text in usage rows or logs.** `usage_daily` holds counts and seconds.
  Request logs carry method, path and request id; job failures log the job name and
  attempt count. pino redacts passwords, tokens, codes, cookies, API keys and fields named
  `content`, `prompt`, `messages` and `input` at any depth up to three levels
  ([`apps/api/src/core/logger.ts`](../../apps/api/src/core/logger.ts)).
- **Camera frames never leave the browser.** Proctoring sends events only
  ([ADR 0008](adr/0008-proctoring-in-browser-only.md)).
- **Users control their data**: JSON export (`GET /api/users/me/export`, 3 a day),
  deleting an interview (cascades to answers, sessions, events and shares), and account
  deletion (erased after 14 days unless they sign in). Admins can set a retention period.

## 7. Model providers and keys

- Keys come only from `PROVIDER_KEYS` and the single-key shortcuts (`OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`); on AWS from
  the `<prefix>/provider-keys` secret. No table has a key column; admins see
  `keyConfigured` only ([ADR 0004](adr/0004-text-model-adapters.md)).
- Provider error bodies are logged truncated with key-shaped strings masked
  ([`apps/api/src/integrations/http.ts`](../../apps/api/src/integrations/http.ts)); users and
  admins see fixed messages.
- A canary key in the integration suite (`secrets.int.test.ts`) proves no response
  contains it.
- An admin cannot create a `STUB` provider in production (`400 STUB_IN_PRODUCTION`).

## 8. Shares

Share ids are a ULID plus 22 random base64url characters (132 random bits). Reads are
public, rate limited (120 a minute per IP), `no-store` and `X-Robots-Tag: noindex`. The
owner chooses whether the transcript and code are included; the owner's email and
account details are never part of a shared report. Revoked, expired, unknown and
malformed ids are the same `404`. Owners and admins can revoke; banning an account revokes
its links.

## 9. Headers and CSP

The API answers JSON only with Helmet defaults and `default-src 'none'`,
`frame-ancestors 'none'`.

The web app sets a per-request CSP with a nonce in
[`apps/web/src/middleware.ts`](../../apps/web/src/middleware.ts):

| Directive | Value | Why |
| --- | --- | --- |
| `script-src` | `'self' 'nonce-...' 'strict-dynamic' 'wasm-unsafe-eval'` (plus `'unsafe-eval'` in development) | `wasm-unsafe-eval` lets the self-hosted MediaPipe face detector compile its WebAssembly; it does not allow JavaScript `eval` |
| `connect-src` | `'self'` plus `REALTIME_ORIGINS` (default `wss://generativelanguage.googleapis.com`) | Gemini Live's WebSocket. OpenAI's handshake goes to this origin's `/api` relay and WebRTC media is not governed by `connect-src` |
| `style-src` | `'self' 'unsafe-inline'` | Radix positions popovers and CodeMirror sizes its editor with inline styles |
| `img-src`, `media-src` | `'self' data: blob:` / `'self' blob:` | |
| `worker-src` | `'self' blob:` | |
| `frame-src`, `frame-ancestors`, `object-src` | `'none'` | |
| `base-uri`, `form-action` | `'self'` | |

Static headers from [`apps/web/next.config.ts`](../../apps/web/next.config.ts): `nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`,
`Cross-Origin-Opener-Policy: same-origin`, and
`Permissions-Policy: camera=(self), microphone=(self), geolocation=(), payment=(), fullscreen=(self)`.

The MediaPipe WebAssembly and model are served from this origin (`/mediapipe/`), not a CDN.

## 10. Rate limits and quotas

Redis-backed limits on every expensive or abusable route, keyed by user or IP, with an
in-memory fallback during a Redis outage ([LLD.md](LLD.md#5-rate-limits)). Monthly
interviews and voice minutes per user, checked under an advisory lock
([quotas.md](quotas.md)). JSON bodies are capped at 2 MB, resumes at `MAX_RESUME_MB`.

## 11. The production guard

`assertProductionConfig` ([`apps/api/src/core/config.ts`](../../apps/api/src/core/config.ts))
refuses to boot with `NODE_ENV=production` when:

- `JWT_SECRET` or `REFRESH_SECRET` is the committed development default, shorter than 32
  characters, or the two are equal;
- `TOTP_ENCRYPTION_KEY` is the development default;
- `CORS_ORIGINS` is empty, or `APP_WEB_URL` points at localhost;
- `MAIL_MODE=outbox`, or another mail mode without `MAIL_FROM`;
- `JOBS_MODE=inline`;
- `BCRYPT_ROUNDS` is below 12.

`productionWarnings` logs, without refusing, a deployment with no provider key. On AWS the
JWT, refresh and TOTP secrets are generated by Terraform and provider keys start as
`set-me` placeholders that count as unset
([`infra/terraform/modules/secrets/main.tf`](../../infra/terraform/modules/secrets/main.tf)).

## 12. Infrastructure

| Control | Where |
| --- | --- |
| Private subnets for every task; one ALB with TLS | [`modules/network`](../../infra/terraform/modules/network/main.tf), [`modules/edge`](../../infra/terraform/modules/edge/main.tf) |
| Optional CloudFront with WAF and a secret origin header the ALB requires | [`modules/cdn`](../../infra/terraform/modules/cdn/main.tf), [`modules/deployment`](../../infra/terraform/modules/deployment/main.tf) |
| RDS encrypted with the deployment's KMS key, master password managed in Secrets Manager | [`modules/database`](../../infra/terraform/modules/database/main.tf) |
| ElastiCache with encryption in transit and at rest | [`modules/cache`](../../infra/terraform/modules/cache/main.tf) |
| Secrets in Secrets Manager, injected by ECS | [`modules/secrets`](../../infra/terraform/modules/secrets/main.tf) |
| Read-only root filesystem for containers | [`modules/service`](../../infra/terraform/modules/service/main.tf) |
| Alarms and encrypted logs | [`modules/observability`](../../infra/terraform/modules/observability/main.tf) |

No voice media crosses this infrastructure.

## 13. Supply chain and CI

- `pnpm install --frozen-lockfile`.
- The `checks` workflow runs lint, typecheck, unit tests, the OpenAPI check, the
  sanitization scan and `terraform validate` ([`.github/workflows/checks.yml`](../../.github/workflows/checks.yml)).
  Further opt-in workflows live in [`.github/workflows-full/`](../../.github/workflows-full).
- [`scripts/check-sanitization.sh`](../../scripts/check-sanitization.sh) refuses credentials,
  account ids, real emails and public IPs in committable files.

## 14. Problems of the original system, fixed by design

This project is a rewrite of an earlier, internal mock-interview tool. These were its
security problems and how this codebase avoids each one:

| Problem in the original | Fix here |
| --- | --- |
| Any signed-in user could read any interview or report by id | Every query is scoped by owner; others get 404 |
| An analytics endpoint returned every user's results to any signed-in user | Aggregates are admin only, and admins see metadata, not answers |
| Realtime instructions were built in the browser, allowing prompt injection and use of the voice model as a free general assistant | The server builds the instructions from the stored question and locks them into the credential (OpenAI session config, Gemini `liveConnectConstraints`) |
| Scores came from the client: the browser posted ratings and the server stored them | The client reports only that a question ended, with its transcript; the server scores with the text model and the API rejects rating fields |
| Unlimited credential minting | Monthly interview and voice-minute quotas, short credential lifetimes, one live session per user, rate limits |
| An SDP relay open to anyone holding a provider credential | The relay is kept (it helps on blocked networks) but bound to a session minted here, used once, rate limited and size capped |
| Resume files were kept and could reach logs | Parsed in memory and never stored; only the summary and plan persist; no resume or transcript text in logs |

## 15. Known limitations

- **The transcript is reported by the browser.** A candidate can fake their own answers.
  Acceptable for self-practice; see [threat-model.md](threat-model.md).
- **OpenAI sessions can be reconfigured from developer tools** with `session.update`,
  bounded by the session length and the server hang-up.
- **Proctoring is advisory.** It runs in the candidate's browser and can be bypassed.
- **Gemini ephemeral tokens are a v1alpha API.**
- **Admins are trusted with configuration**: an admin can point a provider's `base_url`
  at any host and change the interviewer's house rules.
- **No SSO** (OIDC or SAML); passwords and TOTP only.
