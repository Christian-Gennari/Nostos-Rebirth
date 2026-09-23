using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Amazon.S3;
using Amazon.S3.Model;
using Nostos.Backend.Configuration;

namespace Nostos.Backend.Cloud.Recovery;

public interface ICloudRecoveryStore
{
    Task SaveBackupAsync(
        Guid resourceId,
        CloudOperationalBackupManifest manifest,
        string archivePath,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<CloudOperationalBackupManifest>> ListBackupsAsync(
        Guid resourceId,
        CancellationToken cancellationToken = default);

    Task<CloudOperationalBackupManifest?> GetBackupAsync(
        Guid resourceId,
        Guid backupId,
        CancellationToken cancellationToken = default);

    Task DownloadBackupAsync(
        Guid resourceId,
        Guid backupId,
        Stream destination,
        CancellationToken cancellationToken = default);

    Task WriteRestoreAuditAsync(
        Guid resourceId,
        CloudRestoreAudit audit,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Nostos-owned operational recovery artifacts.
///
/// The customer-facing portable archive format remains #399. This store merely
/// persists that same archive as an operator-managed backup and adds recovery
/// metadata around it. Tenant selection is always the trusted control-plane
/// resource id supplied by CloudRecoveryService; HTTP clients never provide an
/// object prefix or bucket key.
/// </summary>
public sealed class S3CloudRecoveryStore(
    IAmazonS3 s3,
    CloudObjectStorageOptions options,
    ILogger<S3CloudRecoveryStore> logger)
    : ICloudRecoveryStore
{
    private const string RecoveryRoot = "__nostos_recovery";
    private const string ArchiveFileName = "library.nostos";
    private const string ManifestFileName = "manifest.json";

    private static readonly JsonSerializerOptions JsonOptions =
        new(JsonSerializerDefaults.Web)
        {
            WriteIndented = false,
        };

    public async Task SaveBackupAsync(
        Guid resourceId,
        CloudOperationalBackupManifest manifest,
        string archivePath,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(archivePath);

        ValidateManifest(resourceId, manifest);

        var prefix = BackupPrefix(resourceId, manifest.BackupId);
        var archiveKey = prefix + ArchiveFileName;
        var manifestKey = prefix + ManifestFileName;

        try
        {
            await using (var input = new FileStream(
                archivePath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                bufferSize: 128 * 1024,
                options: FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                await s3.PutObjectAsync(
                    new PutObjectRequest
                    {
                        BucketName = options.Bucket,
                        Key = archiveKey,
                        InputStream = input,
                        AutoCloseStream = false,
                        ContentType = "application/vnd.nostos.portable+zip",
                    },
                    cancellationToken);
            }

            var uploadedHash = await ComputeObjectSha256Async(
                archiveKey,
                cancellationToken);

            if (!string.Equals(
                uploadedHash,
                manifest.ArchiveSha256,
                StringComparison.OrdinalIgnoreCase))
            {
                throw new CloudRecoveryException(
                    "backup_upload_verification_failed",
                    "The uploaded Cloud recovery archive did not match its local SHA-256 digest.");
            }

            await PutJsonAsync(manifestKey, manifest, cancellationToken);
        }
        catch
        {
            await DeleteBestEffortAsync(manifestKey);
            await DeleteBestEffortAsync(archiveKey);
            throw;
        }
    }

    public async Task<IReadOnlyList<CloudOperationalBackupManifest>> ListBackupsAsync(
        Guid resourceId,
        CancellationToken cancellationToken = default)
    {
        var prefix = $"{RecoveryRoot}/{resourceId:N}/backups/";
        var manifests = new List<CloudOperationalBackupManifest>();
        string? continuation = null;

        do
        {
            var response = await s3.ListObjectsV2Async(
                new ListObjectsV2Request
                {
                    BucketName = options.Bucket,
                    Prefix = prefix,
                    ContinuationToken = continuation,
                },
                cancellationToken);

            foreach (var item in response.S3Objects ?? [])
            {
                if (!item.Key.EndsWith("/" + ManifestFileName, StringComparison.Ordinal))
                    continue;

                var manifest = await ReadJsonAsync<CloudOperationalBackupManifest>(
                    item.Key,
                    cancellationToken);

                if (manifest is null)
                    continue;

                ValidateManifest(resourceId, manifest);
                manifests.Add(manifest);
            }

            continuation = response.IsTruncated == true
                ? response.NextContinuationToken
                : null;
        }
        while (continuation is not null);

        return manifests
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToList();
    }

    public async Task<CloudOperationalBackupManifest?> GetBackupAsync(
        Guid resourceId,
        Guid backupId,
        CancellationToken cancellationToken = default)
    {
        var manifest = await ReadJsonAsync<CloudOperationalBackupManifest>(
            BackupPrefix(resourceId, backupId) + ManifestFileName,
            cancellationToken);

        if (manifest is null)
            return null;

        ValidateManifest(resourceId, manifest);

        if (manifest.BackupId != backupId)
        {
            throw new CloudRecoveryException(
                "backup_metadata_invalid",
                "Cloud recovery backup metadata does not match the selected backup.");
        }

        return manifest;
    }

    public async Task DownloadBackupAsync(
        Guid resourceId,
        Guid backupId,
        Stream destination,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(destination);
        if (!destination.CanWrite)
            throw new ArgumentException("Backup destination must be writable.", nameof(destination));

        try
        {
            using var response = await s3.GetObjectAsync(
                new GetObjectRequest
                {
                    BucketName = options.Bucket,
                    Key = BackupPrefix(resourceId, backupId) + ArchiveFileName,
                },
                cancellationToken);

            await response.ResponseStream.CopyToAsync(destination, cancellationToken);
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == HttpStatusCode.NotFound)
        {
            throw new CloudRecoveryException(
                "backup_archive_missing",
                "The selected Cloud recovery backup is missing its portable archive.",
                exception);
        }
    }

    public Task WriteRestoreAuditAsync(
        Guid resourceId,
        CloudRestoreAudit audit,
        CancellationToken cancellationToken = default)
    {
        if (audit.ResourceId != resourceId)
        {
            throw new CloudRecoveryException(
                "restore_metadata_invalid",
                "Restore audit metadata does not match the trusted Cloud resource.");
        }

        var key =
            $"{RecoveryRoot}/{resourceId:N}/restores/{audit.RestoreId:N}.json";
        return PutJsonAsync(key, audit, cancellationToken);
    }

    private async Task PutJsonAsync<T>(
        string key,
        T value,
        CancellationToken cancellationToken)
    {
        await using var content = new MemoryStream();
        await JsonSerializer.SerializeAsync(
            content,
            value,
            JsonOptions,
            cancellationToken);
        content.Position = 0;

        await s3.PutObjectAsync(
            new PutObjectRequest
            {
                BucketName = options.Bucket,
                Key = key,
                InputStream = content,
                AutoCloseStream = false,
                ContentType = "application/json",
            },
            cancellationToken);
    }

    private async Task<T?> ReadJsonAsync<T>(
        string key,
        CancellationToken cancellationToken)
    {
        try
        {
            using var response = await s3.GetObjectAsync(
                new GetObjectRequest
                {
                    BucketName = options.Bucket,
                    Key = key,
                },
                cancellationToken);

            return await JsonSerializer.DeserializeAsync<T>(
                response.ResponseStream,
                JsonOptions,
                cancellationToken);
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == HttpStatusCode.NotFound)
        {
            return default;
        }
        catch (JsonException exception)
        {
            throw new CloudRecoveryException(
                "backup_metadata_invalid",
                "Cloud recovery metadata is not valid JSON.",
                exception);
        }
    }

    private async Task<string> ComputeObjectSha256Async(
        string key,
        CancellationToken cancellationToken)
    {
        using var response = await s3.GetObjectAsync(
            new GetObjectRequest
            {
                BucketName = options.Bucket,
                Key = key,
            },
            cancellationToken);

        using var sha = SHA256.Create();
        var hash = await sha.ComputeHashAsync(
            response.ResponseStream,
            cancellationToken);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private async Task DeleteBestEffortAsync(string key)
    {
        try
        {
            await s3.DeleteObjectAsync(
                new DeleteObjectRequest
                {
                    BucketName = options.Bucket,
                    Key = key,
                },
                CancellationToken.None);
        }
        catch (Exception exception)
        {
            logger.LogWarning(
                "Could not remove an incomplete Cloud recovery object; exception type {ExceptionType}. Object key and details suppressed.",
                exception.GetType().Name);
        }
    }

    private static string BackupPrefix(Guid resourceId, Guid backupId) =>
        $"{RecoveryRoot}/{resourceId:N}/backups/{backupId:N}/";

    private static void ValidateManifest(
        Guid resourceId,
        CloudOperationalBackupManifest manifest)
    {
        if (!string.Equals(
                manifest.Format,
                CloudOperationalBackupManifest.CurrentFormat,
                StringComparison.Ordinal)
            || manifest.Version != CloudOperationalBackupManifest.CurrentVersion)
        {
            throw new CloudRecoveryException(
                "backup_metadata_version_unsupported",
                "Cloud recovery backup metadata uses an unsupported format version.");
        }

        if (manifest.ResourceId != resourceId)
        {
            throw new CloudRecoveryException(
                "backup_tenant_mismatch",
                "Cloud recovery backup metadata does not belong to the trusted Cloud resource.");
        }

        if (manifest.ArchiveBytes < 1
            || manifest.ArchiveSha256.Length != 64
            || manifest.PortableFormatVersion < 1)
        {
            throw new CloudRecoveryException(
                "backup_metadata_invalid",
                "Cloud recovery backup metadata is incomplete.");
        }
    }
}
