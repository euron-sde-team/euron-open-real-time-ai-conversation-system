# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.x (latest minor) | Yes |
| Older minors | No |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository ("Security" tab, "Report a vulnerability"):
https://github.com/euron-sde-team/euron-open-real-time-ai-conversation-system/security/advisories/new

Please include:

- the affected component (`apps/api`, `apps/web`, `packages/api-client`,
  `infra/terraform/...`) and version or commit,
- a description of the issue and its impact,
- steps to reproduce, or a proof of concept (against your own deployment or the local
  stack, never someone else's),
- any suggested mitigation.

What to expect:

| Stage | Target |
| ----- | ------ |
| Acknowledgement | within 3 business days |
| Initial assessment and severity | within 7 business days |
| Fix or mitigation for critical / high issues | within 30 days |
| Coordinated public disclosure | after a fix is released, credited to you unless you prefer otherwise |

## Scope

In scope: the code in this repository and the infrastructure it provisions with its
default settings. We are most interested in:

- **Authentication and sessions.** Account takeover, access or refresh token theft or
  reuse, bypassing email verification, two-factor or the invite-only domain allowlist,
  session fixation, password reset flaws, sign-in rate limits that can be sidestepped,
  native token mode weaknesses.
- **Interview privacy.** Reading another account's interviews, plans, answers,
  transcripts, scores, reports, live sessions or proctoring events; an admin endpoint that
  reveals answers or transcripts; a share link exposing more than its owner chose.
- **Provider keys.** Any way to make the API return, log or store a model provider key, or
  to surface raw provider error text to a user.
- **Realtime sessions.** Changing the interviewer's instructions through anything the
  server accepts (a request body, a query parameter, the Gemini token's constraints); using
  a minted credential for something other than its interview question; getting the SDP
  relay (`/api/realtime/openai/calls`) to forward a credential the server did not mint, to
  accept one twice, or outside its connection window; holding more than one live session at
  a time; voice time that is not booked. Tampering with an OpenAI session from your own
  browser's developer tools is a known residual risk, bounded by the server-side hang-up
  ([docs/architecture/threat-model.md](docs/architecture/threat-model.md)).
- **Scoring.** Getting a score that the server's scoring job did not write (for example by
  posting ratings), or another account's answer scored or replaced.
- **Prompt injection with a concrete impact** beyond changing the text of a plan or a
  score: instructions in a resume, job description or transcript that escape the fenced
  block to reach another user, leak configuration, or change what is stored outside the
  schema.
- **Resumes.** A resume, or text extracted from one, reaching disk, the database (beyond the
  short summary and the plan), a log line or Redis after its planning job has finished;
  uploading content types or sizes the API should refuse; bypassing the byte sniffing.
- **Shares.** A link that outlives its revocation or expiry, a guessable link id, or a link
  showing the transcript or code when the owner did not include it.
- **Quotas and rate limits.** Creating more interviews or using more voice minutes than the
  monthly allowance, getting quota back by deleting interviews, or bypassing a rate limit.
- **Admin control plane.** Reaching `/api/admin` without the role, changing roles, tiers,
  providers or settings without permission, or tampering with the audit log.

Out of scope:

- **What admins can already do.** Admins manage accounts, quotas, providers (including
  their base URLs) and the interviewer's house rules (`interviewerAddendum`). Reports that rely on that access are out
  of scope; reports that let someone gain it are very much in scope.
- **Content sent to configured providers.** Resume text, job descriptions, transcripts and
  live audio go to the text and realtime providers the operator configures, by design.
- **Model behaviour.** A model saying something false or unwanted, an unfair score, or the
  interviewer being talked off topic, without one of the concrete impacts listed above.
- **A candidate faking their own transcript or proctoring events.** The transcript and the
  proctoring signals come from the candidate's own browser and only affect their own
  practice report; this is documented and accepted. Proctoring is advisory, not an exam
  lock-down.
- **The demo seed.** `make demo` creates well-known demo accounts on purpose and refuses to
  run with `NODE_ENV=production`.
- **The stubs** (`apps/stubs`), test doubles that never run in production.
- Findings that require a compromised host, compromised AWS account, or leaked deployment
  secrets.
- Denial of service through resource exhaustion of a deployment you operate yourself, or
  spending your own provider budget.

## Hardening checklist for operators

- Deploy with the Terraform in `infra/terraform` (or match it): private subnets, TLS
  everywhere, encryption at rest with a customer-managed key, Redis with TLS and an AUTH
  token, secrets only in Secrets Manager.
- Keep `NODE_ENV=production`: the API refuses to boot with development secrets, the mail
  outbox, inline jobs, a localhost web URL or missing CORS origins, and refuses stub
  providers.
- Put provider keys in the `<prefix>/provider-keys` secret by hand rather than in
  `terraform.tfvars`, so they stay out of Terraform state.
- Serve the web app and the API on one HTTPS host so the refresh cookie stays first-party
  and `Secure`.
- Choose a registration mode: `INVITE_ONLY` with your own email domains, or `CLOSED`, for a
  private deployment.
- Set quota tiers that match your budget (monthly interviews, voice minutes, session
  length), and spending limits in each provider's console.
- For sensitive use, set a retention period in `/admin/settings`, and consider a local text
  model (Ollama or vLLM) for planning and scoring. Live voice always goes to the realtime
  provider you configure.
- Enable CloudFront and WAF (`enable_cdn`, on in `aws-prod`) for public deployments.
- Subscribe someone to the alarm topic (`alarm_email`).
