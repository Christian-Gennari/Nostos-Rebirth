using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Data.Models.ReadingTraining;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Backend.Workers;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

// Task 8A — the weekly-review catch-up worker. Exact-once Monday 07:00 local
// (Europe/Stockholm) eligibility semantics are tested against real temp-file
// SQLite databases with a mutable clock and the real service. All timestamps
// are UTC instants of Stockholm-local calendar instants (UTC+2 in summer /
// UTC+1 in winter):
//   ISO week 30 2026: Mon 2026-07-20 00:00 CEST (2026-07-19T22:00Z)
//   W30 eligible:      Mon 2026-07-27 07:00 CEST = 2026-07-27T05:00Z
//   W31 eligible:      Mon 2026-08-03 07:00 CEST = 2026-08-03T05:00Z
//   W32 eligible:      Mon 2026-08-10 07:00 CEST = 2026-08-10T05:00Z
//   DST spring:        W13 (Mon 2026-03-23 00:00 CET = 2026-03-22T23:00Z)
//                      eligible Mon 2026-03-30 07:00 CEST = 2026-03-30T05:00Z
//   DST fall:          W43 (Mon 2026-10-19 00:00 CEST = 2026-10-18T23:00Z)
//                      eligible Mon 2026-10-26 07:00 CET = 2026-10-26T06:00Z
public sealed class ReadingWeeklyReviewWorkerTests : IClassFixture<ReadingTrainingSqliteFixture>
{
    private static readonly DateTime Week30StartUtc = new(2026, 7, 19, 22, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Week30EligibleUtc = new(2026, 7, 27, 5, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Week31EligibleUtc = new(2026, 8, 3, 5, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Week32EligibleUtc = new(2026, 8, 10, 5, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime Week31SundayUtc = new(2026, 8, 2, 10, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime SpringWeek13StartUtc = new(2026, 3, 22, 23, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime SpringEligibleUtc = new(2026, 3, 30, 5, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime FallWeek43StartUtc = new(2026, 10, 18, 23, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime FallEligibleUtc = new(2026, 10, 26, 6, 0, 0, DateTimeKind.Utc);

    private readonly ReadingTrainingSqliteFixture _fixture;

    public ReadingWeeklyReviewWorkerTests(ReadingTrainingSqliteFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task ScanOnce_UninitializedProgramme_IsSilentNoOp()
    {
        var h = Harness();
        (await h.Worker().ScanOnceAsync()).Should().Be(0);

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingWeeklyReviews.CountAsync()).Should().Be(0);
        (await db.ReadingCommandReceipts.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task ScanOnce_SundayBeforeFirstEligibility_CommitsNothing()
    {
        // Programme created Monday of ISO week 31; by Sunday of week 31 no
        // completed week exists yet and pre-programme weeks must never be
        // fabricated.
        var h = Harness(programmeCreatedUtc: new DateTime(2026, 7, 27, 8, 0, 0, DateTimeKind.Utc));
        await h.Init();
        h.Clock.Set(Week31SundayUtc);

        (await h.Worker().ScanOnceAsync()).Should().Be(0);

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingWeeklyReviews.CountAsync()).Should().Be(0);
        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.EnduranceTargetMinutes.Should().Be(40);
        programme.StateVersion.Should().Be("1");
    }

    [Fact]
    public async Task ScanOnce_Monday0659_PreviousWeekIsNotYetEligible()
    {
        var h = Harness(programmeCreatedUtc: new DateTime(2026, 7, 20, 8, 0, 0, DateTimeKind.Utc));
        await h.Init();
        await SeedGoodWeek(h, Week30StartUtc);
        h.Clock.Set(Week30EligibleUtc.AddSeconds(-1)); // W31 Monday 06:59:59 CEST

        (await h.Worker().ScanOnceAsync()).Should().Be(0);

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingWeeklyReviews.CountAsync()).Should().Be(0);
        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.EnduranceTargetMinutes.Should().Be(40);
        programme.EnduranceConsecutiveIncreases.Should().Be(0);
    }

    [Fact]
    public async Task ScanOnce_Monday0700_CommitsPreviousWeekWithDeterministicIdentity()
    {
        var h = Harness(programmeCreatedUtc: new DateTime(2026, 7, 20, 8, 0, 0, DateTimeKind.Utc));
        await h.Init();
        await SeedGoodWeek(h, Week30StartUtc);
        h.Clock.Set(Week30EligibleUtc); // W31 Monday 07:00:00 CEST exactly

        (await h.Worker().ScanOnceAsync()).Should().Be(1);

        await using var db = h.Factory.CreateDbContext();
        var review = await db.ReadingWeeklyReviews.Include(r => r.Decisions).SingleAsync();
        review.WeekKey.Should().Be("2026-W30");
        review.StateVersionAfter.Should().Be("2");
        review.TotalVolumeMinutes.Should().Be(120);
        review.Decisions.Should().HaveCount(3);

        var receipt = await db.ReadingCommandReceipts.SingleAsync(x => x.CommandKind == "CommitWeeklyReview");
        receipt.ClientId.Should().Be(ReadingWeeklyReviewWorker.WorkerClientId);
        receipt.IdempotencyKey.Should().Be("weekly-review:2026-W30");

        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.EnduranceTargetMinutes.Should().Be(45);
        programme.EnduranceConsecutiveIncreases.Should().Be(1);
        programme.StateVersion.Should().Be("2");
    }

    [Fact]
    public async Task ScanOnce_AfterDowntime_CommitsEveryEligibleWeekChronologically()
    {
        var h = Harness(programmeCreatedUtc: new DateTime(2026, 7, 20, 8, 0, 0, DateTimeKind.Utc));
        await h.Init();
        await SeedGoodWeek(h, Week30StartUtc);
        await SeedGoodWeek(h, Week30StartUtc.AddDays(7));  // W31
        await SeedGoodWeek(h, Week30StartUtc.AddDays(14)); // W32
        h.Clock.Set(Week32EligibleUtc); // W33 Monday 07:00 CEST — three completed weeks behind

        (await h.Worker().ScanOnceAsync()).Should().Be(3);

        await using var db = h.Factory.CreateDbContext();
        var reviews = await db.ReadingWeeklyReviews.Include(r => r.Decisions)
            .OrderBy(r => r.WeekKey).ToListAsync();
        reviews.Select(r => r.WeekKey).Should().Equal("2026-W30", "2026-W31", "2026-W32");
        reviews.Select(r => r.StateVersionAfter).Should().Equal("2", "3", "4");

        // Chronological application is visible in the policy chain:
        // 40 → 45 (increase) → 50 (increase) → 50 (consolidation).
        var endurance = reviews.Select(r => r.Decisions.Single(d => d.Mode == ReadingMode.Endurance)).ToList();
        endurance.Select(d => d.TargetBeforeMinutes).Should().Equal(40, 45, 50);
        endurance.Select(d => d.TargetAfterMinutes).Should().Equal(45, 50, 50);
        endurance.Select(d => d.DecisionKind).Should().Equal(
            ReadingProgressionPolicy.KindIncrease,
            ReadingProgressionPolicy.KindIncrease,
            ReadingProgressionPolicy.KindConsolidate);

        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.EnduranceTargetMinutes.Should().Be(50);
        programme.EnduranceConsecutiveIncreases.Should().Be(0);
        programme.StateVersion.Should().Be("4");
    }

    [Fact]
    public async Task ScanOnce_DstSpring_BoundaryIs0700CestAfterSpringForward()
    {
        // W13 ends on the spring-forward Sunday (2026-03-29). Its eligibility
        // Monday 07:00 CEST is 05:00 UTC — one hour earlier than a naive
        // winter-offset conversion would produce.
        var h = Harness(programmeCreatedUtc: new DateTime(2026, 3, 23, 8, 0, 0, DateTimeKind.Utc));
        await h.Init();
        await SeedGoodWeek(h, SpringWeek13StartUtc);

        h.Clock.Set(SpringEligibleUtc.AddSeconds(-1)); // W14 Monday 06:59:59 CEST
        (await h.Worker().ScanOnceAsync()).Should().Be(0);

        h.Clock.Set(SpringEligibleUtc); // W14 Monday 07:00:00 CEST
        (await h.Worker().ScanOnceAsync()).Should().Be(1);

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingWeeklyReviews.SingleAsync()).WeekKey.Should().Be("2026-W13");
    }

    [Fact]
    public async Task ScanOnce_DstFall_BoundaryIs0700CetAfterFallBack()
    {
        // W43 ends on the fall-back Sunday (2026-10-25). Its eligibility
        // Monday 07:00 CET is 06:00 UTC — one hour later than a summer-offset
        // conversion would produce.
        var h = Harness(programmeCreatedUtc: new DateTime(2026, 10, 19, 8, 0, 0, DateTimeKind.Utc));
        await h.Init();
        await SeedGoodWeek(h, FallWeek43StartUtc);

        h.Clock.Set(FallEligibleUtc.AddSeconds(-1)); // W44 Monday 06:59:59 CET
        (await h.Worker().ScanOnceAsync()).Should().Be(0);

        h.Clock.Set(FallEligibleUtc); // W44 Monday 07:00:00 CET
        (await h.Worker().ScanOnceAsync()).Should().Be(1);

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingWeeklyReviews.SingleAsync()).WeekKey.Should().Be("2026-W43");
    }

    [Fact]
    public async Task ScanOnce_DuplicateWorkers_ConvergeToOneReviewAndOneReceipt()
    {
        var h = Harness(programmeCreatedUtc: new DateTime(2026, 7, 20, 8, 0, 0, DateTimeKind.Utc));
        await h.Init();
        await SeedGoodWeek(h, Week30StartUtc);
        h.Clock.Set(Week30EligibleUtc);

        // Two worker instances share the same provider; both see W30 as
        // uncommitted and race the same deterministic client id + key. The
        // service gate, receipts and unique week index converge them.
        var results = await Task.WhenAll(h.Worker().ScanOnceAsync(), h.Worker().ScanOnceAsync());
        results.Sum().Should().BeGreaterThanOrEqualTo(1);

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingWeeklyReviews.CountAsync()).Should().Be(1);
        (await db.ReadingCommandReceipts.CountAsync(x =>
            x.ClientId == ReadingWeeklyReviewWorker.WorkerClientId &&
            x.IdempotencyKey == "weekly-review:2026-W30")).Should().Be(1);
        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.EnduranceTargetMinutes.Should().Be(45);
        programme.StateVersion.Should().Be("2");
    }

    [Fact]
    public async Task ScanOnce_AfterRestart_CommittedReviewIsNotReplicated()
    {
        var h = Harness(programmeCreatedUtc: new DateTime(2026, 7, 20, 8, 0, 0, DateTimeKind.Utc));
        await h.Init();
        await SeedGoodWeek(h, Week30StartUtc);
        h.Clock.Set(Week30EligibleUtc);
        (await h.Worker().ScanOnceAsync()).Should().Be(1);

        // "Restart": a fresh worker instance later in the same week (Sunday,
        // after W30 already became eligible on Monday).
        h.Clock.Set(Week31SundayUtc);
        (await h.Worker().ScanOnceAsync()).Should().Be(0);

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingWeeklyReviews.CountAsync()).Should().Be(1);
        (await db.ReadingCommandReceipts.CountAsync()).Should().Be(2); // init + one commit
        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.EnduranceTargetMinutes.Should().Be(45);
        programme.EnduranceConsecutiveIncreases.Should().Be(1);
        programme.StateVersion.Should().Be("2");
    }

    [Fact]
    public async Task ScanOnce_BacklogCap_DrainsAcrossConsecutiveScans()
    {
        var h = Harness(programmeCreatedUtc: new DateTime(2026, 7, 20, 8, 0, 0, DateTimeKind.Utc), maxCatchUpWeeks: 2);
        await h.Init();
        await SeedGoodWeek(h, Week30StartUtc);
        await SeedGoodWeek(h, Week30StartUtc.AddDays(7));  // W31
        await SeedGoodWeek(h, Week30StartUtc.AddDays(14)); // W32
        h.Clock.Set(Week32EligibleUtc);

        var worker = h.Worker();
        (await worker.ScanOnceAsync()).Should().Be(2); // W30, W31
        (await worker.ScanOnceAsync()).Should().Be(1); // W32
        (await worker.ScanOnceAsync()).Should().Be(0); // drained

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingWeeklyReviews.CountAsync()).Should().Be(3);
        var programme = await db.ReadingProgrammes.SingleAsync();
        programme.EnduranceTargetMinutes.Should().Be(50);
        programme.StateVersion.Should().Be("4");
    }

    [Fact]
    public async Task ExecuteAsync_ScansImmediately_SurvivesFailedCycle_AndStopsGracefully()
    {
        var h = Harness();
        var flakyFactory = new FlakyContextFactory(h.Factory);
        var services = new ServiceCollection();
        services.AddScoped<IReadingTrainingService>(_ => new ReadingTrainingService(h.Factory, h.Clock));
        var provider = services.BuildServiceProvider();
        var worker = new ReadingWeeklyReviewWorker(
            provider.GetRequiredService<IServiceScopeFactory>(),
            flakyFactory,
            h.Clock,
            new ReadingTrainingOptions { WeeklyReviewPollSeconds = 1 },
            NullLogger<ReadingWeeklyReviewWorker>.Instance);

        using var cts = new CancellationTokenSource();
        var run = worker.StartAsync(cts.Token);

        // The first cycle (the immediate startup scan) throws; the loop must
        // survive it and poll again one interval later. Bound the wait so a
        // regression can never hang the suite.
        await flakyFactory.SecondScanStarted.WaitAsync(TimeSpan.FromSeconds(15));

        cts.Cancel();
        await run;

        flakyFactory.CreateCalls.Should().BeGreaterThanOrEqualTo(2);
    }

    [Fact]
    public async Task ScanOnce_PropagatesCancellation()
    {
        var h = Harness(programmeCreatedUtc: new DateTime(2026, 7, 20, 8, 0, 0, DateTimeKind.Utc));
        await h.Init();
        await SeedGoodWeek(h, Week30StartUtc);
        h.Clock.Set(Week30EligibleUtc);

        using var cts = new CancellationTokenSource();
        cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => h.Worker().ScanOnceAsync(cts.Token));
    }

    // --- helpers ------------------------------------------------------------

    private HarnessContext Harness(DateTime? programmeCreatedUtc = null, int maxCatchUpWeeks = 4)
    {
        var path = _fixture.CreateDatabasePath();
        var options = new DbContextOptionsBuilder<NostosDbContext>().UseSqlite($"Data Source={path}").Options;
        var factory = new TestContextFactory(options);
        using (var db = factory.CreateDbContext()) db.Database.EnsureCreated();
        var clock = new MutableReadingClock(
            programmeCreatedUtc ?? new DateTime(2026, 7, 20, 8, 0, 0, DateTimeKind.Utc));
        var trainingOptions = new ReadingTrainingOptions
        {
            WeeklyReviewPollSeconds = 300,
            WeeklyReviewMaxCatchUpWeeks = maxCatchUpWeeks,
        };
        var services = new ServiceCollection();
        services.AddScoped<IReadingTrainingService>(_ => new ReadingTrainingService(factory, clock));
        var provider = services.BuildServiceProvider();
        return new HarnessContext(factory, clock, trainingOptions, provider);
    }

    // Three qualifying endurance sessions (40 min each, effort 5, focus 8):
    // volume 120 ≤ 115% of the 120-minute fallback base, so the week
    // evaluates to an increase unless the consolidation counter holds it.
    private static async Task SeedGoodWeek(HarnessContext h, DateTime weekStartUtc)
    {
        await SeedSession(h, ReadingMode.Endurance, weekStartUtc.AddHours(2), 2400, effort: 5, focus: 8);
        await SeedSession(h, ReadingMode.Endurance, weekStartUtc.AddHours(26), 2400, effort: 5, focus: 8);
        await SeedSession(h, ReadingMode.Endurance, weekStartUtc.AddHours(50), 2400, effort: 5, focus: 8);
    }

    private static async Task SeedSession(
        HarnessContext h,
        ReadingMode mode,
        DateTime completedAtUtc,
        int accumulatedSeconds,
        int effort,
        int focus)
    {
        await using var db = h.Factory.CreateDbContext();
        var book = new PhysicalBookModel { Title = $"Book-{Guid.NewGuid():N}" };
        var planned = mode switch
        {
            ReadingMode.Deep => 30,
            ReadingMode.Recovery => 20,
            _ => 40,
        };
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
        var session = new ReadingSession
        {
            BookAssignment = assignment,
            BookAssignmentId = assignment.Id,
            Book = book,
            BookId = book.Id,
            Mode = mode,
            Status = ReadingSessionStatus.Completed,
            OpenSlot = null,
            TargetMinutes = planned,
            PlannedTargetMinutes = planned,
            Constraint = ReadingConstraint.None,
            AccumulatedSeconds = accumulatedSeconds,
            Effort = effort,
            Focus = focus,
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
        ReadingTrainingOptions Options,
        IServiceProvider Provider)
    {
        public ReadingTrainingService Service => new(Factory, Clock);

        public ReadingWeeklyReviewWorker Worker() => new(
            Provider.GetRequiredService<IServiceScopeFactory>(),
            Factory,
            Clock,
            Options,
            NullLogger<ReadingWeeklyReviewWorker>.Instance);

        public Task Init() => Service.InitializeProgrammeAsync("setup", Guid.NewGuid().ToString("N"));
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
        public void Set(DateTime utcNow) => UtcNow = DateTime.SpecifyKind(utcNow, DateTimeKind.Utc);
    }

    // Fails the first CreateDbContextAsync call so the loop's failed-cycle
    // survival can be observed; every later call delegates to the real
    // factory.
    private sealed class FlakyContextFactory(TestContextFactory inner) : IDbContextFactory<NostosDbContext>
    {
        private int _calls;
        private TaskCompletionSource _secondScanStarted =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task SecondScanStarted => _secondScanStarted.Task;
        public int CreateCalls => Volatile.Read(ref _calls);

        public NostosDbContext CreateDbContext() => inner.CreateDbContext();

        public async Task<NostosDbContext> CreateDbContextAsync(CancellationToken cancellationToken = default)
        {
            var call = Interlocked.Increment(ref _calls);
            if (call == 1) throw new InvalidOperationException("First scan cycle fails.");
            if (call == 2) _secondScanStarted.TrySetResult();
            return await inner.CreateDbContextAsync(cancellationToken);
        }
    }
}
