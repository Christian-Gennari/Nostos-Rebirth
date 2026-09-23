using Nostos.Backend.Cloud.Privacy;
using Nostos.Backend.Configuration;
using Nostos.Backend.Security;
using Nostos.Backend.Services.Portability;

namespace Nostos.Backend.Endpoints;

public static class PortabilityEndpoints
{
    public const string ArchiveContentType = "application/vnd.nostos.portable+zip";

    public static IEndpointRouteBuilder MapPortabilityEndpoints(
        this IEndpointRouteBuilder routes,
        bool cloudMode = false)
    {
        var group = routes.MapGroup("/api/portability");
        if (cloudMode)
            group.RequireRateLimiting(CloudRateLimitPolicies.LargeTransfer);

        if (cloudMode)
        {
            group.MapGet("/export", async (
                HttpContext context,
                IPortableArchiveService portability,
                ICloudTenantContextAccessor tenant,
                ICloudAccountStatusStore statusStore,
                ICloudAccountDeletionService deletion,
                TimeProvider timeProvider,
                CancellationToken cancellationToken) =>
            {
                var account = tenant.GetRequired();
                var status = await statusStore.GetStatusAsync(
                    account.AccountId,
                    cancellationToken);

                if (status == CloudAccountStatus.DeletionRequested)
                {
                    var deletionState = await deletion.GetAsync(
                        account.AccountId,
                        cancellationToken);
                    var now = timeProvider.GetUtcNow().UtcDateTime;

                    if (!deletionState.CanExport(now))
                    {
                        return Results.Conflict(new
                        {
                            error = "portable_export_unavailable",
                            message = "The deletion grace period has ended.",
                        });
                    }

                    context.Response.ContentType = ArchiveContentType;
                    context.Response.Headers.ContentDisposition =
                        $"attachment; filename=\"nostos-export-{now:yyyyMMdd-HHmmss}.nostos\"";

                    await deletion.ExportPortableArchiveAsync(
                        account.AccountId,
                        context.Response.Body,
                        cancellationToken);

                    return Results.Empty;
                }

                context.Response.ContentType = ArchiveContentType;
                context.Response.Headers.ContentDisposition =
                    $"attachment; filename=\"nostos-export-{DateTime.UtcNow:yyyyMMdd-HHmmss}.nostos\"";

                await portability.ExportAsync(
                    context.Response.Body,
                    cancellationToken);

                return Results.Empty;
            })
            .RequireAuthorization(CloudAuthPolicies.RecoverableAccount);
        }
        else
        {
            group.MapGet("/export", async (
                HttpContext context,
                IPortableArchiveService portability,
                CancellationToken cancellationToken) =>
            {
                context.Response.ContentType = ArchiveContentType;
                context.Response.Headers.ContentDisposition =
                    $"attachment; filename=\"nostos-export-{DateTime.UtcNow:yyyyMMdd-HHmmss}.nostos\"";

                await portability.ExportAsync(
                    context.Response.Body,
                    cancellationToken);
            });
        }

        group.MapPost("/import", async (
            HttpRequest request,
            IPortableArchiveService portability,
            CancellationToken cancellationToken) =>
        {
            if (request.ContentLength == 0)
            {
                return Results.BadRequest(new
                {
                    error = "empty_archive",
                    message = "Portable archive request body is empty.",
                });
            }

            try
            {
                var result = await portability.ImportAsync(
                    request.Body,
                    cancellationToken);
                return Results.Ok(result);
            }
            catch (PortableArchiveException exception)
            {
                var statusCode = exception.Code == "destination_not_empty"
                    ? StatusCodes.Status409Conflict
                    : StatusCodes.Status400BadRequest;

                return Results.Json(
                    new
                    {
                        error = exception.Code,
                        message = exception.Message,
                    },
                    statusCode: statusCode);
            }
        });

        return routes;
    }
}
