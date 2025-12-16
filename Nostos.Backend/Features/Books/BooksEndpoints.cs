using System.Text.Json; // Added for JSON Serialization
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models; // Ensure Models namespace is imported for casting
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

        // GET all books (With Pagination, Smart Filters, Sorting AND SEARCH)
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

                // --- 1. Apply Search (Optimized) ---
                if (!string.IsNullOrWhiteSpace(search))
                {
                    var term = $"%{search}%";
                    query = query.Where(b =>
                        EF.Functions.Like(b.Title, term) || EF.Functions.Like(b.Author, term)
                    );
                }

                // --- 2. Apply Smart Filters (Enum-based) ---
                if (Enum.TryParse<BookFilter>(filter, true, out var filterEnum))
                {
                    query = filterEnum switch
                    {
                        BookFilter.Favorites => query.Where(b => b.IsFavorite),
                        BookFilter.Finished => query.Where(b => b.FinishedAt != null),
                        BookFilter.Reading => query.Where(b =>
                            b.FinishedAt == null && b.ProgressPercent > 0
                        ),
                        BookFilter.Unsorted => query.Where(b => b.CollectionId == null),
                        _ => query,
                    };
                }

                // --- 3. Apply Sorting (Enum-based) ---
                var sortEnum = Enum.TryParse<BookSort>(sort, true, out var s) ? s : BookSort.Recent;

                query = sortEnum switch
                {
                    BookSort.Title => query.OrderBy(b => b.Title),
                    BookSort.Rating => query.OrderByDescending(b => b.Rating),
                    BookSort.LastRead => query
                        .OrderByDescending(b => b.LastReadAt.HasValue)
                        .ThenByDescending(b => b.LastReadAt),
                    BookSort.Recent or _ => query.OrderByDescending(b => b.CreatedAt),
                };

                // --- 4. Apply Pagination ---
                var p = page ?? 1;
                var ps = pageSize ?? 20;

                var totalCount = await query.CountAsync();

                var books = await query.Skip((p - 1) * ps).Take(ps).ToListAsync();

                var dtos = books.Select(b => b.ToDto());

                return Results.Ok(new PaginatedResponse<BookDto>(dtos, totalCount, p, ps));
            }
        );

        // GET one book
        group.MapGet(
            "/{id}",
            async (Guid id, NostosDbContext db) =>
            {
                var book = await db.Books.FindAsync(id);
                if (book is null)
                    return Results.NotFound();
                return Results.Ok(book.ToDto());
            }
        );

        // CREATE book
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

        // UPDATE book
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

        // UPDATE Reading Progress
        group.MapPut(
            "/{id}/progress",
            async (Guid id, UpdateProgressDto dto, NostosDbContext db) =>
            {
                var book = await db.Books.FindAsync(id);
                if (book is null)
                    return Results.NotFound();

                book.LastLocation = dto.Location;
                book.ProgressPercent = dto.Percentage;

                // Update LastReadAt whenever progress is saved
                book.LastReadAt = DateTime.UtcNow;

                if (book.ProgressPercent >= 100 && book.FinishedAt == null)
                {
                    book.FinishedAt = DateTime.UtcNow;
                }

                await db.SaveChangesAsync();
                return Results.Ok(new { updated = true });
            }
        );

        // DELETE book
        group.MapDelete(
            "/{id}",
            async (Guid id, NostosDbContext db, FileStorageService storage) =>
            {
                var book = await db.Books.FindAsync(id);
                if (book is null)
                    return Results.NotFound();

                storage.DeleteBookFiles(id);
                book.CoverFileName = null;

                db.Books.Remove(book);
                await db.SaveChangesAsync();

                return Results.NoContent();
            }
        );

        // Upload file
        group.MapPost(
            "/{id}/file",
            async (Guid id, HttpRequest request, NostosDbContext db, FileStorageService storage) =>
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

                // --- NEW: Metadata Extraction (Chapters & Duration) ---
                var filePath = storage.GetBookFileName(id);
                if (filePath is not null)
                {
                    try
                    {
                        var track = new ATL.Track(filePath);

                        // 1. Extract Chapters (if any)
                        if (track.Chapters != null && track.Chapters.Count > 0)
                        {
                            var chapters = track
                                .Chapters.Select(c => new
                                {
                                    Title = c.Title,
                                    StartTime = c.StartTime / 1000.0, // ATL uses ms, convert to seconds
                                })
                                .ToList();

                            // Serialize to the new field in BookModel
                            book.ChaptersJson = JsonSerializer.Serialize(chapters);
                        }

                        // 2. Auto-fill Duration (Only if Book is AudioBookModel)
                        if (
                            book is AudioBookModel audioBook
                            && string.IsNullOrEmpty(audioBook.Duration)
                            && track.Duration > 0
                        )
                        {
                            var t = TimeSpan.FromSeconds(track.Duration);
                            // Format: 12:30:45
                            audioBook.Duration = t.ToString(@"hh\:mm\:ss");
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[Metadata Extraction] Failed: {ex.Message}");
                        // We swallow the exception so the upload doesn't fail just because of metadata
                    }
                }

                book.HasFile = true;
                book.FileName = $"book{Path.GetExtension(file.FileName)}";
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

        static string GetContentType(string filePath)
        {
            return Path.GetExtension(filePath).ToLower() switch
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
        }

        // Upload cover image
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

                var allowed = new[] { "image/png", "image/jpeg" };
                if (!allowed.Contains(file.ContentType))
                    return Results.BadRequest("Only PNG or JPEG images allowed.");

                await storage.SaveBookCoverAsync(id, file);

                book.CoverFileName = "cover.png";
                await db.SaveChangesAsync();

                return Results.Ok(new { uploaded = true });
            }
        );

        // Download cover image
        group.MapGet(
            "/{id}/cover",
            (Guid id, FileStorageService storage) =>
            {
                var coverPath = storage.GetBookCoverPath(id);
                if (coverPath is null)
                    return Results.NotFound();
                return Results.File(coverPath, "image/png", "cover.png");
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

                var removed = storage.DeleteCover(id);
                if (!removed)
                    return Results.NotFound();

                book.CoverFileName = null;
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
