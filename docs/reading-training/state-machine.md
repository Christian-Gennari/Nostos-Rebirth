# Session state machine

## States

`Idle → Planned → Active ↔ Paused → AwaitingFeedback → Completed`

An open session may also become `Cancelled`. `Idle` means no persisted open session; it is not a session row status.

## Legal commands

| Current state | Command | Result |
|---|---|---|
| Idle | plan | Planned |
| Planned | start | Active |
| Planned | cancel | Cancelled |
| Active | pause | Paused |
| Active | complete | AwaitingFeedback |
| Active | cancel | Cancelled |
| Paused | resume | Active |
| Paused | complete | AwaitingFeedback |
| Paused | cancel | Cancelled |
| AwaitingFeedback | rate | Completed |
| AwaitingFeedback | skip ratings | Completed |
| AwaitingFeedback | cancel/discard stale session | Cancelled |
| Completed or Cancelled | any lifecycle mutation | unchanged or transition error |

Planning while any session is open is rejected. Starting requires Planned; pausing requires Active; resuming requires Paused; rating or skipping requires AwaitingFeedback. Repeating an already-committed command with the same client and idempotency key returns its stored result without another state change.

## Timing

Measured elapsed seconds are accumulated only while Active:

`measured = persisted accumulated active seconds + max(0, nowUtc - lastStartedAtUtc)`

Pausing first accumulates the current active span and then stops the clock. Resuming records a new active-span start. Paused duration is never added. Restarting while Planned or Paused changes nothing. Restarting while Active reconstructs elapsed time from persisted UTC timestamps; if the span is stale, completion requires an explicit actual-minute report or discard rather than trusting an unbounded timer.

Completing stores measured seconds. An optional reported-minutes value changes effective/display minutes but never overwrites measured seconds. Weekly evidence uses `reportedMinutes` when present, otherwise floor(`measuredSeconds / 60`).

## Restart, timezone, and DST

All timestamps are persisted in UTC. Human clock text and ISO-week membership are derived with the programme timezone. DST transitions therefore do not alter elapsed UTC seconds or move persisted instants; they only affect local display and week-boundary conversion.

## Concurrency and integrity

The database enforces one global open slot. Concurrent plan/start attempts cannot create two open sessions even if application checks race. Mutations and their command receipts commit in one database transaction; a failed transition cannot leave an unreceipted partial effect.

## Stable transition errors

The service uses machine-readable error codes inside the stable result envelope, including `not_initialized`, `already_active`, `no_planned_session`, `no_active_session`, `invalid_transition`, `invalid_minutes`, `needs_actual_minutes`, and assignment/book lookup errors. Errors leave domain state unchanged, while duplicate successful commands return the original reply/data/version with `duplicate: true`.
