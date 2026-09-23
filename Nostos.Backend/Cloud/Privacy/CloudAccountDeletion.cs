using System.Data;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Security;

namespace Nostos.Backend.Cloud.Privacy;

public static class CloudAccountDeletionPolicy
{
    public static readonly TimeSpan GracePeriod = TimeSpan.FromDays(14);
}

public enum CloudAccountDeletionState
{
    GracePeriod,
    Cancelled,
    Destroying,
    Failed,
    Deleted,
}

/// <summary>
/// Content-free account-deletion lifecycle state. Customer content never belongs
/// in this table; it contains only timestamps and bounded operational state.
/// </summary>
public sealed class CloudAccountDeletion
{
    public Guid AccountId { get; set; }
    public CloudAccountDeletionState State { get; set; }
    public DateTime RequestedAtUtc { get; set; }
    public DateTime EligibleAtUtc { get; set; }
    public DateTime? CancelledAtUtc { get; set; }
    public DateTime? LastAttemptAtUtc { get; set; }
    public DateTime? CompletedAtUtc { get; set; }
    public string? FailureCode { get; set; }
}

public sealed record CloudAccountDeletionSnapshot(
    NostosAccountId AccountId,
    CloudAccountStatus AccountStatus,
    CloudAccountDeletionState? State,
    DateTime? RequestedAtUtc,
    DateTime? EligibleAtUtc,
    DateTime? CancelledAtUtc,
    DateTime? LastAttemptAtUtc,
    DateTime? CompletedAtUtc,
    string? FailureCode)
{
    public bool CanCancel(DateTime utcNow) =>
        State == CloudAccountDeletionState.GracePeriod
        && EligibleAtUtc is { } eligible
        && utcNow < eligible;

    public bool CanExport(DateTime utcNow) => CanCancel(utcNow);
}

public sealed class CloudAccountDeletionException(
    string code,
    string message,
    Exception? innerException = null)
    : InvalidOperationException(message, innerException)
{
    public string Code { get; } = code;
}

public interface ICloudAccountDeletionResourceDestroyer
{
    Task DestroyAsync(
        CloudAccountResourceSnapshot resource,
        CancellationToken cancellationToken = default);
}

public interface ICloudAccountDeletionPortableExporter
{
    Task ExportAsync(
        CloudAccountResourceSnapshot resource,
        Stream destination,
        CancellationToken cancellationToken = default);
}

public interface ICloudAccountDeletionService
{
    Task<CloudAccountDeletionSnapshot> GetAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default);

    Task<CloudAccountDeletionSnapshot> RequestAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default);

    Task<CloudAccountDeletionSnapshot> CancelAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default);

    Task ExportPortableArchiveAsync(
        NostosAccountId accountId,
        Stream destination,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<NostosAccountId>> ListDueAsync(
        CancellationToken cancellationToken = default);

    Task<CloudAccountDeletionSnapshot?> TryFinalizeAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default);
}

