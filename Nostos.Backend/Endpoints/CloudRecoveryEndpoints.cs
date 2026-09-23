using Nostos.Backend.Cloud.Recovery;

namespace Nostos.Backend.Endpoints;

public static class CloudRecoveryEndpoints
{
    public static IEndpointRouteBuilder MapCloudRecoveryEndpoints(
        this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/cloud/recovery");

        group.MapGet("/backups", async (
            ICloudRecoveryService recovery,
            CancellationToken cancellationToken) =>
        {
            var backups = await recovery.ListBackupsAsync(cancellationToken);
            return Results.Ok(backups);
        });

        group.MapPost("/backups", async (
            ICloudRecoveryService recovery,
            CancellationToken cancellationToken) =>
        {
            var backup = await recovery.CreateBackupAsync(cancellationToken);
            return Results.Ok(backup);
        });

        group.MapPost("/backups/{backupId:guid}/restore", async (
            Guid backupId,
            CloudRestoreRequest request,
            ICloudRecoveryService recovery,
            CancellationToken cancellationToken) =>
        {
            try
            {
                var result = await recovery.RestoreAsync(
                    backupId,
                    request.Confirm,
                    cancellationToken);
                return Results.Ok(result);
            }
            catch (CloudRecoveryException exception)
            {
                var statusCode = exception.Code switch
                {
                    "backup_not_found" => StatusCodes.Status404NotFound,
                    "confirmation_required" => StatusCodes.Status409Conflict,
                    "restore_mapping_changed" => StatusCodes.Status409Conflict,
                    "backup_integrity_failed" => StatusCodes.Status422UnprocessableEntity,
                    "backup_portable_validation_failed" => StatusCodes.Status422UnprocessableEntity,
                    "restore_verification_failed" => StatusCodes.Status422UnprocessableEntity,
                    _ => StatusCodes.Status400BadRequest,
                };

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

    public sealed record CloudRestoreRequest(bool Confirm);
}
