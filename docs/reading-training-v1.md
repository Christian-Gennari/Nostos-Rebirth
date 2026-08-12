# Reading Training v1 — Behaviour Parity Contract

Status: frozen contract for the first Nostos-owned Reading Training slice (issue #27).

This document and its companion fixture
(`tests/fixtures/reading-training/behaviour-v1.json`) pin the **accepted
behaviours** of the existing Python reading coach as Nostos must reproduce
them. The Python implementation is the behaviour oracle during porting and is
never a runtime dependency of Nostos. Nothing in this contract is owned,
cached, or computed outside Nostos.

The complete language-neutral specification is split across
[`docs/reading-training/`](reading-training/README.md): state machine,
progression policy, service/persistence contracts, and mirrored fixtures.

## Non-negotiables

- **Nostos owns everything.** Nostos SQLite is the single source of truth for
  books, assignments, sessions, captures, history, progression, weekly reviews,
  notifications, command idempotency, and import receipts. There is no Hermes
  runtime, process, or file dependency.
- **One globally open session.** At most one timed session may be open at any
  moment, enforced by the nullable `OpenSlot` sentinel unique index.
- **One default per mode.** Many assignments may be active/queued per mode;
  exactly one may be the default, enforced by the nullable `DefaultSlot`
  sentinel unique index.
- **Singleton programme.** Exactly one `ReadingProgramme` policy row exists,
  enforced by the `SingletonSlot` unique index.
- **Exact-once commands.** Every mutating command carries `(ClientId,
  IdempotencyKey)`; `ReadingCommandReceipt` is unique on that pair. Retries
  return the stored response without re-running the command.
- **Exact-once captures.** `ReadingCapture.ExternalId` is unique when present.
- **UTC persistence.** All `DateTime` columns are UTC. Europe/Stockholm week
  conversion happens only in the service layer.
- **Immutability.** Completed sessions and committed weekly reviews are never
  rewritten by public commands.
- **No silent data loss.** Deleting a Nostos book that has reading history is
  rejected by the database (Restrict) rather than cascading training history
  away.

## Accepted behaviours (summary)

1. Baseline sustainable targets are Endurance 40, Deep 30, Recovery 20 minutes.
2. Session state machine is `Idle → Planned → Active ↔ Paused →
   AwaitingFeedback → Completed`, with cancellation.
3. Elapsed time excludes pauses; restarting a paused session must not
   double-count time.
4. A reported-minutes override replaces the displayed duration while measured
   seconds are preserved.
5. Time-constrained sessions add volume but are neither failure nor progression
   evidence.
6. High fatigue holds or reduces load; it never increases it.
7. Weekly-only adaptation: three qualifying sessions plus completion threshold
   permit +5; a 15% volume guard, deload, and consolidation stay deterministic.
8. Completed sessions link to exactly one Nostos book; multiple books may be
   active across a period.
9. Captures are verbatim and attach to the correct book; retried captures with
   the same `ExternalId` produce one row.
10. Weekly reviews commit exactly once per completed ISO week per mode.
11. Command retries produce exactly one effect.
12. No streak, debt, catch-up, guilt, or compulsory-reflection language.

See `tests/fixtures/reading-training/behaviour-v1.json` for the machine-readable
expected-input/expected-output cases the Nostos engine must satisfy. Its
`cases` array remains the exact 15-case frozen parity contract; `stressCases`
is separate and drives the 11-session mixed-mode heavy-week verification.
