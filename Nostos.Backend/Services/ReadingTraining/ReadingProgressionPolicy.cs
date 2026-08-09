using Nostos.Shared.Enums;

namespace Nostos.Backend.Services.ReadingTraining;

// ============================================================================
// Task 4B1 — Pure weekly Reading Training progression policy.
//
// Deterministic weekly adaptation for ONE mode over one ISO week. The policy
// is a pure function of its input records: no EF tracking, no database access,
// no notifications and no time conversion (ISO week/date conversion is a
// caller concern and deliberately NOT part of this slice).
//
// Decision rules (all thresholds are fixed constants below, documented both
// here and in the focused tests):
//   * Modes adapt independently. Recovery sessions are volume-only: they count
//     toward weekly volume but can never be qualifying evidence and can never
//     cause an increase of Endurance or Deep.
//   * Only Completed sessions count. Cancelled sessions never count as volume,
//     attempts, failures, or evidence.
//   * A qualifying normal-target attempt is Endurance/Deep, Constraint=None,
//     ratings present (Effort/Focus > 0 and not skipped), and effective
//     minutes at least the session's PlannedTargetMinutes. ReportedMinutes
//     overrides the accumulated measured minutes.
//   * Constrained sessions are volume but neither failures nor qualifying
//     evidence.
//   * High fatigue / poor focus must hold or reduce, never increase: increase
//     requires >= 3 qualifying attempts, completion rate >= 0.8, median
//     effort <= 7 and median focus >= 6, and no volume-guard breach.
//   * Increase is exactly +5, capped at Endurance 60 / Deep 45. One session
//     can never force an increase (qualifying count < 3 holds).
//   * A bad week (completion rate < 0.5, median effort >= 9, or median focus
//     <= 3 over completed normal-target sessions) deloads by exactly 5, never
//     below the baselines Endurance 40 / Deep 30 / Recovery 20.
//   * Consolidation: after two consecutive increases, the next otherwise-good
//     week holds ("consolidate") and resets the increase counter.
//   * 15% volume guard: total completed weekly volume (all modes, effective
//     minutes) may not exceed 115% of the previous completed week's volume
//     before any increase; when the previous volume is absent or zero, the
//     guard base is 3 * the mode's established target. A guard breach holds
//     with reason "volume-guard".
//   * An empty / no-evidence week holds and never punishes.
//
// Median is deterministic: values sorted ascending, and for even counts the
// lower middle element is used (never an average).
// ============================================================================

/// <summary>Per-session evidence snapshot, independent of EF tracking.</summary>
public sealed record ReadingProgressionSession(
    ReadingMode Mode,
    ReadingSessionStatus Status,
    ReadingConstraint Constraint,
    int PlannedTargetMinutes,
    int AccumulatedSeconds,
    int? ReportedMinutes,
    int Effort,
    int Focus,
    bool RatingsSkipped
);

/// <summary>One weekly evaluation request for one mode.</summary>
public sealed record ReadingProgressionInput(
    ReadingMode Mode,
    int TargetBeforeMinutes,
    int EstablishedMinutes,
    int? PreviousWeekVolumeMinutes,
    int ConsecutiveIncreases,
    IReadOnlyList<ReadingProgressionSession> Sessions
);

/// <summary>Deterministic outcome of one weekly evaluation.</summary>
public sealed record ReadingProgressionResult(
    ReadingMode Mode,
    string DecisionKind,           // "increase" | "hold" | "deload" | "consolidate"
    string Reason,                 // stable machine-readable code, see constants
    int TargetBeforeMinutes,
    int TargetAfterMinutes,
    int QualifyingCount,
    double CompletionRate,         // 0..1: target-met / completed normal-target sessions
    int? MedianEffort,             // null when no rated completed normal-target session exists
    int? MedianFocus,
    int TotalVolumeMinutes,        // effective minutes of every Completed session (all modes)
    int NextConsecutiveIncreases
);

public static class ReadingProgressionPolicy
{
    // --- Fixed baselines: deloads never go below these. ---
    public const int EnduranceBaselineMinutes = 40;
    public const int DeepBaselineMinutes = 30;
    public const int RecoveryBaselineMinutes = 20;

    // --- Fixed caps: increases are +5, clamped to these. ---
    public const int EnduranceCapMinutes = 60;
    public const int DeepCapMinutes = 45;
    public const int RecoveryCapMinutes = 20; // unreachable: Recovery never increases

    // --- Fixed thresholds (the documented decision rules). ---
    public const int MinQualifyingAttempts = 3;
    public const double IncreaseCompletionRate = 0.8;
    public const double DeloadCompletionRate = 0.5;
    public const int MaxIncreaseMedianEffort = 7;
    public const int MinIncreaseMedianFocus = 6;
    public const int DeloadMedianEffort = 9;  // median effort >= 9 triggers deload
    public const int DeloadMedianFocus = 3;   // median focus <= 3 triggers deload
    public const int IncreaseStepMinutes = 5;
    public const int ConsolidationAfterIncreases = 2;
    public const int VolumeGuardPercent = 115; // 115% of the previous week's volume
    public const int VolumeGuardFallbackMultiplier = 3; // 3 * established target

