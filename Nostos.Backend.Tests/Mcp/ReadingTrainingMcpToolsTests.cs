using FluentAssertions;
using Nostos.Backend.Integrations.Mcp;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.Mcp;

// Direct invocation of the Task 9B1 read-only and Task 9B2 mutating Reading
// Training MCP tools against a recording fake of the service. Each test
// proves the tool calls exactly one service method (once), passes the
// request cancellation token through, and returns the exact service envelope
// — including the sub-envelope tools (week, books), which must copy server
// facts verbatim instead of recomputing or inferring anything.
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

    // --- Task 9B2 mutation tools: exact-once delegation ---
    // Every mutation test proves: the exact public DTO is forwarded (fixed
    // ClientId "nostos-mcp", caller-supplied key, exact optional/text values),
    // the service method is called exactly once per tool invocation, the
    // request cancellation token is forwarded, the exact service envelope is
    // returned; a duplicate idempotency key reaches the service again (the
    // tool never caches or deduplicates — the service owns convergence), and
    // service rejection envelopes pass through unchanged.

    [Fact]
    public async Task PlanSession_ForwardsExactDtoOnce_AndReturnsExactEnvelope()
    {
        var service = new FakeReadingTrainingService();
        var envelope = Ok("Endurance — 40 min", Session());
        service.PlanResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);
        var assignmentId = Guid.NewGuid();
        using var cts = new CancellationTokenSource();

        var result = await tools.PlanSessionAsync(
            "plan-key-1", assignmentId, ReadingMode.Endurance, 40, ReadingConstraint.TimeConstrained, cts.Token);

        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.PlanSessionAsync));
        service.LastPlanRequest.Should().Be(new ReadingPlanSessionRequest(
            "nostos-mcp", "plan-key-1", assignmentId, ReadingMode.Endurance, 40, ReadingConstraint.TimeConstrained));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task StartSession_ForwardsExactDtoOnce_WithOptionalSessionId()
    {
        var service = new FakeReadingTrainingService();
        var envelope = Ok("Meditations", Session());
        service.StartResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);
        var sessionId = Guid.NewGuid();
        using var cts = new CancellationTokenSource();

        var result = await tools.StartSessionAsync("start-key-1", sessionId, cts.Token);

        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.StartSessionAsync));
        service.LastStartRequest.Should().Be(new ReadingStartSessionRequest("nostos-mcp", "start-key-1", sessionId));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task StartSession_WithoutSessionId_OmitsTheOptionalId()
    {
        var service = new FakeReadingTrainingService();
        var tools = new ReadingTrainingMcpTools(service);

        await tools.StartSessionAsync("start-key-2", null, CancellationToken.None);

        service.LastStartRequest.Should().Be(new ReadingStartSessionRequest("nostos-mcp", "start-key-2"));
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.StartSessionAsync));
    }

    [Fact]
    public async Task PauseSession_ForwardsExactDtoOnce_AndReturnsExactEnvelope()
    {
        var service = new FakeReadingTrainingService();
        var envelope = Ok("Paused — 12 min so far.", Session());
        service.PauseResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);
        using var cts = new CancellationTokenSource();

        var result = await tools.PauseSessionAsync("pause-key-1", cts.Token);

        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.PauseSessionAsync));
        service.LastPauseRequest.Should().Be(new ReadingSessionCommandRequest("nostos-mcp", "pause-key-1"));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task ResumeSession_ForwardsExactDtoOnce_AndReturnsExactEnvelope()
    {
        var service = new FakeReadingTrainingService();
        var envelope = Ok("Resumed: Meditations.", Session());
        service.ResumeResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);
        using var cts = new CancellationTokenSource();

        var result = await tools.ResumeSessionAsync("resume-key-1", cts.Token);

        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.ResumeSessionAsync));
        service.LastResumeRequest.Should().Be(new ReadingSessionCommandRequest("nostos-mcp", "resume-key-1"));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task CompleteSession_ForwardsExactDtoOnce_WithOptionalReportedMinutes()
    {
        var service = new FakeReadingTrainingService();
        var envelope = Ok("Logged 25 min for that session.", Session());
        service.CompleteResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);
        using var cts = new CancellationTokenSource();

        var result = await tools.CompleteSessionAsync("complete-key-1", 25, cts.Token);

        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.CompleteSessionAsync));
        service.LastCompleteRequest.Should().Be(new ReadingCompleteSessionRequest("nostos-mcp", "complete-key-1", 25));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task RateSession_ForwardsExactDtoOnce_WithOptionalRating()
    {
        var service = new FakeReadingTrainingService();
        var envelope = Ok("Logged: Meditations, 25 min.", Session());
        service.RateResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);
        using var cts = new CancellationTokenSource();

        var result = await tools.RateSessionAsync("rate-key-1", 6, 7, 4, cts.Token);

        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.RateSessionAsync));
        service.LastRateRequest.Should().Be(new ReadingRateSessionRequest("nostos-mcp", "rate-key-1", 6, 7, 4));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task CancelSession_ForwardsExactDtoOnce_AndReturnsExactEnvelope()
    {
        var service = new FakeReadingTrainingService();
        var envelope = Ok("Session cancelled.", Session());
        service.CancelResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);
        using var cts = new CancellationTokenSource();

        var result = await tools.CancelSessionAsync("cancel-key-1", cts.Token);

        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.CancelSessionAsync));
        service.LastCancelRequest.Should().Be(new ReadingSessionCommandRequest("nostos-mcp", "cancel-key-1"));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task Capture_ForwardsVerbatimTextAndExactDtoOnce()
    {
        var service = new FakeReadingTrainingService();
        var envelope = Ok("Thought captured.", Capture());
        service.CaptureResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);
        var bookId = Guid.NewGuid();
        var sessionId = Guid.NewGuid();
        const string verbatim = "  keep   this   spacing  ";
        using var cts = new CancellationTokenSource();

        var result = await tools.CaptureAsync(
            "capture-key-1", verbatim, ReadingCaptureType.Question, bookId, sessionId, "ext-1", cts.Token);

        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.CaptureAsync));
        // The exact text is forwarded untouched: the tool never trims or
        // normalizes; whitespace rejection belongs to the service.
        service.LastCaptureRequest.Should().Be(new ReadingCaptureRequest(
            "nostos-mcp", "capture-key-1", verbatim, ReadingCaptureType.Question, bookId, sessionId, "ext-1"));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task Capture_WithoutOptionalAttachments_OmitsThem()
    {
        var service = new FakeReadingTrainingService();
        var tools = new ReadingTrainingMcpTools(service);

        await tools.CaptureAsync("capture-key-2", "plain text", ReadingCaptureType.Bookmark, null, null, null, CancellationToken.None);

        service.LastCaptureRequest.Should().Be(new ReadingCaptureRequest(
            "nostos-mcp", "capture-key-2", "plain text", ReadingCaptureType.Bookmark));
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.CaptureAsync));
    }

    [Fact]
    public async Task AnswerNow_DelegatesToServicePauseOnce_WithExactDto()
    {
        var service = new FakeReadingTrainingService();
        var envelope = Ok("Paused — 12 min so far.", Session());
        service.PauseResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);
        using var cts = new CancellationTokenSource();

        var result = await tools.AnswerNowAsync("answer-key-1", cts.Token);

        // "Answer now" is the service's authoritative pause: the tool calls
        // exactly one service operation (PauseSessionAsync) and returns its
        // envelope untouched — no EF reads, no synthesized pause or text.
        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.PauseSessionAsync));
        service.LastPauseRequest.Should().Be(new ReadingSessionCommandRequest("nostos-mcp", "answer-key-1"));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task AddBook_ForwardsExactDtoOnce_WithOptionalMakeDefault()
    {
        var service = new FakeReadingTrainingService();
        var envelope = Ok("Added to queue.", Book());
        service.AddBookResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);
        var bookId = Guid.NewGuid();
        using var cts = new CancellationTokenSource();

        var result = await tools.AddBookAsync("add-key-1", bookId, ReadingMode.Deep, true, cts.Token);

        // The book is assigned by id only: no title/author/page arguments
        // are invented; the optional makeDefault flag is forwarded verbatim.
        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.AddBookAssignmentAsync));
        service.LastAddBookRequest.Should().Be(new ReadingAddBookAssignmentRequest(
            "nostos-mcp", "add-key-1", bookId, ReadingMode.Deep, true));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task AddBook_WithoutMakeDefault_DefaultsToFalse()
    {
        var service = new FakeReadingTrainingService();
        var tools = new ReadingTrainingMcpTools(service);
        var bookId = Guid.NewGuid();

        await tools.AddBookAsync("add-key-2", bookId, ReadingMode.Endurance, false, CancellationToken.None);

        service.LastAddBookRequest.Should().Be(new ReadingAddBookAssignmentRequest(
            "nostos-mcp", "add-key-2", bookId, ReadingMode.Endurance));
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.AddBookAssignmentAsync));
    }

    [Fact]
    public async Task SetDefaultBook_ForwardsExactAssignmentIdAndModeOnce()
    {
        var service = new FakeReadingTrainingService();
        var envelope = Ok("Default set.", Book());
        service.SetDefaultBookResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);
        var assignmentId = Guid.NewGuid();
        using var cts = new CancellationTokenSource();

        var result = await tools.SetDefaultBookAsync("default-key-1", assignmentId, ReadingMode.Endurance, cts.Token);

        // Exact assignment/mode semantics from the request DTO: no client-side
        // inference about which assignment is or should be default.
        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.SetDefaultBookAsync));
        service.LastSetDefaultRequest.Should().Be(new ReadingSetDefaultBookRequest(
            "nostos-mcp", "default-key-1", assignmentId, ReadingMode.Endurance));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task FinishBook_ForwardsExactAssignmentIdOnce()
    {
        var service = new FakeReadingTrainingService();
        var envelope = Ok("Marked finished.", Book());
        service.CompleteBookResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);
        var assignmentId = Guid.NewGuid();
        using var cts = new CancellationTokenSource();

        var result = await tools.FinishBookAsync("finish-key-1", assignmentId, cts.Token);

        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.CompleteBookAsync));
        service.LastCompleteBookRequest.Should().Be(new ReadingCompleteBookRequest(
            "nostos-mcp", "finish-key-1", assignmentId));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task ResolveCapture_ForwardsExactIdsAndActionOnce_WithOptionalNoteId()
    {
        var service = new FakeReadingTrainingService();
        var envelope = Ok("Capture promoted.", Capture());
        service.ResolveCaptureResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);
        var captureId = Guid.NewGuid();
        var noteId = Guid.NewGuid();
        using var cts = new CancellationTokenSource();

        var result = await tools.ResolveCaptureAsync("resolve-key-1", captureId, true, noteId, cts.Token);

        // The capture id stays outside the request DTO exactly as in the
        // service signature; keep and noteId are forwarded for the service
        // to validate (note_required, note_not_found, note_book_mismatch).
        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.ResolveCaptureAsync));
        service.LastResolveCaptureId.Should().Be(captureId);
        service.LastResolveCaptureRequest.Should().Be(new ReadingResolveCaptureRequest(
            "nostos-mcp", "resolve-key-1", true, noteId));
        service.LastToken.Should().Be(cts.Token);
    }

    [Fact]
    public async Task ResolveCapture_WithoutNoteId_Dismisses()
    {
        var service = new FakeReadingTrainingService();
        var tools = new ReadingTrainingMcpTools(service);
        var captureId = Guid.NewGuid();

        await tools.ResolveCaptureAsync("resolve-key-2", captureId, false, null, CancellationToken.None);

        service.LastResolveCaptureRequest.Should().Be(new ReadingResolveCaptureRequest(
            "nostos-mcp", "resolve-key-2", false));
        service.LastResolveCaptureId.Should().Be(captureId);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.ResolveCaptureAsync));
    }

    [Fact]
    public async Task CommitReview_ForwardsExplicitIsoYearWeekOnce_AndReturnsExactEnvelope()
    {
        var service = new FakeReadingTrainingService();
        var envelope = Ok("2026-W32 committed.", Preview());
        service.CommitReviewResult = envelope;
        var tools = new ReadingTrainingMcpTools(service);
        using var cts = new CancellationTokenSource();

        var result = await tools.CommitReviewAsync("commit-key-1", 2026, 32, cts.Token);

        // Explicit ISO year/week plus the caller key: the service recomputes
        // the review authoritatively and returns the immutable result.
        result.Should().BeSameAs(envelope);
        service.Called.Should().Equal(nameof(FakeReadingTrainingService.CommitWeeklyReviewAsync));
        service.LastCommitReviewRequest.Should().Be(new ReadingCommitWeeklyReviewRequest(
            "nostos-mcp", "commit-key-1", 2026, 32));
        service.LastToken.Should().Be(cts.Token);
    }

    [Theory]
    [MemberData(nameof(MutationCases))]
    public async Task Mutations_DuplicateKeyReachesServiceAgain_AndRejectionsPassThrough(
        string caseName, Action<ReadingTrainingMcpTools, FakeReadingTrainingService> invoke)
    {
        var service = new FakeReadingTrainingService();
        var tools = new ReadingTrainingMcpTools(service);

        // First invocation forwards the exact DTO once.
        invoke(tools, service);
        service.Called.Should().HaveCount(1, caseName);
        var method = service.Called[0];

        // A second tool invocation with the same idempotency key reaches the
        // service again: the tool layer never caches, deduplicates, or retries
        // — the service owns duplicate convergence and returns the stored
        // original.
        invoke(tools, service);
        service.Called.Should().Equal(new[] { method, method }, caseName);

        // A service rejection envelope is returned unchanged (never thrown,
        // never replaced).
        var rejection = new ReadingCommandResultDto(
            "No active reading session.", new ReadingErrorDto("no_active_session"), "7");
        service.PlanResult = rejection;
        service.StartResult = rejection;
        service.PauseResult = rejection;
        service.ResumeResult = rejection;
        service.CompleteResult = rejection;
        service.RateResult = rejection;
        service.CancelResult = rejection;
        service.CaptureResult = rejection;
        service.AddBookResult = rejection;
        service.SetDefaultBookResult = rejection;
        service.CompleteBookResult = rejection;
        service.ResolveCaptureResult = rejection;
        service.CommitReviewResult = rejection;
        service.Called.Clear();
        invoke(tools, service);
        service.Called.Should().HaveCount(1, caseName);
        var rejected = service.LastMutationResult;
        rejected.Should().BeSameAs(rejection, caseName);
        rejected!.Data.Should().BeOfType<ReadingErrorDto>(caseName).Which.Code.Should().Be("no_active_session");
    }

    public static TheoryData<string, Action<ReadingTrainingMcpTools, FakeReadingTrainingService>> MutationCases()
    {
        var assignmentId = Guid.NewGuid();
        var captureId = Guid.NewGuid();
        return new TheoryData<string, Action<ReadingTrainingMcpTools, FakeReadingTrainingService>>
        {
            { "plan", (tools, _) => tools.PlanSessionAsync("dup-key", assignmentId, ReadingMode.Endurance, 40, ReadingConstraint.None, CancellationToken.None).GetAwaiter().GetResult() },
            { "start", (tools, _) => tools.StartSessionAsync("dup-key", null, CancellationToken.None).GetAwaiter().GetResult() },
            { "pause", (tools, _) => tools.PauseSessionAsync("dup-key", CancellationToken.None).GetAwaiter().GetResult() },
            { "resume", (tools, _) => tools.ResumeSessionAsync("dup-key", CancellationToken.None).GetAwaiter().GetResult() },
            { "complete", (tools, _) => tools.CompleteSessionAsync("dup-key", null, CancellationToken.None).GetAwaiter().GetResult() },
            { "rate", (tools, _) => tools.RateSessionAsync("dup-key", 5, 5, null, CancellationToken.None).GetAwaiter().GetResult() },
            { "cancel", (tools, _) => tools.CancelSessionAsync("dup-key", CancellationToken.None).GetAwaiter().GetResult() },
            { "capture", (tools, _) => tools.CaptureAsync("dup-key", "text", ReadingCaptureType.Thought, null, null, null, CancellationToken.None).GetAwaiter().GetResult() },
            { "answerNow", (tools, _) => tools.AnswerNowAsync("dup-key", CancellationToken.None).GetAwaiter().GetResult() },
            { "addBook", (tools, _) => tools.AddBookAsync("dup-key", assignmentId, ReadingMode.Deep, false, CancellationToken.None).GetAwaiter().GetResult() },
            { "setDefaultBook", (tools, _) => tools.SetDefaultBookAsync("dup-key", assignmentId, ReadingMode.Endurance, CancellationToken.None).GetAwaiter().GetResult() },
            { "finishBook", (tools, _) => tools.FinishBookAsync("dup-key", assignmentId, CancellationToken.None).GetAwaiter().GetResult() },
            { "resolveCapture", (tools, _) => tools.ResolveCaptureAsync("dup-key", captureId, true, null, CancellationToken.None).GetAwaiter().GetResult() },
            { "commitReview", (tools, _) => tools.CommitReviewAsync("dup-key", 2026, 32, CancellationToken.None).GetAwaiter().GetResult() },
        };
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

    private static ReadingCaptureDto Capture() => new(
        Guid.NewGuid(), "text", ReadingCaptureType.Thought, Guid.NewGuid(), null, null, false, null, DateTime.UtcNow);
}

