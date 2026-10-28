# Deploy to AWS

Deploy Euron Open Conversation to your own AWS account with the Terraform in
[`infra/terraform`](../../infra/terraform) and one script. The result is one host name
(`https://<domain>`) serving the web app and `/api/*`, with ECS Fargate services in private
subnets, RDS PostgreSQL, ElastiCache Redis, SES, Secrets Manager and a customer-managed KMS
key. The system view is in [HLD.md](../architecture/HLD.md).

## What gets created

The composition is one module, [`modules/deployment`](../../infra/terraform/modules/deployment/main.tf);
the environments [`envs/aws-dev`](../../infra/terraform/envs/aws-dev/main.tf) and
[`envs/aws-prod`](../../infra/terraform/envs/aws-prod/main.tf) only pick sizes and safety
switches.

| Path | Service | Role |
| --- | --- | --- |
| `https://<domain>/api/*`, `/up` | api | The JSON API, including the OpenAI WebRTC handshake relay (`POST /api/realtime/openai/calls`) |
| `https://<domain>/*` | web | Next.js: the app, the interview room, shared reports and `/admin` |
| no inbound traffic | worker | BullMQ jobs: planning, scoring, provider hang-ups, the live session sweeper, upkeep |
| one-off | migrate, admin | Task definitions on the api image: apply migrations; create the first administrator |

| | aws-dev | aws-prod |
| --- | --- | --- |
| Availability zones, NAT | 2, one shared NAT | 3, one NAT per AZ, interface endpoints |
| RDS PostgreSQL | `db.t4g.small`, single AZ, 3 days of backups, no deletion protection | `db.t4g.medium`, Multi-AZ, 14 days, deletion protection |
| ElastiCache Redis | `cache.t4g.small`, 1 node, 1 day of snapshots | `cache.m7g.large`, 2 nodes with failover, 7 days |
| Tasks (min to max) | api 1 to 2, worker 1, web 1 to 2 | api 2 to 10, worker 2 to 6, web 2 to 6 |
| CloudFront + WAF | off by default (`enable_cdn = false`) | on by default |
| KMS deletion window, secret recovery window | 7 days, 0 | 30 days, 30 days |
| Log retention | 14 days | 365 days |

Services scale on CPU (target 60%) and roll out with the ECS deployment circuit breaker and
automatic rollback.

Voice audio never passes through AWS. With OpenAI the browser posts its WebRTC offer to the
API relay, then the media flows between the browser and OpenAI. With Gemini the browser
opens a WebSocket straight to Google. The API only mints credentials, relays the handshake
and books time, so requests stay short and the ALB's default 60 s idle timeout fits
(`alb_idle_timeout`).

There is no file storage: resumes are read in memory and never kept, and proctoring video
never leaves the candidate's device.

## Prerequisites

- An AWS account and credentials for it (a profile with administrator rights for the first
  apply).
- `terraform` (1.16), `docker` with buildx, the AWS CLI and `python3`.
- A domain. With a Route 53 hosted zone (`route53_zone_id`) the certificate and DNS records
  are created for you; otherwise pass `certificate_arn` for an ACM certificate you made and
  point your DNS at the load balancer (`terraform output load_balancer_dns_name`).
- A sending domain for SES (`mail_domain`, defaults to `domain`). New SES accounts are in the
  sandbox: verify the recipient addresses or request production access.
- An OpenAI or Gemini key for live voice, and a key for a text model (the same OpenAI or
  Gemini key works for both).

## Configure

```bash
cp infra/terraform/envs/aws-dev/terraform.tfvars.example infra/terraform/envs/aws-dev/terraform.tfvars
cp infra/terraform/envs/aws-dev/backend.tf.example infra/terraform/envs/aws-dev/backend.tf   # remote state (recommended)
```

The essentials ([`terraform.tfvars.example`](../../infra/terraform/envs/aws-dev/terraform.tfvars.example)):

