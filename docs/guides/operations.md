# Operations

Running a deployment day to day: health, logs, alarms, background jobs and their schedules,
live sessions across deploys, retention, account deletion, backups, migrations, rotating
secrets and scaling. Names below use `<name_prefix>` from `terraform.tfvars`.

## Health endpoints

| Endpoint | Answers | Used by |
| --- | --- | --- |
| `GET /up` | `{ ok: true }` while the process runs | The container health check |
| `GET /api/ready` | `{ ok: true }` when Postgres and Redis answer, else 503 | The ALB target group health check |
| `GET /` (web) | 200 when Next renders | The web target group |

Neither API endpoint is written to the access log ([`app.ts`](../../apps/api/src/app.ts)).

## Logs

Every service logs pino JSON to CloudWatch Logs, group `/open-conversation/<name_prefix>/<service>`
(`api`, `worker`, `web`, and the one-off `migrate` and `admin` tasks). Each API line carries
the request id that error bodies return as `requestId` (and the `X-Request-Id` header), so a
user's report with a request id finds the line.

What is never in a log ([`core/logger.ts`](../../apps/api/src/core/logger.ts)): passwords,
tokens, one-time and recovery codes, cookies, the `Authorization` header and API keys are
redacted by field name up to three levels deep, and so are fields named `content`, `prompt`,
`messages` and `input`. Beyond that, the code never logs resume text, transcripts or
interviewer instructions: job failures and provider errors are logged with ids and HTTP
statuses only.

Useful CloudWatch Logs Insights queries:

```
fields @timestamp, msg, job, attempts | filter level >= 50 | sort @timestamp desc
fields @timestamp, where, provider, status | filter where = "live.mint" | sort @timestamp desc
fields @timestamp, where, interviewId | filter where = "interview.plan" | sort @timestamp desc
fields @timestamp, expired | filter msg = "expired abandoned live sessions"
```

## Alarms

[`modules/observability`](../../infra/terraform/modules/observability/main.tf) creates
CloudWatch alarms that notify `alarm_email` through SNS:

| Alarm | Fires on |
| --- | --- |
| `<service>-5xx`, `<service>-unhealthy` | 5xx responses from api or web tasks; tasks failing health checks |
| `<service>-cpu`, `<service>-memory` | CPU or memory above 85% |
| `db-cpu`, `db-storage`, `db-connections` | Database CPU above 80%, less than 5 GiB free, connections above 80% of the ceiling |
| `worker-failed-jobs` | Failed job attempts in the worker log above the threshold in 5 minutes |

## Background jobs

Jobs are named handlers with a JSON payload ([`jobs/registry.ts`](../../apps/api/src/jobs/registry.ts)).
The queue is the first segment of the name. They are enqueued through `Effects`, so nothing
is queued for a transaction that rolled back.

| Job | Queue (worker concurrency) | Enqueued by | Attempts | Does |
| --- | --- | --- | --- | --- |
| `interview.plan` | `interview` (8) | Creating or re-planning an interview | 2 | Writes the plan with the text model. Removed from Redis as soon as it finishes or fails, because a resume job carries the resume text |
| `interview.score` | `interview` (8) | `POST /api/interviews/:id/answers` | 3 | Scores one answer. Writes only if the answer is still the version it was queued for |
| `interview.hangup` | `interview` (8) | Closing an OpenAI live session whose call id is known | 3 | Ends the call on OpenAI's side (best effort) |
| `interview.sweep`, `maintenance.*` | `interview` (8), `maintenance` (2) | The schedules below | 5 | Upkeep |

Other jobs retry 5 times with exponential backoff from 5 s. Planning and scoring catch model
failures themselves and record them on the row (`PLAN_FAILED`, `FAILED`) instead of retrying a
model that answered badly.

Schedules, registered by every worker on boot (repeatable jobs keyed by name and interval, so
exactly one schedule exists) in [`worker.ts`](../../apps/api/src/worker.ts):

