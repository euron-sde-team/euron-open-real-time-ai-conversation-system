# ADR 0002: One organisation per deployment

## Status

Accepted.

## Context

The system is meant to be self-hosted by a school, bootcamp, company or community for its
own members. Multi-tenancy adds a tenant column to every table and query, tenant-aware
quotas, keys and settings, and a whole class of cross-tenant leaks.

## Decision

One deployment serves one organisation or community. There is no tenant column
([`db/migrations/0001_init.sql`](../../../db/migrations/0001_init.sql)). Deployment-wide
choices (name, registration mode, interviewer name and house rules, feature switches,
retention) live in the `settings` table and are edited in Admin, Settings. Two roles
exist: `USER` and `ADMIN`.

## Consequences

Positive:

- Every query has one scope to get right: the owner. Ownership checks are simple and
  tested on every interview route.
- Provider keys, quotas and settings have one meaning per deployment.

Trade-offs:

- Hosting several organisations means several deployments (separate databases and
  stacks). The Terraform modules make that repeatable, not free.

## Alternatives considered

- **Tenant column everywhere.** More code and more risk for a use case this project does
  not target.
