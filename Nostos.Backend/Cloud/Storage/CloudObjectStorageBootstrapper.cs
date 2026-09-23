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
///
/// Successful probes are cached briefly because platform health checks can run
/// every few seconds and a remote object-store transaction per probe would add
/// cost and load without improving failure detection meaningfully. Failures are
/// never cached.
/// </summary>
public sealed class CloudObjectStorageBootstrapper(
    IAmazonS3 s3,
    CloudObjectStorageOptions options)
    : ICloudObjectStorageBootstrapper
{
    private static readonly TimeSpan SuccessCacheDuration = TimeSpan.FromSeconds(30);
    private readonly SemaphoreSlim _probeLock = new(1, 1);
    private DateTimeOffset _lastSuccessUtc = DateTimeOffset.MinValue;

    public async Task EnsureReadyAsync(CancellationToken cancellationToken = default)
    {
        if (HasFreshSuccess())
            return;

        await _probeLock.WaitAsync(cancellationToken);
        try
        {
            if (HasFreshSuccess())
                return;

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

                _lastSuccessUtc = DateTimeOffset.UtcNow;
            }
            catch (Exception exception)
            {
                throw new InvalidOperationException(
                    $"Nostos Cloud cannot access object-storage bucket '{options.Bucket}'.",
                    exception);
            }
        }
        finally
        {
            _probeLock.Release();
        }
    }

    private bool HasFreshSuccess() =>
        DateTimeOffset.UtcNow - _lastSuccessUtc < SuccessCacheDuration;
}
