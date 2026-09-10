using System.ComponentModel;
using ModelContextProtocol.Server;
using Nostos.Backend.Services.Library;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Integrations.Mcp;

/// <summary>
/// Library MCP tools (issue #34). Every tool forwards to the canonical
/// <see cref="ILibraryService"/> — the sole authority for books and
/// collections — and returns its envelope unchanged: no EF, filesystem,
/// title-matching, or external lookup logic lives here. Read-only tools never
/// mutate; every mutation requires a caller-supplied idempotency key, uses
/// the fixed client id <see cref="ClientId"/>, and delegates exactly once
/// (retries are the caller's concern; the service owns duplicate convergence).
/// </summary>
[McpServerToolType]
public sealed class LibraryMcpTools
{
    // Stable client identity for the Nostos MCP surface (same value as the
    // reading tools): receipts are keyed by (ClientId, IdempotencyKey), so a
    // fixed id keeps MCP retries converging across sessions.
    private const string ClientId = "nostos-mcp";

    private readonly ILibraryService _service;

    public LibraryMcpTools(ILibraryService service)
    {
        _service = service;
    }

    [McpServerTool(Name = "library_list_books", ReadOnly = true)]
    [Description("Lists the Nostos library books with filtering, sorting, search, and pagination.")]
    public Task<LibraryCommandResultDto> ListBooksAsync(
        [Description("Filter: All, Favorites, Finished, Reading, or Unsorted.")] BookFilter filter = BookFilter.All,
        [Description("Sort: Recent, Title, Rating, or LastRead.")] BookSort sort = BookSort.Recent,
        [Description("Optional free-text search on title or author.")] string? search = null,
        [Description("Page number, 1-based (clamped to at least 1).")] int page = 1,
        [Description("Page size, clamped to 1..100.")] int pageSize = 20,
        [Description("Optional collection id to restrict the listing to.")] Guid? collectionId = null,
        CancellationToken ct = default) =>
        _service.ListBooksAsync(filter, sort, search, page, pageSize, collectionId, ct: ct);

    [McpServerTool(Name = "library_get_book", ReadOnly = true)]
    [Description("Gets one book from the Nostos library by id.")]
    public Task<LibraryCommandResultDto> GetBookAsync(
        [Description("Id of the book to fetch.")] Guid bookId,
        CancellationToken ct = default) =>
        _service.GetBookAsync(bookId, ct);

    [McpServerTool(Name = "library_resolve_book", ReadOnly = true)]
    [Description("Resolves book identity against the Nostos library without mutating anything. Returns resolution exact_match (with matchedBook), candidates (with matching rows and reasons), not_found (with optional external metadata prefill when includeExternalMetadata is true and an ISBN is given), or identity_conflict (ISBN and ASIN resolve to different books). Metadata being found externally is NOT membership in the library.")]
    public Task<LibraryResolveResult> ResolveBookAsync(
        [Description("Optional ISBN to resolve (ISBN-10 or ISBN-13; formatting is ignored).")] string? isbn = null,
        [Description("Optional ASIN to resolve (10-character Amazon identifier).")] string? asin = null,
        [Description("Optional title to match (exact normalized title, alone or with author).")] string? title = null,
        [Description("Optional author to match together with the title.")] string? author = null,
        [Description("Optional: consult external metadata sources for a create-prefill when the book is not in the library (default true).")] bool includeExternalMetadata = true,
        CancellationToken ct = default) =>
        _service.ResolveBookAsync(new LibraryResolveBookRequest(isbn, asin, title, author, includeExternalMetadata), ct);

