using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Migrations;
using Nostos.Backend.Cloud.Storage;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Security;
using Nostos.Backend.Services;
using Nostos.Backend.Services.Portability;

namespace Nostos.Backend.Cloud.Recovery;

/// <summary>
/// Creates and verifies replacement resources for exactly one account restore.
///
/// Staging is deliberately separate from the live control-plane mapping. A
/// caller can destroy an unsuccessful stage without touching the current
/// customer database or object namespace.
/// </summary>
public sealed class CloudRecoveryResourceManager(
    CloudDatabaseConnections connections,
    CloudControlPlaneOptions controlPlaneOptions,
    ICloudCustomerConnectionFactory customerConnections,
    IAmazonS3 s3,
    CloudObjectStorageOptions storageOptions,
    ILogger<CloudRecoveryResourceManager> logger)
{
    public CloudRecoveryStage NewStage(
        CloudAccountResourceSnapshot current,
        Guid restoreId)
    {
        var resourcePart = current.ResourceId.ToString("N")[..12];
        var restorePart = restoreId.ToString("N")[..12];

        var databaseName =
            $"{controlPlaneOptions.CustomerDatabasePrefix}_r_{resourcePart}_{restorePart}";
        var storageNamespace =
            $"{controlPlaneOptions.StorageNamespacePrefix}/recovery/{current.ResourceId:N}/{restoreId:N}";

        if (databaseName.Length > 63)
        {
            throw new CloudRecoveryException(
                "restore_database_name_invalid",
                "The generated recovery database name exceeds PostgreSQL's identifier limit.");
        }

        if (storageNamespace.Length > 160)
        {
            throw new CloudRecoveryException(
                "restore_storage_namespace_invalid",
                "The generated recovery storage namespace exceeds the control-plane limit.");
        }

        return new CloudRecoveryStage(
            restoreId,
            current.ResourceId,
            databaseName,
            storageNamespace);
    }

    public async Task CreateStageAsync(
        CloudRecoveryStage stage,
        CancellationToken cancellationToken = default)
    {
        await CreateDatabaseAsync(stage.DatabaseName, cancellationToken);

        var options = new DbContextOptionsBuilder<PostgresNostosDbContext>()
            .UseNpgsql(customerConnections.ForDatabase(stage.DatabaseName))
            .Options;

        await using var db = new PostgresNostosDbContext(options);
        await db.Database.MigrateAsync(cancellationToken);

        if (!await db.LibraryStates.AnyAsync(cancellationToken))
        {
            db.LibraryStates.Add(new LibraryState
            {
                Id = LibraryState.WellKnownId,
                SingletonSlot = LibraryState.SingletonSentinel,
            });
            await db.SaveChangesAsync(cancellationToken);
        }

        var applied = (await db.Database.GetAppliedMigrationsAsync(cancellationToken))
            .ToList();

        if (applied.Count == 0
            || !string.Equals(
                applied[^1],
                CloudCustomerSchema.CurrentVersion,
                StringComparison.Ordinal))
        {
            throw new CloudRecoveryException(
                "restore_stage_schema_invalid",
                "The staged recovery database did not reach the current Cloud schema.");
        }
    }

    public PostgresNostosDbContext CreateDatabaseContext(
        CloudRecoveryStage stage)
    {
        var options = new DbContextOptionsBuilder<PostgresNostosDbContext>()
            .UseNpgsql(customerConnections.ForDatabase(stage.DatabaseName))
            .Options;

        return new PostgresNostosDbContext(options);
    }

    public IBookAssetStorage CreateAssetStorage(
        CloudRecoveryStage stage,
        NostosAccountId accountId)
    {
        var snapshot = new CloudAccountResourceSnapshot(
            accountId,
            stage.ResourceId,
            stage.DatabaseName,
            stage.StorageNamespace,
            CloudProvisioningState.Ready,
            CloudAccountStatus.Active,
            CloudCustomerSchema.CurrentVersion,
            FailureCode: null,
            CreatedAtUtc: DateTime.UtcNow,
            UpdatedAtUtc: DateTime.UtcNow,
            LastProvisionAttemptAtUtc: DateTime.UtcNow,
            ReadyAtUtc: DateTime.UtcNow);

        return new S3BookAssetStorage(
            s3,
            storageOptions,
            new FixedTenantContext(accountId),
            new FixedResourceStore(snapshot));
    }

    public async Task VerifyStageAsync(
        CloudRecoveryStage stage,
        NostosAccountId accountId,
        PortableImportResult import,
        CancellationToken cancellationToken = default)
    {
        await using var db = CreateDatabaseContext(stage);

        if (!await db.Database.CanConnectAsync(cancellationToken))
        {
            throw new CloudRecoveryException(
                "restore_verification_failed",
                "The staged recovery database is not reachable.");
        }

        var applied = (await db.Database.GetAppliedMigrationsAsync(cancellationToken))
            .ToList();
        if (applied.Count == 0
            || !string.Equals(
                applied[^1],
                CloudCustomerSchema.CurrentVersion,
                StringComparison.Ordinal))
        {
            throw new CloudRecoveryException(
                "restore_verification_failed",
                "The staged recovery database schema version is not current.");
        }

        var counts = new PortableArchiveCounts(
            Works: await db.Works.CountAsync(cancellationToken),
            Books: await db.Books.CountAsync(cancellationToken),
            Collections: await db.Collections.CountAsync(cancellationToken),
            BookCollections: await db.BookCollections.CountAsync(cancellationToken),
            Notes: await db.Notes.CountAsync(cancellationToken),
            Concepts: await db.Concepts.CountAsync(cancellationToken),
            NoteConcepts: await db.NoteConcepts.CountAsync(cancellationToken),
            Writings: await db.Writings.CountAsync(cancellationToken),
            BookAcquisitions: await db.BookAcquisitions.CountAsync(cancellationToken));

        if (counts != import.Counts)
        {
            throw new CloudRecoveryException(
                "restore_verification_failed",
                "The staged recovery database does not match the backup's relational counts.");
        }

        if (await db.LibraryStates.CountAsync(cancellationToken) != 1)
        {
            throw new CloudRecoveryException(
                "restore_verification_failed",
                "The staged recovery database does not contain exactly one library-state row.");
        }

        var assets = CreateAssetStorage(stage, accountId);
        var books = await db.Books
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        var verifiedMedia = 0;

        foreach (var book in books)
        {
            if (book.FileDetails.HasFile)
            {
                if (await assets.GetBookFileInfoAsync(
                    book.Id,
                    cancellationToken) is null)
                {
                    throw new CloudRecoveryException(
                        "restore_verification_failed",
                        $"The staged recovery is missing primary media for book '{book.Id}'.");
                }

                verifiedMedia++;
            }

            if (!string.IsNullOrWhiteSpace(book.FileDetails.CoverFileName))
            {
                if (await assets.GetBookCoverInfoAsync(
                    book.Id,
                    cancellationToken) is null)
                {
                    throw new CloudRecoveryException(
                        "restore_verification_failed",
                        $"The staged recovery is missing cover media for book '{book.Id}'.");
                }

                verifiedMedia++;
            }
        }

        if (verifiedMedia != import.MediaFiles)
        {
            throw new CloudRecoveryException(
                "restore_verification_failed",
                "The staged recovery media count does not match the verified portable archive.");
        }
    }

    public async Task CleanupStageAsync(
        CloudRecoveryStage stage)
    {
        await DeleteStoragePrefixBestEffortAsync(stage.StorageNamespace);
        await DropDatabaseBestEffortAsync(stage.DatabaseName);
    }

    private async Task CreateDatabaseAsync(
        string databaseName,
        CancellationToken cancellationToken)
    {
        await using var connection = new NpgsqlConnection(connections.Admin);
        await connection.OpenAsync(cancellationToken);

        var quotedDatabase = QuoteIdentifier(databaseName);
        var quotedRole = QuoteIdentifier(customerConnections.ApplicationRole);

        await using (var create = new NpgsqlCommand(
            $"CREATE DATABASE {quotedDatabase} OWNER {quotedRole}",
            connection))
        {
            await create.ExecuteNonQueryAsync(cancellationToken);
        }

        await using var harden = new NpgsqlCommand(
            $"REVOKE CONNECT ON DATABASE {quotedDatabase} FROM PUBLIC; " +
            $"GRANT CONNECT ON DATABASE {quotedDatabase} TO {quotedRole};",
            connection);
        await harden.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task DeleteStoragePrefixBestEffortAsync(
        string storageNamespace)
    {
        try
        {
            var prefix = storageNamespace.Trim('/') + "/";
            string? continuation = null;

            do
            {
                var response = await s3.ListObjectsV2Async(
                    new ListObjectsV2Request
                    {
                        BucketName = storageOptions.Bucket,
                        Prefix = prefix,
                        ContinuationToken = continuation,
                    },
                    CancellationToken.None);

                foreach (var item in response.S3Objects ?? [])
                {
                    await s3.DeleteObjectAsync(
                        new DeleteObjectRequest
                        {
                            BucketName = storageOptions.Bucket,
                            Key = item.Key,
                        },
                        CancellationToken.None);
                }

                continuation = response.IsTruncated == true
                    ? response.NextContinuationToken
                    : null;
            }
            while (continuation is not null);
        }
        catch (Exception exception)
        {
            logger.LogWarning(
                exception,
                "Could not completely remove failed recovery storage stage {StorageNamespace}.",
                storageNamespace);
        }
    }

    private async Task DropDatabaseBestEffortAsync(
        string databaseName)
    {
        try
        {
            await using var connection = new NpgsqlConnection(connections.Admin);
            await connection.OpenAsync(CancellationToken.None);

            await using (var terminate = new NpgsqlCommand(
                "SELECT pg_terminate_backend(pid) " +
                "FROM pg_stat_activity " +
                "WHERE datname = @databaseName AND pid <> pg_backend_pid();",
                connection))
            {
                terminate.Parameters.AddWithValue("databaseName", databaseName);
                await terminate.ExecuteNonQueryAsync(CancellationToken.None);
            }

            await using var drop = new NpgsqlCommand(
                $"DROP DATABASE IF EXISTS {QuoteIdentifier(databaseName)}",
                connection);
            await drop.ExecuteNonQueryAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            logger.LogWarning(
                exception,
                "Could not remove failed recovery database stage {DatabaseName}.",
                databaseName);
        }
    }

    private static string QuoteIdentifier(string identifier) =>
        "\"" + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";

    private sealed class FixedTenantContext(NostosAccountId accountId)
        : ICloudTenantContextAccessor
    {
        public NostosAccountContext GetRequired() =>
            new(accountId, "Nostos Cloud recovery", Email: null);
    }

    private sealed class FixedResourceStore(
        CloudAccountResourceSnapshot resource)
        : ICloudControlPlaneStore
    {
        public Task<CloudAccountResourceSnapshot?> FindAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<CloudAccountResourceSnapshot?>(
                accountId == resource.AccountId ? resource : null);

        public Task<CloudAccountResourceSnapshot> GetOrCreateAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            accountId == resource.AccountId
                ? Task.FromResult(resource)
                : Task.FromException<CloudAccountResourceSnapshot>(
                    new InvalidOperationException("Recovery tenant mismatch."));

        public Task MarkProvisioningAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            Unsupported();

        public Task MarkReadyAsync(
            NostosAccountId accountId,
            string schemaVersion,
            CancellationToken cancellationToken = default) =>
            Unsupported();

        public Task MarkFailedAsync(
            NostosAccountId accountId,
            string failureCode,
            CancellationToken cancellationToken = default) =>
            Unsupported();

        public Task MarkSchemaVersionAsync(
            NostosAccountId accountId,
            string schemaVersion,
            CancellationToken cancellationToken = default) =>
            Unsupported();

        public Task MarkSchemaFailureAsync(
            NostosAccountId accountId,
            string failureCode,
            CancellationToken cancellationToken = default) =>
            Unsupported();

        public Task<IReadOnlyList<CloudAccountResourceSnapshot>> ListAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<CloudAccountResourceSnapshot>>(
                [resource]);

        private static Task Unsupported() =>
            Task.FromException(
                new NotSupportedException(
                    "The fixed recovery resource mapping is read-only."));
    }
}
