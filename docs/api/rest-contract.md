# REST contract

Every route the API serves, the DTO it returns (from `packages/types`), and the router file
that owns it (`apps/api/src/routes`). The generated OpenAPI document
([`openapi.yaml`](openapi.yaml), `pnpm openapi`) is built from the route files' doc
comments; this page is the human map. Live voice has its own page: [realtime.md](realtime.md).

## Conventions

- **Base path** `/api`. JSON in and out, except the resume upload (multipart), the PDF
  report (`application/pdf`) and the SDP relay (`application/sdp`).
- **Errors**: every non-2xx body is `ApiError`:
  `{ "error": "Human message", "code": "STABLE_CODE", "details": { ... }, "requestId": "..." }`.
  Switch on `code`; `error` may change. `requestId` matches the `X-Request-Id` header and the
  server's log line.
- **Status codes**: creates answer **201** with the resource; deletes and fire-and-forget
  actions answer **204**; an answer submission answers **202** (scoring is queued).
- **Strict bodies**: every body schema is `.strict()`; an unknown key is
  `400 VALIDATION_FAILED` with `details.fields: [{ path, message }]`.
- **Ids** in paths are ULIDs, except provider slugs and share ids (ULID, dash, 22
  base64url characters). A malformed ULID is `400 VALIDATION_FAILED`; a malformed share id
  is `404 SHARE_NOT_FOUND`.
- **Ownership**: another account's interview (and everything under it) or share is
  **404**, never 403.
- **Writes need an ACTIVE account**: a suspended account can read but gets
  `403 ACCOUNT_RESTRICTED` on writes.
- **Auth column**: `auth` = bearer token required, `public` = none, `admin` = bearer token
  of an ACTIVE `ADMIN` (`403 FORBIDDEN_ADMIN` otherwise), `cookie` / `body token` = the
  refresh token, `ek` = a realtime credential from a live session grant.
