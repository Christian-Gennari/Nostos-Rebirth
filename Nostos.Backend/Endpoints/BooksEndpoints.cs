using Nostos.Backend.Configuration;
using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Mapping;
using Nostos.Backend.Services;
using Nostos.Backend.Services.Library;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Endpoints;

public static class BooksEndpoints
{
    public static IEndpointRouteBuilder MapBooksEndpoints(
        this IEndpointRouteBuilder routes,
        bool cloudMode = false)
    {
        var group = routes.MapGroup("/api/books");
        var uploadGroup = cloudMode
            ? routes.MapGroup("/api/books")
                .RequireRateLimiting(CloudRateLimitPolicies.ExpensiveMutation)
            : group;

        // GET all books
        group.MapGet(
            "/",
            async (
                ILibraryService library,
                string? filter,
                string? sort,
                string? search,
                int? page,
                int? pageSize,
                Guid? collectionId,
                bool? groupByWork,
                string? format,
                CancellationToken ct
            ) =>
            {
                Enum.TryParse<BookFilter>(filter, true, out var filterEnum);
                Enum.TryParse<BookSort>(sort, true, out var sortEnum);

                var result = await library.ListBooksAsync(
                    filterEnum, sortEnum, search, page ?? 1, pageSize ?? 20,
                    collectionId, groupByWork, format, ct);

                return LibraryHttpMapper.MapError(result) ?? Results.Ok(result.Data);
            }
        );

        // GET aggregate status counts for the library sidebar
        group.MapGet(
            "/status-counts",
            async (ILibraryService library, CancellationToken ct) =>
            {
                var result = await library.GetStatusCountsAsync(ct);
                return LibraryHttpMapper.MapError(result) ?? Results.Ok(result.Data);
            }
        );

        // GET one
        group.MapGet(
            "/{id}",
            async (Guid id, ILibraryService library, CancellationToken ct) =>
            {
                var result = await library.GetBookAsync(id, ct);
                return LibraryHttpMapper.MapError(result) ?? Results.Ok(result.Data);
            }
        );

        // CREATE (create-or-match, legacy permissive semantics: ambiguity
        // creates rather than asking; exact matches return the existing book)
        group.MapPost(
            "/",
            async (CreateBookDto dto, ILibraryService library, CancellationToken ct) =>
            {
                var request = new LibraryCreateBookRequest(
                    "rest", $"rest-create-{Guid.NewGuid():N}",
                    dto.Type, dto.Title,
                    Subtitle: dto.Subtitle, Author: dto.Author, Editor: dto.Editor,
                    Translator: dto.Translator, Narrator: dto.Narrator,
                    Description: dto.Description, Isbn: dto.Isbn, Asin: dto.Asin, Duration: dto.Duration,
                    Publisher: dto.Publisher, PlaceOfPublication: dto.PlaceOfPublication,
                    PublishedDate: dto.PublishedDate, Edition: dto.Edition,
                    PageCount: dto.PageCount, Language: dto.Language, Categories: dto.Categories,
                    Series: dto.Series, VolumeNumber: dto.VolumeNumber,
                    // REST keeps accepting the singular collectionId as a single-
                    // element membership set: it is the shape the mobile/OPDS
                    // callers and the endpoint tests already use, and the
                    // service translates it into membership rows.
                    CollectionIds: dto.CollectionIds
                        ?? (dto.CollectionId.HasValue ? [dto.CollectionId.Value] : null),
                    Rating: dto.Rating, IsFavorite: dto.IsFavorite,
                    PersonalReview: dto.PersonalReview, FinishedAt: dto.FinishedAt);

                var result = await library.CreateOrMatchBookAsync(request, strictConfirmation: false, ct);
                if (LibraryHttpMapper.MapError(result) is { } error)
                    return error;

                var outcome = (LibraryCreateOrMatchResultDto)result.Data!;
                return outcome.Outcome == "created"
                    ? Results.Created($"/api/books/{outcome.BookId}", outcome.Book)
                    : Results.Ok(outcome.Book);
            }
        );

        // UPDATE
        group.MapPut(
            "/{id}",
            async (Guid id, UpdateBookDto dto, ILibraryService library, CancellationToken ct) =>
            {
                var request = new LibraryUpdateBookRequest(
                    "rest", $"rest-update-{Guid.NewGuid():N}",
                    id,
                    Title: dto.Title, Subtitle: dto.Subtitle, Author: dto.Author,
                    Editor: dto.Editor, Translator: dto.Translator, Narrator: dto.Narrator,
                    Description: dto.Description, Isbn: dto.Isbn, Asin: dto.Asin, Duration: dto.Duration,
                    Publisher: dto.Publisher, PlaceOfPublication: dto.PlaceOfPublication,
                    PublishedDate: dto.PublishedDate, Edition: dto.Edition,
                    PageCount: dto.PageCount, Language: dto.Language, Categories: dto.Categories,
                    Series: dto.Series, VolumeNumber: dto.VolumeNumber,
                    // Singular collectionId (REST compatibility shape) becomes a
                    // single-element set; ClearCollection stays honoured.
                    CollectionIds: dto.CollectionIds
                        ?? (dto.CollectionId.HasValue ? [dto.CollectionId.Value] : null),
                    ClearCollection: dto.ClearCollection,
                    Rating: dto.Rating, IsFavorite: dto.IsFavorite,
                    PersonalReview: dto.PersonalReview, FinishedAt: dto.FinishedAt,
                    IsFinished: dto.IsFinished);

                var result = await library.UpdateBookAsync(request, ct);
                return LibraryHttpMapper.MapError(result) ?? Results.Ok(result.Data);
            }
        );

        // SET collection membership (full replacement set). A dedicated route so
        // the client intent is explicit — "this book belongs to exactly these
        // collections" — and it cannot be confused with a metadata save. Set
        // semantics express add, remove and clear-all in one idempotent call.
        group.MapPut(
            "/{id}/collections",
            async (Guid id, UpdateBookCollectionsDto dto, ILibraryService library, CancellationToken ct) =>
            {
                var request = new LibraryUpdateBookRequest(
                    "rest", $"rest-collections-{Guid.NewGuid():N}",
                    id, CollectionIds: dto.CollectionIds);

                var result = await library.UpdateBookAsync(request, ct);
                return LibraryHttpMapper.MapError(result) ?? Results.Ok(result.Data);
            }
        );

        // UPDATE progress (canonical service; validated 0..100, FinishedAt
        // alignment, version bump; not receipt-guarded by design)
        group.MapPut(
            "/{id}/progress",
            async (Guid id, UpdateProgressDto dto, ILibraryService library, CancellationToken ct) =>
            {
                var result = await library.UpdateProgressAsync(id, dto.Location, dto.Percentage, ct);
                return LibraryHttpMapper.MapError(result) ?? Results.Ok(result.Data);
            }
        );

        // LINK this book into another book's work (manual multi-edition
        // override). A dedicated route, like /collections: the client intent is
        // explicit, and WorkId is never written directly by a client — the
        // domain service owns the merge, the orphan cleanup and the version.
        group.MapPost(
            "/{id}/work/link",
            async (Guid id, LinkWorkDto dto, ILibraryService library, CancellationToken ct) =>
            {
                var request = new LibraryLinkWorkRequest(
                    "rest", $"rest-work-link-{Guid.NewGuid():N}", id, dto.TargetBookId);

                var result = await library.LinkWorkAsync(request, ct);
                return LibraryHttpMapper.MapError(result) ?? Results.Ok(result.Data);
            }
        );

        // UNLINK this book into its own new work (manual split). The book
        // always ends up with a valid work; there is no "no work" state to
        // fall into.
        group.MapPost(
            "/{id}/work/unlink",
            async (Guid id, ILibraryService library, CancellationToken ct) =>
            {
                var request = new LibraryUnlinkWorkRequest(
                    "rest", $"rest-work-unlink-{Guid.NewGuid():N}", id);

                var result = await library.UnlinkWorkAsync(request, ct);
                return LibraryHttpMapper.MapError(result) ?? Results.Ok(result.Data);
            }
        );

        // RESET Progress (explicit reset intent: clears location, percent,
        // finished and recency; deliberately NOT a 0% progress update)
        group.MapPost(
            "/{id}/progress/reset",
            async (Guid id, ILibraryService library, CancellationToken ct) =>
            {
                var result = await library.ResetProgressAsync(id, ct);
                return LibraryHttpMapper.MapError(result) ?? Results.Ok(result.Data);
            }
        );

        // GET Epub cached locations (Cached)
        group.MapGet(
            "/{id}/locations",
            async (Guid id, IBookRepository repo, CancellationToken ct) =>
            {
                var book = await repo.GetByIdAsync(id);
                if (book is null)
                    return Results.NotFound();

                if (string.IsNullOrWhiteSpace(book.FileDetails.LocationsJson))
                    return Results.NotFound();

                return Results.Ok(new BookLocationsDto(book.FileDetails.LocationsJson));
            }
        );

        // SAVE Locations (Cache them)
        group.MapPost(
            "/{id}/locations",
            async (Guid id, BookLocationsDto dto, IBookRepository repo, CancellationToken ct) =>
            {
                var book = await repo.GetByIdAsync(id);
                if (book is null)
                    return Results.NotFound();

                book.FileDetails.LocationsJson = dto.Locations;
                await repo.UpdateAsync(book);

                return Results.Ok();
            }
        );

        // DELETE (row first through the canonical service; storage files are
        // removed only after the row is gone, so an in-use book keeps its
        // files)
        group.MapDelete(
            "/{id}",
            async (Guid id, ILibraryService library, IBookAssetStorage storage, CancellationToken ct) =>
            {
                var result = await library.DeleteBookAsync(id, ct);
                if (LibraryHttpMapper.MapError(result) is { } error)
                    return error;

                await storage.DeleteBookFilesAsync(id, ct);
                return Results.NoContent();
            }
        );

        // Upload file
        uploadGroup.MapPost(
            "/{id}/file",
            async (
                Guid id,
                HttpRequest request,
                IBookRepository repo,
                IBookAssetStorage storage,
                MediaMetadataService metadataService,
                CancellationToken ct
            ) =>
            {
                var book = await repo.GetByIdAsync(id);
                if (book is null)
                    return Results.NotFound();

                if (book is PhysicalBookModel)
                {
                    return Results.BadRequest(
                        "Physical books are metadata-only. Add the digital file as a separate edition."
                    );
                }

                var form = await request.ReadFormAsync(ct);
                var file = form.Files.FirstOrDefault();
                if (file is null)
                    return Results.BadRequest("Missing file.");

                var allowed = BookAssetFormats.IsAllowedUpload(file.ContentType, file.FileName);
                if (!allowed)
                    return Results.BadRequest($"Unsupported file type: {file.ContentType}");

                await using (var metadataStream = file.OpenReadStream())
                {
                    metadataService.EnrichBookMetadata(book, metadataStream);
                }

                await using (var uploadStream = file.OpenReadStream())
                {
                    await storage.SaveBookFileAsync(id, uploadStream, file.FileName, ct);
                }

                book.FileDetails.HasFile = true;
                book.FileDetails.FileName = $"book{Path.GetExtension(file.FileName)}";

                // Clear old locations/chapters if a new file is uploaded
                book.FileDetails.LocationsJson = null;

                await repo.UpdateAsync(book);
                return Results.Ok(new { uploaded = true });
            }
        );

        // Stream file (inline) for media playback; supports HTTP Range requests
        group.MapGet(
            "/{id}/file",
            async (
                Guid id,
                IBookAssetStorage storage,
                HttpContext http,
                CancellationToken ct
            ) =>
                await StoredAssetHttpResult.CreateAsync(
                    http,
                    token => storage.GetBookFileInfoAsync(id, token),
                    (range, token) => storage.OpenBookFileAsync(id, range, token),
                    attachment: false,
                    enableRanges: true,
                    cacheControl: null,
                    ct)
        );

        // Download file (attachment) — used by the book detail "Download File" button
        group.MapGet(
            "/{id}/file/download",
            async (
                Guid id,
                IBookAssetStorage storage,
                HttpContext http,
                CancellationToken ct
            ) =>
                await StoredAssetHttpResult.CreateAsync(
                    http,
                    token => storage.GetBookFileInfoAsync(id, token),
                    (range, token) => storage.OpenBookFileAsync(id, range, token),
                    attachment: true,
                    enableRanges: true,
                    cacheControl: null,
                    ct)
        );

        // Upload cover
        uploadGroup.MapPost(
            "/{id}/cover",
            async (
                Guid id,
                HttpRequest request,
                IBookRepository repo,
                IBookAssetStorage storage,
                CancellationToken ct
            ) =>
            {
                var book = await repo.GetByIdAsync(id);
                if (book is null)
                    return Results.NotFound();

                if (request.ContentLength is > CloudRequestHardeningRegistration.MaxCoverUploadBytes)
                    return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);

                var form = await request.ReadFormAsync(ct);
                var file = form.Files.FirstOrDefault();
                if (file is null)
                    return Results.BadRequest("Missing cover file.");

                if (file.Length > CloudRequestHardeningRegistration.MaxCoverUploadBytes)
                    return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);

                if (!BookAssetFormats.IsAllowedCoverUpload(file.ContentType, file.FileName))
                    return Results.BadRequest("Cover file type does not match a supported PNG or JPEG filename.");

                await using (var coverStream = file.OpenReadStream())
                {
                    await storage.SaveBookCoverAsync(id, coverStream, file.FileName, ct);
                }

                var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
                book.FileDetails.CoverFileName = $"cover{ext}";

                await repo.UpdateAsync(book);

                return Results.Ok(new { uploaded = true });
            }
        );

        // Download a cached, resized WebP cover for card/list views
        group.MapGet(
            "/{id}/cover/thumbnail",
            async (
                Guid id,
                int? width,
                IBookAssetStorage storage,
                HttpContext http,
                CancellationToken ct
            ) =>
            {
                var safeWidth = width ?? 320;
                return await StoredAssetHttpResult.CreateAsync(
                    http,
                    token => storage.GetBookCoverThumbnailInfoAsync(id, safeWidth, token),
                    (_, token) => storage.OpenBookCoverThumbnailAsync(id, safeWidth, token),
                    attachment: false,
                    enableRanges: false,
                    cacheControl: "public, max-age=86400, stale-while-revalidate=2592000",
                    ct);
            }
        );

        // Download cover
        group.MapGet(
            "/{id}/cover",
            async (
                Guid id,
                IBookAssetStorage storage,
                HttpContext http,
                CancellationToken ct
            ) =>
                await StoredAssetHttpResult.CreateAsync(
                    http,
                    token => storage.GetBookCoverInfoAsync(id, token),
                    (_, token) => storage.OpenBookCoverAsync(id, token),
                    attachment: false,
                    enableRanges: false,
                    cacheControl: "public, max-age=86400, stale-while-revalidate=2592000",
                    ct)
        );

        // DELETE cover
        group.MapDelete(
            "/{id}/cover",
            async (Guid id, IBookRepository repo, IBookAssetStorage storage, CancellationToken ct) =>
            {
                var book = await repo.GetByIdAsync(id);
                if (book is null)
                    return Results.NotFound();

                if (!await storage.DeleteCoverAsync(id, ct))
                    return Results.NotFound();

                book.FileDetails.CoverFileName = null;
                await repo.UpdateAsync(book);

                return Results.NoContent();
            }
        );

        // ISBN metadata lookup (validated before any external call)
        group.MapGet(
            "/lookup/{isbn}",
            async (string isbn, BookLookupService service, CancellationToken ct) =>
            {
                if (BookIdentityNormalizer.NormalizeIsbn(isbn) is null)
                    return Results.BadRequest(new { error = "Invalid ISBN." });

                var metadata = await service.LookupCombinedAsync(isbn, ct);
                return metadata is not null ? Results.Ok(metadata) : Results.NotFound();
            }
        );

        return routes;
    }

}
