using System.Security.Cryptography;
using System.Text;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Nostos.Backend.Cloud;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Migrations;
using Nostos.Backend.Cloud.Recovery;
using Nostos.Backend.Cloud.Storage;
using Nostos.Backend.Configuration;
using Nostos.Backend.Security;
using Nostos.Backend.Services.Portability;
using Nostos.Backend.Tests.Portability;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

public sealed class CloudRecoveryIntegrationTests
{
    private const string PostgresEnvironmentVariable =
        "NOSTOS_POSTGRES_SPIKE_CONNECTION";

    [Fact]
    [Trait("Category", "CloudRecovery")]
    public async Task Backup_restore_is_tenant_scoped_staged_verified_and_preserves_previous_resources()
    {
        var postgresRoot =
            Environment.GetEnvironmentVariable(PostgresEnvironmentVariable);
        var endpoint =
            Environment.GetEnvironmentVariable("NOSTOS_S3_TEST_ENDPOINT");

        if (string.IsNullOrWhiteSpace(postgresRoot)
            || string.IsNullOrWhiteSpace(endpoint))
        {
            return;
        }

        var accessKey =
            Environment.GetEnvironmentVariable("NOSTOS_S3_TEST_ACCESS_KEY");
        var secretKey =
            Environment.GetEnvironmentVariable("NOSTOS_S3_TEST_SECRET_KEY");

        if (string.IsNullOrWhiteSpace(accessKey)
            || string.IsNullOrWhiteSpace(secretKey))
        {
            throw new InvalidOperationException(
                "Cloud recovery integration infrastructure is only partially configured.");
        }

        var suffix = Guid.NewGuid().ToString("N")[..10];
        var controlDatabase = $"nostos_rec_cp_{suffix}";
        var customerDatabase = $"nostos_rec_a_{suffix}";
        var bucket = $"nostos-recovery-{Guid.NewGuid():N}";

        var accountA = NostosAccountId.FromExternalIdentity(
            "https://identity.example.test",
            $"recovery-a-{suffix}");
        var accountB = NostosAccountId.FromExternalIdentity(
            "https://identity.example.test",
            $"recovery-b-{suffix}");
        var resourceA = Guid.NewGuid();
        var resourceB = Guid.NewGuid();

        var controlOptions = new CloudControlPlaneOptions
        {
            CustomerDatabasePrefix = "nostos_rec",
            StorageNamespacePrefix = "accounts",
        };

        var controlConnection = ForDatabase(postgresRoot, controlDatabase);
        var connections = new CloudDatabaseConnections(
            ControlPlane: controlConnection,
            Admin: postgresRoot,
            CustomerBase: postgresRoot);
        var customerConnections = new CloudCustomerConnectionFactory(connections);

        var controlDbOptions =
            new DbContextOptionsBuilder<CloudControlPlaneDbContext>()
                .UseNpgsql(controlConnection)
                .Options;
        var controlFactory = new TestControlPlaneFactory(controlDbOptions);

        var objectOptions = new CloudObjectStorageOptions
        {
            Bucket = bucket,
            Region = "us-east-1",
            ServiceUrl = endpoint,
            ForcePathStyle = true,
        };

        using var s3 = new AmazonS3Client(
            new BasicAWSCredentials(accessKey, secretKey),
            new AmazonS3Config
            {
                ServiceURL = endpoint,
                ForcePathStyle = true,
                AuthenticationRegion = "us-east-1",
            });

        string? restoredDatabase = null;

        await CreateDatabaseAsync(postgresRoot, controlDatabase);
        await CreateDatabaseAsync(postgresRoot, customerDatabase);
        await s3.PutBucketAsync(new PutBucketRequest { BucketName = bucket });

        try
        {
            await SeedControlPlaneAsync(
                controlFactory,
                accountA,
                resourceA,
                customerDatabase,
                $"accounts/{resourceA:N}",
                accountB,
                resourceB,
                $"nostos_rec_b_{suffix}",
                $"accounts/{resourceB:N}");

            var controlPlane =
                new CloudControlPlaneStore(controlFactory, controlOptions);

            var originalMapping = await controlPlane.FindAsync(accountA);
            originalMapping.Should().NotBeNull();

            var customerOptions =
                new DbContextOptionsBuilder<PostgresNostosDbContext>()
                    .UseNpgsql(customerConnections.ForDatabase(customerDatabase))
                    .Options;

            await using var cloudDb = new PostgresNostosDbContext(customerOptions);
            await cloudDb.Database.MigrateAsync();

            var tenantA = new FixedTenantContext(accountA);
            var cloudStorage = new S3BookAssetStorage(
                s3,
                objectOptions,
                tenantA,
                controlPlane);

            await using var source = await LocalPortableTestLibrary.CreateAsync();
            var ids = await PortableArchiveTestSupport.PopulateRepresentativeAsync(
                source.Db,
                source.Storage);

            using (var sourceArchive = new MemoryStream())
            {
                await source.Portability().ExportAsync(sourceArchive);
                sourceArchive.Position = 0;

                var import = await new PortableArchiveService(
                    cloudDb,
                    cloudStorage,
                    NullLogger<PortableArchiveService>.Instance)
                    .ImportAsync(sourceArchive);

                import.IntegrityVerified.Should().BeTrue();
                import.Counts.Books.Should().Be(4);
                import.MediaFiles.Should().Be(5);
            }

            var recoveryStore = new S3CloudRecoveryStore(
                s3,
                objectOptions,
                NullLogger<S3CloudRecoveryStore>.Instance);
            var recoveryControlPlane =
                new CloudRecoveryControlPlane(controlFactory);
            var resourceManager = new CloudRecoveryResourceManager(
                connections,
                controlOptions,
                customerConnections,
                s3,
                objectOptions,
                NullLogger<CloudRecoveryResourceManager>.Instance);
            var livePortability = new PortableArchiveService(
                cloudDb,
                cloudStorage,
                NullLogger<PortableArchiveService>.Instance);
            var recovery = new CloudRecoveryService(
                tenantA,
                controlPlane,
                livePortability,
                recoveryStore,
                recoveryControlPlane,
                resourceManager,
                NullLoggerFactory.Instance,
                NullLogger<CloudRecoveryService>.Instance);

            var backup = await recovery.CreateBackupAsync();
            backup.Counts.Books.Should().Be(4);
            backup.Counts.BookCollections.Should().Be(3);
            backup.Counts.NoteConcepts.Should().Be(1);
            backup.MediaFiles.Should().Be(5);

            var listed = await recovery.ListBackupsAsync();
            listed.Should().ContainSingle(x => x.BackupId == backup.BackupId);

            var tenantBArchivePath = Path.Combine(
                Path.GetTempPath(),
                $"nostos-recovery-tenant-b-{Guid.NewGuid():N}.nostos");
            try
            {
                PortableExportResult tenantBExport;
                await using (var tenantBOutput = new FileStream(
                    tenantBArchivePath,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None))
                {
                    tenantBExport = await source.Portability().ExportAsync(tenantBOutput);
                }

                var tenantBBackupId = Guid.NewGuid();
                var tenantBManifest = new CloudOperationalBackupManifest(
                    CloudOperationalBackupManifest.CurrentFormat,
                    CloudOperationalBackupManifest.CurrentVersion,
                    tenantBBackupId,
                    accountB.Value,
                    resourceB,
                    DateTime.UtcNow,
                    CloudCustomerSchema.CurrentVersion,
                    tenantBExport.FormatVersion,
                    tenantBExport.Counts,
                    tenantBExport.MediaFiles,
                    tenantBExport.MediaBytes,
                    new FileInfo(tenantBArchivePath).Length,
                    await Sha256Async(tenantBArchivePath));

                await recoveryStore.SaveBackupAsync(
                    resourceB,
                    tenantBManifest,
                    tenantBArchivePath);

                (await recovery.ListBackupsAsync())
                    .Should().NotContain(x => x.BackupId == tenantBBackupId);

                var crossTenantRestore = () =>
                    recovery.RestoreAsync(tenantBBackupId, confirmed: true);
                var crossTenantException =
                    await crossTenantRestore.Should()
                        .ThrowAsync<CloudRecoveryException>();
                crossTenantException.Which.Code.Should().Be("backup_not_found");
            }
            finally
            {
                TryDelete(tenantBArchivePath);
            }

            var writing = await cloudDb.Writings
                .SingleAsync(x => x.Id == ids.WritingDocumentId);
            cloudDb.Writings.Remove(writing);
            await cloudDb.SaveChangesAsync();
            (await cloudDb.Writings.CountAsync()).Should().Be(1);

            var restore = await recovery.RestoreAsync(
                backup.BackupId,
                confirmed: true);

            restore.IntegrityVerified.Should().BeTrue();
            restore.Counts.Should().Be(backup.Counts);
            restore.MediaFiles.Should().Be(backup.MediaFiles);

            var rebound = await controlPlane.FindAsync(accountA);
            rebound.Should().NotBeNull();
            rebound!.ResourceId.Should().Be(resourceA);
            rebound.DatabaseName.Should().NotBe(customerDatabase);
            rebound.StorageNamespace.Should().NotBe(originalMapping!.StorageNamespace);
            restoredDatabase = rebound.DatabaseName;

            await using (var restoredDb = new PostgresNostosDbContext(
                new DbContextOptionsBuilder<PostgresNostosDbContext>()
                    .UseNpgsql(customerConnections.ForDatabase(rebound.DatabaseName))
                    .Options))
            {
                (await restoredDb.Books.CountAsync()).Should().Be(4);
                (await restoredDb.Writings.CountAsync()).Should().Be(2);
                (await restoredDb.BookCollections.CountAsync()).Should().Be(3);
                (await restoredDb.NoteConcepts.CountAsync()).Should().Be(1);
                (await restoredDb.Books.AnyAsync(x => x.Id == ids.EpubBookId))
                    .Should().BeTrue();
                (await restoredDb.Notes.AnyAsync(x => x.Id == ids.NoteId))
                    .Should().BeTrue();

                var restoredStorage = new S3BookAssetStorage(
                    s3,
                    objectOptions,
                    tenantA,
                    controlPlane);

                (await PortableArchiveTestSupport.ReadBookAsync(
                    restoredStorage,
                    ids.AudioBookId))
                    .Should().Equal(
                        Encoding.UTF8.GetBytes("AUDIO-CONTENT-PORTABLE"));

                using var customerOwnedExport = new MemoryStream();
                var customerExport = await new PortableArchiveService(
                    restoredDb,
                    restoredStorage,
                    NullLogger<PortableArchiveService>.Instance)
                    .ExportAsync(customerOwnedExport);

                await using var independent =
                    await LocalPortableTestLibrary.CreateAsync();
                customerOwnedExport.Position = 0;
                var independentImport =
                    await independent.Portability().ImportAsync(customerOwnedExport);

                independentImport.IntegrityVerified.Should().BeTrue();
                independentImport.Counts.Should().Be(customerExport.Counts);
                (await independent.Db.Books.AnyAsync(x => x.Id == ids.EpubBookId))
                    .Should().BeTrue();
            }

            // Successful restore deliberately leaves the former database and
            // media namespace intact. Cleanup happens later, never inside the
            // critical switch that establishes the new known-good copy.
            await using (var oldDb = new PostgresNostosDbContext(customerOptions))
            {
                (await oldDb.Writings.CountAsync()).Should().Be(1);
            }

            var oldObjects = await s3.ListObjectsV2Async(
                new ListObjectsV2Request
                {
                    BucketName = bucket,
                    Prefix = originalMapping.StorageNamespace.Trim('/') + "/",
                });
            (oldObjects.S3Objects?.Count ?? 0).Should().BeGreaterThan(0);

            var archiveKey = await FindArchiveKeyAsync(
                s3,
                bucket,
                resourceA,
                backup.BackupId);
            await using (var corrupt = new MemoryStream(
                Encoding.UTF8.GetBytes("corrupt-operational-backup")))
            {
                await s3.PutObjectAsync(
                    new PutObjectRequest
                    {
                        BucketName = bucket,
                        Key = archiveKey,
                        InputStream = corrupt,
                        AutoCloseStream = false,
                        ContentType = "application/vnd.nostos.portable+zip",
                    });
            }

            var mappingBeforeFailedRestore = await controlPlane.FindAsync(accountA);
            var failedRestore = () =>
                recovery.RestoreAsync(backup.BackupId, confirmed: true);
            var failure =
                await failedRestore.Should().ThrowAsync<CloudRecoveryException>();

            failure.Which.Code.Should().Be("backup_integrity_failed");

            var mappingAfterFailedRestore = await controlPlane.FindAsync(accountA);
            mappingAfterFailedRestore!.DatabaseName
                .Should().Be(mappingBeforeFailedRestore!.DatabaseName);
            mappingAfterFailedRestore.StorageNamespace
                .Should().Be(mappingBeforeFailedRestore.StorageNamespace);

            await using var stillLive = new PostgresNostosDbContext(
                new DbContextOptionsBuilder<PostgresNostosDbContext>()
                    .UseNpgsql(
                        customerConnections.ForDatabase(
                            mappingAfterFailedRestore.DatabaseName))
                    .Options);
            (await stillLive.Books.CountAsync()).Should().Be(4);
            (await stillLive.Writings.CountAsync()).Should().Be(2);
        }
        finally
        {
            await DeleteAllObjectsAsync(s3, bucket);
            await s3.DeleteBucketAsync(
                new DeleteBucketRequest { BucketName = bucket });

            if (!string.IsNullOrWhiteSpace(restoredDatabase))
                await DropDatabaseIfExistsAsync(postgresRoot, restoredDatabase);

            await DropDatabaseIfExistsAsync(postgresRoot, customerDatabase);
            await DropDatabaseIfExistsAsync(postgresRoot, controlDatabase);

            await DropRecoveryDatabasesAsync(
                postgresRoot,
                "nostos_rec_r_");
        }
    }

