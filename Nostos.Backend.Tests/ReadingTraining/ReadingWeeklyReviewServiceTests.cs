using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Data.Models.ReadingTraining;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

// Task 4B2 — persisted weekly review preview/commit against real temp-file
// SQLite databases. All timestamps are UTC instants of Stockholm-local
// calendar instants (Europe/Stockholm, UTC+2 in August 2026):
//   ISO week 31 2026: Mon 2026-07-27 00:00 CEST .. Sun 2026-08-02 24:00 CEST
//   ISO week 32 2026: Mon 2026-08-03 00:00 CEST .. Sun 2026-08-09 24:00 CEST
//   Week 32 UTC window: [2026-08-02T22:00:00Z, 2026-08-09T22:00:00Z)
public sealed class ReadingWeeklyReviewServiceTests : IClassFixture<ReadingTrainingSqliteFixture>
{
    private static readonly DateTime Week31StartUtc = new(2026, 7, 26, 22, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Week32StartUtc = new(2026, 8, 2, 22, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Week33StartUtc = new(2026, 8, 9, 22, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Week34StartUtc = new(2026, 8, 16, 22, 0, 0, DateTimeKind.Utc);

    private readonly ReadingTrainingSqliteFixture _fixture;

    public ReadingWeeklyReviewServiceTests(ReadingTrainingSqliteFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task Week_boundary_uses_stockholm_sunday_monday_converted_to_utc()
    {
        var h = Harness();
        await h.Init();
        // Sunday 2026-08-02 23:30 CEST (21:30 UTC) still belongs to ISO week 31.
        await SeedSession(h, ReadingMode.Endurance, new DateTime(2026, 8, 2, 21, 30, 0, DateTimeKind.Utc), 2400, effort: 5, focus: 8);
        // Monday 2026-08-03 00:30 CEST (2026-08-02 22:30 UTC) is ISO week 32.
        await SeedSession(h, ReadingMode.Endurance, new DateTime(2026, 8, 2, 22, 30, 0, DateTimeKind.Utc), 2700, effort: 5, focus: 8);

        var week32 = (ReadingWeeklyReviewDto)(await h.Service.PreviewWeeklyReviewAsync(new(2026, 32))).Data!;
        var week31 = (ReadingWeeklyReviewDto)(await h.Service.PreviewWeeklyReviewAsync(new(2026, 31))).Data!;

        week32.WeekKey.Should().Be("2026-W32");
        week32.IsoYear.Should().Be(2026);
        week32.IsoWeek.Should().Be(32);
        week32.TotalVolumeMinutes.Should().Be(45);
        week31.WeekKey.Should().Be("2026-W31");
        week31.TotalVolumeMinutes.Should().Be(40);
    }

    [Fact]
    public async Task Preview_is_read_only_and_leaves_database_and_state_unchanged()
    {
        var h = Harness();
        await h.Init();
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 2400, effort: 5, focus: 8);

        var preview = (ReadingWeeklyReviewDto)(await h.Service.PreviewWeeklyReviewAsync(new(2026, 32))).Data!;

        preview.Committed.Should().BeFalse();
        preview.CommittedAt.Should().BeNull();
        preview.StateVersion.Should().Be("1");

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingWeeklyReviews.CountAsync()).Should().Be(0);
        (await db.ReadingModeDecisions.CountAsync()).Should().Be(0);
        // Initialization is the sole receipt; preview adds none.
        (await db.ReadingCommandReceipts.CountAsync()).Should().Be(1);
        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.StateVersion.Should().Be("1");
        programme.EnduranceTargetMinutes.Should().Be(40);
        programme.DeepTargetMinutes.Should().Be(30);
        programme.RecoveryTargetMinutes.Should().Be(20);
        programme.EnduranceConsecutiveIncreases.Should().Be(0);
        programme.DeepConsecutiveIncreases.Should().Be(0);
    }

    [Fact]
    public async Task Good_endurance_week_increases_five_while_deep_holds_and_recovery_is_untouched()
    {
        var h = Harness();
        await h.Init();
        // Previous week volume 160 so the 115% guard passes for 150 current.
        await SeedSession(h, ReadingMode.Endurance, Week31StartUtc.AddHours(2), 9600);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 2400, effort: 5, focus: 8);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(26), 2400, effort: 6, focus: 7);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(50), 2400, effort: 4, focus: 9);
        await SeedSession(h, ReadingMode.Deep, Week32StartUtc.AddHours(74), 1800, effort: 5, focus: 8);

