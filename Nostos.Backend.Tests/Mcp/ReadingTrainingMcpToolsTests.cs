using FluentAssertions;
using Nostos.Backend.Integrations.Mcp;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.Mcp;

// Direct invocation of the Task 9B1 read-only Reading Training MCP tools
// against a recording fake of the service. Each test proves the tool calls
// exactly one service method (once), passes the request cancellation token
// through, and returns the exact service envelope — including the sub-envelope
// tools (week, books), which must copy server facts verbatim instead of
// recomputing or inferring anything.
public sealed class ReadingTrainingMcpToolsTests
{
    [Fact]
    public async Task GetDashboard_ForwardsToServiceOnce_AndReturnsExactEnvelope()
    {
        var service = new FakeReadingTrainingService();
        var envelope = Ok("Dashboard.", Dashboard());
        service.DashboardResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);

        using var cts = new CancellationTokenSource();
        var result = await tools.GetDashboardAsync(cts.Token);

        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.GetDashboardAsync));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task GetStatus_ForwardsToServiceOnce_AndReturnsExactEnvelope()
    {
        var service = new FakeReadingTrainingService();
        var envelope = new ReadingCommandResultDto("No active reading session.", null, "7");
        service.StatusResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);

        using var cts = new CancellationTokenSource();
        var result = await tools.GetStatusAsync(cts.Token);

        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.GetStatusAsync));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task GetCurrentWeek_ExtractsDashboardCurrentWeek_WithoutRecomputing()
    {
        var service = new FakeReadingTrainingService();
        var week = new ReadingWeekSummaryDto("2026-W32", 2, 1, 55, 0.8, false);
        var envelope = Ok("Dashboard.", Dashboard(week));
        service.DashboardResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);

        using var cts = new CancellationTokenSource();
        var result = await tools.GetCurrentWeekAsync(cts.Token);

        // The exact server envelope is preserved; only the data payload is the
        // verbatim current-week object from the dashboard (no recomputation).
        result.Should().NotBeSameAs(envelope);
        result.Reply.Should().Be(envelope.Reply);
        result.StateVersion.Should().Be(envelope.StateVersion);
        result.Duplicate.Should().BeFalse();
        result.Data.Should().BeSameAs(week);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.GetDashboardAsync));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task GetCurrentWeek_PreservesServiceErrorEnvelope()
    {
        var service = new FakeReadingTrainingService();
        var error = new ReadingCommandResultDto(
            "Reading training is not initialized.", new ReadingErrorDto("not_initialized"), "0");
        service.DashboardResult = error;
        var tools = new ReadingTrainingMcpTools(service);

        var result = await tools.GetCurrentWeekAsync(CancellationToken.None);

        result.Should().BeSameAs(error);
        result.Data.Should().BeOfType<ReadingErrorDto>().Which.Code.Should().Be("not_initialized");
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.GetDashboardAsync));
    }

    [Fact]
    public async Task ListHistory_ForwardsToServiceOnce_AndReturnsExactEnvelope()
    {
        var service = new FakeReadingTrainingService();
        var envelope = Ok("1 completed session.", new[] { Session() });
        service.HistoryResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);

        using var cts = new CancellationTokenSource();
        var result = await tools.ListHistoryAsync(cts.Token);

        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.GetHistoryAsync));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task ListBooks_ExtractsDashboardBooks_WithoutInferring()
    {
        var service = new FakeReadingTrainingService();
        var books = new[] { Book() };
        var envelope = Ok("Dashboard.", Dashboard(books: books));
        service.DashboardResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);

        using var cts = new CancellationTokenSource();
        var result = await tools.ListBooksAsync(cts.Token);

        result.Reply.Should().Be(envelope.Reply);
        result.StateVersion.Should().Be(envelope.StateVersion);
        result.Duplicate.Should().BeFalse();
        // The exact server book list, not a client-side reconstruction.
        result.Data.Should().BeSameAs(books);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.GetDashboardAsync));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task ListBooks_PreservesServiceErrorEnvelope()
    {
        var service = new FakeReadingTrainingService();
        var error = new ReadingCommandResultDto(
            "Reading training is not initialized.", new ReadingErrorDto("not_initialized"), "0");
        service.DashboardResult = error;
        var tools = new ReadingTrainingMcpTools(service);

        var result = await tools.ListBooksAsync(CancellationToken.None);

        result.Should().BeSameAs(error);
        result.Data.Should().BeOfType<ReadingErrorDto>().Which.Code.Should().Be("not_initialized");
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.GetDashboardAsync));
    }

    [Fact]
    public async Task ListInbox_ForwardsToServiceOnce_AndReturnsExactEnvelope()
    {
        var service = new FakeReadingTrainingService();
        var envelope = Ok("Inbox empty.", Array.Empty<ReadingCaptureDto>());
        service.InboxResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);

        using var cts = new CancellationTokenSource();
        var result = await tools.ListInboxAsync(cts.Token);

        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.ListInboxAsync));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task PreviewReview_ForwardsExplicitIsoYearWeek_AndReturnsExactEnvelope()
    {
        var service = new FakeReadingTrainingService();
        var envelope = Ok("2026-W32 preview.", Preview());
        service.PreviewResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);

        using var cts = new CancellationTokenSource();
        var result = await tools.PreviewWeeklyReviewAsync(2026, 32, cts.Token);

        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.PreviewWeeklyReviewAsync));
        service.LastPreviewRequest.Should().Be(new ReadingWeeklyReviewRequest(2026, 32));
        service.LastToken.Should().Be(cts.Token);
    }

    private static ReadingCommandResultDto Ok(string reply, object? data) => new(reply, data, "7");

    private static ReadingDashboardDto Dashboard(
        ReadingWeekSummaryDto? week = null,
        IReadOnlyList<ReadingBookAssignmentDto>? books = null)
    {
        var programme = new ReadingProgrammeDto(
            Guid.NewGuid(), "Europe/Stockholm", "7",
            new ReadingTargetsDto(40, 30, 20, 40, 30, 20), false);
        return new ReadingDashboardDto(
            programme,
            books ?? Array.Empty<ReadingBookAssignmentDto>(),
            null,
            week ?? new ReadingWeekSummaryDto("2026-W32", 0, 0, 0, 0.8, false));
    }

    private static ReadingSessionDto Session() => new(
        Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), "Meditations",
        ReadingMode.Endurance, ReadingSessionStatus.Completed, 40, 40, ReadingConstraint.None,
        true, false, 2400, 2400, 40, 5, 5, 4, false,
        DateTime.UtcNow, DateTime.UtcNow, null, null, DateTime.UtcNow);

    private static ReadingBookAssignmentDto Book() => new(
        Guid.NewGuid(), Guid.NewGuid(), "Meditations", "Marcus Aurelius",
        ReadingMode.Endurance, ReadingAssignmentStatus.Active, 0, true,
        DateTime.UtcNow, DateTime.UtcNow, null);

    private static ReadingWeeklyReviewDto Preview() => new(
        "2026-W32", 2026, 32, false, null, 120, 95,
        new[]
        {
            new ReadingModeReviewDto(
                ReadingMode.Endurance, 40, 40, "Maintain", "reason", 1, 1.0, 5, 5, 0),
        },
        "7");
}

