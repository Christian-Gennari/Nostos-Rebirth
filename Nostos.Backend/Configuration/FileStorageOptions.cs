namespace Nostos.Backend.Configuration;

/// <summary>
/// Where locally stored book files live.
///
/// The root is configurable because it is not always the app's own content
/// directory: tests must never be able to write into a real library (the
/// development worktree symlinks <c>Nostos.Backend/Storage</c> straight to the
/// production directory), and a self-hosted deployment may reasonably want a
/// bigger volume for media than the one holding the application.
/// </summary>
public sealed class FileStorageOptions
{
    public const string SectionName = "Storage";

    /// <summary>
    /// Absolute path, or a path relative to the content root. Defaults to
    /// <c>Storage/books</c> when unset, which is the historical layout.
    /// </summary>
    public string? BooksRoot { get; set; }

    /// <summary>
    /// The effective absolute root. Kept as one function so the storage service
    /// and any other consumer (backups) can never disagree about where the
    /// library's files actually are.
    /// </summary>
    public static string ResolveBooksRoot(string contentRootPath, FileStorageOptions? options)
    {
        var configured = options?.BooksRoot;
        if (string.IsNullOrWhiteSpace(configured))
            return Path.GetFullPath(Path.Combine(contentRootPath, "Storage", "books"));

        return Path.GetFullPath(
            Path.IsPathRooted(configured) ? configured : Path.Combine(contentRootPath, configured));
    }
}
