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

// Real SQLite + real service exact-once gateway tests: a duplicate raw
// dispatch creates exactly one receipt/capture/state transition and
// converges through the existing service idempotency machinery.
public sealed class ReadingGatewaySqliteTests : IDisposable
{
    private readonly ReadingTrainingSqliteFixture _fixture = new();

    public void Dispose() => _fixture.Dispose();

    private sealed class TestContextFactory(DbContextOptions<NostosDbContext> options)
        : IDbContextFactory<NostosDbContext>
    {
        public NostosDbContext CreateDbContext() => new(options);
        public Task<NostosDbContext> CreateDbContextAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(CreateDbContext());
    }

    private sealed class MutableReadingClock(DateTime utcNow) : IReadingClock
    {
        public DateTime UtcNow { get; private set; } = utcNow;
    }

    private sealed record Harness(
        TestContextFactory Factory,
        ReadingTrainingService Service,
        ReadingGatewayDispatcher Dispatcher)
    {
        public async Task<Guid> SeedBook(string title)
        {
            await using var db = Factory.CreateDbContext();
            var book = new PhysicalBookModel { Title = title };
            db.Books.Add(book);
            await db.SaveChangesAsync();
            return book.Id;
        }

        public async Task<(Guid AssignmentId, Guid BookId)> SeedDefaultAssignment(string title, ReadingMode mode)
        {
            var bookId = await SeedBook(title);
            var added = await Service.AddBookAssignmentAsync(
                new ReadingAddBookAssignmentRequest("setup", $"add-{Guid.NewGuid():N}", bookId, mode, MakeDefault: true));
            var assignment = (ReadingBookAssignmentDto)added.Data!;
            return (assignment.Id, bookId);
        }

        public async Task<int> ReceiptCountAsync(string clientId, string key)
        {
            await using var db = Factory.CreateDbContext();
            return await db.ReadingCommandReceipts.CountAsync(r => r.ClientId == clientId && r.IdempotencyKey == key);
        }

        public async Task<List<ReadingCapture>> CapturesAsync()
        {
            await using var db = Factory.CreateDbContext();
            return await db.ReadingCaptures.ToListAsync();
        }

        public async Task<ReadingSession?> OpenSessionAsync()
        {
            await using var db = Factory.CreateDbContext();
            return await db.ReadingSessions.SingleOrDefaultAsync(s => s.OpenSlot != null);
        }
    }

    private async Task<Harness> HarnessAsync()
    {
        var path = _fixture.CreateDatabasePath();
        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseSqlite($"Data Source={path}").Options;
        var factory = new TestContextFactory(options);
        await using (var db = factory.CreateDbContext()) db.Database.EnsureCreated();
        var clock = new MutableReadingClock(new DateTime(2026, 8, 9, 8, 0, 0, DateTimeKind.Utc));
        var service = new ReadingTrainingService(factory, clock);
        await service.InitializeProgrammeAsync("setup", "init-1");
        return new Harness(factory, service, new ReadingGatewayDispatcher(service));
    }

    [Fact]
    public async Task DuplicateCaptureDispatch_CreatesOneCaptureAndConverges()
    {
        var h = await HarnessAsync();
        await h.SeedDefaultAssignment("Candide", ReadingMode.Endurance);
        var started = await h.Service.StartNewSessionAsync(
            new ReadingStartNewSessionRequest("setup", "start-1"));
        started.Data.Should().NotBeOfType<ReadingErrorDto>();
        const string raw = "  a verbatim  capture\nwith   whitespace  ";

        var first = await h.Dispatcher.DispatchAsync(new ReadingGatewayDispatchRequest("gw", "cap-1", raw));
        first.Data.Should().NotBeOfType<ReadingErrorDto>();
        var capture = (ReadingCaptureDto)first.Data!;
        capture.Text.Should().Be(raw);
        capture.SessionId.Should().NotBeNull(); // attached to the open session

        var second = await h.Dispatcher.DispatchAsync(new ReadingGatewayDispatchRequest("gw", "cap-1", raw));
        second.Duplicate.Should().BeTrue();
        ((ReadingCaptureDto)second.Data!).Id.Should().Be(capture.Id);

        var captures = await h.CapturesAsync();
        captures.Should().ContainSingle();
        captures[0].Text.Should().Be(raw);
        captures[0].SessionId.Should().Be(capture.SessionId);
        (await h.ReceiptCountAsync("gw", "cap-1")).Should().Be(1);
        // the duplicate converged: the open session was not disturbed
        var session = await h.OpenSessionAsync();
        session.Should().NotBeNull();
        session!.Status.Should().Be(ReadingSessionStatus.Active);
    }

    [Fact]
    public async Task DuplicateControlDispatch_CreatesOneStateTransition()
    {
        var h = await HarnessAsync();
        await h.SeedDefaultAssignment("Meditations", ReadingMode.Endurance);
        await h.Service.StartNewSessionAsync(new ReadingStartNewSessionRequest("setup", "start-1"));

        var first = await h.Dispatcher.DispatchAsync(new ReadingGatewayDispatchRequest("gw", "pause-1", "pause"));
        var sessionDto = (ReadingSessionDto)first.Data!;
        sessionDto.Status.Should().Be(ReadingSessionStatus.Paused);

        var second = await h.Dispatcher.DispatchAsync(new ReadingGatewayDispatchRequest("gw", "pause-1", "pause"));
        second.Duplicate.Should().BeTrue();
        ((ReadingSessionDto)second.Data!).Status.Should().Be(ReadingSessionStatus.Paused);
        second.Data.Should().BeEquivalentTo(first.Data);

        (await h.ReceiptCountAsync("gw", "pause-1")).Should().Be(1);
        var session = await h.OpenSessionAsync();
        session!.Status.Should().Be(ReadingSessionStatus.Paused);
        // exactly one PauseSession receipt exists in the whole table
        await using var db = h.Factory.CreateDbContext();
        (await db.ReadingCommandReceipts.CountAsync(r => r.CommandKind == "PauseSession")).Should().Be(1);
    }

