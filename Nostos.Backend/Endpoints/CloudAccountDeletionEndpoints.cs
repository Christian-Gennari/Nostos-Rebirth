using Nostos.Backend.Cloud.Privacy;
using Nostos.Backend.Configuration;
using Nostos.Backend.Security;

namespace Nostos.Backend.Endpoints;

public static class CloudAccountDeletionEndpoints
{
    public static IEndpointRouteBuilder MapCloudAccountDeletionEndpoints(
        this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/cloud/account/deletion")
            .RequireAuthorization(CloudAuthPolicies.AuthenticatedAccount)
            .RequireRateLimiting(CloudRateLimitPolicies.AccountLifecycle);

        group.MapGet("/", GetAsync);
        group.MapPost("/", RequestAsync);
        group.MapPost("/cancel", CancelAsync);

        return routes;
    }

    private static async Task<IResult> GetAsync(
        ICloudTenantContextAccessor tenant,
        ICloudAccountDeletionService deletion,
        TimeProvider timeProvider,
        CancellationToken cancellationToken)
    {
        try
        {
            var account = tenant.GetRequired();
            var snapshot = await deletion.GetAsync(
                account.AccountId,
                cancellationToken);
            return Results.Ok(ToResponse(snapshot, timeProvider));
        }
        catch (CloudAccountDeletionException exception)
        {
            return Error(exception);
        }
    }

    private static async Task<IResult> RequestAsync(
        CloudAccountDeletionRequest request,
        ICloudTenantContextAccessor tenant,
        ICloudAccountDeletionService deletion,
        TimeProvider timeProvider,
        CancellationToken cancellationToken)
    {
        if (!request.Confirm)
        {
            return Results.BadRequest(new
            {
                error = "confirmation_required",
                message = "Account deletion requires explicit confirmation.",
            });
        }

        try
        {
            var account = tenant.GetRequired();
            var snapshot = await deletion.RequestAsync(
                account.AccountId,
                cancellationToken);
            return Results.Ok(ToResponse(snapshot, timeProvider));
        }
        catch (CloudAccountDeletionException exception)
        {
            return Error(exception);
        }
    }

    private static async Task<IResult> CancelAsync(
        ICloudTenantContextAccessor tenant,
        ICloudAccountDeletionService deletion,
        TimeProvider timeProvider,
        CancellationToken cancellationToken)
    {
        try
        {
            var account = tenant.GetRequired();
            var snapshot = await deletion.CancelAsync(
                account.AccountId,
                cancellationToken);
            return Results.Ok(ToResponse(snapshot, timeProvider));
        }
        catch (CloudAccountDeletionException exception)
        {
            return Error(exception);
        }
    }

    private static CloudAccountDeletionResponse ToResponse(
        CloudAccountDeletionSnapshot snapshot,
        TimeProvider timeProvider)
    {
        var now = timeProvider.GetUtcNow().UtcDateTime;
        var state = snapshot.State?.ToString()
            ?? snapshot.AccountStatus.ToString();

        return new CloudAccountDeletionResponse(
            State: state,
            GracePeriodDays: (int)CloudAccountDeletionPolicy.GracePeriod.TotalDays,
            RequestedAtUtc: snapshot.RequestedAtUtc,
            EligibleAtUtc: snapshot.EligibleAtUtc,
            CompletedAtUtc: snapshot.CompletedAtUtc,
            CanCancel: snapshot.CanCancel(now),
            PortableExportUrl: snapshot.CanExport(now)
                ? "/api/portability/export"
                : null);
    }

    private static IResult Error(CloudAccountDeletionException exception)
    {
        var status = exception.Code switch
        {
            "account_not_provisioned" => StatusCodes.Status404NotFound,
            "account_unavailable" => StatusCodes.Status409Conflict,
            "deletion_not_recoverable" => StatusCodes.Status409Conflict,
            "account_lifecycle_busy" => StatusCodes.Status409Conflict,
            _ => StatusCodes.Status400BadRequest,
        };

        return Results.Json(
            new
            {
                error = exception.Code,
                message = exception.Message,
            },
            statusCode: status);
    }
}

public sealed record CloudAccountDeletionRequest(bool Confirm);

public sealed record CloudAccountDeletionResponse(
    string State,
    int GracePeriodDays,
    DateTime? RequestedAtUtc,
    DateTime? EligibleAtUtc,
    DateTime? CompletedAtUtc,
    bool CanCancel,
    string? PortableExportUrl);
