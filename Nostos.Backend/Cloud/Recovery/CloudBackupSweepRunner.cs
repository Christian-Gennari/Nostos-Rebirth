using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Security;

namespace Nostos.Backend.Cloud.Recovery;

/// <summary>
/// Per-tenant entry for a backup sweep operation.
/// </summary>
public sealed record CloudBackupSweepTenantResult(
    Guid AccountId,
    Guid ResourceId,
    Guid? BackupId,
    string? ErrorMessage);

/// <summary>
/// Result of a complete backup sweep across all eligible Cloud tenants.
/// </summary>
public sealed record CloudBackupSweepResult(
    int Attempted,
    int Succeeded,
    int Failed,
    DateTime StartedAtUtc,
    TimeSpan Duration,
    IReadOnlyList<CloudBackupSweepTenantResult> Tenants,
    string? ControlPlaneError);

/// <summary>
/// Executes a single sweep of per-customer operational backups for all
/// eligible Cloud tenants.
///
/// This is trusted server-side background work. Tenant identity comes from the
/// control-plane store, never from HTTP input or client-supplied identifiers.
/// Processing is strictly sequential with per-tenant failure isolation.
/// </summary>
public sealed class CloudBackupSweepRunner(
    ICloudControlPlaneStore controlPlane,
    IServiceScopeFactory scopeFactory,
    ILogger<CloudBackupSweepRunner> logger)
{
    private readonly SemaphoreSlim _gate = new(1, 1);

    /// <summary>
    /// Performs one backup sweep across all eligible Cloud customer accounts.
    /// Returns immediately if another sweep is already running.
    /// </summary>
    public async Task<CloudBackupSweepResult> RunAsync(
        CancellationToken cancellationToken = default)
    {
        if (!await _gate.WaitAsync(0, cancellationToken))
        {
            logger.LogInformation(
                "Cloud backup sweep requested but another sweep is already running.");
            return new CloudBackupSweepResult(
                Attempted: 0,
                Succeeded: 0,
                Failed: 0,
                StartedAtUtc: DateTime.UtcNow,
                Duration: TimeSpan.Zero,
                Tenants: [],
                ControlPlaneError: "overlapping_sweep_rejected");
        }

        try
        {
            return await RunInternalAsync(cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<CloudBackupSweepResult> RunInternalAsync(
        CancellationToken cancellationToken)
    {
        var startedAt = DateTime.UtcNow;
        IReadOnlyList<CloudAccountResourceSnapshot>? snapshots;

        try
        {
            snapshots = await controlPlane.ListAsync(cancellationToken);
        }
        catch (Exception exception)
        {
            logger.LogError(
                exception,
                "Cloud backup sweep failed to read control-plane tenant list.");

            return new CloudBackupSweepResult(
                Attempted: 0,
                Succeeded: 0,
                Failed: 0,
                StartedAtUtc: startedAt,
                Duration: DateTime.UtcNow - startedAt,
                Tenants: [],
                ControlPlaneError: exception.Message);
        }

        var eligible = snapshots
            .Where(s => s.IsReady)
            .OrderBy(s => s.ResourceId)
            .ToList();

        logger.LogInformation(
            "Cloud backup sweep started. {EligibleCount} eligible tenants (of {TotalCount} total).",
            eligible.Count,
            snapshots.Count);

        var results = new List<CloudBackupSweepTenantResult>();
        var succeeded = 0;
        var failed = 0;

        foreach (var snapshot in eligible)
        {
            var tenantResult = await ProcessTenantAsync(
                snapshot,
                cancellationToken);

            results.Add(tenantResult);

            if (tenantResult.BackupId.HasValue)
                succeeded++;
            else
                failed++;
        }

        var duration = DateTime.UtcNow - startedAt;

        logger.LogInformation(
            "Cloud backup sweep completed. Attempted: {Attempted}, Succeeded: {Succeeded}, Failed: {Failed}, Duration: {Duration:mm\\:ss}.",
            eligible.Count,
            succeeded,
            failed,
            duration);

        return new CloudBackupSweepResult(
            Attempted: eligible.Count,
            Succeeded: succeeded,
            Failed: failed,
            StartedAtUtc: startedAt,
            Duration: duration,
            Tenants: results,
            ControlPlaneError: null);
    }

    private async Task<CloudBackupSweepTenantResult> ProcessTenantAsync(
        CloudAccountResourceSnapshot snapshot,
        CancellationToken cancellationToken)
    {
        try
        {
            using var scope = scopeFactory.CreateScope();

            var contextScope =
                scope.ServiceProvider.GetRequiredService<CloudTenantContextScope>();

            var tenantContext = new NostosAccountContext(
                snapshot.AccountId,
                DisplayName: "Nostos Cloud scheduled backup",
                Email: null);

            using var tenantContextLease = contextScope.Push(tenantContext);

            var recoveryService =
                scope.ServiceProvider.GetRequiredService<ICloudRecoveryService>();

            var backup = await recoveryService.CreateBackupAsync(cancellationToken);

            logger.LogInformation(
                "Cloud operational backup {BackupId} created for account {AccountId}, resource {ResourceId}.",
                backup.BackupId,
                snapshot.AccountId,
                snapshot.ResourceId);

            return new CloudBackupSweepTenantResult(
                snapshot.AccountId.Value,
                snapshot.ResourceId,
                backup.BackupId,
                ErrorMessage: null);
        }
        catch (Exception exception)
        {
            logger.LogWarning(
                exception,
                "Cloud operational backup failed for account {AccountId}, resource {ResourceId}: {ErrorMessage}",
                snapshot.AccountId,
                snapshot.ResourceId,
                exception.Message);

            return new CloudBackupSweepTenantResult(
                snapshot.AccountId.Value,
                snapshot.ResourceId,
                BackupId: null,
                ErrorMessage: exception.Message);
        }
    }
}
