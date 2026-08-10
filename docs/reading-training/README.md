# Reading Training domain contract

Status: frozen v1 language-neutral contract for issue #27.

Reading Training is a standalone Nostos capability. Nostos SQLite owns programme policy, book assignments, sessions, captures, reviews, notifications, command receipts, and import receipts. Hermes and the former Python coach are behaviour oracles and optional clients only; deleting them must not remove any manual Nostos capability.

## Contract map

- [`state-machine.md`](state-machine.md) — session states, legal commands, timing, restart, and transition errors.
- [`progression.md`](progression.md) — Endurance, Deep, Recovery, weekly evidence, holds, increases, deloads, consolidation, and the volume guard.
- [`contracts.md`](contracts.md) — exact-once commands/captures, assignments, weekly reviews, notification outbox, stable envelopes, and reply vocabulary.
- [`fixtures/behaviour-v1.json`](fixtures/behaviour-v1.json) — the 15 frozen parity cases plus a separate heavy-week stress case.

The machine-readable fixture mirrors `tests/fixtures/reading-training/behaviour-v1.json`, whose cases execute against the real Nostos engine.

## Non-negotiable invariants

1. Exactly one programme policy row exists.
2. At most one session is globally open across Planned, Active, Paused, and AwaitingFeedback.
3. Each mode has at most one default active book; other active or queued books remain valid.
4. A completed session belongs to exactly one Nostos book.
5. Every mutation is exact-once on `(clientId, idempotencyKey)`.
6. Captures preserve text verbatim and an external capture ID is unique when supplied.
7. Completed sessions and committed weekly reviews are immutable through public commands.
8. UTC is persisted; ISO-week calculations use the programme timezone at the service boundary.
9. Cancelling is neutral: it is not volume, failure, or progression evidence.
10. No streak, debt, catch-up, guilt, or compulsory-reflection model exists.

## Baseline programme

- Endurance: 40 minutes
- Deep: 30 minutes
- Recovery: 20 minutes
- Default timezone: Europe/Stockholm

The manual Angular route, REST, and authenticated MCP expose the same Nostos service and semantic result. The Telegram connector is optional and stateless.
