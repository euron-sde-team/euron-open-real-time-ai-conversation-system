# Configuration

Euron Open Conversation is configured in three places:

1. **API environment variables**, read by the API, the worker and the one-off tasks. Every
   one is declared and validated in
   [`apps/api/src/core/config.ts`](../../apps/api/src/core/config.ts) and nowhere else.
2. **Web environment variables**, read by the Next server at request time
   ([`apps/web/src/lib/runtime-env.ts`](../../apps/web/src/lib/runtime-env.ts),
   [`apps/web/src/middleware.ts`](../../apps/web/src/middleware.ts)), so one image fits
   every environment.
3. **Deployment settings**, stored in the database and edited in `/admin/settings`
   (name, registration, interviewer, features, retention).

Providers, models, voices and prices live in the database too, edited in `/admin/models`
([providers.md](providers.md)). Quota tiers live in `/admin/quotas`
([quotas.md](../architecture/quotas.md)).

## API environment

Booleans accept `true`, `false`, `1` or `0`. Lists are comma separated. An invalid value
stops the process at boot with a list of every problem.

### Core

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production`. Production turns the guards below into hard failures |
| `PORT` | `5046` | API listen port |
| `PRODUCT_NAME` | `Euron Open Conversation` | Default app name in mail and the PDF report (the admin setting `appName` overrides it in the UI) |
| `APP_WEB_URL` | `http://localhost:3550` | The web app origin. Emailed links and share URLs (`/s/<id>`) use it; CORS defaults to it |
| `PUBLIC_API_URL` | `http://localhost:5046` | This API's public origin. The OpenAI `connectUrl` in a live session grant is `<PUBLIC_API_URL>/api/realtime/openai/calls`, so it must be the origin the browser reaches the API on (the web origin when both share one host) |
| `CORS_ORIGINS` | (empty: `APP_WEB_URL`) | Origins allowed to call with credentials. Non-GET requests from any other `Origin` get `403 CORS_ORIGIN_DENIED` |
| `TRUST_PROXY` | `1` | Express `trust proxy` hop count, so `req.ip` (rate limits, audit) is the client's address. Terraform sets 2 behind CloudFront |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |

### Database and Redis

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | none | A static Postgres URL (local, CI). Leave unset on AWS |
| `DATABASE_SECRET_ARN` | none | On AWS: the RDS-managed secret. The password is read from it for every new connection (cached 60 s), so a rotation needs no restart ([`db/connection-config.ts`](../../apps/api/src/db/connection-config.ts)) |
| `DB_HOST`, `DB_PORT` (5432), `DB_NAME`, `DB_USER` | | Used with `DATABASE_SECRET_ARN` |
| `DB_SSL` | none | `disable`, `require` or `verify-full` |
| `DB_SSL_CA_FILE` | none | CA bundle for `verify-full` |
| `DB_POOL_MAX` | `10` | Connections per process. Keep `DB_POOL_MAX` times the number of tasks under the database's connection limit |
| `MIGRATE_ON_BOOT` | `false` | Apply pending migrations when the API starts. Compose and Terraform run a separate migrate task instead |
| `MIGRATIONS_DIR` | `db/migrations` next to the runner | Read only by `db/migrate.ts` |
| `REDIS_URL` | `redis://localhost:6449` | BullMQ queues and rate limits |
| `JOBS_MODE` | `queue` | `queue` (BullMQ, run by the worker) or `inline` (run in the API process right after commit; tests only) |

### Sessions and accounts

| Variable | Default | Meaning |
| --- | --- | --- |
| `JWT_SECRET` | a committed development value | Signs access tokens. Production: at least 32 characters, not the default |
| `REFRESH_SECRET` | a committed development value | Signs refresh tokens. Production: at least 32 characters, different from `JWT_SECRET` |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | Access token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Refresh token lifetime |
| `COOKIE_SECURE` | `auto` | `true`, `false` or `auto` (secure when `APP_WEB_URL` is https) |
| `BCRYPT_ROUNDS` | `12` | Password hash cost, 4 to 15. Production refuses less than 12 |
| `REQUIRE_EMAIL_VERIFICATION` | `true` | New accounts must confirm their email before signing in |
| `TOTP_ENCRYPTION_KEY` | derived from a public constant | 32 bytes, base64 (`openssl rand -base64 32`). Encrypts TOTP secrets and keys the recovery code HMAC. Rotating it breaks every enrolled authenticator |
| `RATE_LIMITS` | on (off under `NODE_ENV=test`) | `off` disables every rate limit. Read live, so a test can switch it |
| `RATE_LIMIT_STORE` | Redis (memory under `NODE_ENV=test`) | Set to `redis` to use Redis in tests |