    [Fact]
    public async Task AnswerNow_DelegatesAuthoritativePause_AndLeavesQuestionInInbox()
    {
        var h = await HarnessAsync();
        await h.SeedDefaultAssignment("Candide", ReadingMode.Endurance);
        await h.Service.StartNewSessionAsync(new ReadingStartNewSessionRequest("setup", "start-1"));
        // a saved question exists in the inbox before answer now
        await h.Dispatcher.DispatchAsync(
            new ReadingGatewayDispatchRequest("gw", "q-1", "question: what does Candide teach?"));

        var answer = await h.Dispatcher.DispatchAsync(new ReadingGatewayDispatchRequest("gw", "ans-1", "answer now"));
        var session = (ReadingSessionDto)answer.Data!;
        session.Status.Should().Be(ReadingSessionStatus.Paused); // authoritative pause

        var inbox = await h.Service.ListInboxAsync();
        var inboxData = (IReadOnlyList<ReadingCaptureDto>)inbox.Data!;
        inboxData.Should().ContainSingle(c => c.Type == ReadingCaptureType.Question);
        inboxData[0].Text.Should().Be("question: what does Candide teach?"); // question remains
    }

    [Fact]
    public async Task OrdinaryText_WithNoActiveSession_CreatesNoState()
    {
        var h = await HarnessAsync();

        var result = await h.Dispatcher.DispatchAsync(new ReadingGatewayDispatchRequest("gw", "k-1", "hello there"));

        result.Data.Should().BeOfType<ReadingErrorDto>().Which.Code.Should().Be(ReadingGatewayDispatcher.IgnoredCode);
        (await h.CapturesAsync()).Should().BeEmpty();
        (await h.ReceiptCountAsync("gw", "k-1")).Should().Be(0);
        (await h.OpenSessionAsync()).Should().BeNull();
    }

    [Fact]
    public async Task SlashCommand_NeverCreatesState_EvenWithActiveSession()
    {
        var h = await HarnessAsync();
        await h.SeedDefaultAssignment("Candide", ReadingMode.Endurance);
        await h.Service.StartNewSessionAsync(new ReadingStartNewSessionRequest("setup", "start-1"));

        var result = await h.Dispatcher.DispatchAsync(new ReadingGatewayDispatchRequest("gw", "k-1", "/pause"));

        result.Data.Should().BeOfType<ReadingErrorDto>().Which.Code.Should().Be(ReadingGatewayDispatcher.IgnoredCode);
        (await h.CapturesAsync()).Should().BeEmpty();
        (await h.ReceiptCountAsync("gw", "k-1")).Should().Be(0);
        var session = await h.OpenSessionAsync();
        session!.Status.Should().Be(ReadingSessionStatus.Active); // untouched
    }

    [Fact]
    public async Task GatewayRejection_StillPerformsOneServiceMutationWithCallerKey()
    {
        // "pause" with no active session: the dispatcher delegates, the
        // service answers the authoritative no_active_session rejection, and
        // the caller's key still dedupes the rejection exact-once.
        var h = await HarnessAsync();

        var first = await h.Dispatcher.DispatchAsync(new ReadingGatewayDispatchRequest("gw", "p-1", "pause"));
        first.Data.Should().BeOfType<ReadingErrorDto>().Which.Code.Should().Be("no_active_session");
        (await h.ReceiptCountAsync("gw", "p-1")).Should().Be(1);

        var second = await h.Dispatcher.DispatchAsync(new ReadingGatewayDispatchRequest("gw", "p-1", "pause"));
        second.Duplicate.Should().BeTrue();
        second.Data.Should().BeEquivalentTo(first.Data);
        (await h.ReceiptCountAsync("gw", "p-1")).Should().Be(1);
    }

    [Fact]
    public async Task NaturalComplete_PersistsCompletionAndDoesNotPersistCapture()
    {
        var h = await HarnessAsync();
        await h.SeedDefaultAssignment("Fictions", ReadingMode.Endurance);
        await h.Service.StartNewSessionAsync(new ReadingStartNewSessionRequest("setup", "start-1"));

        var result = await h.Dispatcher.DispatchAsync(new ReadingGatewayDispatchRequest(
            "gw", "end-1", "Ok end this round, I actually maybe read 20 minutes max."));

        result.Data.Should().NotBeOfType<ReadingErrorDto>();
        var session = (ReadingSessionDto)result.Data!;
        session.Status.Should().Be(ReadingSessionStatus.AwaitingFeedback);
        session.ReportedMinutes.Should().Be(20);

        // Database-level proof that the vault monitor has nothing to mirror.
        (await h.CapturesAsync()).Should().BeEmpty();

        // The completion itself persisted through a fresh context.
        await using var db = h.Factory.CreateDbContext();
        var persisted = await db.ReadingSessions.SingleAsync(s => s.OpenSlot != null);
        persisted.Status.Should().Be(ReadingSessionStatus.AwaitingFeedback);
        persisted.ReportedMinutes.Should().Be(20);
        (await h.ReceiptCountAsync("gw", "end-1")).Should().Be(1);
    }
}
