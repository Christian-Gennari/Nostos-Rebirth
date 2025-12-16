using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
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

        // GET all books
        group.MapGet(
            "/",
            async (
                NostosDbContext db,
                string? filter,
                string? sort,
                string? search,
                int? page,
                int? pageSize
            ) =>
            {
                var query = db.Books.AsQueryable();

                // 1. Search
                if (!string.IsNullOrWhiteSpace(search))
                {
                    var term = $"%{search}%";
                    query = query.Where(b =>
                        EF.Functions.Like(b.Title, term) || EF.Functions.Like(b.Author, term)
                    );
                }

                // 2. Filters
                if (Enum.TryParse<BookFilter>(filter, true, out var filterEnum))
                {
                    query = filterEnum switch
                    {
                        BookFilter.Favorites => query.Where(b => b.Progress.IsFavorite),
                        BookFilter.Finished => query.Where(b => b.Progress.FinishedAt != null),
                        BookFilter.Reading => query.Where(b =>
                            b.Progress.FinishedAt == null && b.Progress.ProgressPercent > 0
                        ),
                        BookFilter.Unsorted => query.Where(b => b.CollectionId == null),
                        _ => query,
                    };
                }

                // 3. Sorting
                var sortEnum = Enum.TryParse<BookSort>(sort, true, out var s) ? s : BookSort.Recent;

                query = sortEnum switch
                {
                    BookSort.Title => query.OrderBy(b => b.Title),
                    BookSort.Rating => query.OrderByDescending(b => b.Progress.Rating),
                    BookSort.LastRead => query
                        .OrderByDescending(b => b.Progress.LastReadAt.HasValue)
                        .ThenByDescending(b => b.Progress.LastReadAt),
                    BookSort.Recent or _ => query.OrderByDescending(b => b.CreatedAt),
                };

                // 4. Pagination
                var p = page ?? 1;
                var ps = pageSize ?? 20;
                var totalCount = await query.CountAsync();
                var books = await query.Skip((p - 1) * ps).Take(ps).ToListAsync();
                var dtos = books.Select(b => b.ToDto());

                return Results.Ok(new PaginatedResponse<BookDto>(dtos, totalCount, p, ps));
            }
        );

        // GET one
        group.MapGet(
            "/{id}",
            async (Guid id, NostosDbContext db) =>
            {
                var book = await db.Books.FindAsync(id);
                return book is null ? Results.NotFound() : Results.Ok(book.ToDto());
            }
        );

        // CREATE
        group.MapPost(
            "/",
            async (CreateBookDto dto, NostosDbContext db) =>
            {
                if (string.IsNullOrWhiteSpace(dto.Title))
                    return Results.BadRequest(new { error = "Title is required." });

                var model = dto.ToModel();
                model.CollectionId = dto.CollectionId;

                db.Books.Add(model);
                await db.SaveChangesAsync();

                return Results.Created($"/api/books/{model.Id}", model.ToDto());
            }
        );

        // UPDATE
        group.MapPut(
            "/{id}",
            async (Guid id, UpdateBookDto dto, NostosDbContext db) =>
            {
                var book = await db.Books.FindAsync(id);
                if (book is null)
                    return Results.NotFound();

                if (dto.Title is not null && string.IsNullOrWhiteSpace(dto.Title))
                    return Results.BadRequest(new { error = "Title cannot be empty." });

                book.Apply(dto);
                await db.SaveChangesAsync();

                return Results.Ok(book.ToDto());
            }
        );

        // UPDATE Progress
        group.MapPut(
            "/{id}/progress",
            async (Guid id, UpdateProgressDto dto, NostosDbContext db) =>
            {
                var book = await db.Books.FindAsync(id);
                if (book is null)
                    return Results.NotFound();

                book.Progress.LastLocation = dto.Location;
                book.Progress.ProgressPercent = dto.Percentage;
                book.Progress.LastReadAt = DateTime.UtcNow;

                if (book.Progress.ProgressPercent >= 100 && book.Progress.FinishedAt == null)
                {
                    book.Progress.FinishedAt = DateTime.UtcNow;
                }

                await db.SaveChangesAsync();
                return Results.Ok(new { updated = true });
            }
        );

        // DELETE
        group.MapDelete(
            "/{id}",
            async (Guid id, NostosDbContext db, FileStorageService storage) =>
            {
                var book = await db.Books.FindAsync(id);
                if (book is null)
                    return Results.NotFound();

                storage.DeleteBookFiles(id);
                book.FileDetails.CoverFileName = null;

                db.Books.Remove(book);
                await db.SaveChangesAsync();

                return Results.NoContent();
            }
        );

        // Upload file (UPDATED with Service)
        group.MapPost(
            "/{id}/file",
            async (
                Guid id,
                HttpRequest request,
                NostosDbContext db,
                FileStorageService storage,
                MediaMetadataService metadataService // 👈 Inject Service
            ) =>
            {
                var book = await db.Books.FindAsync(id);
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

                // --- Use the new Service ---
                var filePath = storage.GetBookFileName(id);
                if (filePath is not null)
                {
                    metadataService.EnrichBookMetadata(book, filePath);
                }

                book.FileDetails.HasFile = true;
                book.FileDetails.FileName = $"book{Path.GetExtension(file.FileName)}";

                await db.SaveChangesAsync();
                return Results.Ok(new { uploaded = true });
            }
        );

        // Download file
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
            async (Guid id, HttpRequest request, NostosDbContext db, FileStorageService storage) =>
            {
                var book = await db.Books.FindAsync(id);
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
                await db.SaveChangesAsync();

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
            async (Guid id, NostosDbContext db, FileStorageService storage) =>
            {
                var book = await db.Books.FindAsync(id);
                if (book is null)
                    return Results.NotFound();

                if (!storage.DeleteCover(id))
                    return Results.NotFound();

                book.FileDetails.CoverFileName = null;
                await db.SaveChangesAsync();

                return Results.NoContent();
            }
        );

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
