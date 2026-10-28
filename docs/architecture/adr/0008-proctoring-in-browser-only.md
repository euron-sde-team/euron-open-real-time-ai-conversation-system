# ADR 0008: Proctoring runs in the browser; only events reach the server

## Status

Accepted.

## Context

Some users want practice under exam-like conditions: is someone else in the room, did the
candidate leave the tab. Streaming or recording camera video would be a large privacy
cost, a storage cost, and a compliance burden.

## Decision

- Proctoring is a per-interview switch (default from the user's preference) and a
  deployment feature switch.
- Face presence runs in the browser with the MediaPipe face detector, loaded from this
  origin (`/mediapipe/wasm`, `/mediapipe/blaze_face_short_range.tflite`), one frame every
  1.5 seconds; a state must hold for 3 seconds to count
  ([`apps/web/src/lib/realtime/proctor.ts`](../../../apps/web/src/lib/realtime/proctor.ts)).
- Tab visibility is read from the page.
- Only events are sent (`NO_FACE`, `MULTIPLE_FACES`, `FACE_BACK`, `TAB_HIDDEN`,
  `TAB_VISIBLE`), batched, to `POST /api/interviews/:id/proctor-events`. They appear on the
  report.
- If the detector cannot load, the room shows the check as unavailable and the interview
  continues.
- The CSP allows `'wasm-unsafe-eval'` so the detector can compile its WebAssembly.

## Consequences

Positive:

- Video never leaves the device. Nothing to store, secure or delete.
- No third-party CDN at interview time.

Trade-offs:

- Proctoring is advisory. A candidate controls the browser and can defeat it. Events are
  hints for the candidate's own review, not evidence.
- `'wasm-unsafe-eval'` widens the CSP slightly (WebAssembly compilation, not JavaScript
  `eval`).

## Alternatives considered

- **Server-side video analysis.** Stronger, but contradicts the privacy goal and adds a
  media pipeline.
- **No proctoring.** Simpler; kept as the default (off).
