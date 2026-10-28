# ADR 0006: Monthly quotas from admin tiers; usage rows hold counts only

## Status

Accepted.

## Context

Every interview costs the operator text-model tokens and, mostly, realtime voice minutes.
There is no billing in the product. Operators need a simple way to give a cohort more and
the public less, and to see what is being spent, without the usage records themselves
becoming a store of personal content.

## Decision

- Two monthly allowances per user (UTC calendar months): interviews created and voice
  minutes, plus a per-tier maximum session length. Limits come from the user's override,
  else their tier, else the default tier; `NULL` means unlimited
  ([`services/quota.service.ts`](../../../apps/api/src/services/quota.service.ts)).
- Usage is booked in `usage_daily` (user, UTC day, model): `interviews`, `voice_seconds`,
  `calls`, `input_tokens`, `output_tokens`. Never text.
- Interviews are booked when created and given back only when the plan fails. Deleting an
  interview gives nothing back.
- Voice seconds are measured by the server from mint to close and capped per session.
- Every check-and-book runs under `pg_advisory_xact_lock` keyed by user.
- Optional per-model prices feed an admin cost estimate; nothing is billed.

## Consequences

Positive:

- Parallel requests cannot overdraw. Deleting cannot launder quota.
- The usage table can be shared with finance or analytics without exposing interview
  content.
- Admins can manage cohorts with tiers and individuals with overrides.

Trade-offs:

- Text-model tokens are counted but not limited per user; voice minutes are the real
  control.
- A session the browser abandons is charged its full length.

## Alternatives considered

- **Count from the `interviews` table.** Simple, but deleting would refund quota.
- **Daily allowances.** Interviews are occasional, longer events; monthly fits practice
  patterns better.
