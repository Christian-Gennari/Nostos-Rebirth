using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Privacy;
using Nostos.Backend.Configuration;
using Nostos.Backend.Security;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

public sealed class CloudAccountDeletionResourceIntegrationTests
{
    [Fact]
    [Trait("Category", "CloudRecovery")]
    public async Task Destruction_removes_all_target_generations_and_versions_without_touching_another_tenant()
    {
        var root = Environment.GetEnvironmentVariable("NOSTOS_POSTGRES_SPIKE_CONNECTION");
        var endpoint = Environment.GetEnvironmentVariable("NOSTOS_S3_TEST_ENDPOINT");
        if (string.IsNullOrWhiteSpace(root) || string.IsNullOrWhiteSpace(endpoint))
            return;

        var accessKey = Environment.GetEnvironmentVariable("NOSTOS_S3_TEST_ACCESS_KEY");
        var secretKey = Environment.GetEnvironmentVariable("NOSTOS_S3_TEST_SECRET_KEY");
        if (string.IsNullOrWhiteSpace(accessKey) || string.IsNullOrWhiteSpace(secretKey))
            throw new InvalidOperationException("S3 deletion test credentials are missing.");

        var suffix = Guid.NewGuid().ToString("N")[..10];
        var bucket = $"nostos-del-{suffix}";
        var prefix = $"ndel{suffix[..8]}";
        var control = new CloudControlPlaneOptions
        {
            CustomerDatabasePrefix = prefix,
            StorageNamespacePrefix = $"tests/deletion/{suffix}",
        };

        var resourceA = Guid.NewGuid();
        var resourceB = Guid.NewGuid();
        var databaseA = control.DatabaseName(resourceA);
        var databaseB = control.DatabaseName(resourceB);
        var recoveryDatabaseA =
            $"{prefix}_r_{resourceA.ToString("N")[..12]}_abcdef123456";
        var admin = new NpgsqlConnectionStringBuilder(root).ConnectionString;

        using var s3 = new AmazonS3Client(
            new BasicAWSCredentials(accessKey, secretKey),
            new AmazonS3Config
            {
                ServiceURL = endpoint,
                ForcePathStyle = true,
                AuthenticationRegion = "us-east-1",
            });

        await s3.PutBucketAsync(new PutBucketRequest { BucketName = bucket });
        await s3.PutBucketVersioningAsync(new PutBucketVersioningRequest
        {
            BucketName = bucket,
            VersioningConfig = new S3BucketVersioningConfig
            {
                Status = VersionStatus.Enabled,
            },
        });

        try
        {
            await CreateDatabaseAsync(admin, databaseA);
            await CreateDatabaseAsync(admin, recoveryDatabaseA);
            await CreateDatabaseAsync(admin, databaseB);

            var storageA = control.StorageNamespace(resourceA);
            var storageB = control.StorageNamespace(resourceB);
            var recoveryStorageA =
                $"{control.StorageNamespacePrefix}/recovery/{resourceA:N}/restore-a";
            var backupA =
                $"__nostos_recovery/{resourceA:N}/backups/backup-a/library.nostos";

            await PutAsync(s3, bucket, $"{storageA}/books/shared/book.epub", "a-v1");
            await PutAsync(s3, bucket, $"{storageA}/books/shared/book.epub", "a-v2");
            await PutAsync(s3, bucket, $"{recoveryStorageA}/books/shared/book.epub", "a-recovery");
            await PutAsync(s3, bucket, backupA, "a-backup");
            await PutAsync(s3, bucket, $"{storageB}/books/shared/book.epub", "b");

            var accountA = NostosAccountId.FromExternalIdentity(
                "https://identity.example.test",
                "delete-resource-a");

            var destroyer = new CloudAccountDeletionResourceDestroyer(
                new CloudDatabaseConnections(
                    ControlPlane: admin,
                    Admin: admin,
                    CustomerBase: admin),
                control,
                s3,
                new CloudObjectStorageOptions
                {
                    Bucket = bucket,
                    Region = "us-east-1",
                    ServiceUrl = endpoint,
                    ForcePathStyle = true,
                },
                NullLogger<CloudAccountDeletionResourceDestroyer>.Instance);

            await destroyer.DestroyAsync(new CloudAccountResourceSnapshot(
                accountA,
                resourceA,
                databaseA,
                storageA,
                CloudProvisioningState.Ready,
                CloudAccountStatus.DeletionRequested,
                CloudCustomerSchema.CurrentVersion,
                FailureCode: null,
                DateTime.UtcNow,
                DateTime.UtcNow,
                LastProvisionAttemptAtUtc: null,
                ReadyAtUtc: DateTime.UtcNow));

            (await DatabaseExistsAsync(admin, databaseA)).Should().BeFalse();
            (await DatabaseExistsAsync(admin, recoveryDatabaseA)).Should().BeFalse();
            (await DatabaseExistsAsync(admin, databaseB)).Should().BeTrue();

            (await CountVersionsAsync(s3, bucket, storageA + "/")).Should().Be(0);
            (await CountVersionsAsync(
                s3,
                bucket,
                $"{control.StorageNamespacePrefix}/recovery/{resourceA:N}/"))
                .Should().Be(0);
            (await CountVersionsAsync(
                s3,
                bucket,
                $"__nostos_recovery/{resourceA:N}/"))
                .Should().Be(0);

            (await CountVersionsAsync(s3, bucket, storageB + "/"))
                .Should().BeGreaterThan(0,
                    "deleting tenant A must never delete tenant B's identically-shaped media");
        }
        finally
        {
            await DropDatabaseIfExistsAsync(admin, databaseA);
            await DropDatabaseIfExistsAsync(admin, recoveryDatabaseA);
            await DropDatabaseIfExistsAsync(admin, databaseB);
            await DeleteAllVersionsAsync(s3, bucket);
            await s3.DeleteBucketAsync(new DeleteBucketRequest { BucketName = bucket });
        }
    }