    // --- Decision kinds. ---
    public const string KindIncrease = "increase";
    public const string KindHold = "hold";
    public const string KindDeload = "deload";
    public const string KindConsolidate = "consolidate";

    // --- Stable machine-readable reasons. ---
    public const string ReasonCriteriaMet = "criteria-met";
    public const string ReasonNoEvidence = "no-evidence";
    public const string ReasonInsufficientQualifying = "insufficient-qualifying";
    public const string ReasonCompletionRate = "completion-rate";
    public const string ReasonHighEffort = "high-effort";
    public const string ReasonLowFocus = "low-focus";
    public const string ReasonVolumeGuard = "volume-guard";
    public const string ReasonConsolidation = "consolidation";
    public const string ReasonRecoveryVolumeOnly = "recovery-volume-only";

    public static ReadingProgressionResult Evaluate(ReadingProgressionInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (input.TargetBeforeMinutes < 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(input), "TargetBeforeMinutes must be non-negative.");
        }

        var modeSessions = input.Sessions.Where(s => s.Mode == input.Mode).ToList();

        // Total completed weekly volume across ALL modes: constrained and
        // recovery sessions count as volume; cancelled sessions never do.
        // Effective minutes = ReportedMinutes ?? floor(AccumulatedSeconds / 60).
        var totalVolume = input.Sessions
            .Where(s => s.Status == ReadingSessionStatus.Completed)
            .Sum(EffectiveMinutes);

        // Normal-target attempts are completed, unconstrained sessions only.
        // Cancelled sessions are ignored completely: cancelling is not failure.
        var normalCompleted = modeSessions
            .Where(s => s.Status == ReadingSessionStatus.Completed
                        && s.Constraint == ReadingConstraint.None)
            .ToList();

        var qualifying = normalCompleted.Where(IsQualifyingAttempt).ToList();

        // Medians run over completed normal-target sessions with ratings
        // present (Effort/Focus > 0 and not skipped); Rating is optional.
        var rated = normalCompleted
            .Where(s => !s.RatingsSkipped && s.Effort > 0 && s.Focus > 0)
            .ToList();
        var medianEffort = Median(rated.Select(s => s.Effort).ToList());
        var medianFocus = Median(rated.Select(s => s.Focus).ToList());

        // An empty / no-evidence week holds and never punishes: at least one
        // completed normal-target session is required before any adaptation.
        if (normalCompleted.Count == 0)
        {
            return Result(input, KindHold, ReasonNoEvidence, input.TargetBeforeMinutes,
                qualifying.Count, 0.0, medianEffort, medianFocus, totalVolume,
                input.ConsecutiveIncreases);
        }

        var targetMetCount = normalCompleted.Count(s => EffectiveMinutes(s) >= s.PlannedTargetMinutes);
        var completionRate = targetMetCount / (double)normalCompleted.Count;

        // Recovery contributes volume only. It never adapts any target and a
        // difficult Recovery week is not treated as failure.
        if (input.Mode == ReadingMode.Recovery)
        {
            return Result(input, KindHold, ReasonRecoveryVolumeOnly, input.TargetBeforeMinutes,
                0, completionRate, medianEffort, medianFocus, totalVolume,
                input.ConsecutiveIncreases);
        }

        // --- Bad week: deterministic deload by exactly 5, floored at baseline. ---
        var badWeek = completionRate < DeloadCompletionRate
                      || (medianEffort.HasValue && medianEffort.Value >= DeloadMedianEffort)
                      || (medianFocus.HasValue && medianFocus.Value <= DeloadMedianFocus);
        if (badWeek)
        {
            var after = Math.Max(BaselineFor(input.Mode), input.TargetBeforeMinutes - IncreaseStepMinutes);
            var reason = completionRate < DeloadCompletionRate ? ReasonCompletionRate
                : medianEffort.HasValue && medianEffort.Value >= DeloadMedianEffort ? ReasonHighEffort
                : ReasonLowFocus;
            return Result(input, KindDeload, reason, after,
                qualifying.Count, completionRate, medianEffort, medianFocus, totalVolume,
                nextConsecutiveIncreases: 0);
        }