- **Rate limits** answer `429 RATE_LIMITED` with `Retry-After` ([LLD.md](../architecture/LLD.md#5-rate-limits)).

## Auth modes

| Mode | Access token | Refresh token |
| --- | --- | --- |
| Web (default) | `Authorization: Bearer <token>`, from the body of every session response; keep it in memory | `conv_refresh` cookie: httpOnly, `SameSite=Lax`, `Path=/api/auth`, `Secure` on https |
| Native (`X-Client: native`) | Same | In the body as `refreshToken` with `refreshExpiresAt`; sent back as `{ refreshToken }` to `/auth/refresh` and `/auth/logout`; no cookie ([ADR 0009](../architecture/adr/0009-native-token-mode.md)) |

Access tokens last `ACCESS_TOKEN_TTL_SECONDS` (900); refresh tokens
`REFRESH_TOKEN_TTL_DAYS` (30) and rotate on every use. A 401 `TOKEN_INVALID` means
"refresh and retry"; a 401 `SESSION_EXPIRED` from `/auth/refresh` means "sign in again".

## Pagination

Lists are keyset pages: `Page<T>` is `{ items: T[], nextCursor: string | null }` with
`?cursor=&limit=`. Cursors are opaque (a tampered one is `400 INVALID_CURSOR`); pass
`nextCursor` back unchanged until it is null. No totals, no `OFFSET`.

| List | Default and max `limit` |
| --- | --- |
| `GET /interviews`, `GET /shares` | 20, 50 |
| `GET /admin/users`, `/admin/interviews`, `/admin/shares`, `/admin/audit` | 30, 100 |

Small, bounded lists are plain arrays: realtime models, sessions, tiers, providers, models.

## Account: `auth.routes.ts`, `users.routes.ts`, `meta.routes.ts`, `me.routes.ts`

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| POST | /auth/signup `{ email, username, displayName, password }` | public | **201** `AuthResult` (with cookie, or `IssuedNativeSession`), or **202** `{ verificationRequired: true, email }`; 403 `REGISTRATION_CLOSED`, `REGISTRATION_DOMAIN_NOT_ALLOWED`; 409 `EMAIL_TAKEN`, `USERNAME_TAKEN`, `USERNAME_RESERVED`; 400 `WEAK_PASSWORD`, `DISPLAY_NAME_INVALID` |
| POST | /auth/verify-email `{ token }` | public | `AuthResult`; 400 `TOKEN_INVALID` |
| POST | /auth/resend-verification `{ email }`, /auth/forgot-password `{ email }` | public | **202** `{ ok: true }` whether or not the account exists |
| POST | /auth/login `{ login, password, totp? \| recoveryCode? }` | public | `AuthResult`, or `{ totpRequired: true }`; 401 `INVALID_CREDENTIALS`, `INVALID_TOTP`, `INVALID_RECOVERY_CODE`; 403 `EMAIL_NOT_VERIFIED`, `ACCOUNT_BANNED`; 429 once a failure budget is spent |
| POST | /auth/refresh | cookie | `AuthResult` with a rotated cookie; **204** without a cookie; 401 `SESSION_EXPIRED` |
| POST | /auth/refresh `{ refreshToken }` with `X-Client: native` | body token | `IssuedNativeSession`; 401 `SESSION_EXPIRED` |
| POST | /auth/logout | cookie, or `{ refreshToken }` native | 204 |
| POST | /auth/logout-all | auth | 204 (every session revoked) |
| POST | /auth/reset-password `{ token, password }` | public | 204 (sessions revoked) |
| POST | /auth/change-password `{ currentPassword, newPassword }` | auth | 204 (every session revoked; sign in again) |
| GET | /auth/me, /users/me | auth | `Me` |
| POST | /auth/totp/setup | auth | `{ secret, otpauthUrl }` |
| POST | /auth/totp/enable `{ code }` | auth | `{ recoveryCodes }` (ten, shown once) |
| POST | /auth/totp/disable `{ password, code \| recoveryCode }` | auth | 204 |
| POST | /auth/totp/recovery-codes `{ password, code }` | auth | `{ recoveryCodes }` |
| PATCH | /users/me `{ displayName? }` | auth | `Me` |
| DELETE | /users/me `{ password, totp? \| recoveryCode? }` | auth | `{ purgeAfter }` (14 days); 409 `LAST_ADMIN` |
| GET | /users/me/export | auth | JSON download: account, preferences, interviews, answers and transcripts, proctoring events, voice sessions, share links (3 a day) |
| GET | /users/me/sessions | auth | `SessionInfo[]` |
| DELETE | /users/me/sessions/:id | auth | 204 |
| GET | /meta | public | `AppMeta`: name, tagline, registration, interviewer name, feature switches, limits (`maxResumeMb`, `maxJobDescriptionChars`, `acceptedResumeTypes`), support email, `minSupportedVersion`; cached 30 s |
| GET | /me/usage | auth | `Usage`: this month's interviews and voice minutes against the limits, `maxSessionMinutes`, `resetsAt` |
| GET | /me/realtime-models | auth | `RealtimeModelOption[]`: usable voice models with provider and voices |
| GET, PATCH | /me/preferences | auth | `Preferences`; PATCH takes any of `voice`, `transcriptionLanguage`, `proctoringDefault`, `defaultRealtimeModelId` |

## Interviews: `interviews.routes.ts`

All routes need `auth` and are owner-scoped (404 `INTERVIEW_NOT_FOUND` for others).

| Method | Path | Returns |
| --- | --- | --- |
| GET | /interviews?status&cursor&limit | `Page<InterviewSummary>`, newest first |
| POST | /interviews/from-resume (multipart `file`, optional `proctoring=true`) | **201** `Interview` in `PLANNING`. 400 `FILE_REQUIRED`, `FILE_TOO_LARGE`, `FILE_TYPE`; 422 `FILE_UNREADABLE`, `RESUME_TOO_SHORT`; 403 `FEATURE_DISABLED`; 429 `QUOTA_EXCEEDED`; 503 `NO_TEXT_MODEL` |
| POST | /interviews/from-job-description `{ company, role, jobDescription, proctoring? }` | **201** `Interview` in `PLANNING`. Same quota and model errors |
| GET | /interviews/:id | `Interview`: plan, position, editability, realtime model, answers. Poll this while `PLANNING` |
| PATCH | /interviews/:id `{ title?, plan?, proctoring?, realtimeModelId? }` | `Interview`. After the first live session only `title`: 409 `INTERVIEW_STARTED`. 400 `PLAN_INVALID`, `MODEL_UNAVAILABLE` |
| POST | /interviews/:id/replan | `Interview` back in `PLANNING`. 409 `REPLAN_UNAVAILABLE` (resume), `INTERVIEW_STARTED` |
| DELETE | /interviews/:id | 204. Answers, transcripts, sessions, events and share links go with it. Quota is not given back |
| POST | /interviews/:id/live `{ round?, question? }` | **201** `LiveSessionGrant` ([realtime.md](realtime.md)). 409 `PLAN_NOT_READY`, `INTERVIEW_COMPLETED`; 400 `QUESTION_NOT_FOUND`; 429 `QUOTA_EXCEEDED`; 502 `REALTIME_UNAVAILABLE`; 503 `NO_REALTIME_MODEL` |
| POST | /interviews/:id/live/:sid/end | `LiveSessionEnd` `{ seconds, voiceMinutesLeft }`. Idempotent. 404 `LIVE_SESSION_NOT_FOUND` |
| POST | /interviews/:id/answers `{ round, question, transcript?, code?, language?, advance? }` | **202** `AnswerResult` in `SCORING`. 409 `INTERVIEW_NOT_IN_PROGRESS`; 400 `QUESTION_NOT_FOUND`, `ANSWER_EMPTY`; a body with rating fields is 400 `VALIDATION_FAILED` |
| POST | /interviews/:id/proctor-events `{ events: [{ kind, occurredAt, round?, question? }] }` (1 to 100) | `{ recorded }`. 409 `PROCTORING_OFF` |
| POST | /interviews/:id/complete | `Interview` in `COMPLETED`. 409 `INTERVIEW_NOT_STARTED` while planning |
| GET | /interviews/:id/report | `InterviewReport` with transcripts and code |
| GET | /interviews/:id/report.pdf | `application/pdf` attachment, no transcripts. 404 when the PDF feature is off |
| POST | /interviews/:id/shares `{ includeTranscript?, expiresInDays? }` (1 to 365) | **201** `ShareSummary`. 403 `SHARE_LIMIT` (10 active per interview), `FEATURE_DISABLED` |

Body limits: `company` 1 to 120 characters, `role` 2 to 120, `jobDescription` 80 to
12,000; plan bounds as in [interview-engine.md](../architecture/interview-engine.md#1-the-plan);
transcript at most 400 lines of up to 8,000 characters (the server keeps the last 200
lines and 30,000 characters); `code` up to 40,000 characters; `language` one of `python`,
`javascript`, `typescript`, `java`, `cpp`, `go`, `sql`.

`AnswerInput` example:

```json
{
  "round": 1,
  "question": 2,
  "transcript": [
    { "role": "interviewer", "text": "How did you size the Kafka cluster?" },
    { "role": "candidate", "text": "We started from peak events per second..." }
  ]
}
```

## Realtime: `realtime.routes.ts`

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| POST | /realtime/openai/calls (`application/sdp`, max 64 KB) | ek | The SDP answer with the call `Location`. 401 `REALTIME_SESSION_INVALID`; 400 `SDP_REQUIRED`; 502 `REALTIME_UNAVAILABLE` |

Details in [realtime.md](realtime.md).

## Shares: `shares.routes.ts`, `shared.routes.ts`

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| GET | /shares?cursor&limit | auth | `Page<ShareSummary>` of your active links |
| DELETE | /shares/:id | auth | 204; 404 `SHARE_NOT_FOUND` when not yours or already revoked |
| GET | /shared/:id | public | `SharedReport` (`no-store`, `X-Robots-Tag: noindex`). Transcript and code only when the owner included them. 404 `SHARE_NOT_FOUND` for unknown, revoked or expired links, or with sharing off |

## Admin: `admin.routes.ts`

Every route is `admin`. Admins never receive answers, transcripts, code, summaries or plans.

| Method | Path | Returns |
| --- | --- | --- |
| GET | /admin/me | `AdminSession` |
| GET | /admin/stats?from&to | `AdminStats` (UTC dates, default the last 30 days, at most a year; 400 `RANGE_INVALID`, `RANGE_TOO_LONG`) |
| GET | /admin/users?q&status&role&tierId&cursor&limit | `Page<AdminUserRow>` |
| GET | /admin/users/:id | `AdminUserDetail` |
| PATCH | /admin/users/:id/role `{ role }` | 403 `SELF_ACTION`; 409 `LAST_ADMIN` |
| POST | /admin/users/:id/suspend `{ days, reason? }` (1 to 365), /unsuspend | 403 `TARGET_PROTECTED` for admins |
| POST | /admin/users/:id/ban `{ reason? }`, /unban | Ban signs out everywhere and revokes share links |
| POST | /admin/users/:id/erase `{ reason }` | 204. Identity anonymised, all interviews and links deleted |
| PUT | /admin/users/:id/tier `{ tierId }` | `null` = default tier |
| PUT | /admin/users/:id/quota `{ monthlyInterviews, monthlyVoiceMinutes, note }` | Override; null fields fall back to the tier |
| DELETE | /admin/users/:id/quota | `AdminUserDetail` without the override |
| GET | /admin/tiers | `QuotaTier[]` |
| POST, PUT | /admin/tiers, /admin/tiers/:id `{ name, monthlyInterviews, monthlyVoiceMinutes, maxSessionMinutes, isDefault? }` | Every tier. 409 `TIER_NAME_TAKEN` |
| DELETE | /admin/tiers/:id | 409 `TIER_IS_DEFAULT` |
| GET | /admin/providers | `AdminProvider[]` with `keyConfigured` |
| POST, PUT, DELETE | /admin/providers, /admin/providers/:id `{ id, kind, displayName, baseUrl, enabled }` | 409 `PROVIDER_SLUG_TAKEN`; 400 `STUB_IN_PRODUCTION`, `BASE_URL_REQUIRED`, `BASE_URL_INVALID` |
| GET | /admin/models | `AdminModel[]` |
| POST, PUT, DELETE | /admin/models, /admin/models/:id | 409 `MODEL_DUPLICATE`; 400 `VOICES_REQUIRED` for realtime models without voices, `REALTIME_PROVIDER_UNSUPPORTED` for a realtime model on a provider without voice |
| POST | /admin/models/:id/test | `ModelTestResult` `{ ok, latencyMs, message }` (20 a minute) |
| GET, PATCH | /admin/settings | `AppSettings`; PATCH merges groups key by key and is audited with before and after. 400 `SETTINGS_INVALID` |
| GET | /admin/integrations | `IntegrationStatus`: mail mode, realtime providers with key and model count, text model count |
| GET | /admin/interviews?q&status&userId&cursor&limit | `Page<AdminInterviewRow>`, metadata only |
| GET | /admin/shares?includeRevoked&cursor&limit | `Page<AdminShareRow>` |
| POST | /admin/shares/:id/revoke `{ reason }` | 204 |
| GET | /admin/audit?action&actorId&entityType&entityId&cursor&limit | `Page<AuditEntry>`, newest first; `action` matches a prefix |

## Health

| Method | Path | Returns |
| --- | --- | --- |
| GET | /up | `{ ok: true }` when the process is up |
| GET | /api/ready | `{ ok: true }` when Postgres and Redis answer, else 503 (the load balancer check) |

## Error codes by family

| Status | Codes |
| --- | --- |
| 400 | `VALIDATION_FAILED`, `BAD_REQUEST`, `INVALID_CURSOR`, `FILE_REQUIRED`, `FILE_TOO_LARGE`, `FILE_TYPE`, `PLAN_INVALID`, `QUESTION_NOT_FOUND`, `ANSWER_EMPTY`, `MODEL_UNAVAILABLE`, `SDP_REQUIRED`, `WEAK_PASSWORD`, `DISPLAY_NAME_INVALID`, `TOKEN_INVALID` (email links), `STUB_IN_PRODUCTION`, `SETTINGS_INVALID`, `RANGE_INVALID`, `RANGE_TOO_LONG`, `DAYS_INVALID`, `BASE_URL_REQUIRED`, `BASE_URL_INVALID`, `VOICES_REQUIRED`, `REALTIME_PROVIDER_UNSUPPORTED`, `TIER_DEFAULT_REQUIRED`, `TOTP_REQUIRED`, `TOTP_NOT_STARTED`, `TOTP_NOT_ENABLED` |
| 401 | `UNAUTHENTICATED`, `TOKEN_INVALID`, `SESSION_EXPIRED`, `INVALID_CREDENTIALS`, `INVALID_TOTP`, `INVALID_RECOVERY_CODE`, `REALTIME_SESSION_INVALID` |
| 403 | `ACCOUNT_RESTRICTED`, `ACCOUNT_BANNED`, `ACCOUNT_DEACTIVATED`, `EMAIL_NOT_VERIFIED`, `FORBIDDEN_ADMIN`, `FEATURE_DISABLED`, `SHARE_LIMIT`, `REGISTRATION_CLOSED`, `REGISTRATION_DOMAIN_NOT_ALLOWED`, `SELF_ACTION`, `TARGET_PROTECTED`, `CORS_ORIGIN_DENIED` |
| 404 | `NOT_FOUND`, `INTERVIEW_NOT_FOUND`, `LIVE_SESSION_NOT_FOUND`, `SHARE_NOT_FOUND`, `USER_NOT_FOUND`, `MODEL_NOT_FOUND`, `PROVIDER_NOT_FOUND`, `TIER_NOT_FOUND` |
| 409 | `INTERVIEW_STARTED`, `INTERVIEW_COMPLETED`, `INTERVIEW_NOT_STARTED`, `INTERVIEW_NOT_IN_PROGRESS`, `PLAN_NOT_READY`, `REPLAN_UNAVAILABLE`, `PROCTORING_OFF`, `EMAIL_TAKEN`, `USERNAME_TAKEN`, `USERNAME_RESERVED`, `LAST_ADMIN`, `TIER_IS_DEFAULT`, `TIER_NAME_TAKEN`, `PROVIDER_SLUG_TAKEN`, `MODEL_DUPLICATE`, `TOTP_ALREADY_ENABLED`, `INVALID_STATUS`, `USER_ERASED`, `ALREADY_ERASED` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 422 | `FILE_UNREADABLE`, `RESUME_TOO_SHORT` |
| 429 | `RATE_LIMITED`, `QUOTA_EXCEEDED` |
| 500 | `INTERNAL` |
| 502 | `REALTIME_UNAVAILABLE` |
| 503 | `NO_TEXT_MODEL`, `NO_REALTIME_MODEL` |

The exact field names of every body are in the zod schemas in
[`apps/api/src/controllers/`](../../apps/api/src/controllers/interview.controller.ts) and the
DTOs in [`packages/types`](../../packages/types/src/interview.ts).
