using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Mapping;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Services.Library;

/// <summary>
/// Canonical library domain service (issue #34). REST endpoints, MCP tools and
/// the Angular UI all call this one service; it is the single writer for
/// books and collections. Mutations are exact-once through
/// LibraryCommandReceipt (separate from reading receipts on purpose).
/// </summary>
public sealed class LibraryService : ILibraryService
{
    // Process-local gate serializes library mutations (mirror of the reading
    // service). Static so the gate is shared across scoped service instances.
    private static readonly SemaphoreSlim CommandGate = new(1, 1);
    private static readonly JsonSerializerOptions ReceiptJson = new(JsonSerializerDefaults.Web)
    {
        Converters = { new LibraryCommandResultJsonConverter() },
    };

    private readonly IDbContextFactory<NostosDbContext> _contexts;
    private readonly BookLookupService _lookup;

    public LibraryService(IDbContextFactory<NostosDbContext> contexts, BookLookupService lookup)
    {
        _contexts = contexts;
        _lookup = lookup;
    }

    private DateTime Now => DateTime.UtcNow;

    // ------------------------------------------------------------------
    // Read-only surface
    // ------------------------------------------------------------------

    public async Task<LibraryCommandResultDto> ListBooksAsync(
        BookFilter filter,
        BookSort sort,
        string? search,
        int page,
        int pageSize,
        Guid? collectionId,
        bool? groupByWork = false,
        string? format = null,
        CancellationToken ct = default)
    {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var state = await TryGetStateAsync(db, ct);
        var version = state?.StateVersion ?? "0";

        var safePage = Math.Max(1, page);
        var safePageSize = Math.Clamp(pageSize, 1, 100);

        var query = db.Books.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = $"%{search}%";
            query = query.Where(b =>
                EF.Functions.Like(b.Title, term) || EF.Functions.Like(b.Author, term));
        }

        if (!string.IsNullOrWhiteSpace(format))
        {
            switch (format.Trim().ToLowerInvariant())
            {
                case "audiobook":
                case "audio":
                    query = query.Where(b => b is AudioBookModel);
                    break;
                case "pdf":
                    query = query.Where(b => b.FileDetails.FileName != null && EF.Functions.Like(b.FileDetails.FileName, "%.pdf"));
                    break;
                case "ebook":
                case "epub":
                    query = query.Where(b => b is EBookModel && (b.FileDetails.FileName == null || !EF.Functions.Like(b.FileDetails.FileName, "%.pdf")));
                    break;
                case "physical":
                    query = query.Where(b => b is PhysicalBookModel);
                    break;
            }
        }

        query = filter switch
        {
            BookFilter.Favorites => query.Where(b => b.Progress.IsFavorite),
            BookFilter.Finished => query.Where(b => b.Progress.FinishedAt != null),
            BookFilter.Reading => query.Where(b => b.Progress.FinishedAt == null && b.Progress.ProgressPercent > 0),
            BookFilter.NotStarted => query.Where(b => b.Progress.ProgressPercent == 0),
            BookFilter.Unsorted => query.Where(b => b.CollectionId == null),
            _ => query,
        };

        if (collectionId.HasValue)
        {
            // Recursive filter (collections Phase 1): selecting a parent
            // collection includes books assigned to ANY descendant. The
            // subtree is expanded in memory from the flat id/parent list
            // (no SQL CTE); the small HashSet translates to IN (...).
            var collections = await db.Collections.AsNoTracking()
                .Select(c => new CollectionModel { Id = c.Id, ParentId = c.ParentId })
                .ToListAsync(ct);
            var subtreeIds = GetSubtreeIds(collectionId.Value, collections);
            query = query.Where(b => b.CollectionId.HasValue && subtreeIds.Contains(b.CollectionId.Value));
        }

        PaginatedResponse<BookDto> pageResult;
        int totalCount;
        if (groupByWork == true)
        {
            // Group after all book-level filters have been applied, but before
            // pagination. A work therefore occupies one page slot while the
            // primary still reflects the filtered result (for example, a
            // favorites query can select a favorite edition).
            var candidates = await query
                .Include(b => b.Work)
                .ToListAsync(ct);

            var candidateWorkIds = candidates.Select(c => c.WorkId).Distinct().ToList();
            var siblingBooks = await db.Books.AsNoTracking()
                .Where(b => candidateWorkIds.Contains(b.WorkId))
                .ToListAsync(ct);
            var siblingsByWork = siblingBooks
                .GroupBy(b => b.WorkId)
                .ToDictionary(g => g.Key, g => g.ToList());

            var grouped = candidates
                .GroupBy(b => b.WorkId)
                .Select(g =>
                {
                    var primary = SelectPrimaryEdition(g);
                    var allEditions = siblingsByWork.GetValueOrDefault(primary.WorkId) ?? g.ToList();
                    var dto = primary.ToDto() with
                    {
                        WorkId = primary.WorkId,
                        EditionCount = allEditions.Count,
                        OtherEditions = allEditions
                            .Where(b => b.Id != primary.Id)
                            .Select(MappingExtensions.ToEditionSummary)
                            .ToList(),
                    };
                    return new GroupedBook(primary, dto);
                })
                .ToList();

            grouped = SortGroupedBooks(grouped, sort).ToList();
            totalCount = grouped.Count;
            pageResult = new PaginatedResponse<BookDto>(
                grouped
                    .Skip((safePage - 1) * safePageSize)
                    .Take(safePageSize)
                    .Select(g => g.Dto),
                totalCount,
                safePage,
                safePageSize);
        }
        else
        {
            query = sort switch
            {
                BookSort.Title => query.OrderBy(b => b.Title),
                BookSort.Rating => query.OrderByDescending(b => b.Progress.Rating),
                BookSort.LastRead => query.OrderByDescending(b => b.Progress.LastReadAt.HasValue)
                    .ThenByDescending(b => b.Progress.LastReadAt),
                _ => query.OrderByDescending(b => b.CreatedAt),
            };

            totalCount = await query.CountAsync(ct);
            var items = await query
                .Include(b => b.Work)
                .Skip((safePage - 1) * safePageSize)
                .Take(safePageSize)
                .ToListAsync(ct);

            var pageWorkIds = items.Select(b => b.WorkId).Distinct().ToList();
            var pageSiblings = await db.Books.AsNoTracking()
                .Where(b => pageWorkIds.Contains(b.WorkId))
                .ToListAsync(ct);
            var pageSiblingsByWork = pageSiblings
                .GroupBy(b => b.WorkId)
                .ToDictionary(g => g.Key, g => g.ToList());

            var dtoList = items.Select(b =>
            {
                var siblings = pageSiblingsByWork.GetValueOrDefault(b.WorkId) ?? [b];
                return b.ToDto() with
                {
                    WorkId = b.WorkId,
                    EditionCount = siblings.Count,
                    OtherEditions = siblings
                        .Where(s => s.Id != b.Id)
                        .Select(MappingExtensions.ToEditionSummary)
                        .ToList()
                };
            }).ToList();

            pageResult = new PaginatedResponse<BookDto>(
                dtoList,
                totalCount,
                safePage,
                safePageSize);
        }