    private static async Task PutAsync(
        IAmazonS3 s3,
        string bucket,
        string key,
        string value)
    {
        await using var content = new MemoryStream(System.Text.Encoding.UTF8.GetBytes(value));
        await s3.PutObjectAsync(new PutObjectRequest
        {
            BucketName = bucket,
            Key = key,
            InputStream = content,
            AutoCloseStream = false,
        });
    }

    private static async Task<int> CountVersionsAsync(
        IAmazonS3 s3,
        string bucket,
        string prefix)
    {
        var response = await s3.ListVersionsAsync(new ListVersionsRequest
        {
            BucketName = bucket,
            Prefix = prefix,
        });

        return response.Versions?.Count ?? 0;
    }

    private static async Task DeleteAllVersionsAsync(
        IAmazonS3 s3,
        string bucket)
    {
        string? keyMarker = null;
        string? versionMarker = null;

        do
        {
            var response = await s3.ListVersionsAsync(new ListVersionsRequest
            {
                BucketName = bucket,
                KeyMarker = keyMarker,
                VersionIdMarker = versionMarker,
            });

            foreach (var version in response.Versions ?? [])
            {
                await s3.DeleteObjectAsync(new DeleteObjectRequest
                {
                    BucketName = bucket,
                    Key = version.Key,
                    VersionId = version.VersionId,
                });
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
    }

    private static async Task CreateDatabaseAsync(string root, string database)
    {
        await using var connection = new NpgsqlConnection(root);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = $"CREATE DATABASE {QuoteIdentifier(database)}";
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<bool> DatabaseExistsAsync(string root, string database)
    {
        await using var connection = new NpgsqlConnection(root);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT 1 FROM pg_database WHERE datname = @name";
        command.Parameters.AddWithValue("name", database);
        return await command.ExecuteScalarAsync() is not null;
    }

    private static async Task DropDatabaseIfExistsAsync(string root, string database)
    {
        await using var connection = new NpgsqlConnection(root);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            $"DROP DATABASE IF EXISTS {QuoteIdentifier(database)} WITH (FORCE)";
        await command.ExecuteNonQueryAsync();
    }

    private static string QuoteIdentifier(string identifier) =>
        "\"" + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
}