### Mail

| Variable | Default | Meaning |
| --- | --- | --- |
| `MAIL_MODE` | `outbox` | `outbox` (write `.eml` files under `DATA_DIR`), `smtp` or `ses` |
| `MAIL_FROM` | none | Sender, for example `Interviews <no-reply@example.com>`. Required outside `outbox` |
| `DATA_DIR` | `./data` | Where the outbox is written |
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS` | | For `MAIL_MODE=smtp` |
| `SES_REGION`, `SES_CONFIGURATION_SET` | | For `MAIL_MODE=ses` |
| `AWS_REGION` | `us-east-1` | AWS SDK region (SES, Secrets Manager) |
| `AWS_ENDPOINT_URL` | none | Points the AWS SDK at an emulator (Floci locally) |

### Model providers and realtime

| Variable | Default | Meaning |
| --- | --- | --- |
| `PROVIDER_KEYS` | none | One JSON object of keys keyed by provider slug: `{"openai":"...","gemini":"...","anthropic":"..."}`. On AWS it comes from the `<name_prefix>/provider-keys` secret |
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY` | none | Shortcuts for the providers with slugs `openai`, `gemini`, `anthropic`, `openrouter`, `groq`. `PROVIDER_KEYS` wins when both name one. Empty values and the placeholder `set-me` are ignored |
| `STUBS_URL` | `http://localhost:5139` | Where providers of kind `STUB` live ([`apps/stubs`](../../apps/stubs/README.md)) |
| `OPENAI_REALTIME_URL` | `https://api.openai.com/v1` | Where OpenAI realtime client secrets are minted, where the SDP relay forwards offers, and where hang-ups go (an OpenAI provider's own base URL overrides it for minting and hang-up) |
| `GEMINI_LIVE_URL` | `https://generativelanguage.googleapis.com/v1alpha` | Where Gemini Live ephemeral tokens are minted |
| `REALTIME_CONNECT_TTL_SECONDS` | `120` | 30 to 600. How long a minted credential may be used to open a connection |
| `REALTIME_GRACE_SECONDS` | `60` | 10 to 600. Extra time after a session's maximum length before the sweeper expires it |
| `MAX_RESUME_MB` | `8` | 1 to 20. Largest resume accepted. Resumes are read in memory and never stored |

Keys never enter the database, a log line or an API response. `/admin/models` shows only
whether a key is configured for a provider slug.

### One-off commands

| Variable | Used by | Meaning |
| --- | --- | --- |
| `DEMO_PASSWORD` | `demo:seed` | The password every demo account gets (random and printed when unset). `make demo` passes `CONV_DEMO_PASSWORD` |

### Production guards

With `NODE_ENV=production` the API and the worker refuse to start when any of these holds
(`assertProductionConfig` in `config.ts`). Outside production the same checks are printed as
warnings.

- `JWT_SECRET` or `REFRESH_SECRET` is the committed default or shorter than 32 characters,
  or the two are equal.
- `TOTP_ENCRYPTION_KEY` is the development default.
- `CORS_ORIGINS` is not set, or `APP_WEB_URL` points at localhost.
- `MAIL_MODE=outbox`, or `MAIL_FROM` is missing for SMTP or SES.
- `JOBS_MODE=inline`.
- `BCRYPT_ROUNDS` below 12.

Having no provider key at all is only a warning: the app starts and an admin can sign in to
finish the setup, but interviews cannot be planned or held until a key is set.

## Web environment

The web image reads these at request time. `/env.js` is rendered per request from the
server's environment, and the CSP is built per request in `middleware.ts`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PRODUCT_NAME` | `Euron Open Conversation` | Wordmark, page titles and copy |
| `PUBLIC_API_URL` | `/api` | The API base **including** `/api`, as the browser should call it. Keep the default when the web app and the API share one host (the supported setup). Note the different meaning from the API's `PUBLIC_API_URL` (an origin) |
| `REALTIME_ORIGINS` | `wss://generativelanguage.googleapis.com` | Space or comma separated `https://` or `wss://` origins added to the CSP `connect-src`. The default allows Gemini Live's WebSocket. OpenAI needs nothing here: its handshake goes to this origin's `/api` relay and WebRTC media is not governed by `connect-src`. Set it when you point Gemini somewhere else. Entries that are not a bare `https://` or `wss://` origin are dropped |
| `API_INTERNAL_URL` | `http://localhost:5046` | Where the Next server proxies `/api/*` (local compose). Next evaluates rewrites at build time, so the Docker build takes it as a build argument too. On AWS the load balancer sends `/api/*` to the API before it reaches Next |
| `NODE_ENV` | `production` in the image | Outside production the CSP also allows `unsafe-eval` and any `ws:`/`wss:` for the dev server |
| `NEXT_PUBLIC_PRODUCT_NAME`, `NEXT_PUBLIC_API_URL` | none | Build-time fallbacks for `next dev`; the runtime values above win |


## Local compose variables

`deploy/compose/.env` (written by `make env`) holds the local secrets and optional
overrides. The compose files map them onto the variables above.

| Variable | Feeds |
| --- | --- |
| `CONV_JWT_SECRET`, `CONV_REFRESH_SECRET`, `CONV_TOTP_ENCRYPTION_KEY` | `JWT_SECRET`, `REFRESH_SECRET`, `TOTP_ENCRYPTION_KEY` |
| `CONV_DEMO_PASSWORD` | `DEMO_PASSWORD` for `make demo` |
| `CONV_PRODUCT_NAME`, `CONV_LOG_LEVEL` | `PRODUCT_NAME`, `LOG_LEVEL` |
| `CONV_WEB_PORT`, `CONV_API_PORT`, `CONV_PG_PORT`, `CONV_REDIS_PORT`, `CONV_MAILPIT_PORT`, `CONV_SMTP_PORT`, `CONV_FLOCI_PORT`, `CONV_STUB_PORT` | Host ports (3550, 5046, 5512, 6449, 8066, 1066, 4617, 5139) |
| `PROVIDER_KEYS`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, ... | Passed straight through |
| `REALTIME_ORIGINS`, `OPENAI_REALTIME_URL`, `GEMINI_LIVE_URL`, `STUBS_URL`, `MAX_RESUME_MB`, `REQUIRE_EMAIL_VERIFICATION`, `MAIL_MODE`, `MAIL_FROM`, `DB_POOL_MAX` | Passed straight through when set |

[`deploy/compose/.env.example`](../../deploy/compose/.env.example) lists every optional
override with a comment. `make up-aws` also reads `deploy/compose/.env.aws`
([`.env.aws.example`](../../deploy/compose/.env.aws.example)): region, SES configuration set
and `MAIL_FROM`, never secrets.
## Deployment settings (`/admin/settings`)

Stored as one JSON document in the `settings` table, cached for 5 seconds per process
([`services/settings.service.ts`](../../apps/api/src/services/settings.service.ts)). Every
change is audited with its before and after.

| Setting | Default | Meaning |
| --- | --- | --- |
| `appName`, `tagline` | `PRODUCT_NAME`, "Practise interviews out loud with an AI interviewer." | Shown on the landing page and in titles |
| `registration` | `OPEN` | `OPEN`, `INVITE_ONLY` (only `allowedEmailDomains` may sign up) or `CLOSED` |
| `allowedEmailDomains` | `[]` | For `INVITE_ONLY`, for example `["example.com"]` |
| `supportEmail` | none | Shown to users when something needs a human |
| `interviewerName` | `Avani` | The interviewer's name in the room and in its instructions (1 to 40 characters) |
| `interviewerAddendum` | empty | House rules appended to every interviewer instruction: tone, language, things to avoid (up to 2000 characters) |
| `features.resumeUpload`, `features.jobDescription` | on | The two ways to start an interview |
| `features.codeQuestions` | on | Code questions with the editor |
| `features.proctoring` | on | Lets candidates turn on face and tab checks |
| `features.sharing` | on | Share links. Off makes every existing link a 404 too |
| `features.pdfExport` | on | The PDF report download |
| `retentionDays` | none (keep forever) | 7 to 3650. Interviews older than this are deleted by the `maintenance.retention` job |
| `minSupportedVersion` | none | Native apps older than this are asked to update ([mobile-clients.md](mobile-clients.md)) |

The API enforces every switch. `resumeUpload` and `jobDescription` refuse creation (403
`FEATURE_DISABLED`); `sharing` and `pdfExport` refuse links and downloads. With `codeQuestions`
off, a planned code question is asked and answered by voice (the live session grant says
`code: false` and the answer is stored as a voice answer). With `proctoring` off, new interviews
are created without it, turning it on is refused, and proctoring events are refused (409
`PROCTORING_OFF`). The web app also hides what is off.

`GET /api/meta` returns the public subset (name, registration, interviewer name, features,
resume limits) so a client can hide what is switched off.