// Records which service methods the tools actually invoke and the cancellation
// token passed for each call. Every mutating method throws: the read-only
// tools must never reach them.
internal sealed class FakeReadingTrainingService : IReadingTrainingService
{
    public ReadingCommandResultDto DashboardResult { get; set; } = Ok(null);
    public ReadingCommandResultDto StatusResult { get; set; } = Ok(null);
    public ReadingCommandResultDto HistoryResult { get; set; } = Ok(Array.Empty<ReadingSessionDto>());
    public ReadingCommandResultDto InboxResult { get; set; } = Ok(Array.Empty<ReadingCaptureDto>());
    public ReadingCommandResultDto PreviewResult { get; set; } = Ok(null);

    public List<string> Called { get; } = new();
    public CancellationToken? LastToken { get; private set; }
    public ReadingWeeklyReviewRequest? LastPreviewRequest { get; private set; }

    private void Record(string method, CancellationToken ct)
    {
        Called.Add(method);
        LastToken = ct;
    }

    private static ReadingCommandResultDto Ok(object? data) => new("reply", data, "0");

    // --- read surface exercised by the tools ---
    public Task<ReadingCommandResultDto> GetDashboardAsync(CancellationToken ct = default)
    {
        Record(nameof(GetDashboardAsync), ct);
        return Task.FromResult(DashboardResult);
    }

