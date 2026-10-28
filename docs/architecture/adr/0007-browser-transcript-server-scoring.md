# ADR 0007: The browser reports the transcript; the server scores it

## Status

Accepted.

## Context

Live audio flows between the browser and the realtime provider, so the API does not hear
the conversation. Something has to tell the server what was said, and something has to
rate it. If the browser (or the realtime model through a tool argument the browser
relays) supplied the ratings, a candidate could post any score.

## Decision

- The realtime model has one tool, `end_question`, with no arguments. It only signals that
  the question is done.
- The browser assembles the question's transcript from the provider's transcription
  events (or the candidate's code) and posts it to `POST /api/interviews/:id/answers`.
  The schema is strict and has no rating fields.
- An `interview.score` job scores the answer with the text model, using a fixed rubric,
  fenced untrusted input and a zod-validated output. A candidate who said nothing gets 1
  on both ratings whatever the model returns.
- The job is idempotent by version (`answers.updated_at`).

## Consequences

Positive:

- Ratings always come from the server's model and rubric; posting a score is impossible.
- Scoring uses a cheaper text model than the realtime one, and can be re-run.

Trade-offs:

- The candidate can fake their own transcript. For self-practice the only person misled
  is the candidate, so this is accepted and stated in the
  [threat model](../threat-model.md).
- Scores arrive a few seconds after each question, not instantly.

## Alternatives considered

- **Ratings as `end_question` arguments.** The browser relays tool calls, so it could
  change them; this was a flaw of the original system.
- **A server sideband to the provider** to receive the provider's own transcript. Would
  close the fake-transcript gap for OpenAI; possible follow-up, not built.