public sealed class CloudAccountDeletionService(
    IDbContextFactory<CloudControlPlaneDbContext> factory,
    ICloudControlPlaneStore controlPlane,
    ICloudAccountDeletionResourceDestroyer destroyer,
    ICloudAccountDeletionPortableExporter exporter,
    Cloud.Runtime.ICloudWorkerLeaseManager leases,
    TimeProvider timeProvider,
    ILogger<CloudAccountDeletionService> logger)
    : ICloudAccountDeletionService
{
    private const long AccountLockSalt = 0x408_408_408_408;

    public async Task<CloudAccountDeletionSnapshot> GetAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        return await SnapshotAsync(db, accountId, cancellationToken);
    }

    public async Task<CloudAccountDeletionSnapshot> RequestAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default)
    {
        var now = UtcNow();

        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken);
        await LockAccountAsync(db, accountId, cancellationToken);

        var resource = await RequireResourceAsync(db, accountId, cancellationToken);
        var deletion = await db.AccountDeletions.SingleOrDefaultAsync(
            x => x.AccountId == accountId.Value,
            cancellationToken);

        if (resource.AccountStatus == CloudAccountStatus.Deleted
            || deletion?.State == CloudAccountDeletionState.Deleted)
        {
            await transaction.CommitAsync(cancellationToken);
            return Snapshot(resource, deletion);
        }

        if (deletion?.State is CloudAccountDeletionState.GracePeriod
            or CloudAccountDeletionState.Destroying
            or CloudAccountDeletionState.Failed)
        {
            await transaction.CommitAsync(cancellationToken);
            return Snapshot(resource, deletion);
        }

        if (resource.AccountStatus != CloudAccountStatus.Active)
        {
            throw new CloudAccountDeletionException(
                "account_unavailable",
                "Only an active Nostos Cloud account can request deletion.");
        }

        if (deletion is null)
        {
            deletion = new CloudAccountDeletion
            {
                AccountId = accountId.Value,
            };
            db.AccountDeletions.Add(deletion);
        }

        deletion.State = CloudAccountDeletionState.GracePeriod;
        deletion.RequestedAtUtc = now;
        deletion.EligibleAtUtc = now.Add(CloudAccountDeletionPolicy.GracePeriod);
        deletion.CancelledAtUtc = null;
        deletion.LastAttemptAtUtc = null;
        deletion.CompletedAtUtc = null;
        deletion.FailureCode = null;

        resource.AccountStatus = CloudAccountStatus.DeletionRequested;
        resource.UpdatedAtUtc = now;

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        logger.LogInformation(
            "Cloud account {AccountId} entered deletion grace; final destruction is eligible at {EligibleAtUtc}.",
            accountId,
            deletion.EligibleAtUtc);

        return Snapshot(resource, deletion);
    }

    public async Task<CloudAccountDeletionSnapshot> CancelAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default)
    {
        var now = UtcNow();

        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken);
        await LockAccountAsync(db, accountId, cancellationToken);

        var resource = await RequireResourceAsync(db, accountId, cancellationToken);
        var deletion = await db.AccountDeletions.SingleOrDefaultAsync(
            x => x.AccountId == accountId.Value,
            cancellationToken);

        if (deletion is null)
        {
            if (resource.AccountStatus == CloudAccountStatus.Active)
            {
                await transaction.CommitAsync(cancellationToken);
                return Snapshot(resource, null);
            }

            throw new CloudAccountDeletionException(
                "deletion_not_recoverable",
                "This account has no recoverable deletion request.");
        }

        if (deletion.State == CloudAccountDeletionState.Cancelled
            && resource.AccountStatus == CloudAccountStatus.Active)
        {
            await transaction.CommitAsync(cancellationToken);
            return Snapshot(resource, deletion);
        }

        if (deletion.State != CloudAccountDeletionState.GracePeriod
            || now >= Utc(deletion.EligibleAtUtc))
        {
            throw new CloudAccountDeletionException(
                "deletion_not_recoverable",
                "The deletion grace period has ended and the request can no longer be cancelled.");
        }

        deletion.State = CloudAccountDeletionState.Cancelled;
        deletion.CancelledAtUtc = now;
        deletion.FailureCode = null;
        resource.AccountStatus = CloudAccountStatus.Active;
        resource.UpdatedAtUtc = now;

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        logger.LogInformation(
            "Cloud account {AccountId} cancelled deletion during the grace period.",
            accountId);

        return Snapshot(resource, deletion);
    }

    public async Task ExportPortableArchiveAsync(
        NostosAccountId accountId,
        Stream destination,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(destination);

        await using var lease = await leases.TryAcquireAsync(
            PerAccountLease(accountId),
            cancellationToken)
            ?? throw new CloudAccountDeletionException(
                "account_lifecycle_busy",
                "The account lifecycle is busy. Try the export again shortly.");

        var snapshot = await GetAsync(accountId, cancellationToken);
        var now = UtcNow();

        if (!snapshot.CanExport(now))
        {
            throw new CloudAccountDeletionException(
                "portable_export_unavailable",
                "Portable export is available only during the recoverable deletion grace period.");
        }

        var resource = await controlPlane.FindAsync(accountId, cancellationToken)
            ?? throw new CloudAccountDeletionException(
                "account_not_provisioned",
                "The Cloud account has no resource mapping.");

        if (resource.AccountStatus != CloudAccountStatus.DeletionRequested)
        {
            throw new CloudAccountDeletionException(
                "portable_export_unavailable",
                "Portable deletion-grace export is not available for the current account state.");
        }

        await exporter.ExportAsync(resource, destination, cancellationToken);
    }

    public async Task<IReadOnlyList<NostosAccountId>> ListDueAsync(
        CancellationToken cancellationToken = default)
    {
        var now = UtcNow();

        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var accountIds = await db.AccountDeletions
            .AsNoTracking()
            .Where(x =>
                (x.State == CloudAccountDeletionState.GracePeriod
                    && x.EligibleAtUtc <= now)
                || x.State == CloudAccountDeletionState.Failed
                || x.State == CloudAccountDeletionState.Destroying)
            .OrderBy(x => x.EligibleAtUtc)
            .Select(x => x.AccountId)
            .ToListAsync(cancellationToken);

        return accountIds.Select(id => new NostosAccountId(id)).ToList();
    }

    public async Task<CloudAccountDeletionSnapshot?> TryFinalizeAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default)
    {
        await using var lifecycleLease = await leases.TryAcquireAsync(
            PerAccountLease(accountId),
            cancellationToken);

        if (lifecycleLease is null)
            return null;

        var resource = await ClaimForDestructionAsync(accountId, cancellationToken);
        if (resource is null)
            return await GetAsync(accountId, cancellationToken);

        try
        {
            await destroyer.DestroyAsync(resource, cancellationToken);
            return await MarkDeletedAsync(accountId, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            await MarkFailedBestEffortAsync(accountId, "deletion_cancelled");
            throw;
        }
        catch (Exception exception)
        {
            await MarkFailedBestEffortAsync(accountId, "resource_destruction_failed");

            logger.LogError(
                "Cloud account deletion failed for account {AccountId}, resource {ResourceId}; exception type {ExceptionType}. Details suppressed.",
                accountId,
                resource.ResourceId,
                exception.GetType().Name);

            return await GetAsync(accountId, CancellationToken.None);
        }
    }

    private async Task<CloudAccountResourceSnapshot?> ClaimForDestructionAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken)
    {
        var now = UtcNow();

        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken);
        await LockAccountAsync(db, accountId, cancellationToken);

        var resource = await db.AccountResources.SingleOrDefaultAsync(
            x => x.AccountId == accountId.Value,
            cancellationToken);
        var deletion = await db.AccountDeletions.SingleOrDefaultAsync(
            x => x.AccountId == accountId.Value,
            cancellationToken);

        if (resource is null || deletion is null)
        {
            await transaction.CommitAsync(cancellationToken);
            return null;
        }

        var due =
            deletion.State == CloudAccountDeletionState.Failed
            || deletion.State == CloudAccountDeletionState.Destroying
            || (deletion.State == CloudAccountDeletionState.GracePeriod
                && Utc(deletion.EligibleAtUtc) <= now);

        if (!due
            || resource.AccountStatus != CloudAccountStatus.DeletionRequested)
        {
            await transaction.CommitAsync(cancellationToken);
            return null;
        }

        deletion.State = CloudAccountDeletionState.Destroying;
        deletion.LastAttemptAtUtc = now;
        deletion.FailureCode = null;
        resource.UpdatedAtUtc = now;

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return ToResourceSnapshot(resource);
    }

    private async Task<CloudAccountDeletionSnapshot> MarkDeletedAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken)
    {
        var now = UtcNow();

        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(
            IsolationLevel.ReadCommitted,
            cancellationToken);
        await LockAccountAsync(db, accountId, cancellationToken);

        var resource = await RequireResourceAsync(db, accountId, cancellationToken);
        var deletion = await db.AccountDeletions.SingleAsync(
            x => x.AccountId == accountId.Value,
            cancellationToken);

        if (deletion.State == CloudAccountDeletionState.Deleted
            && resource.AccountStatus == CloudAccountStatus.Deleted)
        {
            await transaction.CommitAsync(cancellationToken);
            return Snapshot(resource, deletion);
        }

        if (deletion.State != CloudAccountDeletionState.Destroying)
        {
            throw new CloudAccountDeletionException(
                "deletion_state_changed",
                "The account deletion state changed before final destruction could be recorded.");
        }

        // Commercial/provider linkage is not customer intellectual content and
        // is not needed by Nostos after final account destruction. Paddle keeps
        // its own legally-required payment records independently.
        await db.AiUsageReservations
            .Where(x => x.AccountId == accountId.Value)
            .ExecuteDeleteAsync(cancellationToken);
        await db.AiUsage
            .Where(x => x.AccountId == accountId.Value)
            .ExecuteDeleteAsync(cancellationToken);
        await db.BillingEvents
            .Where(x => x.AccountId == accountId.Value)
            .ExecuteDeleteAsync(cancellationToken);
        await db.BillingBindings
            .Where(x => x.AccountId == accountId.Value)
            .ExecuteDeleteAsync(cancellationToken);
        await db.SubscriptionAudit
            .Where(x => x.AccountId == accountId.Value)
            .ExecuteDeleteAsync(cancellationToken);
        await db.Subscriptions
            .Where(x => x.AccountId == accountId.Value)
            .ExecuteDeleteAsync(cancellationToken);

        deletion.State = CloudAccountDeletionState.Deleted;
        deletion.CompletedAtUtc = now;
        deletion.FailureCode = null;

        resource.AccountStatus = CloudAccountStatus.Deleted;
        resource.SchemaVersion = null;
        resource.FailureCode = null;
        resource.UpdatedAtUtc = now;

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        logger.LogInformation(
            "Cloud account {AccountId}, resource {ResourceId} completed final destruction.",
            accountId,
            resource.ResourceId);

        return Snapshot(resource, deletion);
    }

    private async Task MarkFailedBestEffortAsync(
        NostosAccountId accountId,
        string failureCode)
    {
        try
        {
            await using var db = await factory.CreateDbContextAsync(CancellationToken.None);
            await using var transaction = await db.Database.BeginTransactionAsync(
                IsolationLevel.ReadCommitted,
                CancellationToken.None);
            await LockAccountAsync(db, accountId, CancellationToken.None);

            var deletion = await db.AccountDeletions.SingleOrDefaultAsync(
                x => x.AccountId == accountId.Value,
                CancellationToken.None);

            if (deletion is not null
                && deletion.State != CloudAccountDeletionState.Deleted)
            {
                deletion.State = CloudAccountDeletionState.Failed;
                deletion.FailureCode = Limit(failureCode, 100);
                await db.SaveChangesAsync(CancellationToken.None);
            }

            await transaction.CommitAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            logger.LogError(
                "Could not persist deletion failure state for account {AccountId}; exception type {ExceptionType}. Details suppressed.",
                accountId,
                exception.GetType().Name);
        }
    }

    private async Task<CloudAccountDeletionSnapshot> SnapshotAsync(
        CloudControlPlaneDbContext db,
        NostosAccountId accountId,
        CancellationToken cancellationToken)
    {
        var resource = await RequireResourceAsync(db, accountId, cancellationToken);
        var deletion = await db.AccountDeletions
            .AsNoTracking()
            .SingleOrDefaultAsync(
                x => x.AccountId == accountId.Value,
                cancellationToken);

        return Snapshot(resource, deletion);
    }

    private static CloudAccountDeletionSnapshot Snapshot(
        CloudAccountResource resource,
        CloudAccountDeletion? deletion) =>
        new(
            new NostosAccountId(resource.AccountId),
            resource.AccountStatus,
            deletion?.State,
            deletion is null ? null : Utc(deletion.RequestedAtUtc),
            deletion is null ? null : Utc(deletion.EligibleAtUtc),
            deletion?.CancelledAtUtc is null ? null : Utc(deletion.CancelledAtUtc.Value),
            deletion?.LastAttemptAtUtc is null ? null : Utc(deletion.LastAttemptAtUtc.Value),
            deletion?.CompletedAtUtc is null ? null : Utc(deletion.CompletedAtUtc.Value),
            deletion?.FailureCode);

    private static async Task<CloudAccountResource> RequireResourceAsync(
        CloudControlPlaneDbContext db,
        NostosAccountId accountId,
        CancellationToken cancellationToken) =>
        await db.AccountResources.SingleOrDefaultAsync(
            x => x.AccountId == accountId.Value,
            cancellationToken)
        ?? throw new CloudAccountDeletionException(
            "account_not_provisioned",
            "The Cloud account has no provisioned resource mapping.");

    private static async Task LockAccountAsync(
        CloudControlPlaneDbContext db,
        NostosAccountId accountId,
        CancellationToken cancellationToken)
    {
        var accountLock =
            BitConverter.ToInt64(accountId.Value.ToByteArray(), 0)
            ^ AccountLockSalt;

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_advisory_xact_lock({accountLock});",
            cancellationToken);
    }

    private static CloudAccountResourceSnapshot ToResourceSnapshot(
        CloudAccountResource row) =>
        new(
            new NostosAccountId(row.AccountId),
            row.ResourceId,
            row.DatabaseName,
            row.StorageNamespace,
            row.ProvisioningState,
            row.AccountStatus,
            row.SchemaVersion,
            row.FailureCode,
            Utc(row.CreatedAtUtc),
            Utc(row.UpdatedAtUtc),
            row.LastProvisionAttemptAtUtc is null ? null : Utc(row.LastProvisionAttemptAtUtc.Value),
            row.ReadyAtUtc is null ? null : Utc(row.ReadyAtUtc.Value));

    private DateTime UtcNow() => timeProvider.GetUtcNow().UtcDateTime;

    private static DateTime Utc(DateTime value) =>
        DateTime.SpecifyKind(value, DateTimeKind.Utc);

    private static string PerAccountLease(NostosAccountId accountId) =>
        $"nostos:account-deletion:{accountId.Value:N}:v1";

    private static string Limit(string value, int max) =>
        value.Length <= max ? value : value[..max];
}