    private static async Task SeedControlPlaneAsync(
        IDbContextFactory<CloudControlPlaneDbContext> factory,
        NostosAccountId accountA,
        Guid resourceA,
        string databaseA,
        string storageA,
        NostosAccountId accountB,
        Guid resourceB,
        string databaseB,
        string storageB)
    {
        await using var db = await factory.CreateDbContextAsync();
        await db.Database.EnsureCreatedAsync();

        var now = DateTime.UtcNow;
        db.AccountResources.AddRange(
            new CloudAccountResource
            {
                AccountId = accountA.Value,
                ResourceId = resourceA,
                DatabaseName = databaseA,
                StorageNamespace = storageA,
                ProvisioningState = CloudProvisioningState.Ready,
                AccountStatus = CloudAccountStatus.Active,
                SchemaVersion = CloudCustomerSchema.CurrentVersion,
                CreatedAtUtc = now,
                UpdatedAtUtc = now,
                ReadyAtUtc = now,
            },
            new CloudAccountResource
            {
                AccountId = accountB.Value,
                ResourceId = resourceB,
                DatabaseName = databaseB,
                StorageNamespace = storageB,
                ProvisioningState = CloudProvisioningState.Ready,
                AccountStatus = CloudAccountStatus.Active,
                SchemaVersion = CloudCustomerSchema.CurrentVersion,
                CreatedAtUtc = now,
                UpdatedAtUtc = now,
                ReadyAtUtc = now,
            });

        await db.SaveChangesAsync();
    }

