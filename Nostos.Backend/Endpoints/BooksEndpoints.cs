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
    public static IEndpointRouteBuilder MapBooksEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/books");

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
                CancellationToken ct
            ) =>
            {
                Enum.TryParse<BookFilter>(filter, true, out var filterEnum);
                Enum.TryParse<BookSort>(sort, true, out var sortEnum);

                var result = await library.ListBooksAsync(
                    filterEnum, sortEnum, search, page ?? 1, pageSize ?? 20,
                    collectionId, groupByWork, ct);

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
                    dto.Subtitle, dto.Author, dto.Editor, dto.Translator, dto.Narrator,
                    dto.Description, dto.Isbn, dto.Asin, dto.Duration,
                    dto.Publisher, dto.PlaceOfPublication, dto.PublishedDate, dto.Edition,
                    dto.PageCount, dto.Language, dto.Categories, dto.Series, dto.VolumeNumber,
                    dto.CollectionId, dto.Rating, dto.IsFavorite, dto.PersonalReview, dto.FinishedAt);

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
                    dto.Title, dto.Subtitle, dto.Author, dto.Editor, dto.Translator, dto.Narrator,
                    dto.Description, dto.Isbn, dto.Asin, dto.Duration,
                    dto.Publisher, dto.PlaceOfPublication, dto.PublishedDate, dto.Edition,
                    dto.PageCount, dto.Language, dto.Categories, dto.Series, dto.VolumeNumber,
                    dto.CollectionId, ClearCollection: false,
                    dto.Rating, dto.IsFavorite, dto.PersonalReview, dto.FinishedAt, dto.IsFinished);

                var result = await library.UpdateBookAsync(request, ct);
                return LibraryHttpMapper.MapError(result) ?? Results.Ok(result.Data);
            }
        );

        // UPDATE Progress (canonical service; validated 0..100, FinishedAt
        // alignment, version bump; not receipt-guarded by design)
        group.MapPut(
            "/{id}/progress",
            async (Guid id, UpdateProgressDto dto, ILibraryService library, CancellationToken ct) =>
            {
                var result = await library.UpdateProgressAsync(id, dto.Location, dto.Percentage, ct);
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
            async (Guid id, ILibraryService library, IFileStorageService storage, CancellationToken ct) =>
            {
                var result = await library.DeleteBookAsync(id, ct);
                if (LibraryHttpMapper.MapError(result) is { } error)
                    return error;

                storage.DeleteBookFiles(id);
                return Results.NoContent();
            }
        );

        // Upload file
        group.MapPost(
            "/{id}/file",
            async (
                Guid id,
                HttpRequest request,
                IBookRepository repo,
                IFileStorageService storage,
                MediaMetadataService metadataService,
                CancellationToken ct
            ) =>
            {
                var book = await repo.GetByIdAsync(id);
                if (book is null)
                    return Results.NotFound();

                var form = await request.ReadFormAsync(ct);
                var file = form.Files.FirstOrDefault();
                if (file is null)
                    return Results.BadRequest("Missing file.");

                var allowed = FileStorageService.IsAllowedUpload(file.ContentType, file.FileName);
                if (!allowed)
                    return Results.BadRequest($"Unsupported file type: {file.ContentType}");

                await storage.SaveBookFileAsync(id, file);

                var filePath = storage.GetBookFileName(id);
                if (filePath is not null)
                {
                    metadataService.EnrichBookMetadata(book, filePath);
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
            (Guid id, IFileStorageService storage) =>
            {
                var filePath = storage.GetBookFileName(id);
                if (filePath is null)
                    return Results.NotFound();

                var contentType = FileStorageService.GetContentType(filePath);

                // No fileName => no Content-Disposition: attachment, so browsers
                // render the file inline (required for <audio>/Howler playback).
                return Results.File(filePath, contentType, enableRangeProcessing: true);
            }
        );

        // Download file (attachment) — used by the book detail "Download File" button
        group.MapGet(
            "/{id}/file/download",
            (Guid id, IFileStorageService storage) =>
            {
                var filePath = storage.GetBookFileName(id);
                if (filePath is null)
                    return Results.NotFound();

                var contentType = FileStorageService.GetContentType(filePath);
                var fileName = Path.GetFileName(filePath);

                return Results.File(filePath, contentType, fileName, enableRangeProcessing: true);
            }
        );

        // Upload cover
        group.MapPost(
            "/{id}/cover",
            async (
                Guid id,
                HttpRequest request,
                IBookRepository repo,
                IFileStorageService storage,
                CancellationToken ct
            ) =>
            {
                var book = await repo.GetByIdAsync(id);
                if (book is null)
                    return Results.NotFound();

                var form = await request.ReadFormAsync(ct);
                var file = form.Files.FirstOrDefault();
                if (file is null)
                    return Results.BadRequest("Missing cover file.");

                if (!new[] { "image/png", "image/jpeg" }.Contains(file.ContentType))
                    return Results.BadRequest("Only PNG or JPEG images allowed.");

                await storage.SaveBookCoverAsync(id, file);
                var ext = Path.GetExtension(file.FileName).ToLower();
                book.FileDetails.CoverFileName = $"cover{ext}";

                await repo.UpdateAsync(book);

                return Results.Ok(new { uploaded = true });
            }
        );

        // Download cover
        group.MapGet(
            "/{id}/cover",
            (Guid id, IFileStorageService storage) =>
            {
                var coverPath = storage.GetBookCoverPath(id);
                if (coverPath is null)
                    return Results.NotFound();

                var ext = Path.GetExtension(coverPath).ToLower();
                var mimeType = ext switch
                {
                    ".jpg" or ".jpeg" => "image/jpeg",
                    _ => "image/png",
                };
                return Results.File(coverPath, mimeType, Path.GetFileName(coverPath));
            }
        );

        // DELETE cover
        group.MapDelete(
            "/{id}/cover",
            async (Guid id, IBookRepository repo, IFileStorageService storage, CancellationToken ct) =>
            {
                var book = await repo.GetByIdAsync(id);
                if (book is null)
                    return Results.NotFound();

                if (!storage.DeleteCover(id))
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
