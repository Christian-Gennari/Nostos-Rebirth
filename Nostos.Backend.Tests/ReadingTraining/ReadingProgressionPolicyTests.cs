using FluentAssertions;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

// Focused unit tests for the pure weekly progression policy (Task 4B1).
// The policy is a pure function: no EF tracking, no database, no time
// conversion. All decision thresholds below are the fixed constants
// documented in ReadingProgressionPolicy.
public sealed class ReadingProgressionPolicyTests
{
    // --- Helpers --------------------------------------------------------------

    private static ReadingProgressionSession S(
        ReadingMode mode,
        ReadingSessionStatus status = ReadingSessionStatus.Completed,
        ReadingConstraint constraint = ReadingConstraint.None,
        int planned = 40,
        int accumulatedSeconds = 40 * 60,
        int? reported = null,
        int effort = 5,
        int focus = 7,
        bool ratingsSkipped = false) =>
        new(mode, status, constraint, planned, accumulatedSeconds, reported, effort, focus, ratingsSkipped);

    private static ReadingProgressionInput Input(
        ReadingMode mode,
        int targetBefore = 40,
        int established = 40,
        int? previousVolume = null,
        int consecutiveIncreases = 0,
        params ReadingProgressionSession[] sessions) =>
        new(mode, targetBefore, established, previousVolume, consecutiveIncreases, sessions);

    // Three qualifying Endurance sessions at exactly the planned 40 minutes,
    // with medians comfortably inside the increase thresholds (effort 6,
    // focus 8): the canonical good week.
    private static ReadingProgressionSession[] GoodEnduranceWeek() =>
    [
        S(ReadingMode.Endurance, effort: 5, focus: 8),
        S(ReadingMode.Endurance, effort: 6, focus: 8),
        S(ReadingMode.Endurance, effort: 7, focus: 8),
    ];

    // --- Successful +5 for each progression mode ------------------------------

