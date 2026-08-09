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