using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Endpoints;

public static class ReadingTrainingEndpoints
{
    public static IEndpointRouteBuilder MapReadingTrainingEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/reading-training")
            .WithTags("Reading Training");

        group.MapPost("/initialize", async (
            ReadingCommandRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.InitializeProgrammeAsync(request.ClientId, request.IdempotencyKey, ct)));

        group.MapGet("/dashboard", async (
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.GetDashboardAsync(ct)));

        group.MapGet("/status", async (
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.GetStatusAsync(ct)));

        group.MapGet("/history", async (
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.GetHistoryAsync(ct)));

        group.MapGet("/inbox", async (
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.ListInboxAsync(ct)));

        group.MapGet("/weekly-reviews/{year:int}/{week:int}/preview", async (
            int year,
            int week,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.PreviewWeeklyReviewAsync(new ReadingWeeklyReviewRequest(year, week), ct)));

        // --- books / queue ---
        group.MapPost("/books", async (
            ReadingAddBookAssignmentRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.AddBookAssignmentAsync(request, ct)));

        group.MapPost("/books/default", async (
            ReadingSetDefaultBookRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.SetDefaultBookAsync(request, ct)));

        group.MapPost("/books/complete", async (
            ReadingCompleteBookRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.CompleteBookAsync(request, ct)));

        group.MapPost("/books/reorder", async (
            ReadingReorderQueueRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.ReorderQueueAsync(request, ct)));

        // --- sessions ---
        group.MapPost("/sessions/plan", async (
            ReadingPlanSessionRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.PlanSessionAsync(request, ct)));

        group.MapPost("/sessions/start", async (
            ReadingStartSessionRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.StartSessionAsync(request, ct)));

        group.MapPost("/sessions/start-new", async (
            ReadingStartNewSessionRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.StartNewSessionAsync(request, ct)));

        group.MapPost("/sessions/pause", async (
            ReadingSessionCommandRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.PauseSessionAsync(request, ct)));

        group.MapPost("/sessions/resume", async (
            ReadingSessionCommandRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.ResumeSessionAsync(request, ct)));

        group.MapPost("/sessions/complete", async (
            ReadingCompleteSessionRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.CompleteSessionAsync(request, ct)));

        group.MapPost("/sessions/rate", async (
            ReadingRateSessionRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.RateSessionAsync(request, ct)));

        group.MapPost("/sessions/skip-ratings", async (
            ReadingSkipRatingsRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.SkipRatingsAsync(request, ct)));

        group.MapPost("/sessions/cancel", async (
            ReadingSessionCommandRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.CancelSessionAsync(request, ct)));

        // --- captures / inbox ---
        group.MapPost("/captures", async (
            ReadingCaptureRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.CaptureAsync(request, ct)));

        group.MapPatch("/captures/{captureId:guid}/resolve", async (
            Guid captureId,
            ReadingResolveCaptureRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.ResolveCaptureAsync(captureId, request, ct)));

        group.MapPost("/captures/{captureId:guid}/promote-to-note", async (
            Guid captureId,
            ReadingPromoteCaptureRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.PromoteCaptureToNoteAsync(captureId, request, ct)));

        // --- weekly reviews ---
        group.MapPost("/weekly-reviews/commit", async (
            ReadingCommitWeeklyReviewRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.CommitWeeklyReviewAsync(request, ct)));

        return routes;
    }

    private static IResult ToHttp(ReadingCommandResultDto result)
    {
        if (result.Data is not ReadingErrorDto error)
        {
            return Results.Ok(result);
        }

        var statusCode = error.Code switch
        {
            "not_initialized" or "already_active" or "invalid_transition" =>
                StatusCodes.Status409Conflict,
            "invalid_week" or "invalid_idempotency" or "invalid_minutes" or
                "invalid_order" or "invalid_ratings" or "invalid_assignment" or
                "note_required" => StatusCodes.Status400BadRequest,
            _ when error.Code.EndsWith("_not_found", StringComparison.Ordinal) ||
                       error.Code.StartsWith("no_", StringComparison.Ordinal) =>
                StatusCodes.Status404NotFound,
            _ when error.Code.StartsWith("invalid_", StringComparison.Ordinal) =>
                StatusCodes.Status400BadRequest,
            _ => StatusCodes.Status422UnprocessableEntity,
        };

        return Results.Json(result, statusCode: statusCode);
    }
}