namespace Nostos.Backend.Services;

public interface IFileStorageService
{
    /// <summary>
    /// Absolute directory that holds every book's files. Exposed so other
    /// components (backups) resolve the same location instead of rebuilding the
    /// path by hand and silently drifting from this service.
    /// </summary>
    string StorageRoot { get; }

    Task<string> SaveBookFileAsync(Guid bookId, IFormFile file);

    /// <summary>
    /// Stores a book's primary file from a stream.
    ///
    /// This is the lower-level primitive: browser uploads go through the
    /// <see cref="IFormFile"/> overload, which is a thin wrapper over it, and
    /// remotely acquired content (which has no <see cref="IFormFile"/>) uses it
    /// directly. One code path means one set of format rules and one set of
    /// storage invariants.
    ///
    /// The file is written to a temporary sibling first and moved into place
    /// only once the stream has been fully consumed, so a failed, aborted or
    /// cancelled transfer can never leave a half-written file where a reader
    /// would find it.
    /// </summary>
    Task<string> SaveBookFileAsync(Guid bookId, Stream content, string fileName, CancellationToken ct = default);

    FileStream? GetBookFile(Guid bookId);
    string? GetBookFileName(Guid bookId);
    /// <summary>
    /// Removes only a book's primary file, leaving any cover in place. Used to
    /// undo a file that was put into storage when the matching database write
    /// then failed, so the rollback cannot also destroy an unrelated cover.
    /// </summary>
    bool DeleteBookFile(Guid bookId);

    void DeleteBookFiles(Guid bookId);

    Task<string> SaveBookCoverAsync(Guid bookId, IFormFile file);

    /// <summary>Stream-based cover twin of <see cref="SaveBookFileAsync(Guid, Stream, string, CancellationToken)"/>.</summary>
    Task<string> SaveBookCoverAsync(Guid bookId, Stream content, string fileName, CancellationToken ct = default);

    /// <summary>
    /// Moves a file the caller has already materialised into a book's storage
    /// folder.
    ///
    /// Acquisition downloads and normalises large media — a feature-length
    /// audiobook runs to hundreds of megabytes — into a staging directory, and
    /// then has to put the result in place without keeping a second full copy of
    /// it. The destination is derived entirely from <paramref name="bookId"/> and
    /// a validated extension; only the source is a path, and it is expected to be
    /// a file the caller itself produced in its own staging area.
    /// </summary>
    Task<string> AdoptBookFileAsync(Guid bookId, string sourcePath, string fileName, CancellationToken ct = default);

    string? GetBookCoverPath(Guid bookId);
    Task<string?> GetBookCoverThumbnailPathAsync(Guid bookId, int width, CancellationToken ct = default);
    bool DeleteCover(Guid bookId);
}
