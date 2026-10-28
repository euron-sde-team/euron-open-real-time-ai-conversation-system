# Architecture decision records

Short records of the decisions that shape Euron Open Conversation: the context, what was
decided, and what it costs. The system as built is described in [HLD.md](../HLD.md) and
[LLD.md](../LLD.md).

| ADR | Decision |
| --- | --- |
| [0001](0001-monorepo-stack.md) | One pnpm and Turborepo monorepo: Express API and worker, Next.js web app, shared DOM-free types and client, SQL migrations |
| [0002](0002-single-tenant.md) | One organisation or community per deployment; no tenants |
| [0003](0003-server-built-locked-realtime-instructions.md) | The server builds the interviewer's instructions and locks them into a short-lived realtime credential |
| [0004](0004-text-model-adapters.md) | Text models behind one adapter interface; keys only in the environment |
| [0005](0005-resumes-never-stored.md) | Resumes are parsed in memory and never stored |
| [0006](0006-monthly-quotas-counts-only-usage.md) | Monthly interview and voice-minute quotas from admin tiers; usage rows hold counts only |
| [0007](0007-browser-transcript-server-scoring.md) | The browser reports the transcript; the server scores it |
| [0008](0008-proctoring-in-browser-only.md) | Proctoring runs in the browser; only events reach the server |
| [0009](0009-native-token-mode.md) | Native token mode for future mobile clients (`X-Client: native`) |
