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
    private static readonly JsonSerializerOptions ReceiptJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
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
        CancellationToken ct = default)
    {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var state = await EnsureStateAsync(db, ct);
        var version = state.StateVersion;

        var safePage = Math.Max(1, page);
        var safePageSize = Math.Clamp(pageSize, 1, 100);

        var query = db.Books.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = $"%{search}%";
            query = query.Where(b =>
                EF.Functions.Like(b.Title, term) || EF.Functions.Like(b.Author, term));
        }

        query = filter switch
        {
            BookFilter.Favorites => query.Where(b => b.Progress.IsFavorite),
            BookFilter.Finished => query.Where(b => b.Progress.FinishedAt != null),
            BookFilter.Reading => query.Where(b => b.Progress.FinishedAt == null && b.Progress.ProgressPercent > 0),
            BookFilter.Unsorted => query.Where(b => b.CollectionId == null),
            _ => query,
        };

        if (collectionId.HasValue)
            query = query.Where(b => b.CollectionId == collectionId.Value);

        query = sort switch
        {
            BookSort.Title => query.OrderBy(b => b.Title),
            BookSort.Rating => query.OrderByDescending(b => b.Progress.Rating),
            BookSort.LastRead => query.OrderByDescending(b => b.Progress.LastReadAt.HasValue)
                .ThenByDescending(b => b.Progress.LastReadAt),
            _ => query.OrderByDescending(b => b.CreatedAt),
        };

        var totalCount = await query.CountAsync(ct);
        var items = await query
            .Skip((safePage - 1) * safePageSize)
            .Take(safePageSize)
            .ToListAsync(ct);

        var pageResult = new PaginatedResponse<BookDto>(
            items.Select(b => b.ToDto()),
            totalCount,
            safePage,
            safePageSize);

        return Result(LibraryReplyFormatter.BookList(totalCount), pageResult, version);
    }

    public async Task<LibraryCommandResultDto> GetBookAsync(Guid bookId, CancellationToken ct = default)
    {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var state = await EnsureStateAsync(db, ct);
        var version = state.StateVersion;

        var book = await db.Books.AsNoTracking().SingleOrDefaultAsync(b => b.Id == bookId, ct);
        if (book is null)
            return Failure("book_not_found", LibraryReplyFormatter.BookNotFound, version);

        return Result(LibraryReplyFormatter.Book(book.Title), book.ToDto(), version);
    }

    public async Task<LibraryResolveResult> ResolveBookAsync(LibraryResolveBookRequest request, CancellationToken ct = default)
    {
        var nIsbn = BookIdentityNormalizer.NormalizeIsbn(request.Isbn);
        var nAsin = BookIdentityNormalizer.NormalizeAsin(request.Asin);
        var nTitle = BookIdentityNormalizer.NormalizeTitle(request.Title);
        var nAuthor = BookIdentityNormalizer.NormalizeAuthor(request.Author);

        await using var db = await _contexts.CreateDbContextAsync(ct);
        await EnsureStateAsync(db, ct);

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
        if (!string.IsNullOrEmpty(nTitle))
        {
            var all = await db.Books.AsNoTracking().ToListAsync(ct);
            var exact = all
                .Where(b =>
                    string.Equals(BookIdentityNormalizer.NormalizeTitle(b.Title), nTitle, StringComparison.Ordinal) &&
                    (string.IsNullOrEmpty(nAuthor) ||
                     string.Equals(BookIdentityNormalizer.NormalizeAuthor(b.Author), nAuthor, StringComparison.Ordinal)))
                .ToList();

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
        if (request.IncludeExternalMetadata && nIsbn is not null)
        {
            try
            {
                prefill = await _lookup.LookupCombinedAsync(nIsbn);
            }
            catch (Exception)
            {
                // External lookup failure must not break local resolution.
                prefill = null;
            }
        }

        return new LibraryResolveResult(LibraryResolution.NotFound, Prefill: prefill);
    }

    public async Task<LibraryCommandResultDto> ListCollectionsAsync(CancellationToken ct = default)
    {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var state = await EnsureStateAsync(db, ct);

        var items = await db.Collections.AsNoTracking()
            .OrderBy(c => c.Name)
            .ThenBy(c => c.Id)
            .ToListAsync(ct);

        return Result(
            LibraryReplyFormatter.CollectionList(items.Count),
            items.Select(c => new CollectionDto(c.Id, c.Name, c.ParentId)).ToList(),
            state.StateVersion);
    }

    public async Task<LibraryCommandResultDto> GetCollectionAsync(Guid collectionId, CancellationToken ct = default)
    {
        await using var db = await _contexts.CreateDbContextAsync(ct);
        var state = await EnsureStateAsync(db, ct);

        var collection = await db.Collections.AsNoTracking()
            .SingleOrDefaultAsync(c => c.Id == collectionId, ct);
        if (collection is null)
            return Failure("collection_not_found", LibraryReplyFormatter.CollectionNotFound, state.StateVersion);

        return Result(
            LibraryReplyFormatter.Collection(collection.Name),
            new CollectionDto(collection.Id, collection.Name, collection.ParentId),
            state.StateVersion);
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

    public Task<LibraryCommandResultDto> CreateCollectionAsync(LibraryCreateCollectionRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "CreateCollection",
            (db, token) => CreateCollectionCoreAsync(db, request, token), ct);

    public Task<LibraryCommandResultDto> RenameCollectionAsync(LibraryRenameCollectionRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "RenameCollection",
            (db, token) => RenameCollectionCoreAsync(db, request, token), ct);

    public Task<LibraryCommandResultDto> MoveCollectionAsync(LibraryMoveCollectionRequest request, CancellationToken ct = default) =>
        MutateAsync(request.ClientId, request.IdempotencyKey, "MoveCollection",
            (db, token) => MoveCollectionCoreAsync(db, request, token), ct);

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

        // 3. Title/author resolution. forceCreate bypasses ambiguity; exact
        //    identifier matches above always win over forceCreate.
        if (!request.ForceCreate && !string.IsNullOrEmpty(nTitle))
        {
            var all = await db.Books.AsNoTracking().ToListAsync(ct);
            var exact = all
                .Where(b =>
                    string.Equals(BookIdentityNormalizer.NormalizeTitle(b.Title), nTitle, StringComparison.Ordinal) &&
                    (string.IsNullOrEmpty(nAuthor) ||
                     string.Equals(BookIdentityNormalizer.NormalizeAuthor(b.Author), nAuthor, StringComparison.Ordinal)))
                .ToList();

            if (exact.Count == 1)
                return NoChange(Result(
                    LibraryReplyFormatter.BookMatched(exact[0].Title),
                    new LibraryCreateOrMatchResultDto("matched", exact[0].Id, exact[0].ToDto()),
                    state.StateVersion));

            if (exact.Count > 1)
            {
                var candidates = exact
                    .Select(b => ToCandidate(b, "exact title" + (string.IsNullOrEmpty(nAuthor) ? "" : "+author match")))
                    .ToList();
                if (strictConfirmation)
                    return NoChange(Failure("confirmation_required",
                        LibraryReplyFormatter.ConfirmationRequired(candidates.Count),
                        state.StateVersion, candidates));
                // Non-strict (legacy REST path): create anyway, as before.
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

        await db.SaveChangesAsync(ct);
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
        var state = await EnsureStateAsync(db, ct);

        if (string.IsNullOrWhiteSpace(request.Name))
            return NoChange(Failure("invalid_collection_name", "Collection name is required.", state.StateVersion));

        var collection = await db.Collections.SingleOrDefaultAsync(c => c.Id == request.CollectionId, ct);
        if (collection is null)
            return NoChange(Failure("collection_not_found", LibraryReplyFormatter.CollectionNotFound, state.StateVersion));

        var nName = BookIdentityNormalizer.NormalizeTitle(request.Name);
        var siblings = await db.Collections.AsNoTracking()
            .Where(c => c.ParentId == collection.ParentId && c.Id != collection.Id)
            .ToListAsync(ct);
        var collision = siblings.FirstOrDefault(c =>
            string.Equals(BookIdentityNormalizer.NormalizeTitle(c.Name), nName, StringComparison.Ordinal));
        if (collision is not null)
            return NoChange(Failure("collection_name_conflict",
                LibraryReplyFormatter.CollectionNameConflict(collision.Name), state.StateVersion));

        collection.Name = request.Name.Trim();
        await db.SaveChangesAsync(ct);

        return Change(Result(
            LibraryReplyFormatter.CollectionRenamed(collection.Name),
            new CollectionDto(collection.Id, collection.Name, collection.ParentId),
            state.StateVersion));
    }

    private async Task<(bool DidChange, LibraryCommandResultDto Result)> MoveCollectionCoreAsync(
        NostosDbContext db,
        LibraryMoveCollectionRequest request,
        CancellationToken ct)
    {
        var state = await EnsureStateAsync(db, ct);

        var collection = await db.Collections.SingleOrDefaultAsync(c => c.Id == request.CollectionId, ct);
        if (collection is null)
            return NoChange(Failure("collection_not_found", LibraryReplyFormatter.CollectionNotFound, state.StateVersion));

        if (request.NewParentId.HasValue)
        {
            if (request.NewParentId.Value == collection.Id)
                return NoChange(Failure("collection_cycle", LibraryReplyFormatter.CollectionCycle, state.StateVersion));

            var parentExists = await db.Collections.AsNoTracking()
                .AnyAsync(c => c.Id == request.NewParentId.Value, ct);
            if (!parentExists)
                return NoChange(Failure("invalid_collection_parent",
                    LibraryReplyFormatter.CollectionParentNotFound, state.StateVersion));

            // Ancestor walk: moving under one of our own descendants cycles.
            var cursor = request.NewParentId.Value;
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

            collection.ParentId = request.NewParentId;
        }
        else
        {
            collection.ParentId = null;
        }

        await db.SaveChangesAsync(ct);

        return Change(Result(
            LibraryReplyFormatter.CollectionMoved(collection.Name),
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

    private static void ApplyNormalizedIdentity(BookModel model, string? nIsbn, string? nAsin)
    {
        // Only types that actually carry the identifier get a normalized value.
        model.NormalizedIsbn = model is PhysicalBookModel or EBookModel ? nIsbn : null;
        model.NormalizedAsin = model is AudioBookModel ? nAsin : null;
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
}
