using Nostos.Backend.Security;
using Nostos.Backend.Services.Portability;

namespace Nostos.Backend.Cloud.Privacy;

/// <summary>
/// Official-host account-lifecycle behavior around the public portable archive
/// export endpoint. The archive implementation and HTTP route remain public.
/// </summary>
public sealed class CloudPortableArchiveExporter(
    IPortableArchiveService portability,
    ICloudTenantContextAccessor tenant,
    ICloudAccountStatusStore statusStore,
    ICloudAccountDeletionService deletion,
    TimeProvider timeProvider) : IPortableArchiveExporter
{
    public async Task<IResult> ExportAsync(
        HttpContext context,
        CancellationToken cancellationToken = default)
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

            SetArchiveHeaders(context, now);
            await deletion.ExportPortableArchiveAsync(
                account.AccountId,
                context.Response.Body,
                cancellationToken);

            return Results.Empty;
        }

        var exportedAt = DateTime.UtcNow;
        SetArchiveHeaders(context, exportedAt);
        await portability.ExportAsync(context.Response.Body, cancellationToken);
        return Results.Empty;
    }

    private static void SetArchiveHeaders(HttpContext context, DateTime timestamp)
    {
        context.Response.ContentType = "application/vnd.nostos.portable+zip";
        context.Response.Headers.ContentDisposition =
            $"attachment; filename=\"nostos-export-{timestamp:yyyyMMdd-HHmmss}.nostos\"";
    }
}
