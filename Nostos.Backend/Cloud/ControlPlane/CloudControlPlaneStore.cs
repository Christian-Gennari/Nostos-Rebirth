using Microsoft.EntityFrameworkCore;
using Npgsql;
using Nostos.Backend.Configuration;
using Nostos.Backend.Security;

namespace Nostos.Backend.Cloud.ControlPlane;

public interface ICloudControlPlaneStore
{
    Task<CloudAccountResourceSnapshot?> FindAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default);

    Task<CloudAccountResourceSnapshot> GetOrCreateAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default);

    Task MarkProvisioningAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default);

    Task MarkReadyAsync(
        NostosAccountId accountId,
        string schemaVersion,
        CancellationToken cancellationToken = default);

    Task MarkFailedAsync(
        NostosAccountId accountId,
        string failureCode,
        CancellationToken cancellationToken = default);

    Task MarkSchemaVersionAsync(
        NostosAccountId accountId,
        string schemaVersion,
        CancellationToken cancellationToken = default);

    Task MarkSchemaFailureAsync(
        NostosAccountId accountId,
        string failureCode,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<CloudAccountResourceSnapshot>> ListAsync(
        CancellationToken cancellationToken = default);
}

public sealed class CloudControlPlaneStore(
    IDbContextFactory<CloudControlPlaneDbContext> factory,
    CloudControlPlaneOptions options)
    : ICloudControlPlaneStore, ICloudAccountStatusStore
{
    public async Task<CloudAccountResourceSnapshot?> FindAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var row = await db.AccountResources
            .AsNoTracking()
            .SingleOrDefaultAsync(x => x.AccountId == accountId.Value, cancellationToken);

        return row is null ? null : Snapshot(row);
    }

    public async Task<CloudAccountResourceSnapshot> GetOrCreateAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default)
    {
        var existing = await FindAsync(accountId, cancellationToken);
        if (existing is not null)
            return existing;

        var now = DateTime.UtcNow;
        var resourceId = Guid.NewGuid();

        await using (var db = await factory.CreateDbContextAsync(cancellationToken))
        {
            db.AccountResources.Add(new CloudAccountResource
            {
                AccountId = accountId.Value,
                ResourceId = resourceId,
                DatabaseName = options.DatabaseName(resourceId),
                StorageNamespace = options.StorageNamespace(resourceId),
                ProvisioningState = CloudProvisioningState.Pending,
                AccountStatus = CloudAccountStatus.Unknown,
                CreatedAtUtc = now,
                UpdatedAtUtc = now,
            });

            try
            {
                await db.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException exception)
                when (exception.InnerException is PostgresException postgres
                    && postgres.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                // Concurrent first requests race on AccountId. Only one stable
                // resource mapping wins; the loser simply reads that row.
            }
        }

        return await FindAsync(accountId, cancellationToken)
            ?? throw new InvalidOperationException(
                "Cloud control plane failed to persist or retrieve the account resource mapping.");
    }

    public Task MarkProvisioningAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken = default) =>
        UpdateAsync(
            accountId,
            row =>
            {
                row.ProvisioningState = CloudProvisioningState.Provisioning;
                row.AccountStatus = CloudAccountStatus.Unknown;
                row.LastProvisionAttemptAtUtc = DateTime.UtcNow;
                row.FailureCode = null;
            },
            cancellationToken);

    public Task MarkReadyAsync(
        NostosAccountId accountId,
        string schemaVersion,
        CancellationToken cancellationToken = default) =>
        UpdateAsync(
            accountId,
            row =>
            {
                row.ProvisioningState = CloudProvisioningState.Ready;
                row.AccountStatus = CloudAccountStatus.Active;
                row.SchemaVersion = schemaVersion;
                row.FailureCode = null;
                row.ReadyAtUtc = DateTime.UtcNow;
            },
            cancellationToken);

    public Task MarkFailedAsync(
        NostosAccountId accountId,
        string failureCode,
        CancellationToken cancellationToken = default) =>
        UpdateAsync(
            accountId,
            row =>
            {
                row.ProvisioningState = CloudProvisioningState.Failed;
                row.AccountStatus = CloudAccountStatus.Unknown;
                row.FailureCode = failureCode.Length <= 100
                    ? failureCode
                    : failureCode[..100];
            },
            cancellationToken);

    public Task MarkSchemaVersionAsync(
        NostosAccountId accountId,
        string schemaVersion,
        CancellationToken cancellationToken = default) =>
        UpdateAsync(
            accountId,
            row =>
            {
                row.SchemaVersion = schemaVersion;
                row.FailureCode = null;
            },
            cancellationToken);

    public Task MarkSchemaFailureAsync(
        NostosAccountId accountId,
        string failureCode,
        CancellationToken cancellationToken = default) =>
        UpdateAsync(
            accountId,
            row =>
            {
                row.FailureCode = failureCode.Length <= 100
                    ? failureCode
                    : failureCode[..100];
            },
            cancellationToken);

    public async Task<IReadOnlyList<CloudAccountResourceSnapshot>> ListAsync(
        CancellationToken cancellationToken = default)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var rows = await db.AccountResources
            .AsNoTracking()
            .OrderBy(x => x.CreatedAtUtc)
            .ToListAsync(cancellationToken);

        return rows.Select(Snapshot).ToList();
    }

    public async ValueTask<CloudAccountStatus> GetStatusAsync(
        NostosAccountId accountId,
        CancellationToken cancellationToken)
    {
        var row = await FindAsync(accountId, cancellationToken);
        if (row is null)
            return CloudAccountStatus.Unknown;

        if (row.AccountStatus is CloudAccountStatus.DeletionRequested
            or CloudAccountStatus.Disabled
            or CloudAccountStatus.Deleted)
        {
            return row.AccountStatus;
        }

        return row.IsReady
            ? CloudAccountStatus.Active
            : CloudAccountStatus.Unknown;
    }

    private async Task UpdateAsync(
        NostosAccountId accountId,
        Action<CloudAccountResource> update,
        CancellationToken cancellationToken)
    {
        await using var db = await factory.CreateDbContextAsync(cancellationToken);
        var row = await db.AccountResources
            .SingleOrDefaultAsync(x => x.AccountId == accountId.Value, cancellationToken)
            ?? throw new InvalidOperationException(
                $"Cloud account '{accountId}' has no control-plane resource mapping.");

        update(row);
        row.UpdatedAtUtc = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
    }

    private static CloudAccountResourceSnapshot Snapshot(CloudAccountResource row) =>
        new(
            new NostosAccountId(row.AccountId),
            row.ResourceId,
            row.DatabaseName,
            row.StorageNamespace,
            row.ProvisioningState,
            row.AccountStatus,
            row.SchemaVersion,
            row.FailureCode,
            DateTime.SpecifyKind(row.CreatedAtUtc, DateTimeKind.Utc),
            DateTime.SpecifyKind(row.UpdatedAtUtc, DateTimeKind.Utc),
            row.LastProvisionAttemptAtUtc is null
                ? null
                : DateTime.SpecifyKind(row.LastProvisionAttemptAtUtc.Value, DateTimeKind.Utc),
            row.ReadyAtUtc is null
                ? null
                : DateTime.SpecifyKind(row.ReadyAtUtc.Value, DateTimeKind.Utc));
}
