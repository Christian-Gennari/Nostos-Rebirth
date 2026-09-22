using System.Net;
using Amazon.S3;
using Amazon.S3.Model;
using Nostos.Backend.Cloud.ControlPlane;
using Nostos.Backend.Security;
using Nostos.Backend.Services;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Processing;

namespace Nostos.Backend.Cloud.Storage;

public sealed class S3BookAssetStorage(
    IAmazonS3 s3,
    Configuration.CloudObjectStorageOptions options,
    ICloudTenantContextAccessor tenantContext,
    ICloudControlPlaneStore controlPlane)
    : IBookAssetStorage
{
    public async Task<string> SaveBookFileAsync(
        Guid bookId,
        Stream content,
        string fileName,
        CancellationToken ct = default)
    {
        var extension = BookAssetFormats.RequireBookExtension(fileName);
        var prefix = await BookPrefixAsync(bookId, ct);
        var key = $"{prefix}book{extension}";

        await PutAsync(key, content, MediaTypeMap.ForBookFile(key), ct);
        await DeleteMatchingAsync(
            prefix,
            candidate =>
                FileName(candidate).StartsWith("book.", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(candidate, key, StringComparison.Ordinal),
            ct);

        return key;
    }

    public async Task<string> AdoptBookFileAsync(
        Guid bookId,
        string sourcePath,
        string fileName,
        CancellationToken ct = default)
    {
        if (!File.Exists(sourcePath))
            throw new FileNotFoundException("The staged file to adopt does not exist.", sourcePath);

        await using var source = new FileStream(
            sourcePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: 81920,
            options: FileOptions.Asynchronous | FileOptions.SequentialScan);

        var key = await SaveBookFileAsync(bookId, source, fileName, ct);

        // The caller's staging artifact is no longer needed only after the
        // object provider has accepted the whole stream successfully.
        File.Delete(sourcePath);
        return key;
    }

    public async Task<StoredAssetInfo?> GetBookFileInfoAsync(
        Guid bookId,
        CancellationToken ct = default)
    {
        var prefix = await BookPrefixAsync(bookId, ct);
        var key = await FindSingleAsync(
            prefix,
            candidate =>
                FileName(candidate).StartsWith("book.", StringComparison.OrdinalIgnoreCase)
                && BookAssetFormats.BookExtensions.Contains(Path.GetExtension(candidate)),
            ct);

        return key is null
            ? null
            : await GetInfoAsync(key, MediaTypeMap.ForBookFile(key), ct);
    }

    public async Task<StoredAssetRead?> OpenBookFileAsync(
        Guid bookId,
        StorageByteRange? range = null,
        CancellationToken ct = default)
    {
        var prefix = await BookPrefixAsync(bookId, ct);
        var key = await FindSingleAsync(
            prefix,
            candidate =>
                FileName(candidate).StartsWith("book.", StringComparison.OrdinalIgnoreCase)
                && BookAssetFormats.BookExtensions.Contains(Path.GetExtension(candidate)),
            ct);

        return key is null
            ? null
            : await OpenAsync(key, MediaTypeMap.ForBookFile(key), range, ct);
    }

    public async Task<bool> DeleteBookFileAsync(
        Guid bookId,
        CancellationToken ct = default)
    {
        var prefix = await BookPrefixAsync(bookId, ct);
        var key = await FindSingleAsync(
            prefix,
            candidate =>
                FileName(candidate).StartsWith("book.", StringComparison.OrdinalIgnoreCase)
                && BookAssetFormats.BookExtensions.Contains(Path.GetExtension(candidate)),
            ct);

        if (key is null)
            return false;

        await DeleteAsync(key, ct);
        return true;
    }

    public async Task DeleteBookFilesAsync(
        Guid bookId,
        CancellationToken ct = default)
    {
        var prefix = await BookPrefixAsync(bookId, ct);
        await DeleteMatchingAsync(prefix, _ => true, ct);
    }

    public async Task<string> SaveBookCoverAsync(
        Guid bookId,
        Stream content,
        string fileName,
        CancellationToken ct = default)
    {
        var extension = BookAssetFormats.RequireCoverExtension(fileName);
        var prefix = await BookPrefixAsync(bookId, ct);
        var key = $"{prefix}cover{extension}";

        await PutAsync(key, content, MediaTypeMap.ForCover(key), ct);

        await DeleteMatchingAsync(
            prefix,
            candidate =>
            {
                if (string.Equals(candidate, key, StringComparison.Ordinal))
                    return false;

                var name = FileName(candidate);
                return name.StartsWith("cover.", StringComparison.OrdinalIgnoreCase)
                    || name.StartsWith("cover-thumb-", StringComparison.OrdinalIgnoreCase);
            },
            ct);

        return key;
    }

    public async Task<StoredAssetInfo?> GetBookCoverInfoAsync(
        Guid bookId,
        CancellationToken ct = default)
    {
        var key = await FindCoverKeyAsync(bookId, ct);
        return key is null
            ? null
            : await GetInfoAsync(key, MediaTypeMap.ForCover(key), ct);
    }

    public async Task<StoredAssetRead?> OpenBookCoverAsync(
        Guid bookId,
        CancellationToken ct = default)
    {
        var key = await FindCoverKeyAsync(bookId, ct);
        return key is null
            ? null
            : await OpenAsync(key, MediaTypeMap.ForCover(key), range: null, ct);
    }

    public async Task<StoredAssetInfo?> GetBookCoverThumbnailInfoAsync(
        Guid bookId,
        int width,
        CancellationToken ct = default)
    {
        var key = await EnsureThumbnailAsync(bookId, width, ct);
        return key is null
            ? null
            : await GetInfoAsync(key, "image/webp", ct);
    }

    public async Task<StoredAssetRead?> OpenBookCoverThumbnailAsync(
        Guid bookId,
        int width,
        CancellationToken ct = default)
    {
        var key = await EnsureThumbnailAsync(bookId, width, ct);
        return key is null
            ? null
            : await OpenAsync(key, "image/webp", range: null, ct);
    }

    private async Task<string?> EnsureThumbnailAsync(
        Guid bookId,
        int width,
        CancellationToken ct)
    {
        var safeWidth = Math.Clamp(width, 120, 640);
        var prefix = await BookPrefixAsync(bookId, ct);
        var thumbnailKey = $"{prefix}cover-thumb-{safeWidth}.webp";

        if (await GetInfoAsync(thumbnailKey, "image/webp", ct) is not null)
            return thumbnailKey;

        var coverKey = await FindCoverKeyAsync(bookId, ct);
        if (coverKey is null)
            return null;

        await using var cover = await OpenAsync(
            coverKey,
            MediaTypeMap.ForCover(coverKey),
            range: null,
            ct);

        if (cover is null)
            return null;

        using var image = await Image.LoadAsync(cover.Content, ct);
        image.Mutate(context => context.Resize(new ResizeOptions
        {
            Size = new Size(safeWidth, 0),
            Mode = ResizeMode.Max,
        }));

        await using var encoded = new MemoryStream();
        await image.SaveAsWebpAsync(
            encoded,
            new WebpEncoder { Quality = 82 },
            ct);
        encoded.Position = 0;

        await PutAsync(thumbnailKey, encoded, "image/webp", ct);
        return thumbnailKey;
    }

    public async Task<bool> DeleteCoverAsync(
        Guid bookId,
        CancellationToken ct = default)
    {
        var prefix = await BookPrefixAsync(bookId, ct);
        var coverKey = await FindCoverKeyAsync(bookId, ct);
        if (coverKey is null)
            return false;

        await DeleteMatchingAsync(
            prefix,
            candidate =>
            {
                var name = FileName(candidate);
                return name.StartsWith("cover.", StringComparison.OrdinalIgnoreCase)
                    || name.StartsWith("cover-thumb-", StringComparison.OrdinalIgnoreCase);
            },
            ct);

        return true;
    }

    private async Task<string?> FindCoverKeyAsync(Guid bookId, CancellationToken ct)
    {
        var prefix = await BookPrefixAsync(bookId, ct);
        return await FindSingleAsync(
            prefix,
            candidate =>
                FileName(candidate).StartsWith("cover.", StringComparison.OrdinalIgnoreCase)
                && BookAssetFormats.CoverExtensions.Contains(Path.GetExtension(candidate)),
            ct);
    }

    private async Task<string> BookPrefixAsync(Guid bookId, CancellationToken ct)
    {
        var account = tenantContext.GetRequired();
        var resource = await controlPlane.FindAsync(account.AccountId, ct)
            ?? throw new InvalidOperationException(
                "The authenticated Cloud account has no storage resource mapping.");

        if (!resource.IsReady)
        {
            throw new InvalidOperationException(
                "The authenticated Cloud account is not ready for object storage.");
        }

        var root = resource.StorageNamespace.Trim('/');
        if (root.Length == 0)
            throw new InvalidOperationException("Cloud storage namespace is empty.");

        return $"{root}/books/{bookId:N}/";
    }

    private async Task PutAsync(
        string key,
        Stream content,
        string contentType,
        CancellationToken ct)
    {
        var request = new PutObjectRequest
        {
            BucketName = options.Bucket,
            Key = key,
            InputStream = content,
            AutoCloseStream = false,
            ContentType = contentType,
        };

        await s3.PutObjectAsync(request, ct);
    }

    private async Task<StoredAssetInfo?> GetInfoAsync(
        string key,
        string fallbackContentType,
        CancellationToken ct)
    {
        try
        {
            var response = await s3.GetObjectMetadataAsync(
                new GetObjectMetadataRequest
                {
                    BucketName = options.Bucket,
                    Key = key,
                },
                ct);

            return new StoredAssetInfo(
                FileName: FileName(key),
                ContentType: string.IsNullOrWhiteSpace(response.Headers.ContentType)
                    ? fallbackContentType
                    : response.Headers.ContentType,
                Length: response.ContentLength,
                EntityTag: NormalizeEntityTag(response.ETag),
                LastModified: new DateTimeOffset(
                    DateTime.SpecifyKind(
                        response.LastModified ?? DateTime.UnixEpoch,
                        DateTimeKind.Utc)));
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    private async Task<StoredAssetRead?> OpenAsync(
        string key,
        string fallbackContentType,
        StorageByteRange? range,
        CancellationToken ct)
    {
        var info = await GetInfoAsync(key, fallbackContentType, ct);
        if (info is null)
            return null;

        if (range is { } requested && requested.EndInclusive >= info.Length)
            throw new ArgumentOutOfRangeException(nameof(range));

        var request = new GetObjectRequest
        {
            BucketName = options.Bucket,
            Key = key,
        };

        if (range is { } actual)
            request.ByteRange = new ByteRange(actual.Start, actual.EndInclusive);

        try
        {
            var response = await s3.GetObjectAsync(request, ct);
            return new StoredAssetRead(
                info,
                response.ResponseStream,
                range,
                owner: response);
        }
        catch (AmazonS3Exception exception) when (exception.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    private async Task<string?> FindSingleAsync(
        string prefix,
        Func<string, bool> predicate,
        CancellationToken ct)
    {
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
                ct);

            var match = response.S3Objects
                .Select(item => item.Key)
                .FirstOrDefault(predicate);

            if (match is not null)
                return match;

            continuation = response.IsTruncated == true
                ? response.NextContinuationToken
                : null;
        }
        while (continuation is not null);

        return null;
    }

    private async Task DeleteMatchingAsync(
        string prefix,
        Func<string, bool> predicate,
        CancellationToken ct)
    {
        var keys = new List<string>();
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
                ct);

            keys.AddRange(response.S3Objects
                .Select(item => item.Key)
                .Where(predicate));

            continuation = response.IsTruncated == true
                ? response.NextContinuationToken
                : null;
        }
        while (continuation is not null);

        foreach (var key in keys)
            await DeleteAsync(key, ct);
    }

    private Task DeleteAsync(string key, CancellationToken ct) =>
        s3.DeleteObjectAsync(
            new DeleteObjectRequest
            {
                BucketName = options.Bucket,
                Key = key,
            },
            ct);

    private static string FileName(string key)
    {
        var slash = key.LastIndexOf('/');
        return slash >= 0 ? key[(slash + 1)..] : key;
    }

    private static string NormalizeEntityTag(string? entityTag)
    {
        var value = (entityTag ?? string.Empty).Trim();
        if (value.Length == 0)
            return "\"missing\"";

        return value.StartsWith('\"') && value.EndsWith('\"')
            ? value
            : $"\"{value.Trim('\"')}\"";
    }
}
