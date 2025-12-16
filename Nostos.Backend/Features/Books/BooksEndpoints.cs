using Nostos.Backend.Data.Models;
using Nostos.Backend.Data.Repositories; // 👈 Import Repo namespace
using Nostos.Backend.Mapping;
using Nostos.Backend.Services;
using Nostos.Shared.Dtos;
using Nostos.Shared.Enums;

namespace Nostos.Backend.Features.Books;

public static class BooksEndpoints
{
    public static IEndpointRouteBuilder MapBooksEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/books");

        // GET all books (CLEANED UP!)
        group.MapGet(
            "/",
            async (
                IBookRepository repo, // 👈 Inject Repo
                string? filter,
                string? sort,
                string? search,
                int? page,
                int? pageSize
            ) =>
            {
                // Parse Enums
                Enum.TryParse<BookFilter>(filter, true, out var filterEnum);
                Enum.TryParse<BookSort>(sort, true, out var sortEnum);

                var p = page ?? 1;
                var ps = pageSize ?? 20;

                // Call Repo
                var result = await repo.GetBooksAsync(search, filterEnum, sortEnum, p, ps);

                // Map to DTOs
                var dtos = result.Items.Select(b => b.ToDto());

                return Results.Ok(new PaginatedResponse<BookDto>(dtos, result.TotalCount, p, ps));
            }
        );

        // GET one
        group.MapGet(
            "/{id}",
            async (Guid id, IBookRepository repo) =>
            {
                var book = await repo.GetByIdAsync(id);
                return book is null ? Results.NotFound() : Results.Ok(book.ToDto());
            }
        );

        // CREATE
        group.MapPost(
            "/",
            async (CreateBookDto dto, IBookRepository repo) =>
            {
                if (string.IsNullOrWhiteSpace(dto.Title))
                    return Results.BadRequest(new { error = "Title is required." });

                var model = dto.ToModel();
                model.CollectionId = dto.CollectionId;

                await repo.AddAsync(model);

                return Results.Created($"/api/books/{model.Id}", model.ToDto());
            }
        );

        // UPDATE
        group.MapPut(
            "/{id}",
            async (Guid id, UpdateBookDto dto, IBookRepository repo) =>
            {
                var book = await repo.GetByIdAsync(id);
                if (book is null)
                    return Results.NotFound();

                if (dto.Title is not null && string.IsNullOrWhiteSpace(dto.Title))
                    return Results.BadRequest(new { error = "Title cannot be empty." });

                book.Apply(dto);
                await repo.UpdateAsync(book);

                return Results.Ok(book.ToDto());
            }
        );

        // UPDATE Progress
        group.MapPut(
            "/{id}/progress",
            async (Guid id, UpdateProgressDto dto, IBookRepository repo) =>
            {
                var book = await repo.GetByIdAsync(id);
                if (book is null)
                    return Results.NotFound();

                book.Progress.LastLocation = dto.Location;
                book.Progress.ProgressPercent = dto.Percentage;
                book.Progress.LastReadAt = DateTime.UtcNow;

                if (book.Progress.ProgressPercent >= 100 && book.Progress.FinishedAt == null)
                {
                    book.Progress.FinishedAt = DateTime.UtcNow;
                }

                await repo.UpdateAsync(book);
                return Results.Ok(new { updated = true });
            }
        );

        // DELETE
        group.MapDelete(
            "/{id}",
            async (Guid id, IBookRepository repo, FileStorageService storage) =>
            {
                var book = await repo.GetByIdAsync(id);
                if (book is null)
                    return Results.NotFound();

                storage.DeleteBookFiles(id);

                await repo.DeleteAsync(book);

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
                FileStorageService storage,
                MediaMetadataService metadataService
            ) =>
            {
                var book = await repo.GetByIdAsync(id);
                if (book is null)
                    return Results.NotFound();

                var form = await request.ReadFormAsync();
                var file = form.Files.FirstOrDefault();
                if (file is null)
                    return Results.BadRequest("Missing file.");

                var allowed = new[]
                {
                    "application/epub+zip",
                    "application/pdf",
                    "text/plain",
                    "audio/mpeg",
                    "audio/mp4",
                    "audio/x-m4a",
                };
                if (
                    !allowed.Contains(file.ContentType)
                    && !file.FileName.EndsWith(".m4b", StringComparison.OrdinalIgnoreCase)
                )
                    return Results.BadRequest($"Unsupported file type: {file.ContentType}");

                await storage.SaveBookFileAsync(id, file);

                var filePath = storage.GetBookFileName(id);
                if (filePath is not null)
                {
                    metadataService.EnrichBookMetadata(book, filePath);
                }

                book.FileDetails.HasFile = true;
                book.FileDetails.FileName = $"book{Path.GetExtension(file.FileName)}";

                await repo.UpdateAsync(book);
                return Results.Ok(new { uploaded = true });
            }
        );

        // Download file (Read-only, doesn't necessarily need Repo, but Service is fine)
        group.MapGet(
            "/{id}/file",
            (Guid id, FileStorageService storage) =>
            {
                var filePath = storage.GetBookFileName(id);
                if (filePath is null)
                    return Results.NotFound();

                var contentType = GetContentType(filePath);
                var fileName = Path.GetFileName(filePath);

                return Results.File(filePath, contentType, fileName, enableRangeProcessing: true);
            }
        );

        static string GetContentType(string filePath) =>
            Path.GetExtension(filePath).ToLower() switch
            {
                ".epub" => "application/epub+zip",
                ".pdf" => "application/pdf",
                ".txt" => "text/plain",
                ".mobi" => "application/x-mobipocket-ebook",
                ".mp3" => "audio/mpeg",
                ".m4a" => "audio/mp4",
                ".m4b" => "audio/mp4",
                _ => "application/octet-stream",
            };

        // Upload cover
        group.MapPost(
            "/{id}/cover",
            async (
                Guid id,
                HttpRequest request,
                IBookRepository repo,
                FileStorageService storage
            ) =>
            {
                var book = await repo.GetByIdAsync(id);
                if (book is null)
                    return Results.NotFound();

                var form = await request.ReadFormAsync();
                var file = form.Files.FirstOrDefault();
                if (file is null)
                    return Results.BadRequest("Missing cover file.");

                if (!new[] { "image/png", "image/jpeg" }.Contains(file.ContentType))
                    return Results.BadRequest("Only PNG or JPEG images allowed.");

                await storage.SaveBookCoverAsync(id, file);
                book.FileDetails.CoverFileName = "cover.png";

                await repo.UpdateAsync(book);

                return Results.Ok(new { uploaded = true });
            }
        );

        // Download cover
        group.MapGet(
            "/{id}/cover",
            (Guid id, FileStorageService storage) =>
            {
                var coverPath = storage.GetBookCoverPath(id);
                return coverPath is null
                    ? Results.NotFound()
                    : Results.File(coverPath, "image/png", "cover.png");
            }
        );

        // DELETE cover
        group.MapDelete(
            "/{id}/cover",
            async (Guid id, IBookRepository repo, FileStorageService storage) =>
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

        // Lookup Service doesn't interact with DB directly, so it stays as is
        group.MapGet(
            "/lookup/{isbn}",
            async (string isbn, BookLookupService service) =>
            {
                var metadata = await service.LookupCombinedAsync(isbn);
                return metadata is not null ? Results.Ok(metadata) : Results.NotFound();
            }
        );

        return routes;
    }
}