        // --- Otherwise-good week? Increase requires every criterion at once. ---
        var goodWeek = qualifying.Count >= MinQualifyingAttempts
                       && completionRate >= IncreaseCompletionRate
                       && medianEffort.HasValue && medianEffort.Value <= MaxIncreaseMedianEffort
                       && medianFocus.HasValue && medianFocus.Value >= MinIncreaseMedianFocus;
        if (goodWeek)
        {
            // Volume guard applies before any increase. Guard base is the
            // previous completed week's volume, or 3 * the established target
            // when the previous volume is absent or zero.
            if (VolumeGuardBreached(input, totalVolume))
            {
                return Result(input, KindHold, ReasonVolumeGuard, input.TargetBeforeMinutes,
                    qualifying.Count, completionRate, medianEffort, medianFocus, totalVolume,
                    nextConsecutiveIncreases: input.ConsecutiveIncreases);
            }

            // Consolidation: after two consecutive increases the next
            // otherwise-good week holds and resets the increase counter.
            if (input.ConsecutiveIncreases >= ConsolidationAfterIncreases)
            {
                return Result(input, KindConsolidate, ReasonConsolidation, input.TargetBeforeMinutes,
                    qualifying.Count, completionRate, medianEffort, medianFocus, totalVolume,
                    nextConsecutiveIncreases: 0);
            }

            var after = Math.Min(CapFor(input.Mode), input.TargetBeforeMinutes + IncreaseStepMinutes);
            return Result(input, KindIncrease, ReasonCriteriaMet, after,
                qualifying.Count, completionRate, medianEffort, medianFocus, totalVolume,
                input.ConsecutiveIncreases + 1);
        }

        // --- Hold with the first unmet criterion (deterministic order). ---
        // A qualifying count >= 3 guarantees rated sessions exist, so the
        // medians are non-null here; the null-coalescing is defensive only.
        var holdReason = completionRate < IncreaseCompletionRate ? ReasonCompletionRate
            : qualifying.Count < MinQualifyingAttempts ? ReasonInsufficientQualifying
            : (medianEffort ?? 0) > MaxIncreaseMedianEffort ? ReasonHighEffort
            : ReasonLowFocus;
        return Result(input, KindHold, holdReason, input.TargetBeforeMinutes,
            qualifying.Count, completionRate, medianEffort, medianFocus, totalVolume,
            input.ConsecutiveIncreases);
    }

    // --- Helpers -------------------------------------------------------------

    // ReportedMinutes overrides the accumulated measured minutes.
    private static int EffectiveMinutes(ReadingProgressionSession s) =>
        s.ReportedMinutes ?? (int)Math.Floor(s.AccumulatedSeconds / 60.0);

    // Endurance/Deep only, unconstrained, rated, and at least the planned
    // target. Recovery is volume-only and never qualifies.
    private static bool IsQualifyingAttempt(ReadingProgressionSession s) =>
        s.Status == ReadingSessionStatus.Completed
        && s.Mode is ReadingMode.Endurance or ReadingMode.Deep
        && s.Constraint == ReadingConstraint.None
        && !s.RatingsSkipped
        && s.Effort > 0
        && s.Focus > 0
        && EffectiveMinutes(s) >= s.PlannedTargetMinutes;

    // Deterministic median: ascending order; even counts use the lower middle.
    private static int? Median(IReadOnlyList<int> values)
    {
        if (values.Count == 0)
        {
            return null;
        }

        var sorted = values.OrderBy(v => v).ToArray();
        return sorted[(sorted.Length - 1) / 2];
    }

    private static bool VolumeGuardBreached(ReadingProgressionInput input, int totalVolume)
    {
        var guardBase = input.PreviousWeekVolumeMinutes is > 0
            ? input.PreviousWeekVolumeMinutes.Value
            : VolumeGuardFallbackMultiplier * input.EstablishedMinutes;
        return totalVolume * 100 > guardBase * VolumeGuardPercent;
    }

    private static int BaselineFor(ReadingMode mode) => mode switch
    {
        ReadingMode.Endurance => EnduranceBaselineMinutes,
        ReadingMode.Deep => DeepBaselineMinutes,
        ReadingMode.Recovery => RecoveryBaselineMinutes,
        _ => throw new ArgumentOutOfRangeException(nameof(mode), mode, "Unknown reading mode."),
    };

    private static int CapFor(ReadingMode mode) => mode switch
    {
        ReadingMode.Endurance => EnduranceCapMinutes,
        ReadingMode.Deep => DeepCapMinutes,
        ReadingMode.Recovery => RecoveryCapMinutes, // never reached: Recovery cannot increase
        _ => throw new ArgumentOutOfRangeException(nameof(mode), mode, "Unknown reading mode."),
    };

    private static ReadingProgressionResult Result(
        ReadingProgressionInput input,
        string kind,
        string reason,
        int targetAfter,
        int qualifyingCount,
        double completionRate,
        int? medianEffort,
        int? medianFocus,
        int totalVolume,
        int nextConsecutiveIncreases) =>
        new(
            input.Mode,
            kind,
            reason,
            input.TargetBeforeMinutes,
            targetAfter,
            qualifyingCount,
            completionRate,
            medianEffort,
            medianFocus,
            totalVolume,
            nextConsecutiveIncreases);
}