        var preview = (ReadingWeeklyReviewDto)(await h.Service.PreviewWeeklyReviewAsync(new(2026, 32))).Data!;
        preview.PreviousWeekVolumeMinutes.Should().Be(160);
        preview.TotalVolumeMinutes.Should().Be(150);

        var endurance = Mode(preview.Modes, ReadingMode.Endurance);
        endurance.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        endurance.Reason.Should().Be(ReadingProgressionPolicy.ReasonCriteriaMet);
        endurance.TargetBeforeMinutes.Should().Be(40);
        endurance.TargetAfterMinutes.Should().Be(45);
        endurance.QualifyingCount.Should().Be(3);
        endurance.CompletionRate.Should().Be(1.0);
        endurance.MedianEffort.Should().Be(5);
        endurance.MedianFocus.Should().Be(8);
        endurance.NextConsecutiveIncreases.Should().Be(1);

        var deep = Mode(preview.Modes, ReadingMode.Deep);
        deep.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        deep.Reason.Should().Be(ReadingProgressionPolicy.ReasonInsufficientQualifying);
        deep.TargetBeforeMinutes.Should().Be(30);
        deep.TargetAfterMinutes.Should().Be(30);

        var recovery = Mode(preview.Modes, ReadingMode.Recovery);
        recovery.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        recovery.Reason.Should().Be(ReadingProgressionPolicy.ReasonNoEvidence);
        recovery.TargetBeforeMinutes.Should().Be(20);
        recovery.TargetAfterMinutes.Should().Be(20);

        var committed = (ReadingWeeklyReviewDto)(await h.Service.CommitWeeklyReviewAsync(new("ui", "commit-32", 2026, 32))).Data!;
        committed.Committed.Should().BeTrue();
        committed.StateVersion.Should().Be("2");