    private static async Task<string> FindArchiveKeyAsync(
        IAmazonS3 s3,
        string bucket,
        Guid resourceId,
        Guid backupId)
    {
        var prefix =
            $"__nostos_recovery/{resourceId:N}/backups/{backupId:N}/";
        var objects = await s3.ListObjectsV2Async(
            new ListObjectsV2Request
            {
                BucketName = bucket,
                Prefix = prefix,
            });

        return (objects.S3Objects ?? [])
            .Select(x => x.Key)
            .Single(x => x.EndsWith("/library.nostos", StringComparison.Ordinal));
    }

    private static async Task<string> Sha256Async(string path)
    {
        await using var input = File.OpenRead(path);
        using var sha = SHA256.Create();
        var hash = await sha.ComputeHashAsync(input);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string ForDatabase(string root, string databaseName)
    {
        var builder = new NpgsqlConnectionStringBuilder(root)
        {
            Database = databaseName,
        };
        return builder.ConnectionString;
    }

    private static async Task CreateDatabaseAsync(
        string root,
        string databaseName)
    {
        await using var connection = new NpgsqlConnection(root);
        await connection.OpenAsync();

        await using var command = connection.CreateCommand();
        command.CommandText =
            $"CREATE DATABASE {QuoteIdentifier(databaseName)}";
        await command.ExecuteNonQueryAsync();
    }

    private static async Task DropRecoveryDatabasesAsync(
        string root,
        string prefix)
    {
        var names = new List<string>();

        await using (var connection = new NpgsqlConnection(root))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText =
                "SELECT datname FROM pg_database WHERE datname LIKE @prefix";
            command.Parameters.AddWithValue("prefix", prefix + "%");

            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                names.Add(reader.GetString(0));
        }

        foreach (var name in names)
            await DropDatabaseIfExistsAsync(root, name);
    }

