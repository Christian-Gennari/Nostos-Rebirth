using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Services.ReadingTraining;

/// <summary>
/// Deterministic raw-text gateway dispatcher (Task 10A). Every dispatch
/// performs at most ONE underlying service mutation with the caller-supplied
/// (clientId, idempotencyKey): the caller owns retries, and duplicate
/// dispatches converge through the service's existing exact-once receipts.
///
/// Control semantics follow the legacy coach's canonical vocabulary exactly
/// (see <see cref="ReadingGatewayParser"/>): "pause"/"resume"/"done"/"stop"/
/// "end"/"cancel"/"abandon"/"skip"/"answer now"/rate pairs delegate to the
/// authoritative service operations, and the service's envelope — success,
/// rejection, or duplicate — is returned unchanged. "answer now" pauses the
/// open session and leaves the saved question in the inbox for the connector
/// to inject into model discussion.
///
/// Capture semantics also follow the legacy hook: ordinary text is captured
/// verbatim (byte-for-byte, whitespace included) only while a session is
/// Active, or while Paused only when it carries an explicit
/// thought/question/bookmark prefix; with no active session, ordinary text
/// creates no state at all (stable <c>gateway_ignored</c> no-op). Slash
/// commands and model-driven reading queries are never captured.
///
/// This class contains no external-agent references, no filesystem access, and no
/// duplicate progression/timing/queue/capture-persistence logic.
/// </summary>
public sealed class ReadingGatewayDispatcher : IReadingGatewayDispatcher
{
    /// <summary>Stable error code for messages the gateway deliberately ignores.</summary>
    public const string IgnoredCode = "gateway_ignored";

    /// <summary>Stable reply accompanying <see cref="IgnoredCode"/>.</summary>
    public const string IgnoredReply = "Not a reading-gateway command.";

    private readonly IReadingTrainingService _service;

    public ReadingGatewayDispatcher(IReadingTrainingService service)
    {
        _service = service;
    }

    public async Task<ReadingCommandResultDto> DispatchAsync(
        ReadingGatewayDispatchRequest request, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var intent = ReadingGatewayParser.Classify(request.Text);
        return intent.Kind switch
        {
            ReadingGatewayParser.ReadingGatewayIntentKind.Status =>
                await _service.GetStatusAsync(ct),

            ReadingGatewayParser.ReadingGatewayIntentKind.Start =>
                await _service.StartSessionAsync(
                    new ReadingStartSessionRequest(request.ClientId, request.IdempotencyKey), ct),

            ReadingGatewayParser.ReadingGatewayIntentKind.StartNew =>
                await _service.StartNewSessionAsync(
                    new ReadingStartNewSessionRequest(request.ClientId, request.IdempotencyKey), ct),

            ReadingGatewayParser.ReadingGatewayIntentKind.Pause =>
                await _service.PauseSessionAsync(
                    new ReadingSessionCommandRequest(request.ClientId, request.IdempotencyKey), ct),

            ReadingGatewayParser.ReadingGatewayIntentKind.Resume =>
                await _service.ResumeSessionAsync(
                    new ReadingSessionCommandRequest(request.ClientId, request.IdempotencyKey), ct),

            ReadingGatewayParser.ReadingGatewayIntentKind.Complete => intent.Natural
                ? await NaturalCompleteAsync(request, intent, ct)
                : await _service.CompleteSessionAsync(
                    new ReadingCompleteSessionRequest(request.ClientId, request.IdempotencyKey, intent.ReportedMinutes), ct),

            ReadingGatewayParser.ReadingGatewayIntentKind.Rate =>
                await _service.RateSessionAsync(
                    new ReadingRateSessionRequest(
                        request.ClientId, request.IdempotencyKey, intent.Effort!.Value, intent.Focus!.Value), ct),

            ReadingGatewayParser.ReadingGatewayIntentKind.SkipRatings =>
                await _service.SkipRatingsAsync(
                    new ReadingSkipRatingsRequest(request.ClientId, request.IdempotencyKey), ct),

            ReadingGatewayParser.ReadingGatewayIntentKind.Cancel =>
                await _service.CancelSessionAsync(
                    new ReadingSessionCommandRequest(request.ClientId, request.IdempotencyKey), ct),

            ReadingGatewayParser.ReadingGatewayIntentKind.Capture =>
                await CaptureAsync(request, intent, ct),

            _ => Ignored(),
        };
    }

    /// <summary>
    /// State-aware preflight for NATURAL completion phrasing (issue #32):
    /// an active or paused session completes exactly like the canonical
    /// "done" command; while ratings are pending the message re-prompts
    /// without any mutation; with no open session it is the stable no-op.
    /// The service remains authoritative for the actual transition (this
    /// probe is read-only; the one-mutation rule is preserved).
    /// </summary>
    private async Task<ReadingCommandResultDto> NaturalCompleteAsync(
        ReadingGatewayDispatchRequest request, ReadingGatewayParser.ReadingGatewayIntent intent, CancellationToken ct)
    {
        var status = await _service.GetStatusAsync(ct);
        if (status.Data is not ReadingSessionDto session)
            return Ignored();

        if (session.Status == ReadingSessionStatus.AwaitingFeedback)
            return new ReadingCommandResultDto(
                ReadingReplyFormatter.RatePrompt, null, status.StateVersion);

        return await _service.CompleteSessionAsync(
            new ReadingCompleteSessionRequest(request.ClientId, request.IdempotencyKey, intent.ReportedMinutes), ct);
    }

    private async Task<ReadingCommandResultDto> CaptureAsync(
        ReadingGatewayDispatchRequest request, ReadingGatewayParser.ReadingGatewayIntent intent, CancellationToken ct)
    {
        // Read-only probe: capture is scoped to an active session (or a
        // paused session with an explicit capture prefix), mirroring the
        // legacy hook. The service remains authoritative inside the capture
        // mutation; this probe only decides whether the message is a capture
        // or a no-op.
        var status = await _service.GetStatusAsync(ct);
        if (status.Data is not ReadingSessionDto session)
            return Ignored();

        var captures = session.Status == ReadingSessionStatus.Active ||
                       (session.Status == ReadingSessionStatus.Paused && intent.ExplicitPrefix);
        if (!captures)
            return Ignored();

        // Raw text preserved byte-for-byte (whitespace included); the
        // classification only selects the capture type. The service attaches
        // the capture to the open session's book.
        return await _service.CaptureAsync(new ReadingCaptureRequest(
            request.ClientId, request.IdempotencyKey, request.Text ?? string.Empty, intent.CaptureType!.Value), ct);
    }

    private static ReadingCommandResultDto Ignored() =>
        new(IgnoredReply, new ReadingErrorDto(IgnoredCode), "0");
}