| Variable | Purpose |
| --- | --- |
| `region`, `name_prefix` | Where, and the prefix of every name (3 to 24 lowercase letters, digits and hyphens) |
| `domain`, `route53_zone_id` or `certificate_arn` | The one public host |
| `mail_domain` | SES sending domain |
| `alarm_email` | Who receives the CloudWatch alarms |
| `enable_cdn` | CloudFront and WAF in front of the load balancer (needs `route53_zone_id`) |
| `provider_keys` | Optional. Leave unset to keep keys out of Terraform state and fill the secret by hand |
| `realtime_origins` | `REALTIME_ORIGINS` for the web CSP. Default `wss://generativelanguage.googleapis.com` (Gemini Live) |
| `cpu_architecture` | `X86_64` (default) or `ARM64` (Graviton) |
| `db_instance_class`, `cache_node_type` | Sizes, defaults in the table above |
| `require_email_verification`, `log_level`, `product_name` | Passed to the API |
| `api_extra_environment`, `api_extra_secrets` | Anything else the API should read (names from [configuration.md](configuration.md)) |

The deployment module also takes `openai_realtime_url`, `gemini_live_url`,
`realtime_connect_ttl_seconds` (120), `realtime_grace_seconds` (60) and `max_resume_mb` (8);
the environments keep their defaults. Change them in
[`envs/<env>/main.tf`](../../infra/terraform/envs/aws-dev/main.tf) if you need to.

## Deploy

```bash
make aws-deploy ENV=aws-dev
```

[`scripts/aws-deploy.sh`](../../scripts/aws-deploy.sh) tags images with the current commit
(`TAG`, override it to pin a release) and runs:

1. `terraform apply` of the image registries (and the KMS key that encrypts them);
2. `docker buildx build --push` of the api and web images for `PLATFORM`, which must match
   `cpu_architecture` (`linux/amd64` for `X86_64`, `linux/arm64` for `ARM64`; a mismatch
   builds fine and then dies with `exec format error`);
3. `terraform apply` of what the migrate task needs (network, database, task definition);
4. the migrate task, waited for ([`scripts/aws-run-task.sh`](../../scripts/aws-run-task.sh));
   it must exit 0;
5. `terraform apply` of everything else: cache, edge, the api, worker and web services;
6. a wait until the three services are stable.

It ends by printing the app URL and the secrets that still hold `set-me` placeholders.

Plan without applying: `make aws-plan ENV=aws-dev`. Run migrations alone:
`make aws-migrate ENV=aws-dev`.

## Secrets

Everything secret lives in Secrets Manager, encrypted with the deployment's KMS key, and is
injected by ECS as environment variables; nothing secret is in a task definition or a log
([`modules/secrets`](../../infra/terraform/modules/secrets/main.tf)).

| Secret | Holds | Created with |
| --- | --- | --- |
| `<name_prefix>/app` | `JWT_SECRET`, `REFRESH_SECRET` | Random, distinct |
| `<name_prefix>/totp` | `TOTP_ENCRYPTION_KEY` | 32 random bytes, base64. Rotating it invalidates every enrolled authenticator |
| `<name_prefix>/provider-keys` | `PROVIDER_KEYS`: one JSON object keyed by provider slug | `set-me` for `openai`, `anthropic`, `gemini`, `openrouter` and `groq` unless `provider_keys` was passed |
| the cache module's secret | `REDIS_URL` with its AUTH token, TLS | Generated |
| the RDS-managed secret | The database master password | RDS (rotated by RDS; the API reads it per connection through `DATABASE_SECRET_ARN`) |

Terraform never overwrites a secret value after creation (`ignore_changes` on the string), so
values you put in by hand stay.

### Provider keys

Interviews cannot be planned or held until at least one provider key is real:

```bash
aws secretsmanager put-secret-value --secret-id <name_prefix>/provider-keys \
  --secret-string '{"openai":"<openai-key>","gemini":"<gemini-key>"}'
```

The slugs must match the providers in `/admin/models` ([providers.md](providers.md)). Then
roll the API and worker so they read the new values: run `make aws-deploy` again, or

