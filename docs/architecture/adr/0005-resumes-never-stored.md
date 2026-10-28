# ADR 0005: Resumes are never stored

## Status

Accepted.

## Context

A resume carries a name, contact details, employment history and sometimes more. The
system needs it once: to write the interview plan. Keeping files means object storage,
access control, retention and breach exposure for data the product does not need after
planning.

## Decision

- The upload is read into memory by multer (`memoryStorage`, capped at `MAX_RESUME_MB`).
- The type is decided by magic bytes (PDF or DOCX), never by name or browser type.
- Text is extracted in memory (unpdf, mammoth), capped at 24,000 characters, and the
  buffer is dropped ([`integrations/extract.ts`](../../../apps/api/src/integrations/extract.ts)).
- The text travels to the worker in the `interview.plan` job only, configured to be
  removed from Redis on completion and on failure.
- Only the planner's output persists: a short `summary` (up to 2,000 characters), `role`,
  `domain` and the plan.
- No resume text is written to logs or usage rows.

## Consequences

Positive:

- No file storage in the request path and no resume archive to protect or delete.
- Account deletion and retention have less to erase.

Trade-offs:

- A resume interview cannot be replanned (`409 REPLAN_UNAVAILABLE`); the candidate uploads
  again. Job description interviews keep their description and can be replanned.
- If the planner job is replayed after its payload was removed, it fails with a plain
  reason and gives the quota back.
- Resume text exists in Redis while the job waits or runs.

## Alternatives considered

- **Store the file in a private bucket.** Enables replanning, at the cost of holding the
  most sensitive document in the system indefinitely.
- **Store the extracted text.** Same exposure in a different place.