| Job | Every | Does |
| --- | --- | --- |
| `interview.sweep` | 1 minute | `OPEN` live sessions past `expires_at` (connect window + `max_seconds` + `REALTIME_GRACE_SECONDS`) become `EXPIRED`, book their full length and, for OpenAI, are hung up |
| `maintenance.lift-suspensions` | 5 minutes | Timed suspensions that have run out become ACTIVE (also lifted lazily on the next request) |
| `maintenance.purge-accounts` | 6 hours | Erases accounts whose deletion request is older than 14 days, re-checking each under a row lock |
| `maintenance.retention` | 6 hours | Deletes interviews older than `retentionDays`, when set |

Every handler is safe to run twice or on two workers at once (conditional updates, row locks).

### `JOBS_MODE`

| | `queue` (default, every deployment) | `inline` (tests, tiny installs) |
| --- | --- | --- |
| Where handlers run | The worker process | The API process, right after commit |
| Retries | As above | None: an error is logged |
| Schedules | Registered by the worker | None: no sweep, no purge, no retention |
| Production | OK | Refused by the production guard |

If the worker is down, new interviews stay `PLANNING`, answers stay `SCORING`, abandoned live
sessions stay `OPEN` (so their minutes are not booked yet and the user's next session closes
them anyway), and upkeep waits. Everything runs when a worker returns. Live interviews
themselves do not depend on the worker.

## Live sessions and deploys

Voice audio flows between the browser and the provider; the API only mints credentials,
relays the OpenAI handshake and books time. So a deploy does not cut an interview in
progress. What a deploy can interrupt:

