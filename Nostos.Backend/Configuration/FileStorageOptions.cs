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
    /// Where <c>.nostos</c> backup archives are written and read. Absolute, or a
    /// path relative to the content root. Defaults to a <c>backups</c> directory
    /// beside the resolved books root.
    /// </summary>
    public string? BackupsRoot { get; set; }

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

    /// <summary>
    /// The effective absolute backup directory.
    ///
    /// Unset, this sits BESIDE the resolved books root rather than under the
    /// content root. Two reasons, and both are the bug this replaced:
    ///
    /// * a self-hoster who puts the library on a larger volume expects the
    ///   backups of that library to land on the same volume, not on whatever
    ///   disk — often an ephemeral container layer — holds the application;
    /// * in a development worktree <c>Nostos.Backend/Storage</c> is a symlink to
    ///   the shared tree, so a content-root-relative default writes archives into
    ///   the real install's backup directory.
    ///
    /// With the default books root this resolves to exactly the historical
    /// <c>&lt;contentRoot&gt;/Storage/backups</c>, so nothing moves for an existing
    /// deployment.
    /// </summary>
    public static string ResolveBackupsRoot(
        string contentRootPath,
        string booksRoot,
        FileStorageOptions? options)
    {
        var configured = options?.BackupsRoot;
        if (!string.IsNullOrWhiteSpace(configured))
            return Path.GetFullPath(
                Path.IsPathRooted(configured) ? configured : Path.Combine(contentRootPath, configured));

        var parent = Path.GetDirectoryName(booksRoot);
        return Path.Combine(string.IsNullOrEmpty(parent) ? booksRoot : parent, "backups");
    }
}
