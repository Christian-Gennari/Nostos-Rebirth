using FluentAssertions;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;
using Xunit;

namespace Nostos.Backend.Tests.ReadingTraining;

// Dispatcher contract tests against a recording fake service: every dispatch
// performs EXACTLY ONE underlying service mutation with the caller-supplied
// client/key and raw text; ignored/unknown messages perform no call at all;
// service envelopes pass through unchanged; cancellation propagates.
public sealed class ReadingGatewayDispatcherTests
{
    private static readonly ReadingCommandResultDto MutationEnvelope =
        new("fake-mutation-ok", null, "7");
    private static readonly ReadingCommandResultDto CaptureEnvelope =
        new("fake-capture-ok", null, "8");

    private sealed class FakeReadingTrainingService : IReadingTrainingService
    {
        public ReadingSessionDto? OpenSession { get; set; }

        public List<string> CallLog { get; } = new();
        public List<(string ClientId, string IdempotencyKey)> CommandKeys { get; } = new();
        public List<ReadingCaptureRequest> Captures { get; } = new();
        public List<ReadingCompleteSessionRequest> Completions { get; } = new();
        public List<ReadingRateSessionRequest> Rates { get; } = new();
        public int StatusCalls { get; private set; }
        public CancellationToken LastToken { get; private set; } = CancellationToken.None;

        private Task<ReadingCommandResultDto> Mutation(string name, string clientId, string key, CancellationToken ct)
        {
            CallLog.Add(name);
            CommandKeys.Add((clientId, key));
            LastToken = ct;
            if (ct.IsCancellationRequested) throw new OperationCanceledException(ct);
            return Task.FromResult(MutationEnvelope);
        }

        public Task<ReadingCommandResultDto> GetStatusAsync(CancellationToken ct = default)
        {
            CallLog.Add("GetStatus");
            StatusCalls++;
            LastToken = ct;
            return Task.FromResult(new ReadingCommandResultDto(
                OpenSession is null ? "No active reading session." : "status", OpenSession, "0"));
        }

        public Task<ReadingCommandResultDto> CaptureAsync(ReadingCaptureRequest request, CancellationToken ct = default)
        {
            CallLog.Add("Capture");
            Captures.Add(request);
            CommandKeys.Add((request.ClientId, request.IdempotencyKey));
            LastToken = ct;
            if (ct.IsCancellationRequested) throw new OperationCanceledException(ct);
            return Task.FromResult(CaptureEnvelope);
        }

        public Task<ReadingCommandResultDto> StartSessionAsync(ReadingStartSessionRequest request, CancellationToken ct = default) =>
            Mutation("Start", request.ClientId, request.IdempotencyKey, ct);
        public Task<ReadingCommandResultDto> StartNewSessionAsync(ReadingStartNewSessionRequest request, CancellationToken ct = default) =>
            Mutation("StartNew", request.ClientId, request.IdempotencyKey, ct);
        public Task<ReadingCommandResultDto> PauseSessionAsync(ReadingSessionCommandRequest request, CancellationToken ct = default) =>
            Mutation("Pause", request.ClientId, request.IdempotencyKey, ct);
        public Task<ReadingCommandResultDto> ResumeSessionAsync(ReadingSessionCommandRequest request, CancellationToken ct = default) =>
            Mutation("Resume", request.ClientId, request.IdempotencyKey, ct);
        public Task<ReadingCommandResultDto> CompleteSessionAsync(ReadingCompleteSessionRequest request, CancellationToken ct = default)
        {
            CallLog.Add("Complete");
            Completions.Add(request);
            CommandKeys.Add((request.ClientId, request.IdempotencyKey));
            LastToken = ct;
            if (ct.IsCancellationRequested) throw new OperationCanceledException(ct);
            return Task.FromResult(MutationEnvelope);
        }
        public Task<ReadingCommandResultDto> RateSessionAsync(ReadingRateSessionRequest request, CancellationToken ct = default)
        {
            CallLog.Add("Rate");
            Rates.Add(request);
            CommandKeys.Add((request.ClientId, request.IdempotencyKey));
            LastToken = ct;
            if (ct.IsCancellationRequested) throw new OperationCanceledException(ct);
            return Task.FromResult(MutationEnvelope);
        }
        public Task<ReadingCommandResultDto> SkipRatingsAsync(ReadingSkipRatingsRequest request, CancellationToken ct = default) =>
            Mutation("SkipRatings", request.ClientId, request.IdempotencyKey, ct);
        public Task<ReadingCommandResultDto> CancelSessionAsync(ReadingSessionCommandRequest request, CancellationToken ct = default) =>
            Mutation("Cancel", request.ClientId, request.IdempotencyKey, ct);