- a request in flight when an old API task stops (SIGTERM: stop accepting, finish in-flight
  requests, forced after 25 s; the ALB's deregistration delay is 60 s);
- an end call that never arrives. The sweeper closes that session after its maximum length
  plus the grace period and books the full length, which is the conservative choice for
  quotas.

At most one live session per user is open at a time (a partial unique index). Starting a new
one closes the previous one first.

## Retention

`retentionDays` in `/admin/settings` (7 to 3650, or empty to keep forever). Every 6 hours
`maintenance.retention` deletes interviews created longer ago than that, 500 at a
time, with their answers, transcripts, live sessions, proctoring events and share links
(cascades), and to write a `retention.applied` audit entry with the count. Usage rows stay,
so quotas and the admin overview are unaffected.

## Account deletion and erasure

| Path | What happens |
| --- | --- |
| A user deletes their account (`DELETE /api/users/me`) | Signed out everywhere, `deletion_requested_at` set. Signing in within 14 days cancels it; after that `maintenance.purge-accounts` erases it |
| An admin erases an account (`POST /api/admin/users/:id/erase`, reason required) | Immediate |

Erasure ([`services/account.service.ts`](../../apps/api/src/services/account.service.ts))
anonymises the user row (email, username, name, password, two-factor), revokes sessions and
tokens, and deletes share links, closed live sessions, interviews (with their answers,
transcripts and proctoring events) and preferences. `usage_daily` rows stay: they hold counts
only. The last active admin cannot delete themselves (`409 LAST_ADMIN`).

## Audit trail

`audit_log` records admin actions (`user.role`, suspend and ban, `user.erase`, `user.tier`,
overrides, `tier.save`, `provider.*`, `model.*`, `settings.update` with before and after,
`share.revoke`), account events (`user.signup`, `user.login`, `user.email_verified`,
two-factor changes, recovery code use, `user.export`, deletion requested and cancelled),
session events (`session.revoke`, `session.reuse_detected` for a replayed refresh token), the
admin bootstrap, and the jobs that change accounts or data (`user.suspension_lifted`,
`user.purged`, `retention.applied`). Read it at `/admin/audit`
(`GET /api/admin/audit?action=<prefix>`). Admins cannot read answers or transcripts; the trail
is how their actions are accounted for.

## Backups and restore

| Store | Backup |
| --- | --- |
| Postgres (RDS) | Automated snapshots: 3 days in `aws-dev`, 14 days in `aws-prod` (`db_backup_retention_days`), point-in-time restore inside that window |
| Redis | Snapshots (1 day `aws-dev`, 7 days `aws-prod`). Nothing durable lives only in Redis: rate limit counters rebuild and the schedules are registered again by the workers. A queued job lost with Redis leaves its row `PLANNING` or `SCORING`; answering the question again re-queues scoring |

There are no files to back up: resumes are never stored, and video never leaves the
candidate's device.

To restore, create an RDS instance from a snapshot and point the deployment at it (or restore
in place under the same identifier).

## Migrations

[`db/migrate.ts`](../../db/migrate.ts) applies `db/migrations/*.sql` in order, forward-only,
checksummed, under a Postgres advisory lock, recording each in its own table. Locally it runs
as the compose `migrate` one-shot; on AWS as the migrate task (`make aws-migrate`, and step 4
of `make aws-deploy`). Never edit an applied migration: the runner refuses to start when a
checksum changes.

## Least-privilege database role

By default the api and worker connect as the RDS master user. To give them a role that can
read and write data but not change the schema:

1. After the first deploy, connect as the master user and create a login role with `CONNECT`
   on the database, `USAGE` on schema `public`, `SELECT, INSERT, UPDATE, DELETE` on all
   tables, and default privileges so tables created by later migrations (run as the master
   user) are granted too.
2. Store `{"username": "...", "password": "..."}` in a Secrets Manager secret encrypted with
   the deployment's KMS key.
3. Set `app_db_secret_arn` and `app_db_username` in `terraform.tfvars` and run
   `make aws-deploy`.

The migrate and admin tasks keep the master user, because migrations need DDL.

## Rotating secrets

| Secret | How | Effect |
| --- | --- | --- |
| `JWT_SECRET` | Put a new value in `<name_prefix>/app`, roll api and worker | Every access token is invalid; clients refresh silently |
| `REFRESH_SECRET` | Same | Signs out everyone |
| `TOTP_ENCRYPTION_KEY` | Do not rotate casually | Every enrolled authenticator stops working; users would need recovery codes |
| `PROVIDER_KEYS` | Put the new JSON in `<name_prefix>/provider-keys`, roll api and worker | Immediate on new tasks; rotate at the provider after the roll |
| Database password | RDS rotates the managed secret | New connections read the new password (cached 60 s) |

## Scaling

| Component | How it scales | What makes that safe |
| --- | --- | --- |
| API tasks | Horizontally on CPU (target 60%) | Sessions in Postgres; rate limits in Redis; quota decisions under a per-user Postgres advisory lock; settings and the model catalogue cached 5 s per process. No stickiness |
| Worker tasks | Horizontally | BullMQ locks jobs; handlers are idempotent |
| Web tasks | Horizontally | Stateless |
| Postgres | Vertically, storage autoscaling | Keyset pagination and indexes for the per-user lists and monthly counts. Keep `DB_POOL_MAX` times tasks under the database's connection ceiling |
| Redis | Vertically; `aws-prod` runs two nodes with failover | Holds queues and rate limits only |
| Voice | Not on AWS | Audio goes browser to provider. Provider concurrency limits and spend are set in each provider's console |

Per-user throughput is bounded by rate limits (10 interviews created and 40 live sessions per
hour, among others) and by the monthly allowances in the quota tiers
([quotas.md](../architecture/quotas.md)).

## Failure modes

| Failure | Effect | Recovery |
| --- | --- | --- |
| Postgres down | `/api/ready` 503, tasks leave rotation | RDS failover (`aws-prod` Multi-AZ) |
| Redis down | `/api/ready` fails; rate limits fall back to per-task memory; jobs cannot be enqueued | ElastiCache failover in `aws-prod` |
| Text model provider down | New plans fail (`PLAN_FAILED`, quota given back); answers fail to score (`FAILED`) | Switch the default TEXT model in `/admin/models`; candidates re-plan or answer again |
| Realtime provider down | `502 REALTIME_UNAVAILABLE` when a question starts | Make another voice model the default, or let candidates pick it |
| Worker down | Plans and scores wait; sweeps wait | Jobs run when a worker returns |
| An API task dies | In-flight requests fail; live audio continues | The room retries; the sweeper closes orphaned sessions |
| Bad image deployed | Circuit breaker rolls back | Redeploy a previous tag |