    [Fact]
    public void Endurance_good_week_increases_by_exactly_five()
    {
        var result = ReadingProgressionPolicy.Evaluate(
            Input(ReadingMode.Endurance, sessions: GoodEnduranceWeek()));

        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonCriteriaMet);
        result.TargetBeforeMinutes.Should().Be(40);
        result.TargetAfterMinutes.Should().Be(45);
        result.QualifyingCount.Should().Be(3);
        result.CompletionRate.Should().Be(1.0);
        result.MedianEffort.Should().Be(6);
        result.MedianFocus.Should().Be(8);
        result.TotalVolumeMinutes.Should().Be(120);
        result.NextConsecutiveIncreases.Should().Be(1);
    }

    [Fact]
    public void Deep_good_week_increases_by_exactly_five()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Deep, targetBefore: 30, established: 30,
            sessions:
            [
                S(ReadingMode.Deep, planned: 30, accumulatedSeconds: 30 * 60, effort: 4, focus: 9),
                S(ReadingMode.Deep, planned: 30, accumulatedSeconds: 30 * 60, effort: 5, focus: 9),
                S(ReadingMode.Deep, planned: 30, accumulatedSeconds: 30 * 60, effort: 6, focus: 9),
            ]));

        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        result.TargetBeforeMinutes.Should().Be(30);
        result.TargetAfterMinutes.Should().Be(35);
        result.QualifyingCount.Should().Be(3);
        result.NextConsecutiveIncreases.Should().Be(1);
    }

    [Fact]
    public void Recovery_never_increases_even_with_three_completed_rated_sessions()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Recovery, targetBefore: 20, established: 20,
            sessions:
            [
                S(ReadingMode.Recovery, planned: 20, accumulatedSeconds: 20 * 60, effort: 2, focus: 9),
                S(ReadingMode.Recovery, planned: 20, accumulatedSeconds: 20 * 60, effort: 2, focus: 9),
                S(ReadingMode.Recovery, planned: 20, accumulatedSeconds: 20 * 60, effort: 2, focus: 9),
            ]));

        // Recovery is volume-only: never qualifying, therefore never increasing.
        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonRecoveryVolumeOnly);
        result.QualifyingCount.Should().Be(0);
        result.TargetAfterMinutes.Should().Be(20);
        result.TotalVolumeMinutes.Should().Be(60);
    }

    // --- Caps ------------------------------------------------------------------

    [Fact]
    public void Endurance_increase_is_capped_at_60()
    {
        var result = ReadingProgressionPolicy.Evaluate(
            Input(ReadingMode.Endurance, targetBefore: 58, sessions: GoodEnduranceWeek()));

        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        // 58 + 5 = 63 clamped to the Endurance cap of 60.
        result.TargetAfterMinutes.Should().Be(60);
    }

    [Fact]
    public void Endurance_at_cap_stays_at_60()
    {
        var result = ReadingProgressionPolicy.Evaluate(
            Input(ReadingMode.Endurance, targetBefore: 60, sessions: GoodEnduranceWeek()));

        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        result.TargetAfterMinutes.Should().Be(60);
    }

    [Fact]
    public void Deep_increase_is_capped_at_45()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Deep, targetBefore: 43, established: 30, previousVolume: 120,
            sessions: [S(ReadingMode.Deep, planned: 30), S(ReadingMode.Deep, planned: 30), S(ReadingMode.Deep, planned: 30)]));

        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        // 43 + 5 = 48 clamped to the Deep cap of 45.
        result.TargetAfterMinutes.Should().Be(45);
    }

    // --- One-session hold --------------------------------------------------------

    [Fact]
    public void Single_qualifying_session_holds_and_never_forces_an_increase()
    {
        var result = ReadingProgressionPolicy.Evaluate(
            Input(ReadingMode.Endurance, sessions: [S(ReadingMode.Endurance)]));

        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonInsufficientQualifying);
        result.QualifyingCount.Should().Be(1);
        result.TargetAfterMinutes.Should().Be(40);
        result.NextConsecutiveIncreases.Should().Be(0);
    }

    [Fact]
    public void Two_qualifying_sessions_hold_insufficient_qualifying()
    {
        var result = ReadingProgressionPolicy.Evaluate(
            Input(ReadingMode.Endurance, sessions: [S(ReadingMode.Endurance), S(ReadingMode.Endurance)]));

        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonInsufficientQualifying);
        result.QualifyingCount.Should().Be(2);
    }

    // --- Constrained sessions ------------------------------------------------------

    [Fact]
    public void Constrained_sessions_are_volume_but_never_evidence_or_failure()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            sessions:
            [
                S(ReadingMode.Endurance, constraint: ReadingConstraint.TimeConstrained),
                S(ReadingMode.Endurance, constraint: ReadingConstraint.FatigueConstrained),
                S(ReadingMode.Endurance, constraint: ReadingConstraint.TimeConstrained),
            ]));

        // Not evidence (no normal-target completed session) -> hold, not deload.
        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonNoEvidence);
        result.QualifyingCount.Should().Be(0);
        // But they still count as volume.
        result.TotalVolumeMinutes.Should().Be(120);
        result.TargetAfterMinutes.Should().Be(40);
    }

    // --- Recovery isolation / volume-only -------------------------------------------

    [Fact]
    public void Recovery_volume_can_never_increase_endurance_or_deep()
    {
        // A good Endurance week on its own, plus recovery volume that pushes
        // the week past the volume guard: the guard holds the increase.
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            established: 40,
            sessions:
            [
                .. GoodEnduranceWeek(),
                S(ReadingMode.Recovery, planned: 20, accumulatedSeconds: 20 * 60),
            ]));

        // Previous volume absent -> guard base = 3 * 40 = 120; 140 > 115% * 120.
        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonVolumeGuard);
        result.TotalVolumeMinutes.Should().Be(140);
        result.TargetAfterMinutes.Should().Be(40);
    }

    [Fact]
    public void Endurance_evaluation_ignores_other_modes_qualifying_evidence()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            sessions:
            [
                .. GoodEnduranceWeek(),
                S(ReadingMode.Deep, planned: 30, accumulatedSeconds: 30 * 60),
            ]));

        // Deep sessions share the volume but never the Endurance evidence.
        result.QualifyingCount.Should().Be(3);
        result.TotalVolumeMinutes.Should().Be(150);
    }

    // --- Deload: low focus / high effort ---------------------------------------------

    [Fact]
    public void Low_focus_week_deloads_by_five()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance, targetBefore: 45,
            sessions:
            [
                S(ReadingMode.Endurance, focus: 1),
                S(ReadingMode.Endurance, focus: 2),
                S(ReadingMode.Endurance, focus: 3),
            ]));

        // Median focus 2 <= 3 -> bad week; 45 - 5 = 40 (above the 40 baseline).
        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindDeload);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonLowFocus);
        result.MedianFocus.Should().Be(2);
        result.TargetBeforeMinutes.Should().Be(45);
        result.TargetAfterMinutes.Should().Be(40);
        result.NextConsecutiveIncreases.Should().Be(0);
    }

    [Fact]
    public void High_effort_week_deloads_by_five()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance, targetBefore: 45,
            sessions:
            [
                S(ReadingMode.Endurance, effort: 9),
                S(ReadingMode.Endurance, effort: 10),
                S(ReadingMode.Endurance, effort: 10),
            ]));

        // Median effort 10 >= 9 -> bad week; 45 - 5 = 40.
        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindDeload);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonHighEffort);
        result.MedianEffort.Should().Be(10);
        result.TargetAfterMinutes.Should().Be(40);
    }

    [Fact]
    public void Deload_never_goes_below_baseline()
    {
        // Endurance already at its 40-minute baseline: deload keeps 40.
        var endurance = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance, targetBefore: 40,
            sessions: [S(ReadingMode.Endurance, focus: 1), S(ReadingMode.Endurance, focus: 2), S(ReadingMode.Endurance, focus: 3)]));
        endurance.DecisionKind.Should().Be(ReadingProgressionPolicy.KindDeload);
        endurance.TargetAfterMinutes.Should().Be(40);

        // Deep already at its 30-minute baseline: deload keeps 30.
        var deep = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Deep, targetBefore: 30, established: 30,
            sessions: [S(ReadingMode.Deep, planned: 30, focus: 1), S(ReadingMode.Deep, planned: 30, focus: 2), S(ReadingMode.Deep, planned: 30, focus: 3)]));
        deep.DecisionKind.Should().Be(ReadingProgressionPolicy.KindDeload);
        deep.TargetAfterMinutes.Should().Be(30);
    }

    [Fact]
    public void Completion_rate_below_half_deloads_even_with_good_medians()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            sessions:
            [
                S(ReadingMode.Endurance),
                S(ReadingMode.Endurance),
                S(ReadingMode.Endurance, accumulatedSeconds: 10 * 60),
                S(ReadingMode.Endurance, accumulatedSeconds: 10 * 60),
            ]));

        // 2 target-met / 4 completed attempts = 0.5: exactly half is NOT below the 0.5
        // deload bar, so the week holds on the 0.8 increase bar instead.
        result.CompletionRate.Should().Be(0.5);
        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonCompletionRate);

        var deload = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance, targetBefore: 45,
            sessions:
            [
                S(ReadingMode.Endurance),
                S(ReadingMode.Endurance, accumulatedSeconds: 10 * 60),
                S(ReadingMode.Endurance, accumulatedSeconds: 10 * 60),
                S(ReadingMode.Endurance, accumulatedSeconds: 10 * 60),
            ]));

        // 1 target-met / 4 completed attempts = 0.25 < 0.5 -> deload.
        deload.DecisionKind.Should().Be(ReadingProgressionPolicy.KindDeload);
        deload.Reason.Should().Be(ReadingProgressionPolicy.ReasonCompletionRate);
        deload.CompletionRate.Should().Be(0.25);
        deload.TargetAfterMinutes.Should().Be(40);
    }

    [Fact]
    public void Recovery_difficult_week_is_volume_only_and_never_deloads()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Recovery, targetBefore: 20, established: 20,
            sessions:
            [
                S(ReadingMode.Recovery, planned: 20, accumulatedSeconds: 5 * 60, effort: 10, focus: 1),
                S(ReadingMode.Recovery, planned: 20, accumulatedSeconds: 5 * 60, effort: 10, focus: 1),
            ]));

        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonRecoveryVolumeOnly);
        result.TargetAfterMinutes.Should().Be(20);
    }

    [Fact]
    public void Cancelled_sessions_never_lower_completion_rate_or_trigger_deload()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            sessions:
            [
                .. GoodEnduranceWeek(),
                S(ReadingMode.Endurance, status: ReadingSessionStatus.Cancelled),
                S(ReadingMode.Endurance, status: ReadingSessionStatus.Cancelled),
            ]));

        result.CompletionRate.Should().Be(1.0);
        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        result.QualifyingCount.Should().Be(3);
    }

    // --- Empty / no-evidence hold -----------------------------------------------------

    [Fact]
    public void Empty_week_holds_and_never_punishes()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(ReadingMode.Endurance, sessions: []));

        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonNoEvidence);
        result.TargetAfterMinutes.Should().Be(40);
        result.QualifyingCount.Should().Be(0);
        result.TotalVolumeMinutes.Should().Be(0);
        // A hold neither advances nor resets the increase streak.
        result.NextConsecutiveIncreases.Should().Be(0);
    }

    [Fact]
    public void All_cancelled_week_is_no_evidence_hold_not_deload()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            sessions:
            [
                S(ReadingMode.Endurance, status: ReadingSessionStatus.Cancelled),
                S(ReadingMode.Endurance, status: ReadingSessionStatus.Cancelled),
                S(ReadingMode.Endurance, status: ReadingSessionStatus.Cancelled),
            ]));

        // Cancelled sessions never count as completed evidence -> hold, never punish.
        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonNoEvidence);
        result.TotalVolumeMinutes.Should().Be(0);
        result.TargetAfterMinutes.Should().Be(40);
    }

    // --- Volume guard -----------------------------------------------------------------

    [Fact]
    public void Volume_guard_holds_when_volume_exceeds_115_percent_of_previous_week()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            previousVolume: 100,
            sessions: GoodEnduranceWeek()));

        // 120 > 115% * 100 = 115 -> guard breach, hold (no increase).
        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonVolumeGuard);
        result.TotalVolumeMinutes.Should().Be(120);
        result.TargetAfterMinutes.Should().Be(40);
        result.NextConsecutiveIncreases.Should().Be(0);
    }

    [Fact]
    public void Volume_guard_allows_up_to_115_percent_of_previous_week()
    {
        // Exactly 115% of 100 = 115 -> allowed (Deep: 3 qualifying at 30 min
        // plus one constrained 25-min session; the constrained one adds volume
        // without qualifying).
        var boundary = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Deep, targetBefore: 30, established: 30, previousVolume: 100,
            sessions:
            [
                S(ReadingMode.Deep, planned: 30, accumulatedSeconds: 30 * 60),
                S(ReadingMode.Deep, planned: 30, accumulatedSeconds: 30 * 60),
                S(ReadingMode.Deep, planned: 30, accumulatedSeconds: 30 * 60),
                S(ReadingMode.Deep, planned: 30, reported: 25, constraint: ReadingConstraint.TimeConstrained),
            ]));

        boundary.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        boundary.QualifyingCount.Should().Be(3);
        boundary.TotalVolumeMinutes.Should().Be(115);

        // 120 vs 115% * 120 = 138 -> allowed.
        var larger = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            previousVolume: 120,
            sessions: GoodEnduranceWeek()));

        larger.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        larger.TotalVolumeMinutes.Should().Be(120);
    }

    [Fact]
    public void Volume_guard_fallback_uses_three_times_established_when_previous_absent_or_zero()
    {
        // Absent previous volume: guard base = 3 * 40 = 120; 138 <= 115% * 120 -> ok.
        var absent = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            previousVolume: null,
            sessions:
            [
                .. GoodEnduranceWeek(),
                S(ReadingMode.Endurance, constraint: ReadingConstraint.TimeConstrained, reported: 18),
            ]));
        absent.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        absent.TotalVolumeMinutes.Should().Be(138);

        // Zero previous volume: same fallback base; 139 > 138 -> guard breach.
        var zero = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            previousVolume: 0,
            sessions:
            [
                .. GoodEnduranceWeek(),
                S(ReadingMode.Endurance, constraint: ReadingConstraint.TimeConstrained, reported: 19),
            ]));
        zero.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        zero.Reason.Should().Be(ReadingProgressionPolicy.ReasonVolumeGuard);
        zero.TotalVolumeMinutes.Should().Be(139);
    }

    // --- Reported-time override ---------------------------------------------------------

    [Fact]
    public void Reported_minutes_override_accumulated_for_qualification()
    {
        // Accumulated 10 minutes but reported 40: reported wins -> qualifies.
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            sessions:
            [
                S(ReadingMode.Endurance, accumulatedSeconds: 10 * 60, reported: 40),
                S(ReadingMode.Endurance, accumulatedSeconds: 10 * 60, reported: 40),
                S(ReadingMode.Endurance, accumulatedSeconds: 10 * 60, reported: 40),
            ]));

        result.QualifyingCount.Should().Be(3);
        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        result.TotalVolumeMinutes.Should().Be(120);
    }

    [Fact]
    public void Reported_minutes_override_can_also_break_qualification()
    {
        // Accumulated 40 minutes but reported 20: reported wins -> fails to qualify.
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            sessions:
            [
                S(ReadingMode.Endurance),
                S(ReadingMode.Endurance),
                S(ReadingMode.Endurance, accumulatedSeconds: 40 * 60, reported: 20),
            ]));

        result.QualifyingCount.Should().Be(2);
        result.CompletionRate.Should().BeApproximately(2.0 / 3.0, 0.0001);
        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonCompletionRate);
        result.TotalVolumeMinutes.Should().Be(100);
    }

    // --- Consolidation ------------------------------------------------------------------

    [Fact]
    public void After_two_consecutive_increases_next_good_week_consolidates_and_resets()
    {
        var result = ReadingProgressionPolicy.Evaluate(
            Input(ReadingMode.Endurance, consecutiveIncreases: 2, sessions: GoodEnduranceWeek()));

        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindConsolidate);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonConsolidation);
        result.TargetAfterMinutes.Should().Be(40);
        result.NextConsecutiveIncreases.Should().Be(0);
    }

    [Fact]
    public void One_prior_increase_advances_the_counter_on_the_next_good_week()
    {
        var result = ReadingProgressionPolicy.Evaluate(
            Input(ReadingMode.Endurance, consecutiveIncreases: 1, sessions: GoodEnduranceWeek()));

        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        result.NextConsecutiveIncreases.Should().Be(2);
    }

    [Fact]
    public void Consolidation_applies_after_an_empty_hold_keeps_the_streak()
    {
        // Two increases, then an empty week (hold preserves the streak of 2),
        // then a good week: the good week consolidates.
        var empty = ReadingProgressionPolicy.Evaluate(
            Input(ReadingMode.Endurance, consecutiveIncreases: 2, sessions: []));
        empty.NextConsecutiveIncreases.Should().Be(2);

        var next = ReadingProgressionPolicy.Evaluate(
            Input(ReadingMode.Endurance, consecutiveIncreases: empty.NextConsecutiveIncreases, sessions: GoodEnduranceWeek()));
        next.DecisionKind.Should().Be(ReadingProgressionPolicy.KindConsolidate);
        next.NextConsecutiveIncreases.Should().Be(0);
    }

    // --- Cancelled ignored ----------------------------------------------------------------

    [Fact]
    public void Cancelled_sessions_never_count_as_volume_or_qualifying()
    {
        // Two completed sessions plus two cancelled 60-minute sessions: the
        // cancelled ones add no volume, no attempt, and no qualifying evidence.
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            sessions:
            [
                S(ReadingMode.Endurance),
                S(ReadingMode.Endurance),
                S(ReadingMode.Endurance, status: ReadingSessionStatus.Cancelled, reported: 60),
                S(ReadingMode.Endurance, status: ReadingSessionStatus.Cancelled, reported: 60),
            ]));

        result.QualifyingCount.Should().Be(2);
        // Only the completed sessions contribute volume; the cancelled 60s do not.
        result.TotalVolumeMinutes.Should().Be(80);
        result.CompletionRate.Should().Be(1.0);
        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonInsufficientQualifying);
    }

    [Fact]
    public void Cancelled_sessions_do_not_drag_completion_rate_below_increase_threshold()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            sessions:
            [
                .. GoodEnduranceWeek(),
                S(ReadingMode.Endurance, status: ReadingSessionStatus.Cancelled),
                S(ReadingMode.Endurance, status: ReadingSessionStatus.Cancelled),
            ]));

        result.CompletionRate.Should().Be(1.0);
        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonCriteriaMet);
        result.QualifyingCount.Should().Be(3);
    }

    [Fact]
    public void Awaiting_feedback_counts_volume_and_target_completion_but_never_qualifies()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            sessions:
            [
                S(ReadingMode.Endurance, status: ReadingSessionStatus.AwaitingFeedback,
                    accumulatedSeconds: 40 * 60, effort: 0, focus: 0),
            ]));

        result.TotalVolumeMinutes.Should().Be(40);
        result.CompletionRate.Should().Be(1.0);
        result.QualifyingCount.Should().Be(0);
        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonInsufficientQualifying);
    }

    // --- Mode independence -----------------------------------------------------------------

    [Fact]
    public void Modes_adapt_independently_from_one_shared_week()
    {
        var sessions = new[]
        {
            S(ReadingMode.Endurance),
            S(ReadingMode.Endurance),
            S(ReadingMode.Deep, planned: 30, accumulatedSeconds: 30 * 60),
            S(ReadingMode.Deep, planned: 30, accumulatedSeconds: 30 * 60),
            S(ReadingMode.Deep, planned: 30, accumulatedSeconds: 30 * 60),
        };

        var endurance = ReadingProgressionPolicy.Evaluate(
            Input(ReadingMode.Endurance, sessions: sessions));
        var deep = ReadingProgressionPolicy.Evaluate(
            Input(ReadingMode.Deep, targetBefore: 30, established: 30, previousVolume: 200, sessions: sessions));

        // Endurance sees only its two qualifying sessions -> hold.
        endurance.QualifyingCount.Should().Be(2);
        endurance.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        endurance.Reason.Should().Be(ReadingProgressionPolicy.ReasonInsufficientQualifying);

        // Deep sees its three qualifying sessions -> increase, independently.
        deep.QualifyingCount.Should().Be(3);
        deep.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        deep.TargetAfterMinutes.Should().Be(35);

        // Both share the same weekly volume (all Completed sessions).
        endurance.TotalVolumeMinutes.Should().Be(170);
        deep.TotalVolumeMinutes.Should().Be(170);
    }

    // --- Deterministic median handling ------------------------------------------------------

    [Fact]
    public void Median_uses_the_lower_middle_for_even_counts()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            previousVolume: 160,
            sessions:
            [
                S(ReadingMode.Endurance, effort: 5, focus: 5),
                S(ReadingMode.Endurance, effort: 6, focus: 6),
                S(ReadingMode.Endurance, effort: 7, focus: 7),
                S(ReadingMode.Endurance, effort: 8, focus: 8),
            ]));

        // Even count: lower middle, so median effort 6 and median focus 6.
        result.MedianEffort.Should().Be(6);
        result.MedianFocus.Should().Be(6);
        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
    }

    [Fact]
    public void Ratings_skipped_sessions_never_qualify_and_medians_are_null()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            sessions:
            [
                S(ReadingMode.Endurance, ratingsSkipped: true, effort: 0, focus: 0),
                S(ReadingMode.Endurance, ratingsSkipped: true, effort: 0, focus: 0),
                S(ReadingMode.Endurance, ratingsSkipped: true, effort: 0, focus: 0),
            ]));

        result.QualifyingCount.Should().Be(0);
        result.MedianEffort.Should().BeNull();
        result.MedianFocus.Should().BeNull();
        // Completed and voluminous, but no ratings -> no evidence of good form.
        result.CompletionRate.Should().Be(1.0);
        result.TotalVolumeMinutes.Should().Be(120);
        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonInsufficientQualifying);
    }

    [Fact]
    public void High_median_effort_holds_not_increases()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            sessions:
            [
                S(ReadingMode.Endurance, effort: 8, focus: 9),
                S(ReadingMode.Endurance, effort: 8, focus: 9),
                S(ReadingMode.Endurance, effort: 8, focus: 9),
            ]));

        // Median effort 8: above the 7 increase bar but below the 9 deload bar.
        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonHighEffort);
        result.TargetAfterMinutes.Should().Be(40);
    }

    [Fact]
    public void Low_median_focus_holds_not_increases()
    {
        var result = ReadingProgressionPolicy.Evaluate(Input(
            ReadingMode.Endurance,
            sessions:
            [
                S(ReadingMode.Endurance, effort: 4, focus: 4),
                S(ReadingMode.Endurance, effort: 4, focus: 5),
                S(ReadingMode.Endurance, effort: 4, focus: 4),
            ]));

        // Median focus 4: below the 6 increase bar but above the 3 deload bar.
        result.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        result.Reason.Should().Be(ReadingProgressionPolicy.ReasonLowFocus);
        result.TargetAfterMinutes.Should().Be(40);
    }

    // --- Input validation ------------------------------------------------------------------

    [Fact]
    public void Negative_target_is_rejected()
    {
        var act = () => ReadingProgressionPolicy.Evaluate(
            Input(ReadingMode.Endurance, targetBefore: -1, sessions: []));

        act.Should().Throw<ArgumentOutOfRangeException>();
    }
}
