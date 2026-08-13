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

    Task<LibraryCommandResultDto> DeleteCollectionAsync(LibraryDeleteCollectionRequest request, CancellationToken ct = default);
}
