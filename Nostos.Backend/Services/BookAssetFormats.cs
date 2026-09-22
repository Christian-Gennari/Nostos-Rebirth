namespace Nostos.Backend.Services;

/// <summary>
/// Shared format policy for every storage provider.
/// </summary>
public static class BookAssetFormats
{
    public static readonly IReadOnlySet<string> BookExtensions =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".epub",
            ".pdf",
            ".txt",
            ".mobi",
            ".azw3",
            ".m4b",
            ".m4a",
            ".mp3",
        };

    public static readonly IReadOnlySet<string> CoverExtensions =
        new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".png",
            ".jpg",
            ".jpeg",
        };

    private static readonly IReadOnlyDictionary<string, string> MimeToExtension =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["application/epub+zip"] = ".epub",
            ["application/pdf"] = ".pdf",
            ["text/plain"] = ".txt",
            ["audio/mpeg"] = ".mp3",
            ["audio/mp4"] = ".m4a",
            ["audio/x-m4a"] = ".m4a",
            ["audio/x-m4b"] = ".m4b",
            ["application/x-mobipocket-ebook"] = ".mobi",
            ["application/octet-stream"] = "",
        };

    public static bool IsAllowedUpload(string contentType, string fileName)
    {
        if (MimeToExtension.TryGetValue(contentType, out var mapped)
            && (mapped.Length == 0 || BookExtensions.Contains(mapped)))
        {
            if (mapped.Length > 0)
                return true;
        }

        return BookExtensions.Contains(Path.GetExtension(fileName));
    }

    public static string RequireBookExtension(string fileName)
    {
        var extension = Path.GetExtension(fileName);
        if (!BookExtensions.Contains(extension))
            throw new InvalidOperationException($"Unsupported file type: {extension}");

        return extension.ToLowerInvariant();
    }

    public static string RequireCoverExtension(string fileName)
    {
        var extension = Path.GetExtension(fileName).ToLowerInvariant();
        if (!CoverExtensions.Contains(extension))
            throw new InvalidOperationException("Only PNG, JPG, or JPEG allowed.");

        return extension;
    }
}