        return Result(LibraryReplyFormatter.BookList(totalCount), pageResult, version);
    }

    public async Task<LibraryCommandResultDto> GetStatusCountsAsync(CancellationToken ct = default)
    {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var state = await TryGetStateAsync(db, ct);
        var version = state?.StateVersion ?? "0";

        var all = await db.Books.AsNoTracking().CountAsync(ct);
        var notStarted = await db.Books.AsNoTracking().CountAsync(b => b.Progress.ProgressPercent == 0, ct);
        var reading = await db.Books.AsNoTracking().CountAsync(b => b.Progress.FinishedAt == null && b.Progress.ProgressPercent > 0, ct);
        var favorites = await db.Books.AsNoTracking().CountAsync(b => b.Progress.IsFavorite, ct);
        var finished = await db.Books.AsNoTracking().CountAsync(b => b.Progress.FinishedAt != null, ct);
        var unsorted = await db.Books.AsNoTracking().CountAsync(b => b.CollectionId == null, ct);
        var audiobooks = await db.Books.AsNoTracking().OfType<AudioBookModel>().CountAsync(ct);
        var pdfs = await db.Books.AsNoTracking().CountAsync(
            b => b.FileDetails.FileName != null && EF.Functions.Like(b.FileDetails.FileName, "%.pdf"), ct);
        var ebooks = await db.Books.AsNoTracking().OfType<EBookModel>().CountAsync(
            b => b.FileDetails.FileName == null || !EF.Functions.Like(b.FileDetails.FileName, "%.pdf"), ct);

        var counts = new LibraryStatusCountsDto(
            all, notStarted, reading, favorites, finished, unsorted, audiobooks, ebooks, pdfs);

        return Result(LibraryReplyFormatter.Success("Status counts retrieved."), counts, version);
    }

    public async Task<LibraryCommandResultDto> GetBookAsync(Guid bookId, CancellationToken ct = default)
    {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var state = await TryGetStateAsync(db, ct);
        var version = state?.StateVersion ?? "0";

        var book = await db.Books.AsNoTracking().SingleOrDefaultAsync(b => b.Id == bookId, ct);
        if (book is null)
            return Failure("book_not_found", LibraryReplyFormatter.BookNotFound, version);

        var siblings = await db.Books.AsNoTracking()
            .Where(b => b.WorkId == book.WorkId)
            .ToListAsync(ct);

        var dto = book.ToDto() with
        {
            WorkId = book.WorkId,
            EditionCount = siblings.Count,
            OtherEditions = siblings
                .Where(s => s.Id != book.Id)
                .Select(MappingExtensions.ToEditionSummary)
                .ToList()
        };

        return Result(LibraryReplyFormatter.Book(book.Title), dto, version);
    }

    public async Task<LibraryResolveResult> ResolveBookAsync(LibraryResolveBookRequest request, CancellationToken ct = default)
    {
        var nIsbn = BookIdentityNormalizer.NormalizeIsbn(request.Isbn);
        var nAsin = BookIdentityNormalizer.NormalizeAsin(request.Asin);
        var nTitle = BookIdentityNormalizer.NormalizeTitle(request.Title);
        var nAuthor = BookIdentityNormalizer.NormalizeAuthor(request.Author);

        await using var db = await _contexts.CreateDbContextAsync(ct);
        // Read-only: never creates the state row (strict read-only contract).

        // 1. Identifier resolution first (authoritative, indexed).
        BookModel? isbnMatch = null;
        BookModel? asinMatch = null;
        if (nIsbn is not null)
            isbnMatch = await db.Books.AsNoTracking().SingleOrDefaultAsync(b => b.NormalizedIsbn == nIsbn, ct);
        if (nAsin is not null)
            asinMatch = await db.Books.AsNoTracking().SingleOrDefaultAsync(b => b.NormalizedAsin == nAsin, ct);

        if (isbnMatch is not null && asinMatch is not null && isbnMatch.Id != asinMatch.Id)
            return new LibraryResolveResult(LibraryResolution.IdentityConflict);

        if (isbnMatch is not null)
            return new LibraryResolveResult(LibraryResolution.ExactMatch, isbnMatch.ToDto());
        if (asinMatch is not null)
            return new LibraryResolveResult(LibraryResolution.ExactMatch, asinMatch.ToDto());

        // 2. Title/author resolution (in-memory; personal library scale).
        //    Exact matching requires BOTH title and author: a title-only
        //    request yields candidates, never an automatic match.
        if (!string.IsNullOrEmpty(nTitle))
        {
            var all = await db.Books.AsNoTracking().ToListAsync(ct);
            var hasAuthor = !string.IsNullOrEmpty(nAuthor);
            var exact = hasAuthor
                ? all
                    .Where(b =>
                        string.Equals(BookIdentityNormalizer.NormalizeTitle(b.Title), nTitle, StringComparison.Ordinal) &&
                        string.Equals(BookIdentityNormalizer.NormalizeAuthor(b.Author), nAuthor, StringComparison.Ordinal))
                    .ToList()
                : [];

            if (exact.Count == 1)
                return new LibraryResolveResult(LibraryResolution.ExactMatch, exact[0].ToDto());

            if (exact.Count > 1)
            {
                var candidates = exact
                    .Select(b => ToCandidate(b, "exact title" + (string.IsNullOrEmpty(nAuthor) ? "" : "+author match")))
                    .ToList();
                return new LibraryResolveResult(LibraryResolution.Candidates, Candidates: candidates);
            }

            // Fuzzy: normalized containment on title or author.
            var fuzzy = all
                .Where(b =>
                {
                    var bt = BookIdentityNormalizer.NormalizeTitle(b.Title);
                    var ba = BookIdentityNormalizer.NormalizeAuthor(b.Author);
                    return (!string.IsNullOrEmpty(bt) && bt.Contains(nTitle, StringComparison.Ordinal)) ||
                           (!string.IsNullOrEmpty(nAuthor) && !string.IsNullOrEmpty(ba) &&
                            ba.Contains(nAuthor, StringComparison.Ordinal));
                })
                .Select(b => ToCandidate(b, "fuzzy title/author match"))
                .ToList();

            if (fuzzy.Count > 0)
                return new LibraryResolveResult(LibraryResolution.Candidates, Candidates: fuzzy);
        }

        // 3. Not found locally; prefill from external metadata when an ISBN is
        //    available. External metadata is NEVER treated as membership.
        CreateBookDto? prefill = null;
        string? lookupError = null;
        if (request.IncludeExternalMetadata && nIsbn is not null)
        {
            var outcome = await _lookup.LookupCombinedDetailedAsync(nIsbn, ct);
            prefill = outcome.Metadata;
            if (outcome.Failed)
                lookupError = "lookup_timeout";
        }

        return new LibraryResolveResult(LibraryResolution.NotFound, Prefill: prefill, LookupError: lookupError);
    }

    public async Task<LibraryCommandResultDto> ListCollectionsAsync(CancellationToken ct = default)
    {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var state = await TryGetStateAsync(db, ct);
        var version = state?.StateVersion ?? "0";

        var items = await db.Collections.AsNoTracking()
            .OrderBy(c => c.Name)
            .ThenBy(c => c.Id)
            .ToListAsync(ct);

        return Result(
            LibraryReplyFormatter.CollectionList(items.Count),
            items.Select(c => new CollectionDto(c.Id, c.Name, c.ParentId)).ToList(),
            version);
    }

    public async Task<LibraryCommandResultDto> ListCollectionCountsAsync(CancellationToken ct = default)
    {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var state = await TryGetStateAsync(db, ct);
        var version = state?.StateVersion ?? "0";

        // One grouped query for DIRECT counts, then a single in-memory
        // post-order rollup. Never one count query per collection, and the
        // frontend never sums counts itself (canonical recursion lives here).
        var collections = await db.Collections.AsNoTracking()
            .OrderBy(c => c.Name)
            .ThenBy(c => c.Id)
            .Select(c => new CollectionModel { Id = c.Id, ParentId = c.ParentId })
            .ToListAsync(ct);

        var directCounts = await db.Books.AsNoTracking()
            .Where(b => b.CollectionId != null)
            .GroupBy(b => b.CollectionId!.Value)
            .Select(g => new { CollectionId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.CollectionId, x => x.Count, ct);

        var counts = RollUpDescendantCounts(collections, directCounts);
        var items = collections
            .Select(c => new CollectionCountDto(c.Id, counts[c.Id]))
            .ToList();

        return Result(
            LibraryReplyFormatter.CollectionCountList(items.Count),
            items,
            version);
    }

    public async Task<LibraryCommandResultDto> GetCollectionAsync(Guid collectionId, CancellationToken ct = default)
    {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var state = await TryGetStateAsync(db, ct);
        var version = state?.StateVersion ?? "0";

        var collection = await db.Collections.AsNoTracking()
            .SingleOrDefaultAsync(c => c.Id == collectionId, ct);
        if (collection is null)
            return Failure("collection_not_found", LibraryReplyFormatter.CollectionNotFound, version);

        return Result(
            LibraryReplyFormatter.Collection(collection.Name),
            new CollectionDto(collection.Id, collection.Name, collection.ParentId),
            version);
    }

    // ------------------------------------------------------------------
    // Mutations (exact-once)
    // ------------------------------------------------------------------

    public Task<LibraryCommandResultDto> CreateOrMatchBookAsync(
        LibraryCreateBookRequest request,
        bool strictConfirmation,
        CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "CreateOrMatchBook",
            (db, token) => CreateOrMatchCoreAsync(db, request, strictConfirmation, token), ct);

    public Task<LibraryCommandResultDto> UpdateBookAsync(LibraryUpdateBookRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "UpdateBook",
            (db, token) => UpdateBookCoreAsync(db, request, token), ct);

    public async Task<LibraryCommandResultDto> UpdateProgressAsync(
        Guid bookId,
        string location,
        int percentage,
        CancellationToken ct = default)
    {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var state = await EnsureStateAsync(db, ct);

        var book = await db.Books.SingleOrDefaultAsync(b => b.Id == bookId, ct);
        if (book is null)
            return Failure("book_not_found", LibraryReplyFormatter.BookNotFound, state.StateVersion);

        var clamped = Math.Clamp(percentage, 0, 100);
        book.Progress.LastLocation = string.IsNullOrWhiteSpace(location) ? null : location;
        book.Progress.ProgressPercent = clamped;
        book.Progress.LastReadAt = Now;

        // Keep FinishedAt aligned with the percentage (regression fix: a
        // finished book that is read again becomes unfinished).
        if (clamped >= 100)
            book.Progress.FinishedAt ??= Now;
        else if (book.Progress.FinishedAt is not null)
            book.Progress.FinishedAt = null;

        var version = NextVersion(state.StateVersion);
        state.StateVersion = version;
        state.UpdatedAt = Now;

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        return Result(LibraryReplyFormatter.ProgressUpdated(book.Title), new { updated = true }, version);
    }

    public async Task<LibraryCommandResultDto> ResetProgressAsync(Guid bookId, CancellationToken ct = default)
    {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var state = await EnsureStateAsync(db, ct);

        var book = await db.Books.SingleOrDefaultAsync(b => b.Id == bookId, ct);
        if (book is null)
            return Failure("book_not_found", LibraryReplyFormatter.BookNotFound, state.StateVersion);

        // Canonical reset state; an already-reset book is a successful no-op
        // (no state-version bump).
        var progress = book.Progress;
        var alreadyReset = progress.LastLocation is null
            && progress.ProgressPercent == 0
            && progress.FinishedAt is null
            && progress.LastReadAt is null;

        if (alreadyReset)
            return Result(LibraryReplyFormatter.ProgressReset(book.Title), new { updated = false }, state.StateVersion);

        progress.LastLocation = null;
        progress.ProgressPercent = 0;
        progress.FinishedAt = null;
        progress.LastReadAt = null;

        var version = NextVersion(state.StateVersion);
        state.StateVersion = version;
        state.UpdatedAt = Now;

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        return Result(LibraryReplyFormatter.ProgressReset(book.Title), new { updated = true }, version);
    }

    public async Task<LibraryCommandResultDto> DeleteBookAsync(Guid bookId, CancellationToken ct = default)
    {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var state = await EnsureStateAsync(db, ct);

        var book = await db.Books.SingleOrDefaultAsync(b => b.Id == bookId, ct);
        if (book is null)
            return Failure("book_not_found", LibraryReplyFormatter.BookNotFound, state.StateVersion);

        var version = NextVersion(state.StateVersion);
        state.StateVersion = version;
        state.UpdatedAt = Now;

        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        db.Books.Remove(book);
        try
        {
            await db.SaveChangesAsync(ct);

            if (book.WorkId != Guid.Empty)
            {
                var remainingInWork = await db.Books.AnyAsync(b => b.WorkId == book.WorkId, ct);
                if (!remainingInWork)
                {
                    var work = await db.Works.FindAsync(new object[] { book.WorkId }, ct);
                    if (work is not null)
                    {
                        db.Works.Remove(work);
                        await db.SaveChangesAsync(ct);
                    }
                }
            }
        }
        catch (DbUpdateException)
        {
            await transaction.RollbackAsync(ct);
            return Failure("book_in_use", LibraryReplyFormatter.BookInUse(book.Title), state.StateVersion);
        }

        await transaction.CommitAsync(ct);
        return Result(LibraryReplyFormatter.BookDeleted(book.Title), new { deleted = true }, version);
    }

    public Task<LibraryCommandResultDto> CreateCollectionAsync(LibraryCreateCollectionRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "CreateCollection",
            (db, token) => CreateCollectionCoreAsync(db, request, token), ct);

    public Task<LibraryCommandResultDto> RenameCollectionAsync(LibraryRenameCollectionRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "RenameCollection",
            (db, token) => RenameCollectionCoreAsync(db, request, token), ct);

    public Task<LibraryCommandResultDto> MoveCollectionAsync(LibraryMoveCollectionRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "MoveCollection",
            (db, token) => MoveCollectionCoreAsync(db, request, token), ct);

    public Task<LibraryCommandResultDto> UpdateCollectionAsync(
        string clientId,
        string idempotencyKey,
        Guid collectionId,
        string name,
        Guid? parentId,
        CancellationToken ct = default) =>
        MutateAsync(clientId, idempotencyKey, "UpdateCollection",
            (db, token) => UpdateCollectionCoreAsync(db, collectionId, name, parentId,
                treatUnchangedAsNoOp: true, token), ct);

    public Task<LibraryCommandResultDto> DeleteCollectionAsync(LibraryDeleteCollectionRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "DeleteCollection",
            (db, token) => DeleteCollectionCoreAsync(db, request, token), ct);

    private async Task<(bool DidChange, LibraryCommandResultDto Result)> CreateOrMatchCoreAsync(
        NostosDbContext db,
        LibraryCreateBookRequest request,
        bool strictConfirmation,
        CancellationToken ct)
    {
        var state = await EnsureStateAsync(db, ct);

        if (string.IsNullOrWhiteSpace(request.Title))
            return NoChange(Failure("invalid_book_identity", "Title is required.", state.StateVersion));

        var nIsbn = BookIdentityNormalizer.NormalizeIsbn(request.Isbn);
        var nAsin = BookIdentityNormalizer.NormalizeAsin(request.Asin);
        var nTitle = BookIdentityNormalizer.NormalizeTitle(request.Title);
        var nAuthor = BookIdentityNormalizer.NormalizeAuthor(request.Author);

        // Type and identifier/type consistency: an identifier the target
        // model cannot store must be rejected, never silently dropped after
        // being used for matching (strong-identity contract). The unknown-type
        // check runs first; identifier/type consistency runs AFTER identity
        // resolution so exact identifier matches (and identity_conflict) stay
        // reachable.
        var normalizedType = string.IsNullOrWhiteSpace(request.Type) ? "physical" : request.Type.Trim().ToLowerInvariant();
        if (normalizedType is not ("physical" or "ebook" or "audiobook"))
            return NoChange(Failure("invalid_book_identity",
                $"Unknown book type: {request.Type}. Use physical, ebook, or audiobook.", state.StateVersion));

        // 1. Explicit confirmation: use the caller-selected existing row.
        if (request.ConfirmedBookId.HasValue)
        {
            var confirmed = await db.Books.AsNoTracking().SingleOrDefaultAsync(b => b.Id == request.ConfirmedBookId.Value, ct);
            if (confirmed is null)
                return NoChange(Failure("book_not_found", LibraryReplyFormatter.BookNotFound, state.StateVersion));

            return NoChange(Result(
                LibraryReplyFormatter.BookMatched(confirmed.Title),
                new LibraryCreateOrMatchResultDto("matched", confirmed.Id, confirmed.ToDto()),
                state.StateVersion));
        }

        // 2. Identifier resolution.
        BookModel? isbnMatch = null;
        BookModel? asinMatch = null;
        if (nIsbn is not null)
            isbnMatch = await db.Books.AsNoTracking().SingleOrDefaultAsync(b => b.NormalizedIsbn == nIsbn, ct);
        if (nAsin is not null)
            asinMatch = await db.Books.AsNoTracking().SingleOrDefaultAsync(b => b.NormalizedAsin == nAsin, ct);

        if (isbnMatch is not null && asinMatch is not null && isbnMatch.Id != asinMatch.Id)
            return NoChange(Failure("identity_conflict",
                LibraryReplyFormatter.IdentityConflict, state.StateVersion));

        if (isbnMatch is not null)
            return NoChange(Result(
                LibraryReplyFormatter.BookMatched(isbnMatch.Title),
                new LibraryCreateOrMatchResultDto("matched", isbnMatch.Id, isbnMatch.ToDto()),
                state.StateVersion));
        if (asinMatch is not null)
            return NoChange(Result(
                LibraryReplyFormatter.BookMatched(asinMatch.Title),
                new LibraryCreateOrMatchResultDto("matched", asinMatch.Id, asinMatch.ToDto()),
                state.StateVersion));

        // Identifier/type consistency (after resolution, before creation): a
        // fresh audiobook with an ISBN, or a physical/ebook with an ASIN, is
        // rejected rather than silently dropping the identifier.
        if (normalizedType == "audiobook" && nIsbn is not null)
            return NoChange(Failure("invalid_book_identity",
                "Audiobooks use ASIN, not ISBN.", state.StateVersion));
        if (normalizedType != "audiobook" && nAsin is not null)
            return NoChange(Failure("invalid_book_identity",
                "Only audiobooks use ASIN.", state.StateVersion));

        // 3. Title/author resolution. forceCreate bypasses ambiguity; exact
        //    identifier matches above always win over forceCreate. Exact
        //    matching requires BOTH title and author: title-only requests
        //    yield candidates below, never an automatic match.
        Guid? targetWorkId = null;
        if (!request.ForceCreate && !string.IsNullOrEmpty(nTitle))
        {
            var all = await db.Books.AsNoTracking().ToListAsync(ct);
            var hasAuthor = !string.IsNullOrEmpty(nAuthor);
            var exact = hasAuthor
                ? all
                    .Where(b =>
                        string.Equals(BookIdentityNormalizer.NormalizeTitle(b.Title), nTitle, StringComparison.Ordinal) &&
                        string.Equals(BookIdentityNormalizer.NormalizeAuthor(b.Author), nAuthor, StringComparison.Ordinal))
                    .ToList()
                : [];

            if (exact.Count > 0)
            {
                targetWorkId = exact[0].WorkId;

                var sameTypeEdition = exact.FirstOrDefault(b =>
                    (normalizedType == "audiobook" && b is AudioBookModel) ||
                    (normalizedType == "ebook" && b is EBookModel) ||
                    (normalizedType == "physical" && b is PhysicalBookModel));

                if (sameTypeEdition != null)
                {
                    var sameTypeCandidates = exact.Where(b => b.GetType() == sameTypeEdition.GetType()).ToList();
                    if (sameTypeCandidates.Count > 1)
                    {
                        if (strictConfirmation)
                        {
                            var candidates = sameTypeCandidates
                                .Select(b => ToCandidate(b, "exact title" + (string.IsNullOrEmpty(nAuthor) ? "" : "+author match")))
                                .ToList();
                            return NoChange(Failure("confirmation_required",
                                LibraryReplyFormatter.ConfirmationRequired(candidates.Count),
                                state.StateVersion, candidates));
                        }
                        // Non-strict (legacy REST path): multiple same-type editions exist; create anyway as before.
                    }
                    else
                    {
                        return NoChange(Result(
                            LibraryReplyFormatter.BookMatched(sameTypeEdition.Title),
                            new LibraryCreateOrMatchResultDto("matched", sameTypeEdition.Id, sameTypeEdition.ToDto()),
                            state.StateVersion));
                    }
                }

                // If same work exists but in different format/type:
                // We do not return matched! We proceed to create the new edition attached to targetWorkId.
            }
            else if (string.IsNullOrEmpty(nAuthor) && strictConfirmation)
            {
                // Title-only with no exact match: fuzzy candidates before
                // guessing. Non-strict legacy path creates (old UI behavior).
                var fuzzy = all
                    .Where(b =>
                    {
                        var bt = BookIdentityNormalizer.NormalizeTitle(b.Title);
                        return !string.IsNullOrEmpty(bt) && bt.Contains(nTitle, StringComparison.Ordinal);
                    })
                    .Select(b => ToCandidate(b, "fuzzy title match"))
                    .ToList();
                if (fuzzy.Count > 0)
                    return NoChange(Failure("confirmation_required",
                        LibraryReplyFormatter.ConfirmationRequired(fuzzy.Count),
                        state.StateVersion, fuzzy));
            }
        }

        // 4. No safe match: create (requires valid identifier, title+author,
        //    or explicit forceCreate; a bare title in strict mode needs more
        //    information).
        if (strictConfirmation && nIsbn is null && nAsin is null && string.IsNullOrEmpty(nAuthor) && !request.ForceCreate)
            return NoChange(Failure("confirmation_required",
                LibraryReplyFormatter.MoreInformationRequired, state.StateVersion));

        if (request.CollectionId.HasValue)
        {
            var collectionExists = await db.Collections.AsNoTracking()
                .AnyAsync(c => c.Id == request.CollectionId.Value, ct);
            if (!collectionExists)
                return NoChange(Failure("collection_not_found",
                    LibraryReplyFormatter.CollectionNotFound, state.StateVersion));
        }

        var createDto = new CreateBookDto(
            request.Type,
            request.Title,
            request.Subtitle,
            request.Author,
            request.Editor,
            request.Translator,
            request.Narrator,
            request.Description,
            request.Isbn,
            request.Asin,
            request.Duration,
            request.Publisher,
            request.PlaceOfPublication,
            request.PublishedDate,
            request.Edition,
            request.PageCount,
            request.Language,
            request.Categories,
            request.Series,
            request.VolumeNumber,
            request.CollectionId,
            request.Rating,
            request.IsFavorite,
            request.PersonalReview,
            request.FinishedAt);

        var model = createDto.ToModel();
        var (normIsbn, normAsin) = LibraryIdentityBackfill.ComputeNormalizedIdentity(model);
        model.NormalizedIsbn = normIsbn;
        model.NormalizedAsin = normAsin;

        if (targetWorkId.HasValue && targetWorkId.Value != Guid.Empty)
        {
            model.WorkId = targetWorkId.Value;
        }
        else
        {
            var work = await db.Works.FirstOrDefaultAsync(w =>
                w.NormalizedTitle == nTitle &&
                w.NormalizedAuthor == (string.IsNullOrEmpty(nAuthor) ? null : nAuthor), ct);

            if (work is null)
            {
                work = new WorkModel
                {
                    Id = Guid.NewGuid(),
                    Title = request.Title,
                    Author = request.Author,
                    NormalizedTitle = nTitle,
                    NormalizedAuthor = string.IsNullOrEmpty(nAuthor) ? null : nAuthor,
                    CreatedAt = DateTime.UtcNow,
                };
                db.Works.Add(work);
            }

            model.WorkId = work.Id;
            model.Work = work;
        }

        db.Books.Add(model);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Multi-process race on the filtered unique indexes: another
            // process committed the same ISBN/ASIN between our pre-check and
            // insert. Convert to a typed conflict, never a 500.
            var raced = await FindByIdentifiersAsync(db, nIsbn, nAsin, ct);
            if (raced is not null)
                return NoChange(Failure("duplicate_identifier",
                    LibraryReplyFormatter.DuplicateIdentifier(raced.Title), state.StateVersion));
            throw;
        }

        return Change(Result(
            LibraryReplyFormatter.BookCreated(model.Title),
            new LibraryCreateOrMatchResultDto("created", model.Id, model.ToDto()),
            state.StateVersion));
    }

    private async Task<(bool DidChange, LibraryCommandResultDto Result)> UpdateBookCoreAsync(
        NostosDbContext db,
        LibraryUpdateBookRequest request,
        CancellationToken ct)
    {
        var state = await EnsureStateAsync(db, ct);

        var book = await db.Books.SingleOrDefaultAsync(b => b.Id == request.BookId, ct);
        if (book is null)
            return NoChange(Failure("book_not_found", LibraryReplyFormatter.BookNotFound, state.StateVersion));

        if (request.Title is not null && string.IsNullOrWhiteSpace(request.Title))
            return NoChange(Failure("invalid_book_identity", "Title cannot be empty.", state.StateVersion));

        // Identifier/type consistency: identifiers the model cannot store are
        // rejected, never silently dropped.
        if (book is AudioBookModel && !string.IsNullOrWhiteSpace(request.Isbn))
            return NoChange(Failure("invalid_book_identity",
                "Audiobooks use ASIN, not ISBN.", state.StateVersion));
        if (book is not AudioBookModel && !string.IsNullOrWhiteSpace(request.Asin))
            return NoChange(Failure("invalid_book_identity",
                "Only audiobooks use ASIN.", state.StateVersion));

        // Null = leave unchanged; empty string = clear (repo convention).
        if (request.Title is not null)
            book.Title = request.Title;
        if (request.Author is not null)
            book.Author = NullIfEmpty(request.Author);
        if (request.Subtitle is not null)
            book.Metadata.Subtitle = NullIfEmpty(request.Subtitle);
        if (request.Editor is not null)
            book.Metadata.Editor = NullIfEmpty(request.Editor);
        if (request.Translator is not null)
            book.Metadata.Translator = NullIfEmpty(request.Translator);
        if (request.Description is not null)
            book.Metadata.Description = NullIfEmpty(request.Description);
        if (request.Publisher is not null)
            book.Metadata.Publisher = NullIfEmpty(request.Publisher);
        if (request.PlaceOfPublication is not null)
            book.Metadata.PlaceOfPublication = NullIfEmpty(request.PlaceOfPublication);
        if (request.PublishedDate is not null)
            book.Metadata.PublishedDate = NullIfEmpty(request.PublishedDate);
        if (request.Edition is not null)
            book.Metadata.Edition = NullIfEmpty(request.Edition);
        if (request.Language is not null)
            book.Metadata.Language = NullIfEmpty(request.Language);
        if (request.Categories is not null)
            book.Metadata.Categories = NullIfEmpty(request.Categories);
        if (request.Series is not null)
            book.Metadata.Series = NullIfEmpty(request.Series);
        if (request.VolumeNumber is not null)
            book.Metadata.VolumeNumber = NullIfEmpty(request.VolumeNumber);

        if (request.Rating.HasValue)
            book.Progress.Rating = Math.Clamp(request.Rating.Value, 0, 5);
        if (request.IsFavorite.HasValue)
            book.Progress.IsFavorite = request.IsFavorite.Value;
        if (request.PersonalReview is not null)
            book.Progress.PersonalReview = NullIfEmpty(request.PersonalReview);

        // Finished semantics mirror UpdateBookDto.Apply.
        if (request.FinishedAt is not null)
        {
            book.Progress.FinishedAt = request.FinishedAt;
        }
        else if (request.IsFinished.HasValue)
        {
            if (request.IsFinished.Value)
            {
                book.Progress.FinishedAt ??= Now;
                book.Progress.ProgressPercent = 100;
            }
            else
            {
                book.Progress.FinishedAt = null;
            }
        }

        if (request.CollectionId.HasValue)
        {
            var collectionExists = await db.Collections.AsNoTracking()
                .AnyAsync(c => c.Id == request.CollectionId.Value, ct);
            if (!collectionExists)
                return NoChange(Failure("collection_not_found",
                    LibraryReplyFormatter.CollectionNotFound, state.StateVersion));
            book.CollectionId = request.CollectionId;
        }
        else if (request.ClearCollection)
        {
            book.CollectionId = null;
        }

        switch (book)
        {
            case PhysicalBookModel p:
                if (request.Isbn is not null)
                    p.Isbn = NullIfEmpty(request.Isbn);
                if (request.PageCount.HasValue)
                    p.PageCount = request.PageCount;
                break;
            case EBookModel e:
                if (request.Isbn is not null)
                    e.Isbn = NullIfEmpty(request.Isbn);
                if (request.PageCount.HasValue)
                    e.PageCount = request.PageCount;
                break;
            case AudioBookModel a:
                if (request.Asin is not null)
                    a.Asin = NullIfEmpty(request.Asin);
                if (request.Duration is not null)
                    a.Duration = NullIfEmpty(request.Duration);
                if (request.Narrator is not null)
                    a.Narrator = NullIfEmpty(request.Narrator);
                break;
        }

        // Recompute normalized identity after possible identifier changes.
        var (nIsbn, nAsin) = LibraryIdentityBackfill.ComputeNormalizedIdentity(book);
        book.NormalizedIsbn = nIsbn;
        book.NormalizedAsin = nAsin;

        // Conflict check: another book holds the same normalized identity.
        // Runs through a FRESH context: the current context carries tracked
        // pending changes, and EF's query pipeline must never be trusted to
        // see the pre-change database state for the same entity graph.
        if (nIsbn is not null || nAsin is not null)
        {
            await using var probeDb = await _contexts.CreateDbContextAsync(ct);
            var conflict = await probeDb.Books.AsNoTracking()
                .Where(b => b.Id != book.Id &&
                            ((nIsbn != null && b.NormalizedIsbn == nIsbn) ||
                             (nAsin != null && b.NormalizedAsin == nAsin)))
                .Select(b => new { b.Id, b.Title, b.NormalizedIsbn, b.NormalizedAsin })
                .ToListAsync(ct);
            if (conflict.Count > 0)
                return NoChange(Failure("duplicate_identifier",
                    LibraryReplyFormatter.DuplicateIdentifier(conflict[0].Title), state.StateVersion));
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Another writer committed the identifier between the probe and
            // this save; the filtered unique index is the final guard. Convert
            // to a typed conflict, never a 500 (mirror of the create path).
            await using var probeDb = await _contexts.CreateDbContextAsync(ct);
            var raced = await probeDb.Books.AsNoTracking()
                .Where(b => b.Id != book.Id &&
                            ((nIsbn != null && b.NormalizedIsbn == nIsbn) ||
                             (nAsin != null && b.NormalizedAsin == nAsin)))
                .Select(b => new { b.Title })
                .ToListAsync(ct);
            if (raced.Count > 0)
                return NoChange(Failure("duplicate_identifier",
                    LibraryReplyFormatter.DuplicateIdentifier(raced[0].Title), state.StateVersion));
            throw;
        }

        return Change(Result(
            LibraryReplyFormatter.BookUpdated(book.Title),
            book.ToDto(),
            state.StateVersion));
    }

    private async Task<(bool DidChange, LibraryCommandResultDto Result)> CreateCollectionCoreAsync(
        NostosDbContext db,
        LibraryCreateCollectionRequest request,
        CancellationToken ct)
    {
        var state = await EnsureStateAsync(db, ct);

        if (string.IsNullOrWhiteSpace(request.Name))
            return NoChange(Failure("invalid_collection_name", "Collection name is required.", state.StateVersion));

        if (request.ParentId.HasValue)
        {
            var parentExists = await db.Collections.AsNoTracking()
                .AnyAsync(c => c.Id == request.ParentId.Value, ct);
            if (!parentExists)
                return NoChange(Failure("invalid_collection_parent",
                    LibraryReplyFormatter.CollectionParentNotFound, state.StateVersion));
        }

        // Duplicate sibling name: return the existing collection.
        var nName = BookIdentityNormalizer.NormalizeTitle(request.Name);
        var existing = await db.Collections.AsNoTracking()
            .Where(c => c.ParentId == request.ParentId)
            .ToListAsync(ct);
        var duplicate = existing.FirstOrDefault(c =>
            string.Equals(BookIdentityNormalizer.NormalizeTitle(c.Name), nName, StringComparison.Ordinal));
        if (duplicate is not null)
            return NoChange(Result(
                LibraryReplyFormatter.CollectionExists(duplicate.Name),
                new CollectionDto(duplicate.Id, duplicate.Name, duplicate.ParentId),
                state.StateVersion));

        var model = new CollectionModel { Name = request.Name.Trim(), ParentId = request.ParentId };
        db.Collections.Add(model);
        await db.SaveChangesAsync(ct);

        return Change(Result(
            LibraryReplyFormatter.CollectionCreated(model.Name),
            new CollectionDto(model.Id, model.Name, model.ParentId),
            state.StateVersion));
    }

    private async Task<(bool DidChange, LibraryCommandResultDto Result)> RenameCollectionCoreAsync(
        NostosDbContext db,
        LibraryRenameCollectionRequest request,
        CancellationToken ct)
    {
        // Preserve the historical check order (invalid name wins over
        // collection_not_found) that the frozen MCP surface relies on; the
        // shared core validates the name after loading the collection.
        var state = await EnsureStateAsync(db, ct);
        if (string.IsNullOrWhiteSpace(request.Name))
            return NoChange(Failure("invalid_collection_name", "Collection name is required.", state.StateVersion));

        var outcome = await UpdateCollectionCoreAsync(db, request.CollectionId, request.Name,
            Optional<Guid?>.None, treatUnchangedAsNoOp: false, ct);
        if (!outcome.DidChange)
            return outcome;
        return Change(outcome.Result with
        {
            Reply = LibraryReplyFormatter.CollectionRenamed(((CollectionDto)outcome.Result.Data!).Name),
        });
    }

    private async Task<(bool DidChange, LibraryCommandResultDto Result)> MoveCollectionCoreAsync(
        NostosDbContext db,
        LibraryMoveCollectionRequest request,
        CancellationToken ct)
    {
        var outcome = await UpdateCollectionCoreAsync(db, request.CollectionId, Optional<string>.None,
            request.NewParentId, treatUnchangedAsNoOp: false, ct);
        if (!outcome.DidChange)
            return outcome;
        return Change(outcome.Result with
        {
            Reply = LibraryReplyFormatter.CollectionMoved(((CollectionDto)outcome.Result.Data!).Name),
        });
    }

    /// <summary>
    /// Shared atomic rename/move core (collections Phase 1). Runs inside one
    /// MutateAsync transaction: loads the collection, validates the proposed
    /// name, rejects invalid/self/descendant parents, checks the normalized
    /// final name against the final parent's siblings, then assigns both
    /// values with a single SaveChanges. When
    /// <paramref name="treatUnchangedAsNoOp"/> is set (combined update), a
    /// request whose name and parent are both unchanged succeeds without a
    /// stateVersion bump; the two frozen MCP ops (rename/move) keep their
    /// historical always-bump-on-success behavior.
    /// </summary>
    private async Task<(bool DidChange, LibraryCommandResultDto Result)> UpdateCollectionCoreAsync(
        NostosDbContext db,
        Guid collectionId,
        Optional<string> name,
        Optional<Guid?> parentId,
        bool treatUnchangedAsNoOp,
        CancellationToken ct)
    {
        var state = await EnsureStateAsync(db, ct);

        var collection = await db.Collections.SingleOrDefaultAsync(c => c.Id == collectionId, ct);
        if (collection is null)
            return NoChange(Failure("collection_not_found", LibraryReplyFormatter.CollectionNotFound, state.StateVersion));

        if (name.HasValue && string.IsNullOrWhiteSpace(name.Value))
            return NoChange(Failure("invalid_collection_name", "Collection name is required.", state.StateVersion));

        var finalName = name.HasValue ? name.Value.Trim() : collection.Name;
        var finalParentId = parentId.HasValue ? parentId.Value : collection.ParentId;

        if (finalParentId.HasValue)
        {
            if (finalParentId.Value == collection.Id)
                return NoChange(Failure("collection_cycle", LibraryReplyFormatter.CollectionCycle, state.StateVersion));

            var parentExists = await db.Collections.AsNoTracking()
                .AnyAsync(c => c.Id == finalParentId.Value, ct);
            if (!parentExists)
                return NoChange(Failure("invalid_collection_parent",
                    LibraryReplyFormatter.CollectionParentNotFound, state.StateVersion));

            // Ancestor walk: moving under one of our own descendants cycles.
            var cursor = finalParentId.Value;
            var visited = new HashSet<Guid>();
            while (cursor != Guid.Empty)
            {
                if (cursor == collection.Id)
                    return NoChange(Failure("collection_cycle", LibraryReplyFormatter.CollectionCycle, state.StateVersion));
                if (!visited.Add(cursor))
                    return NoChange(Failure("collection_cycle", LibraryReplyFormatter.CollectionCycle, state.StateVersion));

                var parent = await db.Collections.AsNoTracking()
                    .Where(c => c.Id == cursor)
                    .Select(c => c.ParentId)
                    .SingleOrDefaultAsync(ct);
                if (parent is null)
                    break;
                cursor = parent.Value;
            }
        }

        // Sibling-name collision at the FINAL destination: the normalized
        // final name must not collide with any OTHER sibling there (the
        // root level is a sibling set like any other, parentId = null).
        var nName = BookIdentityNormalizer.NormalizeTitle(finalName);
        var siblings = await db.Collections.AsNoTracking()
            .Where(c => c.Id != collection.Id && c.ParentId == finalParentId)
            .ToListAsync(ct);
        var collision = siblings.FirstOrDefault(c =>
            string.Equals(BookIdentityNormalizer.NormalizeTitle(c.Name), nName, StringComparison.Ordinal));
        if (collision is not null)
            return NoChange(Failure("collection_name_conflict",
                LibraryReplyFormatter.CollectionNameConflict(collision.Name), state.StateVersion));

        var dto = new CollectionDto(collection.Id, collection.Name, collection.ParentId);

        // No-op policy (combined update only): same name and same parent is
        // a successful no-op — one receipt is still written, but the
        // stateVersion is not bumped.
        if (treatUnchangedAsNoOp &&
            string.Equals(collection.Name, finalName, StringComparison.Ordinal) &&
            collection.ParentId == finalParentId)
        {
            return NoChange(Result(
                LibraryReplyFormatter.CollectionUpdated(finalName),
                dto, state.StateVersion));
        }

        collection.Name = finalName;
        collection.ParentId = finalParentId;
        await db.SaveChangesAsync(ct);

        return Change(Result(
            LibraryReplyFormatter.CollectionUpdated(collection.Name),
            new CollectionDto(collection.Id, collection.Name, collection.ParentId),
            state.StateVersion));
    }

    private async Task<(bool DidChange, LibraryCommandResultDto Result)> DeleteCollectionCoreAsync(
        NostosDbContext db,
        LibraryDeleteCollectionRequest request,
        CancellationToken ct)
    {
        var state = await EnsureStateAsync(db, ct);

        if (!request.Confirm)
            return NoChange(Failure("confirmation_required",
                LibraryReplyFormatter.DeleteConfirmationRequired, state.StateVersion));

        var collection = await db.Collections.SingleOrDefaultAsync(c => c.Id == request.CollectionId, ct);
        if (collection is null)
            return NoChange(Failure("collection_not_found", LibraryReplyFormatter.CollectionNotFound, state.StateVersion));

        // Children must be moved/deleted first; never cascade silently.
        var childCount = await db.Collections.CountAsync(c => c.ParentId == collection.Id, ct);
        if (childCount > 0)
            return NoChange(Failure("collection_has_children",
                LibraryReplyFormatter.CollectionHasChildren, state.StateVersion));

        var bookCount = await db.Books.CountAsync(b => b.CollectionId == collection.Id, ct);
        await db.Books
            .Where(b => b.CollectionId == collection.Id)
            .ExecuteUpdateAsync(s => s.SetProperty(b => b.CollectionId, (Guid?)null), ct);
        db.Collections.Remove(collection);
        await db.SaveChangesAsync(ct);

        return Change(Result(
            LibraryReplyFormatter.CollectionDeleted(collection.Name),
            new LibraryDeleteCollectionResultDto(collection.Id, bookCount, 0),
            state.StateVersion));
    }

    // ------------------------------------------------------------------
    // Exact-once receipt plumbing (mirror of the reading service)
    // ------------------------------------------------------------------

    private async Task<LibraryCommandResultDto> MutateAsync(
        string clientId,
        string idempotencyKey,
        string commandKind,
        Func<NostosDbContext, CancellationToken, Task<(bool DidChange, LibraryCommandResultDto Result)>> command,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(idempotencyKey))
            return Failure("invalid_idempotency", "ClientId and IdempotencyKey are required.");
        if (clientId.Length > 64 || idempotencyKey.Length > 128)
            return Failure("invalid_idempotency", "ClientId is limited to 64 characters and IdempotencyKey to 128.");

        await CommandGate.WaitAsync(ct);
        try
        {
            await using var db = await _contexts.CreateDbContextAsync(ct);
            var prior = await db.LibraryCommandReceipts.AsNoTracking()
                .SingleOrDefaultAsync(x => x.ClientId == clientId && x.IdempotencyKey == idempotencyKey, ct);
            if (prior is not null)
                return Deserialize(prior.ResponseJson) with { Duplicate = true };

            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var outcome = await command(db, ct);
            // Commands commit their own successful saves; when a command
            // reports no change it may still have left tracked mutations
            // behind (e.g. a rejected update). Discard them so the receipt
            // save below can never flush half-applied changes.
            if (!outcome.DidChange)
                db.ChangeTracker.Clear();
            var state = db.ChangeTracker.Entries<LibraryState>().Select(x => x.Entity).SingleOrDefault()
                ?? await db.LibraryStates.AsNoTracking().SingleOrDefaultAsync(ct);
            var version = state?.StateVersion ?? outcome.Result.StateVersion;
            if (outcome.DidChange && state is not null)
            {
                version = NextVersion(state.StateVersion);
                state.StateVersion = version;
                state.UpdatedAt = Now;
            }

            var result = outcome.Result with { StateVersion = version, Duplicate = false };
            db.LibraryCommandReceipts.Add(new LibraryCommandReceipt
            {
                ClientId = clientId,
                IdempotencyKey = idempotencyKey,
                CommandKind = commandKind,
                ResponseJson = Serialize(result),
                CreatedAt = Now,
            });

            try
            {
                await db.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
                return result;
            }
            catch (DbUpdateException)
            {
                await transaction.RollbackAsync(ct);
                await using var retryDb = await _contexts.CreateDbContextAsync(ct);
                var raced = await retryDb.LibraryCommandReceipts.AsNoTracking()
                    .SingleOrDefaultAsync(x => x.ClientId == clientId && x.IdempotencyKey == idempotencyKey, ct);
                if (raced is not null)
                    return Deserialize(raced.ResponseJson) with { Duplicate = true };
                throw;
            }
        }
        finally
        {
            CommandGate.Release();
        }
    }

    private static async Task<LibraryState?> TryGetStateAsync(NostosDbContext db, CancellationToken ct) =>
        await db.LibraryStates.AsNoTracking().SingleOrDefaultAsync(ct);

    private static async Task<LibraryState> EnsureStateAsync(NostosDbContext db, CancellationToken ct)
    {
        var state = await db.LibraryStates.SingleOrDefaultAsync(ct);
        if (state is not null)
            return state;

        state = new LibraryState
        {
            Id = LibraryState.WellKnownId,
            SingletonSlot = LibraryState.SingletonSentinel,
        };
        db.LibraryStates.Add(state);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Concurrent ensure: the singleton already exists.
            db.ChangeTracker.Clear();
            state = await db.LibraryStates.SingleAsync(ct);
        }

        return state;
    }

    private static async Task<BookModel?> FindByIdentifiersAsync(
        NostosDbContext db,
        string? nIsbn,
        string? nAsin,
        CancellationToken ct)
    {
        if (nIsbn is not null)
        {
            var byIsbn = await db.Books.AsNoTracking()
                .SingleOrDefaultAsync(b => b.NormalizedIsbn == nIsbn, ct);
            if (byIsbn is not null)
                return byIsbn;
        }

        if (nAsin is not null)
        {
            var byAsin = await db.Books.AsNoTracking()
                .SingleOrDefaultAsync(b => b.NormalizedAsin == nAsin, ct);
            if (byAsin is not null)
                return byAsin;
        }

        return null;
    }

    private static LibraryCandidate ToCandidate(BookModel book, string reason) =>
        new(book.Id, book.Title, book.Author,
            book switch
            {
                PhysicalBookModel p => p.Isbn,
                EBookModel e => e.Isbn,
                _ => null,
            },
            book is AudioBookModel a ? a.Asin : null,
            reason);

    private sealed record GroupedBook(BookModel Primary, BookDto Dto);

    private static BookModel SelectPrimaryEdition(IEnumerable<BookModel> editions) => editions
        .OrderByDescending(b => b.Progress.LastReadAt.HasValue)
        .ThenByDescending(b => b.Progress.LastReadAt)
        .ThenByDescending(b => b.Progress.ProgressPercent)
        .ThenBy(b => b.CreatedAt)
        .ThenBy(b => b.Id)
        .First();

    private static IEnumerable<GroupedBook> SortGroupedBooks(
        IEnumerable<GroupedBook> books,
        BookSort sort) => sort switch
        {
            BookSort.Title => books.OrderBy(b => b.Primary.Title).ThenBy(b => b.Primary.Id),
            BookSort.Rating => books.OrderByDescending(b => b.Primary.Progress.Rating).ThenBy(b => b.Primary.Id),
            BookSort.LastRead => books
                .OrderByDescending(b => b.Primary.Progress.LastReadAt.HasValue)
                .ThenByDescending(b => b.Primary.Progress.LastReadAt)
                .ThenBy(b => b.Primary.Id),
            _ => books.OrderByDescending(b => b.Primary.CreatedAt).ThenBy(b => b.Primary.Id),
        };

    private static string? NullIfEmpty(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;

    private static string NextVersion(string version) =>
        (long.TryParse(version, out var parsed) ? parsed + 1 : 1).ToString();

    private static LibraryCommandResultDto Result(string reply, object? data, string version) =>
        new(reply, data, version);

    private static LibraryCommandResultDto Failure(string code, string reply, string version = "0",
        IReadOnlyList<LibraryCandidate>? candidates = null)
    {
        if (candidates is not null)
            return new LibraryCommandResultDto(reply,
                new LibraryConfirmationErrorDto(code, candidates), version);
        return new LibraryCommandResultDto(reply, new LibraryErrorDto(code), version);
    }

    private static (bool DidChange, LibraryCommandResultDto Result) Change(LibraryCommandResultDto result) =>
        (true, result);

    private static (bool DidChange, LibraryCommandResultDto Result) NoChange(LibraryCommandResultDto result) =>
        (false, result);

    private static string Serialize(LibraryCommandResultDto result) =>
        JsonSerializer.Serialize(result, ReceiptJson);

    private static LibraryCommandResultDto Deserialize(string json) =>
        JsonSerializer.Deserialize<LibraryCommandResultDto>(json, ReceiptJson)
        ?? throw new InvalidOperationException("Stored library command receipt is invalid.");

    // ------------------------------------------------------------------
    // Collections Phase 1 helpers
    // ------------------------------------------------------------------

    // Tri-state argument for the shared rename/move core: HasValue=false
    // means "leave the field unchanged" (distinct from an explicit null).
    private readonly record struct Optional<T>(T Value, bool HasValue)
    {
        public static implicit operator Optional<T>(T value) => new(value, true);

        public static Optional<T> None => default;
    }

    /// <summary>
    /// Expands a collection subtree to the collection id plus every
    /// descendant id, iteratively, from the flat id/parent list (personal
    /// library scale; no recursive SQL needed).
    /// </summary>
    private static HashSet<Guid> GetSubtreeIds(
        Guid rootId,
        IReadOnlyCollection<CollectionModel> collections)
    {
        var childrenByParent = collections
            .Where(c => c.ParentId.HasValue)
            .GroupBy(c => c.ParentId!.Value)
            .ToDictionary(g => g.Key, g => g.Select(c => c.Id).ToArray());

        var result = new HashSet<Guid>();
        var pending = new Stack<Guid>();
        pending.Push(rootId);

        while (pending.TryPop(out var id))
        {
            if (!result.Add(id))
                continue;

            if (childrenByParent.TryGetValue(id, out var children))
            {
                foreach (var child in children)
                    pending.Push(child);
            }
        }

        return result;
    }

    /// <summary>
    /// Rolls direct per-collection book counts upward in a post-order
    /// traversal so every collection's count is descendant-inclusive.
    /// Iterative and cycle-safe (the service forbids cycles; the visiting
    /// guard makes an accidental one terminate instead of hanging).
    /// </summary>
    private static Dictionary<Guid, int> RollUpDescendantCounts(
        IReadOnlyCollection<CollectionModel> collections,
        IReadOnlyDictionary<Guid, int> directCounts)
    {
        var counts = collections.ToDictionary(c => c.Id, c => directCounts.GetValueOrDefault(c.Id));
        var childrenByParent = collections
            .Where(c => c.ParentId.HasValue)
            .GroupBy(c => c.ParentId!.Value)
            .ToDictionary(g => g.Key, g => g.Select(c => c.Id).ToArray());

        var order = new List<Guid>(collections.Count);
        var expanded = new HashSet<Guid>();
        var visiting = new HashSet<Guid>();
        var stack = new Stack<(Guid Id, bool Expanded)>();

        foreach (var collection in collections)
        {
            if (expanded.Contains(collection.Id))
                continue;
            stack.Push((collection.Id, false));
            while (stack.TryPop(out var item))
            {
                if (item.Expanded)
                {
                    order.Add(item.Id);
                    expanded.Add(item.Id);
                    visiting.Remove(item.Id);
                    continue;
                }
                if (expanded.Contains(item.Id) || visiting.Contains(item.Id))
                    continue;

                visiting.Add(item.Id);
                stack.Push((item.Id, true));
                if (childrenByParent.TryGetValue(item.Id, out var children))
                {
                    foreach (var child in children)
                    {
                        if (!expanded.Contains(child) && !visiting.Contains(child))
                            stack.Push((child, false));
                    }
                }
            }
        }

        // Post-order guarantees children precede parents: a parent's total
        // is its own direct count plus each child's already-rolled-up total.
        foreach (var id in order)
        {
            if (childrenByParent.TryGetValue(id, out var children))
            {
                foreach (var child in children)
                    counts[id] += counts[child];
            }
        }

        return counts;
    }
}
