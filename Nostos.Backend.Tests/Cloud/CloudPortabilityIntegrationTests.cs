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
using Nostos.Backend.Cloud.Storage;
using Nostos.Backend.Configuration;
using Nostos.Backend.Security;
using Nostos.Backend.Services.Portability;
using Nostos.Backend.Tests.Portability;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

public sealed class CloudPortabilityIntegrationTests
{
    private const string PostgresEnvironmentVariable =
        "NOSTOS_POSTGRES_SPIKE_CONNECTION";

    [Fact]
    [Trait("Category", "CloudPortability")]
    public async Task SelfHosted_SQLite_and_local_media_round_trip_through_Postgres_and_S3()
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
                "Cloud portability integration infrastructure is only partially configured.");
        }

        var databaseName = $"nostos_port_{Guid.NewGuid():N}"[..31];
        var bucket = $"nostos-portability-{Guid.NewGuid():N}"[..50];

        await CreateDatabaseAsync(postgresRoot, databaseName);

        using var s3 = new AmazonS3Client(
            new BasicAWSCredentials(accessKey, secretKey),
            new AmazonS3Config
            {
                ServiceURL = endpoint,
                ForcePathStyle = true,
                AuthenticationRegion = "us-east-1",
            });
        await s3.PutBucketAsync(new PutBucketRequest { BucketName = bucket });

        try
        {
            await using var source = await LocalPortableTestLibrary.CreateAsync();
            var ids = await PortableArchiveTestSupport.PopulateRepresentativeAsync(
                source.Db,
                source.Storage);

            using var selfHostedExport = new MemoryStream();
            var selfHostedExportResult =
                await source.Portability().ExportAsync(selfHostedExport);

            var postgresOptions =
                new DbContextOptionsBuilder<PostgresNostosDbContext>()
                    .UseNpgsql(ForDatabase(postgresRoot, databaseName))
                    .Options;

            await using (var cloudDb = new PostgresNostosDbContext(postgresOptions))
            {
                await cloudDb.Database.MigrateAsync();

                var accountId = NostosAccountId.FromExternalIdentity(
                    "https://identity.example.test",
                    "portable-account");
                var tenant = new FixedTenantContext(accountId);
                var store = new SingleTenantStore(new CloudAccountResourceSnapshot(
                    accountId,
                    ResourceId: Guid.NewGuid(),
                    DatabaseName: databaseName,
                    StorageNamespace: "accounts/portable-account",
                    ProvisioningState: CloudProvisioningState.Ready,
                    AccountStatus: CloudAccountStatus.Active,
                    SchemaVersion: CloudCustomerSchema.CurrentVersion,
                    FailureCode: null,
                    CreatedAtUtc: DateTime.UtcNow,
                    UpdatedAtUtc: DateTime.UtcNow,
                    LastProvisionAttemptAtUtc: DateTime.UtcNow,
                    ReadyAtUtc: DateTime.UtcNow));

                var cloudStorage = new S3BookAssetStorage(
                    s3,
                    new CloudObjectStorageOptions
                    {
                        Bucket = bucket,
                        Region = "us-east-1",
                        ServiceUrl = endpoint,
                        ForcePathStyle = true,
                    },
                    tenant,
                    store);

                var cloudPortability = new PortableArchiveService(
                    cloudDb,
                    cloudStorage,
                    NullLogger<PortableArchiveService>.Instance);

                selfHostedExport.Position = 0;
                var cloudImport =
                    await cloudPortability.ImportAsync(selfHostedExport);

                cloudImport.IntegrityVerified.Should().BeTrue();
                cloudImport.Counts.Should().Be(selfHostedExportResult.Counts);
                (await cloudDb.Books.CountAsync()).Should().Be(4);
                (await cloudDb.BookCollections.CountAsync()).Should().Be(3);
                (await cloudDb.NoteConcepts.CountAsync()).Should().Be(1);

                var cloudEpub = await cloudStorage.GetBookFileInfoAsync(
                    ids.EpubBookId);
                cloudEpub.Should().NotBeNull();
                cloudEpub!.FileName.Should().Be("book.epub");

                var cloudAudio = await cloudStorage.GetBookFileInfoAsync(
                    ids.AudioBookId);
                cloudAudio.Should().NotBeNull();
                cloudAudio!.FileName.Should().Be("book.m4b");

                using var cloudExport = new MemoryStream();
                var cloudExportResult =
                    await cloudPortability.ExportAsync(cloudExport);
                cloudExportResult.Counts.Should().Be(selfHostedExportResult.Counts);

                await using var finalSelfHosted =
                    await LocalPortableTestLibrary.CreateAsync();
                cloudExport.Position = 0;
                var finalImport =
                    await finalSelfHosted.Portability().ImportAsync(cloudExport);

                finalImport.IntegrityVerified.Should().BeTrue();
                finalImport.Counts.Should().Be(selfHostedExportResult.Counts);
                (await finalSelfHosted.Db.Books.CountAsync()).Should().Be(4);
                (await finalSelfHosted.Db.Writings.CountAsync()).Should().Be(2);
                (await finalSelfHosted.Db.BookCollections.CountAsync()).Should().Be(3);
                (await finalSelfHosted.Db.NoteConcepts.CountAsync()).Should().Be(1);

                var finalAudio =
                    await PortableArchiveTestSupport.ReadBookAsync(
                        finalSelfHosted.Storage,
                        ids.AudioBookId);
                finalAudio.Should().Equal(
                    System.Text.Encoding.UTF8.GetBytes("AUDIO-CONTENT-PORTABLE"));
            }
        }
        finally
        {
            await DeleteAllObjectsAsync(s3, bucket);
            await s3.DeleteBucketAsync(new DeleteBucketRequest
            {
                BucketName = bucket,
            });
            await DropDatabaseIfExistsAsync(postgresRoot, databaseName);
        }
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
        var builder = new NpgsqlConnectionStringBuilder(root)
        {
            Database = "postgres",
        };

        await using var connection = new NpgsqlConnection(builder.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"CREATE DATABASE \"{databaseName}\"";
        await command.ExecuteNonQueryAsync();
    }

    private static async Task DropDatabaseIfExistsAsync(
        string root,
        string databaseName)
    {
        var builder = new NpgsqlConnectionStringBuilder(root)
        {
            Database = "postgres",
        };

        await using var connection = new NpgsqlConnection(builder.ConnectionString);
        await connection.OpenAsync();

        await using (var terminate = connection.CreateCommand())
        {
            terminate.CommandText =
                "SELECT pg_terminate_backend(pid) "
                + "FROM pg_stat_activity "
                + "WHERE datname = @database AND pid <> pg_backend_pid();";
            terminate.Parameters.AddWithValue("database", databaseName);
            await terminate.ExecuteNonQueryAsync();
        }

        await using var drop = connection.CreateCommand();
        drop.CommandText = $"DROP DATABASE IF EXISTS \"{databaseName}\"";
        await drop.ExecuteNonQueryAsync();
    }

    private static async Task DeleteAllObjectsAsync(
        IAmazonS3 s3,
        string bucket)
    {
        string? continuation = null;
        do
        {
            var response = await s3.ListObjectsV2Async(new ListObjectsV2Request
            {
                BucketName = bucket,
                ContinuationToken = continuation,
            });

            foreach (var item in response.S3Objects ?? [])
            {
                await s3.DeleteObjectAsync(new DeleteObjectRequest
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

    private sealed class FixedTenantContext(NostosAccountId accountId)
        : ICloudTenantContextAccessor
    {
        public NostosAccountContext GetRequired() =>
            new(accountId, "Portable integration test", null);
    }

    private sealed class SingleTenantStore(
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
            Task.FromResult(resource);

        public Task MarkProvisioningAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task MarkReadyAsync(
            NostosAccountId accountId,
            string schemaVersion,
            CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task MarkFailedAsync(
            NostosAccountId accountId,
            string failureCode,
            CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task MarkSchemaVersionAsync(
            NostosAccountId accountId,
            string schemaVersion,
            CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task MarkSchemaFailureAsync(
            NostosAccountId accountId,
            string failureCode,
            CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task<IReadOnlyList<CloudAccountResourceSnapshot>> ListAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<CloudAccountResourceSnapshot>>(
                [resource]);
    }
}