    public Task<ReadingCommandResultDto> GetStatusAsync(CancellationToken ct = default)
    {
        Record(nameof(GetStatusAsync), ct);
        return Task.FromResult(StatusResult);
    }

    public Task<ReadingCommandResultDto> GetHistoryAsync(CancellationToken ct = default)
    {
        Record(nameof(GetHistoryAsync), ct);
        return Task.FromResult(HistoryResult);
    }

    public Task<ReadingCommandResultDto> ListInboxAsync(CancellationToken ct = default)
    {
        Record(nameof(ListInboxAsync), ct);
        return Task.FromResult(InboxResult);
    }

    public Task<ReadingCommandResultDto> PreviewWeeklyReviewAsync(
        ReadingWeeklyReviewRequest request, CancellationToken ct = default)
    {
        Record(nameof(PreviewWeeklyReviewAsync), ct);
        LastPreviewRequest = request;
        return Task.FromResult(PreviewResult);
    }

    // --- mutation surface: never reachable from the read-only tools ---
    public Task<ReadingCommandResultDto> InitializeProgrammeAsync(string clientId, string idempotencyKey, CancellationToken ct = default)
    {
        Record(nameof(InitializeProgrammeAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> AddBookAssignmentAsync(ReadingAddBookAssignmentRequest request, CancellationToken ct = default)
    {
        Record(nameof(AddBookAssignmentAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> SetDefaultBookAsync(ReadingSetDefaultBookRequest request, CancellationToken ct = default)
    {
        Record(nameof(SetDefaultBookAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> CompleteBookAsync(ReadingCompleteBookRequest request, CancellationToken ct = default)
    {
        Record(nameof(CompleteBookAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> ReorderQueueAsync(ReadingReorderQueueRequest request, CancellationToken ct = default)
    {
        Record(nameof(ReorderQueueAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> PlanSessionAsync(ReadingPlanSessionRequest request, CancellationToken ct = default)
    {
        Record(nameof(PlanSessionAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> StartSessionAsync(ReadingStartSessionRequest request, CancellationToken ct = default)
    {
        Record(nameof(StartSessionAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> StartNewSessionAsync(ReadingStartNewSessionRequest request, CancellationToken ct = default)
    {
        Record(nameof(StartNewSessionAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> PauseSessionAsync(ReadingSessionCommandRequest request, CancellationToken ct = default)
    {
        Record(nameof(PauseSessionAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> ResumeSessionAsync(ReadingSessionCommandRequest request, CancellationToken ct = default)
    {
        Record(nameof(ResumeSessionAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> CompleteSessionAsync(ReadingCompleteSessionRequest request, CancellationToken ct = default)
    {
        Record(nameof(CompleteSessionAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> RateSessionAsync(ReadingRateSessionRequest request, CancellationToken ct = default)
    {
        Record(nameof(RateSessionAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> SkipRatingsAsync(ReadingSkipRatingsRequest request, CancellationToken ct = default)
    {
        Record(nameof(SkipRatingsAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> CancelSessionAsync(ReadingSessionCommandRequest request, CancellationToken ct = default)
    {
        Record(nameof(CancelSessionAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> CommitWeeklyReviewAsync(ReadingCommitWeeklyReviewRequest request, CancellationToken ct = default)
    {
        Record(nameof(CommitWeeklyReviewAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> CaptureAsync(ReadingCaptureRequest request, CancellationToken ct = default)
    {
        Record(nameof(CaptureAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> ResolveCaptureAsync(Guid captureId, ReadingResolveCaptureRequest request, CancellationToken ct = default)
    {
        Record(nameof(ResolveCaptureAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> PromoteCaptureToNoteAsync(Guid captureId, ReadingPromoteCaptureRequest request, CancellationToken ct = default)
    {
        Record(nameof(PromoteCaptureToNoteAsync), ct);
        throw new NotSupportedException();
    }
}