        // Unused in gateway tests.
        public Task<ReadingCommandResultDto> InitializeProgrammeAsync(string clientId, string idempotencyKey, CancellationToken ct = default) =>
            Task.FromResult(MutationEnvelope);
        public Task<ReadingCommandResultDto> GetDashboardAsync(CancellationToken ct = default) =>
            Task.FromResult(MutationEnvelope);
        public Task<ReadingCommandResultDto> GetHistoryAsync(CancellationToken ct = default) =>
            Task.FromResult(MutationEnvelope);
        public Task<ReadingCommandResultDto> AddBookAssignmentAsync(ReadingAddBookAssignmentRequest request, CancellationToken ct = default) =>
            Task.FromResult(MutationEnvelope);
        public Task<ReadingCommandResultDto> SetDefaultBookAsync(ReadingSetDefaultBookRequest request, CancellationToken ct = default) =>
            Task.FromResult(MutationEnvelope);
        public Task<ReadingCommandResultDto> CompleteBookAsync(ReadingCompleteBookRequest request, CancellationToken ct = default) =>
            Task.FromResult(MutationEnvelope);
        public Task<ReadingCommandResultDto> ReorderQueueAsync(ReadingReorderQueueRequest request, CancellationToken ct = default) =>
            Task.FromResult(MutationEnvelope);
        public Task<ReadingCommandResultDto> PlanSessionAsync(ReadingPlanSessionRequest request, CancellationToken ct = default) =>
            Task.FromResult(MutationEnvelope);
        public Task<ReadingCommandResultDto> PreviewWeeklyReviewAsync(ReadingWeeklyReviewRequest request, CancellationToken ct = default) =>
            Task.FromResult(MutationEnvelope);
        public Task<ReadingCommandResultDto> CommitWeeklyReviewAsync(ReadingCommitWeeklyReviewRequest request, CancellationToken ct = default) =>
            Task.FromResult(MutationEnvelope);
        public Task<ReadingCommandResultDto> ListInboxAsync(CancellationToken ct = default) =>
            Task.FromResult(MutationEnvelope);
        public Task<ReadingCommandResultDto> ResolveCaptureAsync(Guid captureId, ReadingResolveCaptureRequest request, CancellationToken ct = default) =>
            Task.FromResult(MutationEnvelope);
        public Task<ReadingCommandResultDto> PromoteCaptureToNoteAsync(Guid captureId, ReadingPromoteCaptureRequest request, CancellationToken ct = default) =>
            Task.FromResult(MutationEnvelope);
    }