    private static async Task DropDatabaseIfExistsAsync(
        string root,
        string databaseName)
    {
        await using var connection = new NpgsqlConnection(root);
        await connection.OpenAsync();

        await using (var terminate = connection.CreateCommand())
        {
            terminate.CommandText =
                "SELECT pg_terminate_backend(pid) " +
                "FROM pg_stat_activity " +
                "WHERE datname = @database AND pid <> pg_backend_pid();";
            terminate.Parameters.AddWithValue("database", databaseName);
            await terminate.ExecuteNonQueryAsync();
        }

        await using var drop = connection.CreateCommand();
        drop.CommandText =
            $"DROP DATABASE IF EXISTS {QuoteIdentifier(databaseName)}";
        await drop.ExecuteNonQueryAsync();
    }

    private static async Task DeleteAllObjectsAsync(
        IAmazonS3 s3,
        string bucket)
    {
        string? continuation = null;
        do
        {
            var response = await s3.ListObjectsV2Async(
                new ListObjectsV2Request
                {
                    BucketName = bucket,
                    ContinuationToken = continuation,
                });

            foreach (var item in response.S3Objects ?? [])
            {
                await s3.DeleteObjectAsync(
                    new DeleteObjectRequest
                    {
                        BucketName = bucket,
                        Key = item.Key,
                    });
            }

            continuation = response.IsTruncated == true
                ? response.NextContinuationToken
                : null;
        }
        while (continuation is not null);
    }

    private static string QuoteIdentifier(string identifier) =>
        "\"" + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
                File.Delete(path);
        }
        catch
        {
            // Test cleanup only.
        }
    }

    private sealed class FixedTenantContext(NostosAccountId accountId)
        : ICloudTenantContextAccessor
    {
        public NostosAccountContext GetRequired() =>
            new(accountId, "Recovery integration test", Email: null);
    }

    private sealed class TestControlPlaneFactory(
        DbContextOptions<CloudControlPlaneDbContext> options)
        : IDbContextFactory<CloudControlPlaneDbContext>
    {
        public CloudControlPlaneDbContext CreateDbContext() =>
            new(options);

        public ValueTask<CloudControlPlaneDbContext> CreateDbContextAsync(
            CancellationToken cancellationToken = default) =>
            ValueTask.FromResult(new CloudControlPlaneDbContext(options));
    }
}