// Records which service methods the tools actually invoke, the cancellation
// token passed for each call, and the exact request DTO of every mutation.
// The fourteen mutation methods exercised by the Task 9B2 tools return a
// configurable envelope; the remaining mutation surface throws: neither the
// read-only tools nor the fourteen mutation tools may ever reach them.
public sealed class FakeReadingTrainingService : IReadingTrainingService
{
    public ReadingCommandResultDto DashboardResult { get; set; } = Ok(null);
    public ReadingCommandResultDto StatusResult { get; set; } = Ok(null);
    public ReadingCommandResultDto HistoryResult { get; set; } = Ok(Array.Empty<ReadingSessionDto>());
    public ReadingCommandResultDto InboxResult { get; set; } = Ok(Array.Empty<ReadingCaptureDto>());
    public ReadingCommandResultDto PreviewResult { get; set; } = Ok(null);

    public ReadingCommandResultDto PlanResult { get; set; } = Ok(null);
    public ReadingCommandResultDto StartResult { get; set; } = Ok(null);
    public ReadingCommandResultDto PauseResult { get; set; } = Ok(null);
    public ReadingCommandResultDto ResumeResult { get; set; } = Ok(null);
    public ReadingCommandResultDto CompleteResult { get; set; } = Ok(null);
    public ReadingCommandResultDto RateResult { get; set; } = Ok(null);
    public ReadingCommandResultDto CancelResult { get; set; } = Ok(null);
    public ReadingCommandResultDto CaptureResult { get; set; } = Ok(null);
    public ReadingCommandResultDto AddBookResult { get; set; } = Ok(null);
    public ReadingCommandResultDto SetDefaultBookResult { get; set; } = Ok(null);
    public ReadingCommandResultDto CompleteBookResult { get; set; } = Ok(null);
    public ReadingCommandResultDto ResolveCaptureResult { get; set; } = Ok(null);
    public ReadingCommandResultDto CommitReviewResult { get; set; } = Ok(null);

