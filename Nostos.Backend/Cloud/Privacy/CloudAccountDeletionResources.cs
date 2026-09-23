using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Storage;
using Nostos.Backend.Configuration;
using Nostos.Backend.Data;
using Nostos.Backend.Security;
using Nostos.Backend.Services;
using Nostos.Backend.Services.Portability;

namespace Nostos.Backend.Cloud.Privacy;

public sealed class CloudAccountDeletionResourceDestroyer(
    CloudDatabaseConnections connections,
    CloudControlPlaneOptions controlPlaneOptions,
    IAmazonS3 s3,
    CloudObjectStorageOptions storageOptions,
    ILogger<CloudAccountDeletionResourceDestroyer> logger)
    : ICloudAccountDeletionResourceDestroyer
{
    public async Task DestroyAsync(
        CloudAccountResourceSnapshot resource,
        CancellationToken cancellationToken = default)
    {
        ValidateResource(resource);

        // Delete all known customer media/recovery generations before the
        // control-plane tombstone is committed. Every operation is idempotent.
        var initialStorage =
            controlPlaneOptions.StorageNamespace(resource.ResourceId).Trim('/');
        var recoveryStorage =
            $"{controlPlaneOptions.StorageNamespacePrefix.Trim('/')}/recovery/{resource.ResourceId:N}";
        var recoveryArtifacts =
            $"__nostos_recovery/{resource.ResourceId:N}";

        await DeleteAllVersionsUnderPrefixAsync(
            initialStorage + "/",
            cancellationToken);
        await DeleteAllVersionsUnderPrefixAsync(
            recoveryStorage + "/",
            cancellationToken);
        await DeleteAllVersionsUnderPrefixAsync(
            recoveryArtifacts + "/",
            cancellationToken);

        await DropAllResourceDatabasesAsync(resource, cancellationToken);

        logger.LogInformation(
            "Destroyed Cloud customer resources for account {AccountId}, resource {ResourceId}.",
            resource.AccountId,
            resource.ResourceId);
    }

    private void ValidateResource(CloudAccountResourceSnapshot resource)
    {
        var initialDatabase = controlPlaneOptions.DatabaseName(resource.ResourceId);
        var recoveryDatabasePrefix =
            $"{controlPlaneOptions.CustomerDatabasePrefix}_r_{resource.ResourceId.ToString("N")[..12]}_";

        if (!string.Equals(resource.DatabaseName, initialDatabase, StringComparison.Ordinal)
            && !resource.DatabaseName.StartsWith(
                recoveryDatabasePrefix,
                StringComparison.Ordinal))
        {
            throw new CloudAccountDeletionException(
                "deletion_resource_mapping_invalid",
                "The account database mapping does not match its trusted resource identifier.");
        }

        var initialStorage =
            controlPlaneOptions.StorageNamespace(resource.ResourceId).Trim('/');
        var recoveryStoragePrefix =
            $"{controlPlaneOptions.StorageNamespacePrefix.Trim('/')}/recovery/{resource.ResourceId:N}/";

        var currentStorage = resource.StorageNamespace.Trim('/');
        if (!string.Equals(currentStorage, initialStorage, StringComparison.Ordinal)
            && !currentStorage.StartsWith(
                recoveryStoragePrefix,
                StringComparison.Ordinal))
        {
            throw new CloudAccountDeletionException(
                "deletion_resource_mapping_invalid",
                "The account storage mapping does not match its trusted resource identifier.");
        }
    }

    private async Task DropAllResourceDatabasesAsync(
        CloudAccountResourceSnapshot resource,
        CancellationToken cancellationToken)
    {
        var initialDatabase = controlPlaneOptions.DatabaseName(resource.ResourceId);
        var recoveryPrefix =
            $"{controlPlaneOptions.CustomerDatabasePrefix}_r_{resource.ResourceId.ToString("N")[..12]}_";

        await using var connection = new NpgsqlConnection(connections.Admin);
        await connection.OpenAsync(cancellationToken);

        var databases = new List<string>();
        await using (var list = connection.CreateCommand())
        {
            list.CommandText = "SELECT datname FROM pg_database;";
            await using var reader = await list.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var name = reader.GetString(0);
                if (string.Equals(name, initialDatabase, StringComparison.Ordinal)
                    || name.StartsWith(recoveryPrefix, StringComparison.Ordinal))
                {
                    databases.Add(name);
                }
            }
        }

        foreach (var databaseName in databases.Distinct(StringComparer.Ordinal))
        {
            await using (var terminate = connection.CreateCommand())
            {
                terminate.CommandText =
                    "SELECT pg_terminate_backend(pid) " +
                    "FROM pg_stat_activity " +
                    "WHERE datname = @databaseName AND pid <> pg_backend_pid();";
                terminate.Parameters.AddWithValue("databaseName", databaseName);
                await terminate.ExecuteNonQueryAsync(cancellationToken);
            }

            await using var drop = connection.CreateCommand();
            drop.CommandText =
                $"DROP DATABASE IF EXISTS {QuoteIdentifier(databaseName)};";
            await drop.ExecuteNonQueryAsync(cancellationToken);
        }
    }

    private async Task DeleteAllVersionsUnderPrefixAsync(
        string prefix,
        CancellationToken cancellationToken)
    {
        string? keyMarker = null;
        string? versionMarker = null;

        do
        {
            var response = await s3.ListVersionsAsync(
                new ListVersionsRequest
                {
                    BucketName = storageOptions.Bucket,
                    Prefix = prefix,
                    KeyMarker = keyMarker,
                    VersionIdMarker = versionMarker,
                },
                cancellationToken);

            foreach (var version in response.Versions ?? [])
            {
                if (string.IsNullOrWhiteSpace(version.Key))
                    continue;

                await s3.DeleteObjectAsync(
                    new DeleteObjectRequest
                    {
                        BucketName = storageOptions.Bucket,
                        Key = version.Key,
                        VersionId = version.VersionId,
                    },
                    cancellationToken);
            }

            if (response.IsTruncated == true)
            {
                keyMarker = response.NextKeyMarker;
                versionMarker = response.NextVersionIdMarker;
            }
            else
            {
                keyMarker = null;
                versionMarker = null;
            }
        }
        while (keyMarker is not null);

        // Verify destructive cleanup instead of assuming provider success.
        var verification = await s3.ListVersionsAsync(
            new ListVersionsRequest
            {
                BucketName = storageOptions.Bucket,
                Prefix = prefix,
                MaxKeys = 1,
            },
            cancellationToken);

        if ((verification.Versions?.Count ?? 0) != 0)
        {
            throw new CloudAccountDeletionException(
                "storage_destruction_incomplete",
                "Customer object versions remain after destructive cleanup.");
        }
    }

    private static string QuoteIdentifier(string identifier) =>
        "\"" + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
}

