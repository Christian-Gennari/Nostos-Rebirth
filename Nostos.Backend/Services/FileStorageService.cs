using Microsoft.Extensions.Options;
using Nostos.Backend.Configuration;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Processing;

namespace Nostos.Backend.Services;

public class FileStorageService : IFileStorageService
{
    private const int CopyBufferSize = 81920;

    private readonly string _root;
    private readonly ILogger<FileStorageService> _logger;

    // Centralized allowed extensions
    private readonly HashSet<string> _allowedBookExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".epub",
        ".pdf",
        ".txt",
        ".mobi",
        ".azw3",
        // Audio formats
        ".m4b",
        ".m4a",
        ".mp3",
    };

    private readonly HashSet<string> _allowedCoverExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png",
        ".jpg",
        ".jpeg",
    };

    // Centralized MIME-to-extension mapping for upload validation
    private static readonly Dictionary<string, string> MimeToExtension = new(
        StringComparer.OrdinalIgnoreCase
    )
    {
        ["application/epub+zip"] = ".epub",
        ["application/pdf"] = ".pdf",
        ["text/plain"] = ".txt",
        ["audio/mpeg"] = ".mp3",
        ["audio/mp4"] = ".m4a",
        ["audio/x-m4a"] = ".m4a",
        ["audio/x-m4b"] = ".m4b",
        ["application/x-mobipocket-ebook"] = ".mobi",
        ["application/octet-stream"] = "", // handled by extension fallback
    };

    /// <summary>
    /// Returns true if the file is an accepted book upload based on MIME type or file extension.
    /// </summary>
    public static bool IsAllowedUpload(string contentType, string fileName)
    {
        if (MimeToExtension.ContainsKey(contentType))
            return true;

        // Fallback: check extension for types like .m4b that may arrive as application/octet-stream
        var ext = Path.GetExtension(fileName);
        return ext.Equals(".m4b", StringComparison.OrdinalIgnoreCase)
            || ext.Equals(".mobi", StringComparison.OrdinalIgnoreCase)
            || ext.Equals(".azw3", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Maps a file path to the correct Content-Type for download responses.
    /// </summary>
    public static string GetContentType(string filePath) =>
        Path.GetExtension(filePath).ToLower() switch
        {
            ".epub" => "application/epub+zip",
            ".pdf" => "application/pdf",
            ".txt" => "text/plain",
            ".mobi" => "application/x-mobipocket-ebook",
            ".azw3" => "application/x-mobipocket-ebook",
            ".mp3" => "audio/mpeg",
            ".m4a" => "audio/mp4",
            ".m4b" => "audio/mp4",
            _ => "application/octet-stream",
        };

    public FileStorageService(
        IWebHostEnvironment env,
        IOptions<FileStorageOptions> options,
        ILogger<FileStorageService> logger
    )
    {
        _root = FileStorageOptions.ResolveBooksRoot(env.ContentRootPath, options.Value);
        _logger = logger;
        Directory.CreateDirectory(_root);
    }

    public string StorageRoot => _root;

    public async Task<string> SaveBookFileAsync(Guid bookId, IFormFile file)
    {
        await using var stream = file.OpenReadStream();
        return await SaveBookFileAsync(bookId, stream, file.FileName);
    }

    public async Task<string> SaveBookFileAsync(
        Guid bookId,
        Stream content,
        string fileName,
        CancellationToken ct = default
    )
    {
        var ext = Path.GetExtension(fileName);
        if (!_allowedBookExtensions.Contains(ext))
            throw new InvalidOperationException($"Unsupported file type: {ext}");

        var bookFolder = BookFolder(bookId);
        Directory.CreateDirectory(bookFolder);

        var finalPath = Path.Combine(bookFolder, $"book{ext}");
        var tempPath = TempSiblingPath(bookFolder, finalPath);

        try
        {
            await WriteStreamAsync(content, tempPath, ct);

            // Only once the transfer is complete do we disturb what is already
            // there. The invariant is one "book.*" per folder, and replacing it
            // is a rename rather than a truncate, so a reader can never observe
            // a partially written book file.
            DeleteExistingBookFiles(bookFolder, except: finalPath);
            File.Move(tempPath, finalPath, overwrite: true);
        }
        catch
        {
            TryDelete(tempPath);
            throw;
        }

        return finalPath;
    }

    public FileStream? GetBookFile(Guid bookId)
    {
        var file = GetBookFileName(bookId);
        return file is null ? null : new FileStream(file, FileMode.Open, FileAccess.Read);
    }

    public string? GetBookFileName(Guid bookId)
    {
        var folder = Path.Combine(_root, bookId.ToString());
        if (!Directory.Exists(folder))
            return null;

        return Directory
            .EnumerateFiles(folder)
            .FirstOrDefault(f => _allowedBookExtensions.Contains(Path.GetExtension(f)));
    }

    public void DeleteBookFiles(Guid bookId)
    {
        var bookFolder = Path.Combine(_root, bookId.ToString());
        if (Directory.Exists(bookFolder))
            Directory.Delete(bookFolder, true);
    }

    public async Task<string> SaveBookCoverAsync(Guid bookId, IFormFile file)
    {
        await using var stream = file.OpenReadStream();
        return await SaveBookCoverAsync(bookId, stream, file.FileName);
    }

    public async Task<string> SaveBookCoverAsync(
        Guid bookId,
        Stream content,
        string fileName,
        CancellationToken ct = default
    )
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        if (!_allowedCoverExtensions.Contains(ext))
            throw new InvalidOperationException("Only PNG, JPG, or JPEG allowed.");

        var bookFolder = BookFolder(bookId);
        Directory.CreateDirectory(bookFolder);

        var finalPath = Path.Combine(bookFolder, $"cover{ext}");
        var tempPath = TempSiblingPath(bookFolder, finalPath);

        try
        {
            await WriteStreamAsync(content, tempPath, ct);

            foreach (var existing in Directory.EnumerateFiles(bookFolder, "cover.*"))
            {
                if (existing.EndsWith(".partial", StringComparison.Ordinal)
                    || string.Equals(existing, finalPath, StringComparison.Ordinal))
                    continue;

                TryDelete(existing);
            }

            // Replacing the cover must also drop its cached thumbnails, or the
            // library grid keeps rendering the previous artwork.
            foreach (var thumbnail in Directory.EnumerateFiles(bookFolder, "cover-thumb-*.webp"))
                TryDelete(thumbnail);

            File.Move(tempPath, finalPath, overwrite: true);
        }
        catch
        {
            TryDelete(tempPath);
            throw;
        }

        return finalPath;
    }

    public string? GetBookCoverPath(Guid bookId)
    {
        var folder = Path.Combine(_root, bookId.ToString());
        if (!Directory.Exists(folder))
            return null;

        return Directory
            .EnumerateFiles(folder, "cover.*")
            .FirstOrDefault(f => _allowedCoverExtensions.Contains(Path.GetExtension(f)));
    }

    /// <summary>
    /// A cached, resized WebP copy of the cover for list views.
    ///
    /// The cache is invalidated by <see cref="SaveBookCoverAsync(Guid, Stream, string, CancellationToken)"/>,
    /// which discards these thumbnails whenever the cover itself is replaced —
    /// otherwise a replaced cover would keep showing its old artwork in the
    /// library grid while the detail view showed the new one.
    /// </summary>
    public async Task<string?> GetBookCoverThumbnailPathAsync(
        Guid bookId,
        int width,
        CancellationToken ct = default
    )
    {
        var coverPath = GetBookCoverPath(bookId);
        if (coverPath is null)
            return null;

        var safeWidth = Math.Clamp(width, 120, 640);
        var thumbnailPath = Path.Combine(
            Path.GetDirectoryName(coverPath)!,
            $"cover-thumb-{safeWidth}.webp"
        );

        if (File.Exists(thumbnailPath))
            return thumbnailPath;

        using var image = await Image.LoadAsync(coverPath, ct);
        image.Mutate(context => context.Resize(new ResizeOptions
        {
            Size = new Size(safeWidth, 0),
            Mode = ResizeMode.Max,
        }));

        await image.SaveAsWebpAsync(
            thumbnailPath,
            new WebpEncoder { Quality = 82 },
            ct
        );

        return thumbnailPath;
    }

    public bool DeleteCover(Guid bookId)
    {
        var coverPath = GetBookCoverPath(bookId);
        if (coverPath is null)
            return false;

        File.Delete(coverPath);
        return true;
    }

    private string BookFolder(Guid bookId) => Path.Combine(_root, bookId.ToString());

    /// <summary>
    /// The in-progress file lives beside its destination, never in a shared
    /// temp directory: the final move is then a same-volume rename, which is
    /// atomic, instead of a copy that could be interrupted half way.
    /// </summary>
    private static string TempSiblingPath(string folder, string finalPath) =>
        Path.Combine(folder, Path.GetFileName(finalPath) + ".partial");

    private static async Task WriteStreamAsync(Stream content, string path, CancellationToken ct)
    {
        await using var destination = new FileStream(
            path,
            FileMode.Create,
            FileAccess.Write,
            FileShare.None,
            CopyBufferSize,
            useAsync: true);

        await content.CopyToAsync(destination, CopyBufferSize, ct);
        await destination.FlushAsync(ct);
    }

    private void DeleteExistingBookFiles(string bookFolder, string except)
    {
        foreach (var existingFile in Directory.EnumerateFiles(bookFolder))
        {
            if (!_allowedBookExtensions.Contains(Path.GetExtension(existingFile)))
                continue;

            if (string.Equals(existingFile, except, StringComparison.Ordinal))
                continue;

            TryDelete(existingFile);
        }
    }

    private void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
                File.Delete(path);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to delete file during cleanup: {FileName}", path);
        }
    }
}