    public List<string> Called { get; } = new();
    public CancellationToken? LastToken { get; private set; }
    public ReadingWeeklyReviewRequest? LastPreviewRequest { get; private set; }

    public ReadingPlanSessionRequest? LastPlanRequest { get; private set; }
    public ReadingStartSessionRequest? LastStartRequest { get; private set; }
    public ReadingSessionCommandRequest? LastPauseRequest { get; private set; }
    public ReadingSessionCommandRequest? LastResumeRequest { get; private set; }
    public ReadingCompleteSessionRequest? LastCompleteRequest { get; private set; }
    public ReadingRateSessionRequest? LastRateRequest { get; private set; }
    public ReadingSessionCommandRequest? LastCancelRequest { get; private set; }
    public ReadingCaptureRequest? LastCaptureRequest { get; private set; }
    public ReadingAddBookAssignmentRequest? LastAddBookRequest { get; private set; }
    public ReadingSetDefaultBookRequest? LastSetDefaultRequest { get; private set; }
    public ReadingCompleteBookRequest? LastCompleteBookRequest { get; private set; }
    public Guid? LastResolveCaptureId { get; private set; }
    public ReadingResolveCaptureRequest? LastResolveCaptureRequest { get; private set; }
    public ReadingCommitWeeklyReviewRequest? LastCommitReviewRequest { get; private set; }

