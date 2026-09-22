using System.Net;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using FluentAssertions;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Cloud.Storage;
using Nostos.Backend.Configuration;
using Nostos.Backend.Security;
using Nostos.Backend.Services;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace Nostos.Backend.Tests.Cloud;

public sealed class CloudObjectStorageIntegrationTests
{
    [Fact]
    [Trait("Category", "CloudObjectStorage")]
    public async Task S3_storage_isolates_tenants_and_supports_range_cover_thumbnail_and_cleanup()
    {
        var endpoint = Environment.GetEnvironmentVariable("NOSTOS_S3_TEST_ENDPOINT");
        if (string.IsNullOrWhiteSpace(endpoint))
            return;

        var accessKey =
            Environment.GetEnvironmentVariable("NOSTOS_S3_TEST_ACCESS_KEY")
            ?? "minioadmin";
        var secretKey =
            Environment.GetEnvironmentVariable("NOSTOS_S3_TEST_SECRET_KEY")
            ?? "minioadmin";

        var bucket = $"nostos-test-{Guid.NewGuid():N}"[..36];

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
            var accountA = NostosAccountId.FromExternalIdentity(
                "https://identity.example.test",
                "storage-a");
            var accountB = NostosAccountId.FromExternalIdentity(
                "https://identity.example.test",
                "storage-b");

            var tenant = new MutableTenantContext(accountA);
            var store = new TwoTenantStore(
                Ready(accountA, "accounts/resource-a"),
                Ready(accountB, "accounts/resource-b"));

            var storage = new S3BookAssetStorage(
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

            var bookId = Guid.NewGuid();
            var bytesA = Enumerable.Range(0, 256).Select(i => (byte)i).ToArray();
            var bytesB = Enumerable.Range(0, 256).Select(i => (byte)(255 - i)).ToArray();

            await using (var content = new MemoryStream(bytesA))
                await storage.SaveBookFileAsync(bookId, content, "reader.epub");

            tenant.AccountId = accountB;
            await using (var content = new MemoryStream(bytesB))
                await storage.SaveBookFileAsync(bookId, content, "reader.epub");

            tenant.AccountId = accountA;
            (await ReadAllAsync(await storage.OpenBookFileAsync(bookId)))
                .Should().Equal(bytesA);

            await using (var ranged = await storage.OpenBookFileAsync(
                bookId,
                StorageByteRange.Create(10, 29, bytesA.Length)))
            {
                ranged.Should().NotBeNull();
                ranged!.Range.Should().Be(new StorageByteRange(10, 29));
                var rangeBytes = await ReadExactlyAsync(ranged.Content, 20);
                rangeBytes.Should().Equal(bytesA[10..30]);
            }

            tenant.AccountId = accountB;
            (await ReadAllAsync(await storage.OpenBookFileAsync(bookId)))
                .Should().Equal(bytesB);

            // Replacing the primary file removes the old extension within this
            // tenant only.
            await using (var replacement = new MemoryStream([7, 8, 9, 10]))
                await storage.SaveBookFileAsync(bookId, replacement, "reader.pdf");

            var bInfo = await storage.GetBookFileInfoAsync(bookId);
            bInfo.Should().NotBeNull();
            bInfo!.FileName.Should().Be("book.pdf");
            bInfo.ContentType.Should().Be("application/pdf");

            tenant.AccountId = accountA;
            (await storage.GetBookFileInfoAsync(bookId))!.FileName
                .Should().Be("book.epub");

            var png = CreatePng();
            await using (var cover = new MemoryStream(png))
                await storage.SaveBookCoverAsync(bookId, cover, "cover.png");

            var thumbnailInfo =
                await storage.GetBookCoverThumbnailInfoAsync(bookId, 240);
            thumbnailInfo.Should().NotBeNull();
            thumbnailInfo!.FileName.Should().Be("cover-thumb-240.webp");
            thumbnailInfo.ContentType.Should().Be("image/webp");

            await using (var thumbnail =
                await storage.OpenBookCoverThumbnailAsync(bookId, 240))
            {
                thumbnail.Should().NotBeNull();
                thumbnail!.Info.Length.Should().BeGreaterThan(0);
            }

            // Cover replacement invalidates old cover derivatives.
            await using (var cover = new MemoryStream(CreateJpeg()))
                await storage.SaveBookCoverAsync(bookId, cover, "cover.jpg");

            (await storage.GetBookCoverInfoAsync(bookId))!.FileName
                .Should().Be("cover.jpg");

            var regenerated =
                await storage.GetBookCoverThumbnailInfoAsync(bookId, 240);
            regenerated.Should().NotBeNull();

            await storage.DeleteBookFilesAsync(bookId);
            (await storage.GetBookFileInfoAsync(bookId)).Should().BeNull();
            (await storage.GetBookCoverInfoAsync(bookId)).Should().BeNull();

            tenant.AccountId = accountB;
            (await storage.GetBookFileInfoAsync(bookId)).Should().NotBeNull(
                "deleting account A's book prefix must never touch account B");
        }
        finally
        {
            await DeleteAllObjectsAsync(s3, bucket);
            await s3.DeleteBucketAsync(new DeleteBucketRequest
            {
                BucketName = bucket,
            });
        }
    }

