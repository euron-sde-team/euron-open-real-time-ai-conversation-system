## What and why

<!-- One paragraph: the problem, and how this change solves it. Link the issue. -->

## How it was verified

- [ ] `pnpm lint && pnpm typecheck && pnpm test`
- [ ] `make test-integration` (if API, database, queue, provider, realtime or mail code changed)
- [ ] `make test-matrix` (if mail backends changed)
- [ ] `make e2e` (if a user flow or the infrastructure changed)
- [ ] `make tf-validate tf-lint tf-security` (if Terraform changed)

## Checklist

- [ ] Docs updated (`docs/`, the configuration reference) for any behavior or config change
- [ ] `pnpm openapi` re-run if a route changed
- [ ] New migration instead of editing an applied one
- [ ] Access stays scoped: interviews, answers, reports and shares are visible only to their owner (and to what an admin is meant to see), covered by a test
- [ ] Provider keys never reach the database, a log line or an API response
- [ ] Resumes stay in memory (never written to disk, the database or a log) and uploads keep their size limit
- [ ] No secrets, account ids, real emails or hostnames (`make sanitize` is clean)
- [ ] Security-relevant change? Described the threat and mitigation above