    // The envelope of the most recent mutation call (shared by the duplicate
    // and rejection assertions in the mutation theory).
    public ReadingCommandResultDto? LastMutationResult { get; private set; }

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

    public Task<ReadingCommandResultDto> GetBooksAsync(CancellationToken ct = default)
    {
        Record(nameof(GetBooksAsync), ct);
        return Task.FromResult(Ok(Array.Empty<ReadingBookAssignmentDto>()));
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
        LastAddBookRequest = request;
        LastMutationResult = AddBookResult;
        return Task.FromResult(AddBookResult);
    }

    public Task<ReadingCommandResultDto> SetDefaultBookAsync(ReadingSetDefaultBookRequest request, CancellationToken ct = default)
    {
        Record(nameof(SetDefaultBookAsync), ct);
        LastSetDefaultRequest = request;
        LastMutationResult = SetDefaultBookResult;
        return Task.FromResult(SetDefaultBookResult);
    }

    public Task<ReadingCommandResultDto> CompleteBookAsync(ReadingCompleteBookRequest request, CancellationToken ct = default)
    {
        Record(nameof(CompleteBookAsync), ct);
        LastCompleteBookRequest = request;
        LastMutationResult = CompleteBookResult;
        return Task.FromResult(CompleteBookResult);
    }