public sealed class CloudAccountDeletionPortableExporter(
    ICloudCustomerConnectionFactory customerConnections,
    IAmazonS3 s3,
    CloudObjectStorageOptions storageOptions,
    ILoggerFactory loggerFactory)
    : ICloudAccountDeletionPortableExporter
{
    public async Task ExportAsync(
        CloudAccountResourceSnapshot resource,
        Stream destination,
        CancellationToken cancellationToken = default)
    {
        if (resource.AccountStatus != CloudAccountStatus.DeletionRequested
            || resource.ProvisioningState != CloudProvisioningState.Ready
            || !CloudCustomerSchema.IsApplicationCompatible(resource.SchemaVersion))
        {
            throw new CloudAccountDeletionException(
                "portable_export_unavailable",
                "The deleting account no longer has recoverable data available for export.");
        }

        var options = new DbContextOptionsBuilder<NostosDbContext>()
            .UseNpgsql(customerConnections.ForDatabase(resource.DatabaseName))
            .Options;

        await using var db = new NostosDbContext(options);

        // S3BookAssetStorage normally requires an Active mapping. For this
        // narrowly-scoped export adapter we provide an immutable internal view
        // of the same trusted resource as Active; no browser-supplied resource
        // selector is involved and no write endpoint is exposed.
        var readableResource = resource with
        {
            AccountStatus = CloudAccountStatus.Active,
        };

        var assets = new S3BookAssetStorage(
            s3,
            storageOptions,
            new FixedTenantContext(resource.AccountId),
            new FixedResourceStore(readableResource));

        var portability = new PortableArchiveService(
            db,
            assets,
            loggerFactory.CreateLogger<PortableArchiveService>());

        await portability.ExportAsync(destination, cancellationToken);
    }

    private sealed class FixedTenantContext(NostosAccountId accountId)
        : ICloudTenantContextAccessor
    {
        public NostosAccountContext GetRequired() =>
            new(accountId, "Nostos deletion export", Email: null);
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
                    new InvalidOperationException("Deletion export tenant mismatch."));

        public Task MarkProvisioningAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) => Unsupported();

        public Task MarkReadyAsync(
            NostosAccountId accountId,
            string schemaVersion,
            CancellationToken cancellationToken = default) => Unsupported();

        public Task MarkFailedAsync(
            NostosAccountId accountId,
            string failureCode,
            CancellationToken cancellationToken = default) => Unsupported();

        public Task MarkSchemaVersionAsync(
            NostosAccountId accountId,
            string schemaVersion,
            CancellationToken cancellationToken = default) => Unsupported();

        public Task MarkSchemaFailureAsync(
            NostosAccountId accountId,
            string failureCode,
            CancellationToken cancellationToken = default) => Unsupported();

        public Task<IReadOnlyList<CloudAccountResourceSnapshot>> ListAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<CloudAccountResourceSnapshot>>([resource]);

        private static Task Unsupported() =>
            Task.FromException(
                new NotSupportedException(
                    "The deletion-export resource mapping is read-only."));
    }
}
