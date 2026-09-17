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
    void DeleteBookFiles(Guid bookId);

    Task<string> SaveBookCoverAsync(Guid bookId, IFormFile file);

    /// <summary>Stream-based cover twin of <see cref="SaveBookFileAsync(Guid, Stream, string, CancellationToken)"/>.</summary>
    Task<string> SaveBookCoverAsync(Guid bookId, Stream content, string fileName, CancellationToken ct = default);

    string? GetBookCoverPath(Guid bookId);
    Task<string?> GetBookCoverThumbnailPathAsync(Guid bookId, int width, CancellationToken ct = default);
    bool DeleteCover(Guid bookId);
}