    private static ReadingSessionDto Session(ReadingSessionStatus status) => new(
        Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), "Book", ReadingMode.Endurance, status,
        40, 40, ReadingConstraint.None, true, false, 0, 0, null, 0, 0, null, false,
        DateTime.UtcNow, null, null, null, null);

    private static ReadingGatewayDispatcher Dispatcher(FakeReadingTrainingService service) => new(service);

    private static ReadingGatewayDispatchRequest Request(string text, string clientId = "gateway-test", string key = "key-1") =>
        new(clientId, key, text);

    // --- capture path: exactly one mutation, verbatim raw text, caller key ---

    [Fact]
    public async Task Dispatch_ActiveSessionOrdinaryText_CapturesVerbatimWithCallerKey()
    {
        var service = new FakeReadingTrainingService { OpenSession = Session(ReadingSessionStatus.Active) };
        var dispatcher = Dispatcher(service);
        const string raw = "  a verbatim  thought\nwith odd   whitespace  ";

        var result = await dispatcher.DispatchAsync(Request(raw));

        result.Should().Be(CaptureEnvelope);
        service.Captures.Should().ContainSingle();
        var capture = service.Captures[0];
        capture.Text.Should().Be(raw); // byte-for-byte, never trimmed/case-folded
        capture.Type.Should().Be(ReadingCaptureType.Thought);
        capture.ClientId.Should().Be("gateway-test");
        capture.IdempotencyKey.Should().Be("key-1");
        capture.BookId.Should().BeNull();
        capture.SessionId.Should().BeNull();
        capture.ExternalId.Should().BeNull();
        // exactly one mutation + one read-only probe
        service.CallLog.Where(c => c == "Capture").Should().ContainSingle();
        service.CallLog.Should().ContainSingle(c => c == "GetStatus");
    }

    [Theory]
    [InlineData("is this right?", ReadingCaptureType.Question)]
    [InlineData("Why did the author write this", ReadingCaptureType.Question)]
    [InlineData("thought: keep this", ReadingCaptureType.Thought)]
    [InlineData("bookmark: page 12", ReadingCaptureType.Bookmark)]
    public async Task Dispatch_ActiveSession_ClassifiesCaptureType(
        string text, ReadingCaptureType type)
    {
        var service = new FakeReadingTrainingService { OpenSession = Session(ReadingSessionStatus.Active) };
        var dispatcher = Dispatcher(service);

        await dispatcher.DispatchAsync(Request(text));

        service.Captures.Should().ContainSingle();
        service.Captures[0].Type.Should().Be(type);
        service.Captures[0].Text.Should().Be(text);
    }

    [Fact]
    public async Task Dispatch_PausedSession_OnlyExplicitPrefixCaptures()
    {
        var service = new FakeReadingTrainingService { OpenSession = Session(ReadingSessionStatus.Paused) };
        var dispatcher = Dispatcher(service);

        var captured = await dispatcher.DispatchAsync(Request("question: what next?"));
        captured.Should().Be(CaptureEnvelope);
        service.Captures.Should().ContainSingle();
        service.Captures[0].Type.Should().Be(ReadingCaptureType.Question);

        var ignored = await dispatcher.DispatchAsync(Request("plain discussion text"));
        ignored.Data.Should().BeOfType<ReadingErrorDto>().Which.Code.Should().Be(ReadingGatewayDispatcher.IgnoredCode);
        service.Captures.Should().ContainSingle(); // unchanged
        service.CallLog.Where(c => c == "Capture").Should().ContainSingle();
    }

    [Fact]
    public async Task Dispatch_NoActiveSession_OrdinaryTextCreatesNoState()
    {
        var service = new FakeReadingTrainingService { OpenSession = null };
        var dispatcher = Dispatcher(service);

        var result = await dispatcher.DispatchAsync(Request("hello there"));

        result.Data.Should().BeOfType<ReadingErrorDto>().Which.Code.Should().Be(ReadingGatewayDispatcher.IgnoredCode);
        result.Reply.Should().Be(ReadingGatewayDispatcher.IgnoredReply);
        service.CallLog.Should().ContainSingle(c => c == "GetStatus"); // probe only
        service.CallLog.Should().NotContain("Capture");
        service.CommandKeys.Should().BeEmpty(); // no mutation, no receipt path
    }

    [Fact]
    public async Task Dispatch_PlannedOrAwaitingSession_OrdinaryTextIsIgnored()
    {
        foreach (var status in new[] { ReadingSessionStatus.Planned, ReadingSessionStatus.AwaitingFeedback })
        {
            var service = new FakeReadingTrainingService { OpenSession = Session(status) };
            var dispatcher = Dispatcher(service);

            var result = await dispatcher.DispatchAsync(Request("some text"));

            result.Data.Should().BeOfType<ReadingErrorDto>().Which.Code.Should().Be(ReadingGatewayDispatcher.IgnoredCode);
            service.CallLog.Should().NotContain("Capture");
        }
    }

    // --- controls: exactly one mutation with the caller key ---

    [Theory]
    [InlineData("pause", "Pause")]
    [InlineData("pause reading", "Pause")]
    [InlineData("answer now", "Pause")]
    [InlineData("answer now please", "Pause")]
    [InlineData("resume", "Resume")]
    [InlineData("resume reading", "Resume")]
    [InlineData("cancel", "Cancel")]
    [InlineData("abandon", "Cancel")]
    [InlineData("discard it", "Cancel")]
    [InlineData("skip", "SkipRatings")]
    [InlineData("skip ratings", "SkipRatings")]
    [InlineData("start", "Start")]
    [InlineData("start now", "Start")]
    [InlineData("start new session", "StartNew")]
    [InlineData("new session", "StartNew")]
    public async Task Dispatch_Control_ExactlyOneMutationWithCallerKey(string text, string expectedCall)
    {
        var service = new FakeReadingTrainingService();
        var dispatcher = Dispatcher(service);

        var result = await dispatcher.DispatchAsync(Request(text, clientId: "gw", key: "k-9"));

        result.Should().Be(MutationEnvelope);
        service.CallLog.Where(c => c == expectedCall).Should().ContainSingle();
        service.CallLog.Count(c => c is "Pause" or "Resume" or "Cancel" or "SkipRatings" or "Start" or "StartNew" or "Complete" or "Rate").Should().Be(1);
        service.CommandKeys.Should().ContainSingle(k => k.ClientId == "gw" && k.IdempotencyKey == "k-9");
        service.CallLog.Should().NotContain("GetStatus"); // controls never probe
    }

    [Fact]
    public async Task Dispatch_Done_CompletesWithReportedMinutesOnly()
    {
        var service = new FakeReadingTrainingService();
        var dispatcher = Dispatcher(service);

        await dispatcher.DispatchAsync(Request("done 42m effort 4 focus 8"));

        service.Completions.Should().ContainSingle();
        service.Completions[0].ReportedMinutes.Should().Be(42);
        service.Completions[0].ClientId.Should().Be("gateway-test");
        service.Completions[0].IdempotencyKey.Should().Be("key-1");
        service.Rates.Should().BeEmpty(); // ratings stay in the two-turn flow
        service.CallLog.Count(c => c == "Complete").Should().Be(1);
    }

    [Fact]
    public async Task Dispatch_RatePair_RatesWithEffortAndFocus()
    {
        var service = new FakeReadingTrainingService();
        var dispatcher = Dispatcher(service);

        await dispatcher.DispatchAsync(Request("4, 8"));

        service.Rates.Should().ContainSingle();
        service.Rates[0].Effort.Should().Be(4);
        service.Rates[0].Focus.Should().Be(8);
        service.Rates[0].ClientId.Should().Be("gateway-test");
        service.Rates[0].IdempotencyKey.Should().Be("key-1");
    }

    [Fact]
    public async Task Dispatch_StatusControl_OnlyReadsStatus()
    {
        var service = new FakeReadingTrainingService { OpenSession = Session(ReadingSessionStatus.Active) };
        var dispatcher = Dispatcher(service);

        var result = await dispatcher.DispatchAsync(Request("status"));

        result.Data.Should().BeSameAs(service.OpenSession);
        service.StatusCalls.Should().Be(1);
        service.CallLog.Should().ContainSingle(); // GetStatus only, no mutation
    }

    // --- ignored / unknown: no call at all ---

    [Theory]
    [InlineData("/pause")]
    [InlineData("/read")]
    [InlineData("review the week")]
    [InlineData("inbox")]
    [InlineData("add candide to the reading queue")]
    [InlineData("finished candide")]
    [InlineData("read")]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Dispatch_IgnoredText_MakesNoServiceCall(string text)
    {
        var service = new FakeReadingTrainingService { OpenSession = Session(ReadingSessionStatus.Active) };
        var dispatcher = Dispatcher(service);

        var result = await dispatcher.DispatchAsync(Request(text));

        result.Data.Should().BeOfType<ReadingErrorDto>().Which.Code.Should().Be(ReadingGatewayDispatcher.IgnoredCode);
        result.Duplicate.Should().BeFalse();
        service.CallLog.Should().BeEmpty(); // no probe, no mutation — zero state
    }

    // --- cancellation propagates with the caller's token ---

    [Fact]
    public async Task Dispatch_ForwardsCancellationToken_AndPropagatesCancellation()
    {
        var service = new FakeReadingTrainingService { OpenSession = Session(ReadingSessionStatus.Active) };
        var dispatcher = Dispatcher(service);
        using var cts = new CancellationTokenSource();

        var probe = await dispatcher.DispatchAsync(Request("a capture"), cts.Token);
        service.LastToken.Should().Be(cts.Token);
        probe.Should().Be(CaptureEnvelope);

        cts.Cancel();
        var act = () => dispatcher.DispatchAsync(Request("another capture"), cts.Token);
        await act.Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public async Task Dispatch_Control_ForwardsCancellationToken()
    {
        var service = new FakeReadingTrainingService();
        var dispatcher = Dispatcher(service);
        using var cts = new CancellationTokenSource();

        await dispatcher.DispatchAsync(Request("pause"), cts.Token);
        service.LastToken.Should().Be(cts.Token);
    }
}