    public Task<ReadingCommandResultDto> ReorderQueueAsync(ReadingReorderQueueRequest request, CancellationToken ct = default)
    {
        Record(nameof(ReorderQueueAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> PlanSessionAsync(ReadingPlanSessionRequest request, CancellationToken ct = default)
    {
        Record(nameof(PlanSessionAsync), ct);
        LastPlanRequest = request;
        LastMutationResult = PlanResult;
        return Task.FromResult(PlanResult);
    }

    public Task<ReadingCommandResultDto> StartSessionAsync(ReadingStartSessionRequest request, CancellationToken ct = default)
    {
        Record(nameof(StartSessionAsync), ct);
        LastStartRequest = request;
        LastMutationResult = StartResult;
        return Task.FromResult(StartResult);
    }

    public Task<ReadingCommandResultDto> StartNewSessionAsync(ReadingStartNewSessionRequest request, CancellationToken ct = default)
    {
        Record(nameof(StartNewSessionAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> PauseSessionAsync(ReadingSessionCommandRequest request, CancellationToken ct = default)
    {
        Record(nameof(PauseSessionAsync), ct);
        LastPauseRequest = request;
        LastMutationResult = PauseResult;
        return Task.FromResult(PauseResult);
    }

    public Task<ReadingCommandResultDto> ResumeSessionAsync(ReadingSessionCommandRequest request, CancellationToken ct = default)
    {
        Record(nameof(ResumeSessionAsync), ct);
        LastResumeRequest = request;
        LastMutationResult = ResumeResult;
        return Task.FromResult(ResumeResult);
    }

    public Task<ReadingCommandResultDto> CompleteSessionAsync(ReadingCompleteSessionRequest request, CancellationToken ct = default)
    {
        Record(nameof(CompleteSessionAsync), ct);
        LastCompleteRequest = request;
        LastMutationResult = CompleteResult;
        return Task.FromResult(CompleteResult);
    }

    public Task<ReadingCommandResultDto> RateSessionAsync(ReadingRateSessionRequest request, CancellationToken ct = default)
    {
        Record(nameof(RateSessionAsync), ct);
        LastRateRequest = request;
        LastMutationResult = RateResult;
        return Task.FromResult(RateResult);
    }

    public Task<ReadingCommandResultDto> SkipRatingsAsync(ReadingSkipRatingsRequest request, CancellationToken ct = default)
    {
        Record(nameof(SkipRatingsAsync), ct);
        throw new NotSupportedException();
    }

    public Task<ReadingCommandResultDto> CancelSessionAsync(ReadingSessionCommandRequest request, CancellationToken ct = default)
    {
        Record(nameof(CancelSessionAsync), ct);
        LastCancelRequest = request;
        LastMutationResult = CancelResult;
        return Task.FromResult(CancelResult);
    }

    public Task<ReadingCommandResultDto> CommitWeeklyReviewAsync(ReadingCommitWeeklyReviewRequest request, CancellationToken ct = default)
    {
        Record(nameof(CommitWeeklyReviewAsync), ct);
        LastCommitReviewRequest = request;
        LastMutationResult = CommitReviewResult;
        return Task.FromResult(CommitReviewResult);
    }

    public Task<ReadingCommandResultDto> CaptureAsync(ReadingCaptureRequest request, CancellationToken ct = default)
    {
        Record(nameof(CaptureAsync), ct);
        LastCaptureRequest = request;
        LastMutationResult = CaptureResult;
        return Task.FromResult(CaptureResult);
    }

    public Task<ReadingCommandResultDto> ResolveCaptureAsync(Guid captureId, ReadingResolveCaptureRequest request, CancellationToken ct = default)
    {
        Record(nameof(ResolveCaptureAsync), ct);
        LastResolveCaptureId = captureId;
        LastResolveCaptureRequest = request;
        LastMutationResult = ResolveCaptureResult;
        return Task.FromResult(ResolveCaptureResult);
    }

    public Task<ReadingCommandResultDto> PromoteCaptureToNoteAsync(Guid captureId, ReadingPromoteCaptureRequest request, CancellationToken ct = default)
    {
        Record(nameof(PromoteCaptureToNoteAsync), ct);
        throw new NotSupportedException();
    }
}
