# Service and persistence contracts

## Stable semantic result

REST, authenticated MCP, Angular, and the optional gateway connector consume the same semantic result:

```text
reply: human-readable authoritative reply
data: typed payload or null/omitted-null on MCP JSON
stateVersion: authoritative programme version
 duplicate: true only when replaying a stored command result
```

Semantic errors carry a stable error `code` as data and do not advance state version. Transport-specific JSON representation may omit a null field, but reply, code/data meaning, version, and duplicate semantics are identical.

## Exact-once commands

Every mutation supplies non-empty `clientId` and `idempotencyKey`. Their pair is unique. The command's domain effect and immutable serialized receipt commit in one transaction. A retry returns the stored result byte-for-byte in meaning and performs no second effect. Concurrent retries resolve to one committed receipt/effect.

Failure receipts are permitted only when the attempted command leaves tracked domain state unchanged. Validation and transition failures cannot persist timer accumulation or other partial mutation.

## Books and sessions

Many assignments may be active or queued in each mode, but only one active assignment may be default for that mode. Queue order is deterministic. Completing a book preserves its historical sessions and captures. At most one session is globally open, and every session references exactly one Nostos book.

## Captures and inbox

Capture text is stored verbatim. Thoughts may resolve immediately; questions and bookmarks enter the inbox. Book and optional session links are preserved. When supplied, `externalId` is unique: replay returns the existing capture instead of creating another row. Resolving or promoting a capture is also an exact-once command.

## Weekly reviews

A review is unique by completed ISO week. Its three mode decisions and evidence snapshot are immutable. Preview performs no write. Commit applies all decisions and target/version changes atomically. Repeated commits do not create rows or reapply targets. Missing completed weeks are committed in order after downtime.

## Notification outbox

Notifications are durable Nostos rows created transactionally with the state that caused them. A sender leases eligible rows for a bounded interval. Delivery is acknowledged only after confirmed send; failure or lease expiry makes the row eligible again. Idempotent acknowledgement prevents duplicate state changes. No connector owns or deletes notification state, and the v1 connector does not claim delivery capability it has not implemented.

## Import and backup privacy

The one-time Hermes import is local, explicit, dry-run-first, fingerprint-bound, checksum-verified, and exact-once. It fails closed before backup or database writes on malformed manifests, unsafe names/paths, missing files, malformed JSONL, or checksum mismatch. Immutable import receipts and backup metadata contain only whitelisted counts, IDs, codes, basenames, lengths, and checksums—never titles, authors, capture/session text, notes, details, source paths, or raw source timestamps.

Normal `.nostos` backup/restore treats the SQLite database as authoritative and adds only safe informational Reading Training metadata. Restore verifies archive integrity, preserves the original database on failure, and always exits maintenance mode.

## Reply vocabulary

Replies are direct and operational: plan/start/pause/resume/complete/rate/capture/review status plus stable transition guidance. The exact rating prompt is:

```text
Effort 1–10?
Focus 1–10?
```

Allowed adaptation words are `increase`, `hold`, `deload`, and `consolidate`, with stable reasons such as `criteria-met`, `no-evidence`, `insufficient-qualifying`, `completion-rate`, `high-effort`, `low-focus`, `volume-guard`, `consolidation`, and `recovery-volume-only`.

Forbidden framing includes streak, debt, catch-up, guilt, and compulsory reflection.
