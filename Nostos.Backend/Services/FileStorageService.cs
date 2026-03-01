namespace Nostos.Backend.Services;

public class FileStorageService : IFileStorageService
{
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

    public FileStorageService(IWebHostEnvironment env, ILogger<FileStorageService> logger)
    {
        _root = Path.Combine(env.ContentRootPath, "Storage", "books");
        _logger = logger;
        Directory.CreateDirectory(_root);
    }

    public async Task<string> SaveBookFileAsync(Guid bookId, IFormFile file)
    {
        var ext = Path.GetExtension(file.FileName);
        if (!_allowedBookExtensions.Contains(ext))
            throw new InvalidOperationException($"Unsupported file type: {ext}");

        var bookFolder = Path.Combine(_root, bookId.ToString());
        Directory.CreateDirectory(bookFolder);

        // Clean up existing book files to ensure only one "book.*" exists
        // ignoring the current operation's target if it were to somehow exist already
        var existingFiles = Directory
            .EnumerateFiles(bookFolder)
            .Where(f => _allowedBookExtensions.Contains(Path.GetExtension(f)))
            .ToList();

        foreach (var existingFile in existingFiles)
        {
            try
            {
                File.Delete(existingFile);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "Failed to delete existing file during cleanup: {FileName}",
                    existingFile
                );
            }
        }

        // Normalize filename to "book" + extension
        var fileName = $"book{ext}";
        var filePath = Path.Combine(bookFolder, fileName);

        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        return filePath;
    }

    public FileStream? GetBookFile(Guid bookId)
    {
        var folder = Path.Combine(_root, bookId.ToString());
        if (!Directory.Exists(folder))
            return null;

        var file = Directory
            .EnumerateFiles(folder)
            .FirstOrDefault(f => _allowedBookExtensions.Contains(Path.GetExtension(f)));

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
        var ext = Path.GetExtension(file.FileName).ToLower();
        if (!_allowedCoverExtensions.Contains(ext))
            throw new InvalidOperationException("Only PNG, JPG, or JPEG allowed.");

        var bookFolder = Path.Combine(_root, bookId.ToString());
        Directory.CreateDirectory(bookFolder);

        // Delete any existing cover files first
        foreach (var existing in Directory.EnumerateFiles(bookFolder, "cover.*"))
        {
            try
            {
                File.Delete(existing);
            }
            catch
            { /* best effort */
            }
        }

        var coverFileName = $"cover{ext}";
        var filePath = Path.Combine(bookFolder, coverFileName);

        using var stream = new FileStream(filePath, FileMode.Create);
        await file.CopyToAsync(stream);

        return filePath;
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

    public bool DeleteCover(Guid bookId)
    {
        var coverPath = GetBookCoverPath(bookId);
        if (coverPath is null)
            return false;

        File.Delete(coverPath);
        return true;
    }
}
