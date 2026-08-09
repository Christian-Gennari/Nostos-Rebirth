using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Data.Models.ReadingTraining;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

public sealed class ReadingTrainingServiceTests : IClassFixture<ReadingTrainingSqliteFixture>
{
    private readonly ReadingTrainingSqliteFixture _fixture;

    public ReadingTrainingServiceTests(ReadingTrainingSqliteFixture fixture) => _fixture = fixture;

    [Fact]
    public async Task Initialize_is_idempotent_and_duplicate_returns_original_result()
    {
        var h = Harness();
        var first = await h.Service.InitializeProgrammeAsync("ui", "init-1");
        var duplicate = await h.Service.InitializeProgrammeAsync("ui", "init-1");
        var secondKey = await h.Service.InitializeProgrammeAsync("ui", "init-2");

        first.Reply.Should().Be(ReadingReplyFormatter.InitializedFresh);
        first.StateVersion.Should().Be("1");
        ((ReadingProgrammeDto)first.Data!).StateVersion.Should().Be("1");
        duplicate.Duplicate.Should().BeTrue();
        duplicate.Reply.Should().Be(first.Reply);
        secondKey.Reply.Should().Be(ReadingReplyFormatter.AlreadyInitialized);

        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingProgrammes.CountAsync()).Should().Be(1);
        (await db.ReadingCommandReceipts.CountAsync()).Should().Be(2);
    }

    [Fact]
    public async Task Books_support_multiple_modes_defaults_completion_and_reordering()
    {
        var h = Harness();
        await h.Init();
        var candide = await h.AddBook("Candide", "Voltaire");
        var ethics = await h.AddBook("Nicomachean Ethics", "Aristotle");

        var endurance = await h.Service.AddBookAssignmentAsync(new("ui", "add-c", candide, ReadingMode.Endurance, true));
        var deep = await h.Service.AddBookAssignmentAsync(new("ui", "add-e", ethics, ReadingMode.Deep, true));
        var a1 = (ReadingBookAssignmentDto)endurance.Data!;
        var a2 = (ReadingBookAssignmentDto)deep.Data!;

        a1.IsDefault.Should().BeTrue();
        a2.IsDefault.Should().BeTrue();
        var reordered = await h.Service.ReorderQueueAsync(new("ui", "order", [a2.Id, a1.Id]));
        ((IReadOnlyList<ReadingBookAssignmentDto>)reordered.Data!).Select(x => x.Id).Should().ContainInOrder(a2.Id, a1.Id);
        var completed = await h.Service.CompleteBookAsync(new("ui", "finish", a1.Id));
        ((ReadingBookAssignmentDto)completed.Data!).Status.Should().Be(ReadingAssignmentStatus.Completed);
    }

    [Fact]
    public async Task Plan_uses_default_book_and_preserves_constrained_session_semantics()
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Candide", "Voltaire");
        var added = await h.Service.AddBookAssignmentAsync(new("ui", "add", book, ReadingMode.Endurance, true));
        var assignment = (ReadingBookAssignmentDto)added.Data!;

        var planned = await h.Service.PlanSessionAsync(new(
            "ui", "plan", assignment.Id, ReadingMode.Endurance, 15, ReadingConstraint.TimeConstrained));
        var session = (ReadingSessionDto)planned.Data!;

        session.Status.Should().Be(ReadingSessionStatus.Planned);
        session.TargetMinutes.Should().Be(15);
        session.PlannedTargetMinutes.Should().Be(40);
        session.ProgressionEligible.Should().BeFalse();
        session.CountsAsFailure.Should().BeFalse();
        planned.Reply.Should().Contain("today's available load");
    }

    [Fact]
    public async Task Recovery_is_volume_only_and_uses_recovery_target()
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Essays", "Montaigne");
        var added = await h.Service.AddBookAssignmentAsync(new("ui", "add", book, ReadingMode.Recovery, true));
        var assignment = (ReadingBookAssignmentDto)added.Data!;

        var planned = await h.Service.PlanSessionAsync(new(
            "ui", "plan", assignment.Id, ReadingMode.Recovery, 0));
        var session = (ReadingSessionDto)planned.Data!;

        session.TargetMinutes.Should().Be(20);
        session.ProgressionEligible.Should().BeFalse();
    }

    [Fact]
    public async Task Start_pause_resume_is_restart_safe_and_excludes_paused_time()
    {
        var h = Harness();
        await h.Init();
        var session = await h.PlanDefault("Candide", ReadingMode.Endurance);
        await h.Service.StartSessionAsync(new("ui", "start", session.Id));

        h.Clock.Advance(TimeSpan.FromMinutes(12));
        var paused = await h.Service.PauseSessionAsync(new("ui", "pause"));
        ((ReadingSessionDto)paused.Data!).AccumulatedSeconds.Should().Be(720);
        h.Clock.Advance(TimeSpan.FromMinutes(30));

        var restartedService = new ReadingTrainingService(h.Factory, h.Clock);
        var pausedStatus = await restartedService.GetStatusAsync();
        ((ReadingSessionDto)pausedStatus.Data!).AccumulatedSeconds.Should().Be(720);
        await restartedService.ResumeSessionAsync(new("ui", "resume"));
        h.Clock.Advance(TimeSpan.FromMinutes(3));
        var active = await restartedService.GetStatusAsync();
        ((ReadingSessionDto)active.Data!).AccumulatedSeconds.Should().Be(900);
    }

    [Fact]
    public async Task Duplicate_pause_does_not_accumulate_twice()
    {
        var h = Harness();
        await h.Init();
        var session = await h.PlanDefault("Candide", ReadingMode.Endurance);
        await h.Service.StartSessionAsync(new("ui", "start", session.Id));
        h.Clock.Advance(TimeSpan.FromMinutes(7));

        var first = await h.Service.PauseSessionAsync(new("ui", "pause-key"));
        var retry = await h.Service.PauseSessionAsync(new("ui", "pause-key"));

        retry.Duplicate.Should().BeTrue();
        ((ReadingSessionDto)retry.Data!).AccumulatedSeconds.Should().Be(420);
        retry.Reply.Should().Be(first.Reply);
    }

    [Fact]
    public async Task Concurrent_same_key_plan_creates_one_session_and_one_receipt()
    {
        var h = Harness();
        await h.Init();
        var book = await h.AddBook("Candide", "Voltaire");
        var added = await h.Service.AddBookAssignmentAsync(new("ui", "add", book, ReadingMode.Endurance, true));
        var assignment = (ReadingBookAssignmentDto)added.Data!;
        var request = new ReadingPlanSessionRequest("shared", "plan-once", assignment.Id, ReadingMode.Endurance, 40);

        var results = await Task.WhenAll(
            h.Service.PlanSessionAsync(request),
            h.Service.PlanSessionAsync(request));

        results.Count(x => x.Duplicate).Should().Be(1);
        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingSessions.CountAsync()).Should().Be(1);
        (await db.ReadingCommandReceipts.CountAsync(x => x.ClientId == "shared" && x.IdempotencyKey == "plan-once")).Should().Be(1);
    }

    [Fact]
    public async Task Invalid_transition_is_deterministic_and_does_not_mutate_session()
    {
        var h = Harness();
        await h.Init();
        var session = await h.PlanDefault("Candide", ReadingMode.Endurance);

        var result = await h.Service.ResumeSessionAsync(new("ui", "resume-invalid"));

        ((ReadingErrorDto)result.Data!).Code.Should().Be("invalid_transition");
        var status = await h.Service.GetStatusAsync();
        ((ReadingSessionDto)status.Data!).Status.Should().Be(ReadingSessionStatus.Planned);
        ((ReadingSessionDto)status.Data!).Id.Should().Be(session.Id);
    }

    [Fact]
    public async Task Dashboard_and_status_are_authoritative_snapshots()
    {
        var h = Harness();
        await h.Init();
        var session = await h.PlanDefault("Candide", ReadingMode.Endurance);

        var dashboard = (ReadingDashboardDto)(await h.Service.GetDashboardAsync()).Data!;
        var status = (ReadingSessionDto)(await h.Service.GetStatusAsync()).Data!;

        dashboard.Books.Should().ContainSingle();
        dashboard.OpenSession!.Id.Should().Be(session.Id);
        status.Id.Should().Be(session.Id);
        status.BookTitle.Should().Be("Candide");
    }

    private HarnessContext Harness()
    {
        var path = _fixture.CreateDatabasePath();
        var options = new DbContextOptionsBuilder<NostosDbContext>().UseSqlite($"Data Source={path}").Options;
        var factory = new TestContextFactory(options);
        using (var db = factory.CreateDbContext()) db.Database.EnsureCreated();
        var clock = new MutableReadingClock(new DateTime(2026, 8, 9, 8, 0, 0, DateTimeKind.Utc));
        return new HarnessContext(factory, clock, new ReadingTrainingService(factory, clock));
    }

    private sealed record HarnessContext(
        TestContextFactory Factory,
        MutableReadingClock Clock,
        ReadingTrainingService Service)
    {
        public Task<ReadingCommandResultDto> Init() => Service.InitializeProgrammeAsync("setup", Guid.NewGuid().ToString("N"));

        public async Task<Guid> AddBook(string title, string? author = null)
        {
            await using var db = Factory.CreateDbContext();
            var book = new PhysicalBookModel { Title = title, Author = author };
            db.Books.Add(book);
            await db.SaveChangesAsync();
            return book.Id;
        }

        public async Task<ReadingSessionDto> PlanDefault(string title, ReadingMode mode)
        {
            var book = await AddBook(title);
            var added = await Service.AddBookAssignmentAsync(new("setup", $"add-{book:N}", book, mode, true));
            var assignment = (ReadingBookAssignmentDto)added.Data!;
            var planned = await Service.PlanSessionAsync(new("ui", $"plan-{book:N}", assignment.Id, mode, 0));
            return (ReadingSessionDto)planned.Data!;
        }
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
