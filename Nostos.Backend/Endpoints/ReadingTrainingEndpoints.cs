using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Nostos.Backend.Services.ReadingTraining;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Endpoints;

public static class ReadingTrainingEndpoints
{
    public static IEndpointRouteBuilder MapReadingTrainingEndpoints(this IEndpointRouteBuilder routes)
    {
        // Canonical Task 5 surface (frozen plan lines 289-314): registered
        // identically under /api/reading (canonical — frontend, docs and the
        // Task 17 live verification use these paths) and under
        // /api/reading-training (backward-compatible alias). A single
        // registration method keeps both prefixes in lock-step, so every
        // canonical route behaves identically through either prefix.
        MapReadingRoutes(routes.MapGroup("/api/reading").WithTags("Reading Training"));
        MapReadingRoutes(routes.MapGroup("/api/reading-training").WithTags("Reading Training"));

        // Legacy route shapes that predate the canonical contract remain
        // available under /api/reading-training only (backward
        // compatibility); the frontend and docs use the canonical surface.
        MapLegacyReadingTrainingRoutes(routes.MapGroup("/api/reading-training").WithTags("Reading Training"));

        return routes;
    }

    // --- canonical Task 5 surface (plan lines 289-314) ---

    private static void MapReadingRoutes(RouteGroupBuilder group)
    {
        // programme
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

        group.MapGet("/week", async (
            string? week,
            IReadingTrainingService service,
            CancellationToken ct) =>
        {
            if (!TryParseIsoWeek(week, out var year, out var isoWeek))
            {
                return Results.Problem(
                    statusCode: StatusCodes.Status400BadRequest,
                    title: "Invalid week.",
                    detail: "The week query parameter must be an ISO 8601 week (e.g. 2026-W32).");
            }

            return ToHttp(await service.PreviewWeeklyReviewAsync(
                new ReadingWeeklyReviewRequest(year, isoWeek), ct));
        });

        group.MapGet("/sessions", async (
            DateTime? from,
            DateTime? to,
            Guid? bookId,
            ReadingMode? mode,
            IReadingTrainingService service,
            CancellationToken ct) =>
        {
            var result = await service.GetHistoryAsync(ct);
            // Optional contract filters, applied in the endpoint layer only
            // (the domain history read is unfiltered). Filtering is applied
            // on the session's completion (or start/plan) timestamp.
            if (from is not null || to is not null || bookId is not null || mode is not null)
            {
                if (result.Data is IReadOnlyList<ReadingSessionDto> sessions)
                {
                    var filtered = sessions
                        .Where(s => from is null || (s.CompletedAt ?? s.StartedAt ?? s.PlannedAt) >= from)
                        .Where(s => to is null || (s.CompletedAt ?? s.StartedAt ?? s.PlannedAt) <= to)
                        .Where(s => bookId is null || s.BookId == bookId)
                        .Where(s => mode is null || s.Mode == mode.Value)
                        .ToList();
                    return Results.Ok(result with { Data = filtered });
                }
            }

            return Results.Ok(result);
        });

        // sessions (path-id commands target the single open session)
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

        group.MapPost("/sessions/{id:guid}/pause", async (
            Guid id,
            ReadingSessionCommandRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            await SessionCommandAsync(id, service, t => service.PauseSessionAsync(request, t), ct));

        group.MapPost("/sessions/{id:guid}/resume", async (
            Guid id,
            ReadingSessionCommandRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            await SessionCommandAsync(id, service, t => service.ResumeSessionAsync(request, t), ct));

        group.MapPost("/sessions/{id:guid}/complete", async (
            Guid id,
            ReadingCompleteSessionRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            await SessionCommandAsync(id, service, t => service.CompleteSessionAsync(request, t), ct));

        group.MapPost("/sessions/{id:guid}/rate", async (
            Guid id,
            ReadingRateSessionRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            await SessionCommandAsync(id, service, t => service.RateSessionAsync(request, t), ct));

        group.MapPost("/sessions/{id:guid}/skip-ratings", async (
            Guid id,
            ReadingSkipRatingsRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            await SessionCommandAsync(id, service, t => service.SkipRatingsAsync(request, t), ct));

        group.MapDelete("/sessions/{id:guid}/open", async (
            Guid id,
            [FromBody] ReadingSessionCommandRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            await SessionCommandAsync(id, service, t => service.CancelSessionAsync(request, t), ct));

        // books / queue
        group.MapGet("/books", async (
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.GetBooksAsync(ct)));

        group.MapPost("/books", async (
            ReadingAddBookAssignmentRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.AddBookAssignmentAsync(request, ct)));

        // Canonical set-default expression: makes the named assignment the
        // default for the mode carried in the body.
        group.MapPatch("/books/{assignmentId:guid}", async (
            Guid assignmentId,
            ReadingUpdateBookAssignmentRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.SetDefaultBookAsync(
                new ReadingSetDefaultBookRequest(request.ClientId, request.IdempotencyKey, assignmentId, request.Mode), ct)));

        // Change-mode expression: moves an active, session-free assignment
        // into the mode carried in the body, absorbing a session-free
        // duplicate collider in the target mode when one exists.
        group.MapPatch("/books/{assignmentId:guid}/mode", async (
            Guid assignmentId,
            ReadingChangeBookModeRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.ChangeBookModeAsync(
                new ReadingChangeBookModeCommandRequest(request.ClientId, request.IdempotencyKey, assignmentId, request.Mode), ct)));

        // Remove-from-queue expression: deletes an active, session-free
        // assignment. The request body carries the exact-once identity.
        group.MapDelete("/books/{assignmentId:guid}", async (
            Guid assignmentId,
            [FromBody] ReadingRemoveBookAssignmentRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.RemoveBookAssignmentAsync(
                new ReadingRemoveBookAssignmentCommandRequest(request.ClientId, request.IdempotencyKey, assignmentId), ct)));

        group.MapPost("/books/{assignmentId:guid}/finish", async (
            Guid assignmentId,
            ReadingCompleteBookRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.CompleteBookAsync(
                new ReadingCompleteBookRequest(request.ClientId, request.IdempotencyKey, assignmentId), ct)));

        // Queue-wide reorder (kept on the canonical surface for the UI).
        group.MapPost("/books/reorder", async (
            ReadingReorderQueueRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.ReorderQueueAsync(request, ct)));

        // captures / inbox
        group.MapGet("/inbox", async (
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.ListInboxAsync(ct)));

        group.MapPost("/captures", async (
            ReadingCaptureRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.CaptureAsync(request, ct)));

        // Canonical resolve expression (legacy path kept as an alias).
        group.MapPatch("/captures/{id:guid}", async (
            Guid id,
            ReadingResolveCaptureRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.ResolveCaptureAsync(id, request, ct)));

        group.MapPost("/captures/{id:guid}/promote-to-note", async (
            Guid id,
            ReadingPromoteCaptureRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.PromoteCaptureToNoteAsync(id, request, ct)));

        // weekly reviews
        group.MapPost("/reviews/preview", async (
            ReadingWeeklyReviewRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.PreviewWeeklyReviewAsync(request, ct)));

        group.MapPost("/reviews/commit", async (
            ReadingCommitWeeklyReviewRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.CommitWeeklyReviewAsync(request, ct)));

        // raw-text gateway (Task 10A). The canonical /api/reading/gateway
        // dispatch path required by the optional gateway connector contract
        // is part of this table, so the alias prefix mirrors it too. Accepts
        // raw free text, dispatches canonical controls and verbatim
        // active-session captures through the deterministic
        // ReadingGatewayDispatcher, and returns the same stable envelope and
        // status mapping as every other reading command.
        group.MapPost("/gateway/dispatch", async (
            ReadingGatewayDispatchRequest request,
            IReadingGatewayDispatcher dispatcher,
            CancellationToken ct) =>
            ToHttp(await dispatcher.DispatchAsync(request, ct)));

        // notification outbox
        group.MapGet("/notifications/lease", async (
            int? maxCount,
            int? leaseSeconds,
            IReadingNotificationOutbox outbox,
            CancellationToken ct) =>
        {
            maxCount ??= 10;
            leaseSeconds ??= 60;

            if (maxCount is < 1 or > 100)
            {
                return Results.Problem(
                    statusCode: StatusCodes.Status400BadRequest,
                    title: "Invalid maxCount.",
                    detail: "maxCount must be between 1 and 100.");
            }
            if (leaseSeconds is < 1 or > 3600)
            {
                return Results.Problem(
                    statusCode: StatusCodes.Status400BadRequest,
                    title: "Invalid leaseSeconds.",
                    detail: "leaseSeconds must be between 1 and 3600.");
            }

            var claimed = await outbox.ClaimDueAsync(
                maxCount.Value, TimeSpan.FromSeconds(leaseSeconds.Value), ct);
            return Results.Ok(claimed);
        });

        group.MapPost("/notifications/{notificationId:guid}/ack", async (
            Guid notificationId,
            IReadingNotificationOutbox outbox,
            CancellationToken ct) =>
        {
            var acknowledged = await outbox.AcknowledgeAsync(notificationId, ct);
            if (!acknowledged)
            {
                return Results.Problem(
                    statusCode: StatusCodes.Status404NotFound,
                    title: "Notification not found.",
                    detail: $"No notification exists with id '{notificationId:D}'.");
            }

            // Acknowledging is intrinsically idempotent: an existing row —
            // including one already acknowledged — answers 200; no receipt
            // record is created anywhere.
            return Results.Ok(new { notificationId, acknowledged = true });
        });
    }

    // --- legacy /api/reading-training shapes (backward compatibility) ---

    private static void MapLegacyReadingTrainingRoutes(RouteGroupBuilder group)
    {
        group.MapGet("/history", async (
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.GetHistoryAsync(ct)));

        group.MapGet("/weekly-reviews/{year:int}/{week:int}/preview", async (
            int year,
            int week,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.PreviewWeeklyReviewAsync(new ReadingWeeklyReviewRequest(year, week), ct)));

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

        // Legacy open-session command shapes (session id not in the path).
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

        group.MapPatch("/captures/{captureId:guid}/resolve", async (
            Guid captureId,
            ReadingResolveCaptureRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.ResolveCaptureAsync(captureId, request, ct)));

        group.MapPost("/weekly-reviews/commit", async (
            ReadingCommitWeeklyReviewRequest request,
            IReadingTrainingService service,
            CancellationToken ct) =>
            ToHttp(await service.CommitWeeklyReviewAsync(request, ct)));
    }

    // The domain acts on the single open session; the canonical path id must
    // name it. Verified before invoking so a mismatched id can never mutate
    // a session it does not identify.
    private static async Task<IResult> SessionCommandAsync(
        Guid sessionId,
        IReadingTrainingService service,
        Func<CancellationToken, Task<ReadingCommandResultDto>> invoke,
        CancellationToken ct)
    {
        var status = await service.GetStatusAsync(ct);
        if (status.Data is not ReadingSessionDto open || open.Id != sessionId)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status404NotFound,
                title: "Session not found.",
                detail: $"No open session exists with id '{sessionId:D}'.");
        }

        return ToHttp(await invoke(ct));
    }

    private static bool TryParseIsoWeek(string? week, out int year, out int isoWeek)
    {
        year = 0;
        isoWeek = 0;
        if (string.IsNullOrWhiteSpace(week))
        {
            return false;
        }

        var match = Regex.Match(week, @"^(\d{4})-W(\d{2})$");
        if (!match.Success)
        {
            return false;
        }

        year = int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
        isoWeek = int.Parse(match.Groups[2].Value, CultureInfo.InvariantCulture);
        return isoWeek is >= 1 and <= 53;
    }

    private static IResult ToHttp(ReadingCommandResultDto result)
    {
        if (result.Data is not ReadingErrorDto error)
        {
            return Results.Ok(result);
        }

        var statusCode = error.Code switch
        {
            "not_initialized" or "already_active" or "invalid_transition" or
                "mode_unchanged" or "assignment_has_sessions" or
                "mode_collision_has_sessions" or "assignment_completed" or
                "assignment_archived" or "assignment_not_active" =>
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
