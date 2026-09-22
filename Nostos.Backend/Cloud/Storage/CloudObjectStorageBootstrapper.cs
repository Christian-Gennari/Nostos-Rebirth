using Amazon.S3;
using Amazon.S3.Model;
using Nostos.Backend.Configuration;

namespace Nostos.Backend.Cloud.Storage;

public interface ICloudObjectStorageBootstrapper
{
    Task EnsureReadyAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Verifies that the configured Cloud bucket exists and the application
/// credential can list it. Bucket creation remains deployment/infrastructure
/// responsibility; the app fails startup closed instead of silently falling
/// back to container disk.
/// </summary>
public sealed class CloudObjectStorageBootstrapper(
    IAmazonS3 s3,
    CloudObjectStorageOptions options)
    : ICloudObjectStorageBootstrapper
{
    public async Task EnsureReadyAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await s3.ListObjectsV2Async(
                new ListObjectsV2Request
                {
                    BucketName = options.Bucket,
                    MaxKeys = 1,
                    Prefix = "__nostos_readiness__/",
                },
                cancellationToken);
        }
        catch (Exception exception)
        {
            throw new InvalidOperationException(
                $"Nostos Cloud cannot access object-storage bucket '{options.Bucket}'.",
                exception);
        }
    }
}