        await using var db = h.Factory.CreateDbContext();
        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.EnduranceTargetMinutes.Should().Be(45);
        programme.EnduranceConsecutiveIncreases.Should().Be(1);
        programme.DeepTargetMinutes.Should().Be(30);
        programme.DeepConsecutiveIncreases.Should().Be(0);
        programme.RecoveryTargetMinutes.Should().Be(20);
        programme.StateVersion.Should().Be("2");
    }

    [Fact]
    public async Task Cancelled_sessions_are_ignored_entirely_by_volume_and_evidence()
    {
        var h = Harness();
        await h.Init();
        await SeedSession(h, ReadingMode.Endurance, Week31StartUtc.AddHours(2), 9600);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 2400, effort: 5, focus: 8);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(26), 2400, effort: 5, focus: 8);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(50), 2400, effort: 5, focus: 8);
        // Cancelled mid-week with substantial elapsed time: no volume, no
        // attempt, no evidence, and never a deload trigger.
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(74), 3000, status: ReadingSessionStatus.Cancelled);

        var preview = (ReadingWeeklyReviewDto)(await h.Service.PreviewWeeklyReviewAsync(new(2026, 32))).Data!;
        preview.TotalVolumeMinutes.Should().Be(120);
        var endurance = Mode(preview.Modes, ReadingMode.Endurance);
        endurance.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        endurance.QualifyingCount.Should().Be(3);
        endurance.CompletionRate.Should().Be(1.0);
    }

    [Fact]
    public async Task Constrained_sessions_count_as_volume_but_not_qualifying_evidence()
    {
        var h = Harness();
        await h.Init();
        await SeedSession(h, ReadingMode.Endurance, Week31StartUtc.AddHours(2), 9600);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 2400, effort: 5, focus: 8);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(26), 2400, effort: 5, focus: 8);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(50), 2400, effort: 5, focus: 8);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(74), 2100, effort: 5, focus: 8, constraint: ReadingConstraint.TimeConstrained);

        var preview = (ReadingWeeklyReviewDto)(await h.Service.PreviewWeeklyReviewAsync(new(2026, 32))).Data!;
        preview.TotalVolumeMinutes.Should().Be(155);
        var endurance = Mode(preview.Modes, ReadingMode.Endurance);
        endurance.QualifyingCount.Should().Be(3);
        endurance.CompletionRate.Should().Be(1.0);
        endurance.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
    }

    [Fact]
    public async Task Previous_week_volume_guard_holds_when_volume_grows_too_fast()
    {
        // Fallback base without any previous volume: 3 × established 40 = 120,
        // so 115% = 138 < 150 current volume → hold.
        var fallback = Harness();
        await fallback.Init();
        await SeedSession(fallback, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 2400, effort: 5, focus: 8);
        await SeedSession(fallback, ReadingMode.Endurance, Week32StartUtc.AddHours(26), 2400, effort: 5, focus: 8);
        await SeedSession(fallback, ReadingMode.Endurance, Week32StartUtc.AddHours(50), 2400, effort: 5, focus: 8);
        await SeedSession(fallback, ReadingMode.Deep, Week32StartUtc.AddHours(74), 1800, effort: 5, focus: 8);

        var fallbackPreview = (ReadingWeeklyReviewDto)(await fallback.Service.PreviewWeeklyReviewAsync(new(2026, 32))).Data!;
        fallbackPreview.PreviousWeekVolumeMinutes.Should().Be(0);
        var fallbackEndurance = Mode(fallbackPreview.Modes, ReadingMode.Endurance);
        fallbackEndurance.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        fallbackEndurance.Reason.Should().Be(ReadingProgressionPolicy.ReasonVolumeGuard);

        // Explicit previous volume of 100 → 115% = 115, still below 150 → hold.
        var smallPrevious = Harness();
        await smallPrevious.Init();
        await SeedSession(smallPrevious, ReadingMode.Endurance, Week31StartUtc.AddHours(2), 6000);
        await SeedSession(smallPrevious, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 2400, effort: 5, focus: 8);
        await SeedSession(smallPrevious, ReadingMode.Endurance, Week32StartUtc.AddHours(26), 2400, effort: 5, focus: 8);
        await SeedSession(smallPrevious, ReadingMode.Endurance, Week32StartUtc.AddHours(50), 2400, effort: 5, focus: 8);
        await SeedSession(smallPrevious, ReadingMode.Deep, Week32StartUtc.AddHours(74), 1800, effort: 5, focus: 8);

        var smallPreview = (ReadingWeeklyReviewDto)(await smallPrevious.Service.PreviewWeeklyReviewAsync(new(2026, 32))).Data!;
        smallPreview.PreviousWeekVolumeMinutes.Should().Be(100);
        Mode(smallPreview.Modes, ReadingMode.Endurance).Reason.Should().Be(ReadingProgressionPolicy.ReasonVolumeGuard);
    }

    [Fact]
    public async Task Reported_minutes_override_accumulated_floor_minutes()
    {
        var h = Harness();
        await h.Init();
        await SeedSession(h, ReadingMode.Endurance, Week31StartUtc.AddHours(2), 9600);
        // 40 accumulated minutes reported as 45 → qualifies with 45 volume.
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 2400, reportedMinutes: 45, effort: 5, focus: 8);
        // 50 accumulated minutes reported as 30 → does not qualify, 30 volume.
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(26), 3000, reportedMinutes: 30, effort: 5, focus: 8);
        // 2460 s = 41 floor minutes, unreported → qualifies with 41 volume.
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(50), 2460, effort: 5, focus: 8);

        var preview = (ReadingWeeklyReviewDto)(await h.Service.PreviewWeeklyReviewAsync(new(2026, 32))).Data!;
        preview.TotalVolumeMinutes.Should().Be(116);
        var endurance = Mode(preview.Modes, ReadingMode.Endurance);
        endurance.QualifyingCount.Should().Be(2);
        endurance.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        endurance.Reason.Should().Be(ReadingProgressionPolicy.ReasonCompletionRate);
    }

    [Fact]
    public async Task Commit_persists_one_review_and_exactly_three_mode_decisions()
    {
        var h = Harness();
        await h.Init();
        await SeedSession(h, ReadingMode.Endurance, Week31StartUtc.AddHours(2), 9600);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 2400, effort: 5, focus: 8);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(26), 2400, effort: 6, focus: 7);
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(50), 2400, effort: 4, focus: 9);
        await SeedSession(h, ReadingMode.Deep, Week32StartUtc.AddHours(74), 1800, effort: 5, focus: 8);

        var committed = await h.Service.CommitWeeklyReviewAsync(new("ui", "commit", 2026, 32));

        committed.StateVersion.Should().Be("2");
        var dto = (ReadingWeeklyReviewDto)committed.Data!;
        dto.Committed.Should().BeTrue();
        dto.CommittedAt.Should().NotBeNull();
        dto.WeekKey.Should().Be("2026-W32");
        dto.StateVersion.Should().Be("2");

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingWeeklyReviews.CountAsync()).Should().Be(1);
        var review = await db.ReadingWeeklyReviews.Include(r => r.Decisions).SingleAsync();
        review.WeekKey.Should().Be("2026-W32");
        review.StateVersionAfter.Should().Be("2");
        review.TotalVolumeMinutes.Should().Be(150);
        review.PreviousWeekVolumeMinutes.Should().Be(160);
        review.Decisions.Should().HaveCount(3);
        review.Decisions.Select(d => d.Mode).Should().BeEquivalentTo(
            new[] { ReadingMode.Endurance, ReadingMode.Deep, ReadingMode.Recovery });

        var endurance = review.Decisions.Single(d => d.Mode == ReadingMode.Endurance);
        endurance.DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        endurance.Reason.Should().Be(ReadingProgressionPolicy.ReasonCriteriaMet);
        endurance.TargetBeforeMinutes.Should().Be(40);
        endurance.TargetAfterMinutes.Should().Be(45);
        endurance.QualifyingCount.Should().Be(3);
        endurance.CompletionRate.Should().Be(1.0);
        endurance.MedianEffort.Should().Be(5);
        endurance.MedianFocus.Should().Be(8);
        endurance.NextConsecutiveIncreases.Should().Be(1);

        var deep = review.Decisions.Single(d => d.Mode == ReadingMode.Deep);
        deep.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        deep.TargetAfterMinutes.Should().Be(30);
        deep.QualifyingCount.Should().Be(1);

        var recovery = review.Decisions.Single(d => d.Mode == ReadingMode.Recovery);
        recovery.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
        recovery.Reason.Should().Be(ReadingProgressionPolicy.ReasonNoEvidence);
        recovery.QualifyingCount.Should().Be(0);
        recovery.CompletionRate.Should().Be(0.0);
        recovery.MedianEffort.Should().BeNull();
        recovery.MedianFocus.Should().BeNull();
        recovery.NextConsecutiveIncreases.Should().Be(0);

        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.StateVersion.Should().Be("2");
        (await db.ReadingCommandReceipts.CountAsync(x => x.CommandKind == "CommitWeeklyReview")).Should().Be(1);
    }

    [Fact]
    public async Task Duplicate_commit_with_same_key_returns_stored_response_and_creates_nothing()
    {
        var h = Harness();
        await h.Init();
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 2400, effort: 5, focus: 8);
        var request = new ReadingCommitWeeklyReviewRequest("ui", "commit-once", 2026, 32);

        var first = await h.Service.CommitWeeklyReviewAsync(request);
        var retry = await h.Service.CommitWeeklyReviewAsync(request);

        retry.Duplicate.Should().BeTrue();
        retry.Reply.Should().Be(first.Reply);
        retry.StateVersion.Should().Be(first.StateVersion);
        retry.Data.Should().BeEquivalentTo(first.Data);

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingWeeklyReviews.CountAsync()).Should().Be(1);
        (await db.ReadingModeDecisions.CountAsync()).Should().Be(3);
        // Initialization plus the one weekly commit.
        (await db.ReadingCommandReceipts.CountAsync()).Should().Be(2);
        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.StateVersion.Should().Be("2");
        programme.EnduranceTargetMinutes.Should().Be(40);
    }

    [Fact]
    public async Task Same_week_committed_under_different_key_returns_existing_review_unchanged()
    {
        var h = Harness();
        await h.Init();
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 2400, effort: 5, focus: 8);

        var first = (ReadingWeeklyReviewDto)(await h.Service.CommitWeeklyReviewAsync(new("ui", "key-a", 2026, 32))).Data!;
        var secondResult = await h.Service.CommitWeeklyReviewAsync(new("ui", "key-b", 2026, 32));
        var second = (ReadingWeeklyReviewDto)secondResult.Data!;

        secondResult.Duplicate.Should().BeFalse();
        second.Should().BeEquivalentTo(first);
        second.Committed.Should().BeTrue();
        secondResult.Reply.Should().Contain("already reviewed");

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingWeeklyReviews.CountAsync()).Should().Be(1);
        (await db.ReadingModeDecisions.CountAsync()).Should().Be(3);
        // Initialization plus one receipt for each distinct commit key.
        (await db.ReadingCommandReceipts.CountAsync()).Should().Be(3);
        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.StateVersion.Should().Be("2");
        programme.EnduranceTargetMinutes.Should().Be(40);
        programme.EnduranceConsecutiveIncreases.Should().Be(0);
    }

    [Fact]
    public async Task Concurrent_same_key_commits_converge_to_one_review_and_one_receipt()
    {
        var h = Harness();
        await h.Init();
        await SeedSession(h, ReadingMode.Endurance, Week32StartUtc.AddHours(2), 2400, effort: 5, focus: 8);
        var request = new ReadingCommitWeeklyReviewRequest("shared", "commit-once", 2026, 32);

        var results = await Task.WhenAll(
            h.Service.CommitWeeklyReviewAsync(request),
            h.Service.CommitWeeklyReviewAsync(request));

        results.Count(r => r.Duplicate).Should().Be(1);
        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingWeeklyReviews.CountAsync()).Should().Be(1);
        (await db.ReadingModeDecisions.CountAsync()).Should().Be(3);
        (await db.ReadingCommandReceipts.CountAsync(x => x.ClientId == "shared" && x.IdempotencyKey == "commit-once")).Should().Be(1);
        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.StateVersion.Should().Be("2");
    }

    [Fact]
    public async Task Consecutive_increase_counters_accumulate_and_consolidate_after_two()
    {
        var h = Harness();
        await h.Init();
        // W31 volume 160 so the guard passes for W32's 150.
        await SeedSession(h, ReadingMode.Endurance, Week31StartUtc.AddHours(2), 9600);

        async Task SeedGoodWeek(DateTime weekStart)
        {
            await SeedSession(h, ReadingMode.Endurance, weekStart.AddHours(2), 2400, effort: 5, focus: 8);
            await SeedSession(h, ReadingMode.Endurance, weekStart.AddHours(26), 2400, effort: 5, focus: 8);
            await SeedSession(h, ReadingMode.Endurance, weekStart.AddHours(50), 2400, effort: 5, focus: 8);
            await SeedSession(h, ReadingMode.Deep, weekStart.AddHours(74), 1800, effort: 5, focus: 8);
        }

        await SeedGoodWeek(Week32StartUtc);
        var w32 = (ReadingWeeklyReviewDto)(await h.Service.CommitWeeklyReviewAsync(new("ui", "w32", 2026, 32))).Data!;
        Mode(w32.Modes, ReadingMode.Endurance).DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        Mode(w32.Modes, ReadingMode.Endurance).TargetAfterMinutes.Should().Be(45);
        Mode(w32.Modes, ReadingMode.Endurance).NextConsecutiveIncreases.Should().Be(1);

        await SeedGoodWeek(Week33StartUtc);
        var w33 = (ReadingWeeklyReviewDto)(await h.Service.CommitWeeklyReviewAsync(new("ui", "w33", 2026, 33))).Data!;
        Mode(w33.Modes, ReadingMode.Endurance).DecisionKind.Should().Be(ReadingProgressionPolicy.KindIncrease);
        Mode(w33.Modes, ReadingMode.Endurance).TargetAfterMinutes.Should().Be(50);
        Mode(w33.Modes, ReadingMode.Endurance).NextConsecutiveIncreases.Should().Be(2);

        await SeedGoodWeek(Week34StartUtc);
        var w34 = (ReadingWeeklyReviewDto)(await h.Service.CommitWeeklyReviewAsync(new("ui", "w34", 2026, 34))).Data!;
        var endurance34 = Mode(w34.Modes, ReadingMode.Endurance);
        endurance34.DecisionKind.Should().Be(ReadingProgressionPolicy.KindConsolidate);
        endurance34.Reason.Should().Be(ReadingProgressionPolicy.ReasonConsolidation);
        endurance34.TargetBeforeMinutes.Should().Be(50);
        endurance34.TargetAfterMinutes.Should().Be(50);
        endurance34.NextConsecutiveIncreases.Should().Be(0);

        await using var db = h.Factory.CreateDbContext();
        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.EnduranceTargetMinutes.Should().Be(50);
        programme.EnduranceConsecutiveIncreases.Should().Be(0);
        programme.DeepTargetMinutes.Should().Be(30);
        programme.DeepConsecutiveIncreases.Should().Be(0);
        programme.RecoveryTargetMinutes.Should().Be(20);
        (await db.ReadingWeeklyReviews.CountAsync()).Should().Be(3);
        (await db.ReadingModeDecisions.CountAsync()).Should().Be(9);
    }

    [Fact]
    public async Task No_evidence_week_commits_a_hold_review_without_target_changes()
    {
        var h = Harness();
        await h.Init();

        var committed = await h.Service.CommitWeeklyReviewAsync(new("ui", "empty-week", 2026, 32));
        var dto = (ReadingWeeklyReviewDto)committed.Data!;

        dto.TotalVolumeMinutes.Should().Be(0);
        foreach (var mode in dto.Modes)
        {
            mode.DecisionKind.Should().Be(ReadingProgressionPolicy.KindHold);
            mode.Reason.Should().Be(ReadingProgressionPolicy.ReasonNoEvidence);
            mode.TargetAfterMinutes.Should().Be(mode.TargetBeforeMinutes);
        }

        await using var db = h.Factory.CreateDbContext();
        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.EnduranceTargetMinutes.Should().Be(40);
        programme.EnduranceConsecutiveIncreases.Should().Be(0);
        programme.DeepTargetMinutes.Should().Be(30);
        programme.RecoveryTargetMinutes.Should().Be(20);
        programme.StateVersion.Should().Be("2");
        (await db.ReadingWeeklyReviews.CountAsync()).Should().Be(1);
        (await db.ReadingModeDecisions.CountAsync()).Should().Be(3);
    }

    [Fact]
    public async Task Preview_without_programme_returns_not_initialized()
    {
        var h = Harness();
        var result = await h.Service.PreviewWeeklyReviewAsync(new(2026, 32));
        ((ReadingErrorDto)result.Data!).Code.Should().Be("not_initialized");
    }

    [Fact]
    public async Task Invalid_iso_week_is_rejected()
    {
        var h = Harness();
        await h.Init();
        var result = await h.Service.PreviewWeeklyReviewAsync(new(2026, 54));
        ((ReadingErrorDto)result.Data!).Code.Should().Be("invalid_week");
    }

    // --- helpers ------------------------------------------------------------

    private static ReadingModeReviewDto Mode(IReadOnlyList<ReadingModeReviewDto> modes, ReadingMode mode) =>
        modes.Single(m => m.Mode == mode);

    private HarnessContext Harness()
    {
        var path = _fixture.CreateDatabasePath();
        var options = new DbContextOptionsBuilder<NostosDbContext>().UseSqlite($"Data Source={path}").Options;
        var factory = new TestContextFactory(options);
        using (var db = factory.CreateDbContext()) db.Database.EnsureCreated();
        var clock = new MutableReadingClock(new DateTime(2026, 8, 9, 8, 0, 0, DateTimeKind.Utc));
        return new HarnessContext(factory, clock, new ReadingTrainingService(factory, clock));
    }

    private async Task SeedSession(
        HarnessContext h,
        ReadingMode mode,
        DateTime completedAtUtc,
        int accumulatedSeconds,
        int? reportedMinutes = null,
        int effort = 0,
        int focus = 0,
        bool ratingsSkipped = false,
        ReadingConstraint constraint = ReadingConstraint.None,
        ReadingSessionStatus status = ReadingSessionStatus.Completed,
        int? plannedTargetMinutes = null)
    {
        await using var db = h.Factory.CreateDbContext();
        var book = new PhysicalBookModel { Title = $"Book-{Guid.NewGuid():N}" };
        var assignment = new ReadingBookAssignment
        {
            Book = book,
            BookId = book.Id,
            Mode = mode,
            QueueOrder = 0,
            Status = ReadingAssignmentStatus.Active,
            CreatedAt = completedAtUtc,
            StartedAt = completedAtUtc,
        };
        var planned = plannedTargetMinutes ?? mode switch
        {
            ReadingMode.Deep => 30,
            ReadingMode.Recovery => 20,
            _ => 40,
        };
        var session = new ReadingSession
        {
            BookAssignment = assignment,
            BookAssignmentId = assignment.Id,
            Book = book,
            BookId = book.Id,
            Mode = mode,
            Status = status,
            OpenSlot = null,
            TargetMinutes = planned,
            PlannedTargetMinutes = planned,
            Constraint = constraint,
            AccumulatedSeconds = accumulatedSeconds,
            ReportedMinutes = reportedMinutes,
            Effort = effort,
            Focus = focus,
            RatingsSkipped = ratingsSkipped,
            CompletedAt = completedAtUtc,
            PlannedAt = completedAtUtc,
            CreatedAt = completedAtUtc,
            UpdatedAt = completedAtUtc,
        };
        db.Books.Add(book);
        db.ReadingBookAssignments.Add(assignment);
        db.ReadingSessions.Add(session);
        await db.SaveChangesAsync();
    }

    private sealed record HarnessContext(
        TestContextFactory Factory,
        MutableReadingClock Clock,
        ReadingTrainingService Service)
    {
        public Task<ReadingCommandResultDto> Init() =>
            Service.InitializeProgrammeAsync("setup", Guid.NewGuid().ToString("N"));
    }

    private sealed class TestContextFactory(DbContextOptions<NostosDbContext> options) : IDbContextFactory<NostosDbContext>
    {
        public NostosDbContext CreateDbContext() => new(options);
        public Task<NostosDbContext> CreateDbContextAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(CreateDbContext());
    }

    private sealed class MutableReadingClock(DateTime utcNow) : IReadingClock
    {
        public DateTime UtcNow { get; private set; } = utcNow;
        public void Advance(TimeSpan amount) => UtcNow = UtcNow.Add(amount);
    }
}
