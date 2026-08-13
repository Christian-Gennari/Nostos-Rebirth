using System;
using System.Threading;
using System.Threading.Tasks;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Services.Library;

/// <summary>
/// Canonical library domain service. REST endpoints, MCP tools and the UI all
/// call this one service; no surface computes or caches authoritative library
/// state. Mutations are exact-once through LibraryCommandReceipt.
/// </summary>
public interface ILibraryService
{
    // --- Read-only ---
    Task<LibraryCommandResultDto> ListBooksAsync(
        BookFilter filter,
        BookSort sort,
        string? search,
        int page,
        int pageSize,
        Guid? collectionId,
        CancellationToken ct = default);

    Task<LibraryCommandResultDto> GetBookAsync(Guid bookId, CancellationToken ct = default);

    Task<LibraryResolveResult> ResolveBookAsync(LibraryResolveBookRequest request, CancellationToken ct = default);

    Task<LibraryCommandResultDto> ListCollectionsAsync(CancellationToken ct = default);

    /// <summary>
    /// REST-only descendant-inclusive book counts for every collection
    /// (sidebar). One grouped query for direct counts, then a post-order
    /// rollup in memory; never one query per collection.
    /// </summary>
    Task<LibraryCommandResultDto> ListCollectionCountsAsync(CancellationToken ct = default);

    Task<LibraryCommandResultDto> GetCollectionAsync(Guid collectionId, CancellationToken ct = default);

    // --- Mutations (all exact-once) ---
    /// <summary>
    /// Create or match a book by normalized identity. When
    /// <paramref name="strictConfirmation"/> is true (MCP), ambiguity returns
    /// confirmation_required instead of creating; when false (REST, preserving
    /// legacy UI behavior), ambiguity auto-creates while exact matches still
    /// match.
    /// </summary>
    Task<LibraryCommandResultDto> CreateOrMatchBookAsync(
        LibraryCreateBookRequest request,
        bool strictConfirmation,
        CancellationToken ct = default);

    Task<LibraryCommandResultDto> UpdateBookAsync(LibraryUpdateBookRequest request, CancellationToken ct = default);

    /// <summary>
    /// High-frequency progress update. Deliberately NOT receipt-guarded
    /// (last-write-wins, idempotent by nature); validates 0..100 and keeps
    /// FinishedAt aligned with the percentage.
    /// </summary>
    Task<LibraryCommandResultDto> UpdateProgressAsync(Guid bookId, string location, int percentage, CancellationToken ct = default);

    /// <summary>
    /// Deletes the library row first (reading/notes FKs reject in-use books
    /// with book_in_use before any file is touched); the caller removes
    /// storage files only after this succeeds.
    /// </summary>
    Task<LibraryCommandResultDto> DeleteBookAsync(Guid bookId, CancellationToken ct = default);

    Task<LibraryCommandResultDto> CreateCollectionAsync(LibraryCreateCollectionRequest request, CancellationToken ct = default);

    Task<LibraryCommandResultDto> RenameCollectionAsync(LibraryRenameCollectionRequest request, CancellationToken ct = default);

    Task<LibraryCommandResultDto> MoveCollectionAsync(LibraryMoveCollectionRequest request, CancellationToken ct = default);

    /// <summary>
    /// Atomic full-replacement update (collections Phase 1): renames and/or
    /// moves a collection in ONE transaction with ONE receipt and at most
    /// ONE stateVersion bump. Missing/invalid name, invalid parent, cycles
    /// and normalized sibling collisions reject the whole update. When name
    /// and parent are both unchanged the operation succeeds as a no-op
    /// (receipt written, stateVersion untouched).
    /// </summary>
    Task<LibraryCommandResultDto> UpdateCollectionAsync(
        string clientId,
        string idempotencyKey,
        Guid collectionId,
        string name,
        Guid? parentId,
        CancellationToken ct = default);

    Task<LibraryCommandResultDto> DeleteCollectionAsync(LibraryDeleteCollectionRequest request, CancellationToken ct = default);
}
