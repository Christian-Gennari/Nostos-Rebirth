# Weekly progression contract

Progression is deterministic, weekly, and evaluated independently for Endurance, Deep, and Recovery. It does not use streaks, debt, catch-up volume, or daily punishment.

## Modes and bounds

| Mode | Baseline | Cap | Adaptation |
|---|---:|---:|---|
| Endurance | 40 min | 60 min | ±5 or hold |
| Deep | 30 min | 45 min | ±5 or hold |
| Recovery | 20 min | 20 min | volume-only hold |

A constrained session uses the available load chosen for that day. It contributes completed volume but is never a qualifying attempt, never a failure, and never changes rating medians or completion-rate evidence.

Recovery contributes volume only. It cannot qualify, increase, deload, or pollute Endurance/Deep evidence.

## Evidence

Only sessions whose timer has stopped (`AwaitingFeedback` or `Completed`) contribute volume. Cancelled sessions contribute nothing.

A qualifying attempt must be:

- Completed (ratings closed),
- Endurance or Deep,
- unconstrained,
- at least its planned target using effective minutes,
- rated with effort and focus greater than zero, and
- not marked ratings-skipped.

Completion rate is target-met unconstrained completed attempts divided by all unconstrained completed attempts for that mode. Rating medians use rated unconstrained completed attempts; values are sorted and an even-sized set uses the lower middle value.

## Decision order

1. **No evidence:** hold without punishment.
2. **Recovery:** hold with `recovery-volume-only`.
3. **Bad week:** deload by exactly 5, floored at baseline, when completion rate is below 0.5, median effort is at least 9, or median focus is at most 3.
4. **Otherwise-good week:** an increase is eligible only with at least 3 qualifying attempts, completion rate at least 0.8, median effort at most 7, and median focus at least 6.
5. **15% volume guard:** before an increase, total completed volume across all modes must not exceed 115% of the previous completed week. If no positive previous volume exists, the guard base is three times the mode's established target. A breach holds with `volume-guard`.
6. **Consolidation:** after two consecutive increases, the next otherwise-good week holds with `consolidation` and resets the consecutive-increase counter.
7. **Increase:** add exactly 5 minutes, capped by the mode maximum.
8. **Other unmet criteria:** hold with the first deterministic reason: completion rate, insufficient qualifying attempts, high effort, or low focus.

## Review semantics

A preview is read-only. Committing creates one immutable review for the completed ISO week and three mode decisions, updates targets once, and advances state version once. Repeating the commit is exact-once. A background worker catches up every missing completed ISO week after downtime; correctness depends on unique week identity, not on being alive at a particular minute.

The canonical fixture contains an 11-session mixed-mode stress week proving constrained and Recovery volume cannot produce false deloads or false qualification.