    [McpServerTool(Name = "library_create_or_match_book")]
    [Description("Adds a book to the Nostos library, or matches an existing one by normalized identity. Resolution order: confirmedBookId, then exact ISBN/ASIN, then exactly one exact title+author match; exact matches return outcome 'matched' without creating. Multiple title+author matches or ambiguous bare titles return error code confirmation_required with candidates — do NOT guess; ask the user, then call again with a NEW idempotencyKey and either confirmedBookId (use an existing candidate) or forceCreate=true (create anyway). Never reuse the first key after confirmation_required; failed or ambiguous receipts replay. When created, the returned data carries outcome 'created', the canonical bookId, and the full book.")]
    public Task<LibraryCommandResultDto> CreateOrMatchBookAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command. Use a NEW key after a confirmation_required response.")] string idempotencyKey,
        [Description("Book type: physical, ebook, or audiobook.")] string type,
        [Description("Book title (required).")] string title,
        [Description("Optional subtitle.")] string? subtitle = null,
        [Description("Optional author.")] string? author = null,
        [Description("Optional editor.")] string? editor = null,
        [Description("Optional translator.")] string? translator = null,
        [Description("Optional narrator (audiobooks).")] string? narrator = null,
        [Description("Optional description/blurb.")] string? description = null,
        [Description("Optional ISBN (ISBN-10 or ISBN-13; formatting is ignored).")] string? isbn = null,
        [Description("Optional ASIN (audiobooks).")] string? asin = null,
        [Description("Optional audiobook duration.")] string? duration = null,
        [Description("Optional publisher.")] string? publisher = null,
        [Description("Optional place of publication.")] string? placeOfPublication = null,
        [Description("Optional publication date.")] string? publishedDate = null,
        [Description("Optional edition.")] string? edition = null,
        [Description("Optional page count.")] int? pageCount = null,
        [Description("Optional language.")] string? language = null,
        [Description("Optional categories.")] string? categories = null,
        [Description("Optional series.")] string? series = null,
        [Description("Optional volume number.")] string? volumeNumber = null,
        [Description("Optional collection id to place the book in.")] Guid? collectionId = null,
        [Description("Optional rating 0-5.")] int rating = 0,
        [Description("Optional favorite flag.")] bool isFavorite = false,
        [Description("Optional personal review.")] string? personalReview = null,
        [Description("Optional finished timestamp.")] DateTime? finishedAt = null,
        [Description("Optional: after confirmation_required, the id of the existing candidate to use instead of creating. Requires a NEW idempotencyKey.")] Guid? confirmedBookId = null,
        [Description("Optional: create anyway despite matching candidates. Requires a NEW idempotencyKey after confirmation_required.")] bool forceCreate = false,
        CancellationToken ct = default) =>
        _service.CreateOrMatchBookAsync(new LibraryCreateBookRequest(
            ClientId, idempotencyKey, type, title,
            subtitle, author, editor, translator, narrator,
            description, isbn, asin, duration,
            publisher, placeOfPublication, publishedDate, edition,
            pageCount, language, categories, series, volumeNumber,
            collectionId, rating, isFavorite, personalReview, finishedAt,
            confirmedBookId, forceCreate), strictConfirmation: true, ct);

    [McpServerTool(Name = "library_update_book")]
    [Description("Updates metadata of an existing Nostos book. Null fields are left unchanged; an empty string clears a text field; ClearCollection=true removes the book from its collection. Identifier changes are validated: an ISBN/ASIN already held by another book returns duplicate_identifier.")]
    public Task<LibraryCommandResultDto> UpdateBookAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        [Description("Id of the book to update.")] Guid bookId,
        [Description("Optional new title (empty string is rejected).")] string? title = null,
        [Description("Optional subtitle; empty string clears.")] string? subtitle = null,
        [Description("Optional author; empty string clears.")] string? author = null,
        [Description("Optional editor; empty string clears.")] string? editor = null,
        [Description("Optional translator; empty string clears.")] string? translator = null,
        [Description("Optional narrator; empty string clears.")] string? narrator = null,
        [Description("Optional description; empty string clears.")] string? description = null,
        [Description("Optional ISBN; empty string clears.")] string? isbn = null,
        [Description("Optional ASIN; empty string clears.")] string? asin = null,
        [Description("Optional audiobook duration; empty string clears.")] string? duration = null,
        [Description("Optional publisher; empty string clears.")] string? publisher = null,
        [Description("Optional place of publication; empty string clears.")] string? placeOfPublication = null,
        [Description("Optional publication date; empty string clears.")] string? publishedDate = null,
        [Description("Optional edition; empty string clears.")] string? edition = null,
        [Description("Optional page count.")] int? pageCount = null,
        [Description("Optional language; empty string clears.")] string? language = null,
        [Description("Optional categories; empty string clears.")] string? categories = null,
        [Description("Optional series; empty string clears.")] string? series = null,
        [Description("Optional volume number; empty string clears.")] string? volumeNumber = null,
        [Description("Optional collection id to move the book into.")] Guid? collectionId = null,
        [Description("Optional: true removes the book from its collection.")] bool clearCollection = false,
        [Description("Optional rating 0-5.")] int? rating = null,
        [Description("Optional favorite flag.")] bool? isFavorite = null,
        [Description("Optional personal review; empty string clears.")] string? personalReview = null,
        [Description("Optional finished timestamp.")] DateTime? finishedAt = null,
        [Description("Optional finish/unfinish tri-state: true marks finished (sets 100%), false clears the finished state.")] bool? isFinished = null,
        CancellationToken ct = default) =>
        _service.UpdateBookAsync(new LibraryUpdateBookRequest(
            ClientId, idempotencyKey, bookId,
            title, subtitle, author, editor, translator, narrator,
            description, isbn, asin, duration,
            publisher, placeOfPublication, publishedDate, edition,
            pageCount, language, categories, series, volumeNumber,
            collectionId, clearCollection, rating, isFavorite, personalReview, finishedAt, isFinished), ct);

    // ------------------------------------------------------------------
    // Collections
    // ------------------------------------------------------------------

    [McpServerTool(Name = "library_list_collections", ReadOnly = true)]
    [Description("Lists all Nostos collections as a flat list (id, name, parentId). Collection order is not persisted; treat the order as presentation-only.")]
    public Task<LibraryCommandResultDto> ListCollectionsAsync(CancellationToken ct = default) =>
        _service.ListCollectionsAsync(ct);

    [McpServerTool(Name = "library_get_collection", ReadOnly = true)]
    [Description("Gets one Nostos collection by id.")]
    public Task<LibraryCommandResultDto> GetCollectionAsync(
        [Description("Id of the collection to fetch.")] Guid collectionId,
        CancellationToken ct = default) =>
        _service.GetCollectionAsync(collectionId, ct);

    [McpServerTool(Name = "library_create_collection")]
    [Description("Creates a Nostos collection. A sibling with the same normalized name under the same parent returns the existing collection (reply says it already exists) instead of creating a duplicate.")]
    public Task<LibraryCommandResultDto> CreateCollectionAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        [Description("Collection name (required).")] string name,
        [Description("Optional parent collection id; omit or null for a top-level collection.")] Guid? parentId = null,
        CancellationToken ct = default) =>
        _service.CreateCollectionAsync(new LibraryCreateCollectionRequest(
            ClientId, idempotencyKey, name, parentId), ct);

    [McpServerTool(Name = "library_rename_collection")]
    [Description("Renames a Nostos collection. A sibling with the same normalized name under the same parent returns collection_name_conflict.")]
    public Task<LibraryCommandResultDto> RenameCollectionAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        [Description("Id of the collection to rename.")] Guid collectionId,
        [Description("New name (required).")] string name,
        CancellationToken ct = default) =>
        _service.RenameCollectionAsync(new LibraryRenameCollectionRequest(
            ClientId, idempotencyKey, collectionId, name), ct);

    [McpServerTool(Name = "library_move_collection")]
    [Description("Moves a Nostos collection under a new parent (null/omitted parentId moves it to the top level). Moving into its own descendant returns collection_cycle; a sibling with the same name at the destination returns collection_name_conflict; books stay in place.")]
    public Task<LibraryCommandResultDto> MoveCollectionAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        [Description("Id of the collection to move.")] Guid collectionId,
        [Description("Optional new parent id; null moves the collection to the top level.")] Guid? newParentId = null,
        CancellationToken ct = default) =>
        _service.MoveCollectionAsync(new LibraryMoveCollectionRequest(
            ClientId, idempotencyKey, collectionId, newParentId), ct);

    [McpServerTool(Name = "library_delete_collection")]
    [Description("Deletes a Nostos collection (confirm=true required). Books in the collection are unlinked, never deleted; the deletion is rejected with collection_has_children while the collection has child collections.")]
    public Task<LibraryCommandResultDto> DeleteCollectionAsync(
        [Description("Caller-supplied key that makes retries of this command exact-once: reuse the same key to replay the same command.")] string idempotencyKey,
        [Description("Id of the collection to delete.")] Guid collectionId,
        [Description("Must be true to delete; the server rejects deletion without explicit confirmation.")] bool confirm,
        CancellationToken ct = default) =>
        _service.DeleteCollectionAsync(new LibraryDeleteCollectionRequest(
            ClientId, idempotencyKey, collectionId, confirm), ct);
}