```bash
aws ecs update-service --cluster <cluster> --service <api service> --force-new-deployment
aws ecs update-service --cluster <cluster> --service <worker service> --force-new-deployment
```

(`terraform output cluster_name` and `terraform output services` give the names.)

## The first administrator

```bash
make aws-admin ENV=aws-dev EMAIL=you@example.com
```

This runs `node dist/cli.js admin:create --email you@example.com` as a one-off task
([`services/admin-bootstrap.service.ts`](../../apps/api/src/services/admin-bootstrap.service.ts)):
it promotes an existing account without touching its password, or creates the account and
emails a set-password link through SES. It never prints a password (task output goes to
CloudWatch Logs). When the link cannot be emailed it creates nothing and exits non-zero:
verify the SES identity first.

## First-time setup in `/admin`

On its first boot against an empty database the API creates the starter catalogue
(OpenAI, Gemini and Anthropic models; no stub in production). Then:

1. **Models**: press **Test** on the models whose keys you stored, fix any model ref that
   fails, pick the default TEXT and REALTIME models, and fill in prices if you want a cost
   estimate ([providers.md](providers.md)).
2. **Quotas**: review the seeded `Default` tier (8 interviews and 120 voice minutes a month,
   sessions of up to 15 minutes) and create others ([quotas.md](../architecture/quotas.md)).
3. **Settings**: name and tagline, registration (`OPEN`, `INVITE_ONLY` with your email
   domains, or `CLOSED`), support email, the interviewer's name and house rules, features,
   retention ([configuration.md](configuration.md#deployment-settings-adminsettings)).

## Realtime voice and the network

- **OpenAI**: the browser sends its SDP offer to `https://<domain>/api/realtime/openai/calls`
  (a normal HTTPS POST through the load balancer and, when enabled, CloudFront). The API
  forwards it to OpenAI and returns the answer. Audio then flows over WebRTC between the
  browser and OpenAI, which needs UDP (or OpenAI's TURN fallback) from the candidate's
  network. Networks that block `api.openai.com` for HTTPS still work, because only the
  handshake would have gone there.
- **Gemini**: the browser opens `wss://generativelanguage.googleapis.com` directly. The web
  CSP allows that origin through `REALTIME_ORIGINS`, which Terraform sets from
  `realtime_origins`.
- `PUBLIC_API_URL` is set to the app URL, so the grant's relay URL is on the same host.

See [realtime.md](../api/realtime.md) for the protocol and
[troubleshooting.md](troubleshooting.md) for blocked networks.

## CloudFront and WAF

With `enable_cdn = true` CloudFront serves the host, WAF is attached, the load balancer
accepts only CloudFront's origin ranges, and both listener rules require a secret
`X-Origin-Verify` header that only this distribution sends; anything else gets 403.
`TRUST_PROXY` becomes 2. `/_next/static/*` is cached; pages and `/api/*` are not.

## Updating

Commit, then `make aws-deploy ENV=aws-prod` again: new images, migrations, then the
services roll. Migrations are forward-only and checksummed; a deploy never edits an applied
one. A bad image is rolled back by the circuit breaker; redeploy a previous tag with
`TAG=<commit> make aws-deploy ENV=...`.

A rolling deploy stops old API tasks with SIGTERM: they stop accepting requests and finish
in-flight ones (forced after 25 s). Live voice sessions are not affected, because the audio
does not pass through the API; a session whose end call was lost is closed by the sweeper
([operations.md](operations.md#background-jobs)).

## Using real AWS from your laptop

`make up-aws` runs the local stack against real SES from an `aws-dev` environment, with your
AWS profile: copy
[`deploy/compose/.env.aws.example`](../../deploy/compose/.env.aws.example) to `.env.aws` and
fill it from `terraform output`. `MAIL_FROM` must be a verified SES sender.

## Tearing down

`aws-dev` has no deletion protection: `terraform -chdir=infra/terraform/envs/aws-dev destroy`.
`aws-prod` refuses until you turn `deletion_protection` off. Secrets have
a 30-day recovery window in `aws-prod`.
