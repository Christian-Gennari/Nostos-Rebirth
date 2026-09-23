using System.Security.Cryptography;
using System.Text;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Nostos.Backend.Cloud;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Migrations;
using Nostos.Backend.Cloud.Recovery;
using Nostos.Backend.Cloud.Storage;
using Nostos.Backend.Configuration;
using Nostos.Backend.Security;
using Nostos.Backend.Services;
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

    [Fact]
    [Trait("Category", "CloudRecoveryIntegrationTests")]
    public async Task Multi_tenant_sweep_creates_operational_backups_for_all_eligible_accounts()
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
        var controlDatabase = $"nostos_sweep_{suffix}";
        var customerDatabaseA = $"nostos_sweep_a_{suffix}";
        var customerDatabaseB = $"nostos_sweep_b_{suffix}";
        var bucket = $"nostos-sweep-{Guid.NewGuid():N}";

        var accountA = NostosAccountId.FromExternalIdentity(
            "https://identity.example.test",
            $"sweep-a-{suffix}");
        var accountB = NostosAccountId.FromExternalIdentity(
            "https://identity.example.test",
            $"sweep-b-{suffix}");
        var resourceA = Guid.NewGuid();
        var resourceB = Guid.NewGuid();

        var controlOptions = new CloudControlPlaneOptions
        {
            CustomerDatabasePrefix = "nostos_sweep",
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

        await CreateDatabaseAsync(postgresRoot, controlDatabase);
        await CreateDatabaseAsync(postgresRoot, customerDatabaseA);
        await CreateDatabaseAsync(postgresRoot, customerDatabaseB);
        await s3.PutBucketAsync(new PutBucketRequest { BucketName = bucket });

        try
        {
            await SeedControlPlaneAsync(
                controlFactory,
                accountA,
                resourceA,
                customerDatabaseA,
                $"accounts/{resourceA:N}",
                accountB,
                resourceB,
                customerDatabaseB,
                $"accounts/{resourceB:N}");

            var controlPlane =
                new CloudControlPlaneStore(controlFactory, controlOptions);

            await using var sourceLibrary =
                await LocalPortableTestLibrary.CreateAsync();
            var sourceIds = await PortableArchiveTestSupport.PopulateRepresentativeAsync(
                sourceLibrary.Db,
                sourceLibrary.Storage);

            var tenantAOptions =
                new DbContextOptionsBuilder<PostgresNostosDbContext>()
                    .UseNpgsql(customerConnections.ForDatabase(customerDatabaseA))
                    .Options;
            await using var tenantADb = new PostgresNostosDbContext(tenantAOptions);
            await tenantADb.Database.MigrateAsync();

            var tenantBOptions =
                new DbContextOptionsBuilder<PostgresNostosDbContext>()
                    .UseNpgsql(customerConnections.ForDatabase(customerDatabaseB))
                    .Options;
            await using var tenantBDb = new PostgresNostosDbContext(tenantBOptions);
            await tenantBDb.Database.MigrateAsync();

            var tenantAContext = new FixedTenantContext(accountA);
            var tenantAStorage = new S3BookAssetStorage(
                s3,
                objectOptions,
                tenantAContext,
                controlPlane);

            var tenantBContext = new FixedTenantContext(accountB);
            var tenantBStorage = new S3BookAssetStorage(
                s3,
                objectOptions,
                tenantBContext,
                controlPlane);

            using (var archive = new MemoryStream())
            {
                await sourceLibrary.Portability().ExportAsync(archive);
                archive.Position = 0;

                await new PortableArchiveService(
                    tenantADb,
                    tenantAStorage,
                    NullLogger<PortableArchiveService>.Instance)
                    .ImportAsync(archive);
            }

            using (var archive = new MemoryStream())
            {
                await sourceLibrary.Portability().ExportAsync(archive);
                archive.Position = 0;

                await new PortableArchiveService(
                    tenantBDb,
                    tenantBStorage,
                    NullLogger<PortableArchiveService>.Instance)
                    .ImportAsync(archive);
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

            var services = new ServiceCollection();
            services.AddSingleton(controlPlane);
            services.AddSingleton<ICloudControlPlaneStore>(controlPlane);
            services.AddSingleton(recoveryStore);
            services.AddSingleton<ICloudRecoveryStore>(recoveryStore);
            services.AddSingleton(recoveryControlPlane);
            services.AddSingleton<ICloudRecoveryControlPlane>(recoveryControlPlane);
            services.AddSingleton(resourceManager);
            services.AddSingleton(objectOptions);
            services.AddLogging();
            services.AddScoped<CloudTenantContextScope>();
            services.AddScoped<ICloudRecoveryService, CloudRecoveryService>(sp =>
            {
                var scope = sp.GetRequiredService<CloudTenantContextScope>();
                var tenantAccessor = new DirectCloudTenantContextAccessor(scope);
                var portability = new PortableArchiveService(
                    sp.GetRequiredService<PostgresNostosDbContext>(),
                    sp.GetRequiredService<IBookAssetStorage>(),
                    sp.GetRequiredService<ILogger<PortableArchiveService>>());

                return new CloudRecoveryService(
                    tenantAccessor,
                    sp.GetRequiredService<ICloudControlPlaneStore>(),
                    portability,
                    sp.GetRequiredService<ICloudRecoveryStore>(),
                    sp.GetRequiredService<ICloudRecoveryControlPlane>(),
                    sp.GetRequiredService<CloudRecoveryResourceManager>(),
                    sp.GetRequiredService<ILoggerFactory>(),
                    sp.GetRequiredService<ILogger<CloudRecoveryService>>());
            });

            services.AddScoped(sp =>
            {
                var scope = sp.GetRequiredService<CloudTenantContextScope>();
                var context = scope.Current;
                if (context == null)
                    throw new InvalidOperationException("No tenant context set");

                var mapping = controlPlane.FindAsync(context.AccountId).GetAwaiter().GetResult();
                if (mapping == null)
                    throw new InvalidOperationException("No mapping found");

                return new PostgresNostosDbContext(
                    new DbContextOptionsBuilder<PostgresNostosDbContext>()
                        .UseNpgsql(customerConnections.ForDatabase(mapping.DatabaseName))
                        .Options);
            });

            services.AddScoped<IBookAssetStorage>(sp =>
            {
                var scope = sp.GetRequiredService<CloudTenantContextScope>();
                var context = scope.Current;
                if (context == null)
                    throw new InvalidOperationException("No tenant context set");

                return new S3BookAssetStorage(
                    s3,
                    objectOptions,
                    new DirectCloudTenantContextAccessor(scope),
                    controlPlane);
            });

            services.AddScoped<CloudBackupSweepRunner>();

            var provider = services.BuildServiceProvider();

            var runner = provider.GetRequiredService<CloudBackupSweepRunner>();
            var sweepResult = await runner.RunAsync();

            sweepResult.Attempted.Should().Be(2);
            sweepResult.Succeeded.Should().Be(2);
            sweepResult.Failed.Should().Be(0);
            sweepResult.ControlPlaneError.Should().BeNull();

            var tenantABackup = sweepResult.Tenants
                .Single(t => t.AccountId == accountA.Value);
            tenantABackup.BackupId.Should().NotBeNull();

            var tenantBBackup = sweepResult.Tenants
                .Single(t => t.AccountId == accountB.Value);
            tenantBBackup.BackupId.Should().NotBeNull();

            var tenantAArchiveKey = await FindArchiveKeyAsync(
                s3, bucket, resourceA, tenantABackup.BackupId!.Value);
            tenantAArchiveKey.Should().Contain($"{resourceA:N}/backups/{tenantABackup.BackupId:N}");

            var tenantBArchiveKey = await FindArchiveKeyAsync(
                s3, bucket, resourceB, tenantBBackup.BackupId!.Value);
            tenantBArchiveKey.Should().Contain($"{resourceB:N}/backups/{tenantBBackup.BackupId:N}");

            using var tenantARecoveryService = provider.CreateScope();
            var tenantAScope = tenantARecoveryService.ServiceProvider
                .GetRequiredService<CloudTenantContextScope>();
            tenantAScope.Set(new NostosAccountContext(
                accountA, "Sweep test A", null));
            var tenantARecovery = tenantARecoveryService.ServiceProvider
                .GetRequiredService<ICloudRecoveryService>();

            var tenantARestoreResult = await tenantARecovery.RestoreAsync(
                tenantABackup.BackupId!.Value,
                confirmed: true);

            tenantARestoreResult.IntegrityVerified.Should().BeTrue();
            tenantARestoreResult.Counts.Books.Should().Be(4);

            using var tenantBRecoveryService = provider.CreateScope();
            var tenantBScope = tenantBRecoveryService.ServiceProvider
                .GetRequiredService<CloudTenantContextScope>();
            tenantBScope.Set(new NostosAccountContext(
                accountB, "Sweep test B", null));
            var tenantBRecovery = tenantBRecoveryService.ServiceProvider
                .GetRequiredService<ICloudRecoveryService>();

            var tenantBRestoreResult = await tenantBRecovery.RestoreAsync(
                tenantBBackup.BackupId!.Value,
                confirmed: true);

            tenantBRestoreResult.IntegrityVerified.Should().BeTrue();
            tenantBRestoreResult.Counts.Books.Should().Be(4);
        }
        finally
        {
            await DeleteAllObjectsAsync(s3, bucket);
            await s3.DeleteBucketAsync(
                new DeleteBucketRequest { BucketName = bucket });

            await DropDatabaseIfExistsAsync(postgresRoot, customerDatabaseA);
            await DropDatabaseIfExistsAsync(postgresRoot, customerDatabaseB);
            await DropDatabaseIfExistsAsync(postgresRoot, controlDatabase);

            await DropRecoveryDatabasesAsync(
                postgresRoot,
                $"nostos_sweep_r_");
        }
    }

    private sealed class DirectCloudTenantContextAccessor(
        CloudTenantContextScope scope) : ICloudTenantContextAccessor
    {
        public NostosAccountContext GetRequired() =>
            scope.Current
            ?? throw new InvalidOperationException("No tenant context set");
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