    private static CloudAccountResourceSnapshot Ready(
        NostosAccountId accountId,
        string storageNamespace) =>
        new(
            accountId,
            ResourceId: Guid.NewGuid(),
            DatabaseName: $"nostos_{Guid.NewGuid():N}",
            StorageNamespace: storageNamespace,
            ProvisioningState: CloudProvisioningState.Ready,
            AccountStatus: CloudAccountStatus.Active,
            SchemaVersion: CloudCustomerSchema.CurrentVersion,
            FailureCode: null,
            CreatedAtUtc: DateTime.UtcNow,
            UpdatedAtUtc: DateTime.UtcNow,
            LastProvisionAttemptAtUtc: DateTime.UtcNow,
            ReadyAtUtc: DateTime.UtcNow);

    private static async Task<byte[]> ReadAllAsync(StoredAssetRead? read)
    {
        var opened = read.Should().NotBeNull().Subject!;
        await using (opened)
        {
            using var output = new MemoryStream();
            await opened.Content.CopyToAsync(output);
            return output.ToArray();
        }
    }

    private static async Task<byte[]> ReadExactlyAsync(Stream source, int length)
    {
        var bytes = new byte[length];
        var offset = 0;
        while (offset < length)
        {
            var read = await source.ReadAsync(bytes.AsMemory(offset, length - offset));
            if (read == 0)
                break;
            offset += read;
        }

        return bytes[..offset];
    }

    private static byte[] CreatePng()
    {
        using var image = new Image<Rgba32>(32, 24);
        using var output = new MemoryStream();
        image.SaveAsPng(output);
        return output.ToArray();
    }

    private static byte[] CreateJpeg()
    {
        using var image = new Image<Rgba32>(32, 24);
        using var output = new MemoryStream();
        image.SaveAsJpeg(output);
        return output.ToArray();
    }

    private static async Task DeleteAllObjectsAsync(IAmazonS3 s3, string bucket)
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

    private sealed class MutableTenantContext(NostosAccountId accountId)
        : ICloudTenantContextAccessor
    {
        public NostosAccountId AccountId { get; set; } = accountId;

        public NostosAccountContext GetRequired() =>
            new(AccountId, "Storage test", null);
    }

    private sealed class TwoTenantStore(
        params CloudAccountResourceSnapshot[] resources)
        : ICloudControlPlaneStore
    {
        private readonly Dictionary<Guid, CloudAccountResourceSnapshot> _resources =
            resources.ToDictionary(x => x.AccountId.Value);

        public Task<CloudAccountResourceSnapshot?> FindAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(
                _resources.GetValueOrDefault(accountId.Value));

        public Task<CloudAccountResourceSnapshot> GetOrCreateAsync(
            NostosAccountId accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(
                _resources[accountId.Value]);

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
                _resources.Values.ToList());
    }
}
