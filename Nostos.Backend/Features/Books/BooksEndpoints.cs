using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Mapping;
using Nostos.Backend.Services;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Features.Books;

public static class BooksEndpoints
{
  public static IEndpointRouteBuilder MapBooksEndpoints(this IEndpointRouteBuilder routes)
  {
    var group = routes.MapGroup("/api/books");

    // GET all books (With Smart Filters & Sorting)
    group.MapGet("/", async (NostosDbContext db, string? filter, string? sort) =>
    {
      var query = db.Books.AsQueryable();

      // --- 1. Apply Smart Filters ---
      if (!string.IsNullOrWhiteSpace(filter))
      {
        switch (filter.ToLower())
        {
          case "favorites":
            query = query.Where(b => b.IsFavorite);
            break;
          case "finished":
            query = query.Where(b => b.FinishedAt != null);
            break;
          case "reading":
            // Started (progress > 0) but not finished
            query = query.Where(b => b.FinishedAt == null && b.ProgressPercent > 0);
            break;
          case "unsorted":
            // Books not assigned to any user collection
            query = query.Where(b => b.CollectionId == null);
            break;
        }
      }

      // --- 2. Apply Sorting ---
      // Default to "Recently Added" if no sort provided
      query = (sort?.ToLower()) switch
      {
        "title" => query.OrderBy(b => b.Title),
        "rating" => query.OrderByDescending(b => b.Rating), // Sort by your new Rating field
        "recent" or _ => query.OrderByDescending(b => b.CreatedAt)
      };

      var books = await query.ToListAsync();

      return Results.Ok(books.Select(b => b.ToDto()));
    });

    // GET one book
    group.MapGet("/{id}", async (Guid id, NostosDbContext db) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      return Results.Ok(book.ToDto());
    });

    // CREATE book
    group.MapPost("/", async (CreateBookDto dto, NostosDbContext db) =>
    {
      if (string.IsNullOrWhiteSpace(dto.Title))
        return Results.BadRequest(new { error = "Title is required." });

      var model = dto.ToModel();
      model.CollectionId = dto.CollectionId;

      db.Books.Add(model);
      await db.SaveChangesAsync();

      return Results.Created($"/api/books/{model.Id}", model.ToDto());
    });

    // UPDATE book
    group.MapPut("/{id}", async (Guid id, UpdateBookDto dto, NostosDbContext db) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      // FIX: Only validate Title if the client is actually trying to change it.
      // If dto.Title is null, it means "no change", so we skip validation.
      if (dto.Title is not null && string.IsNullOrWhiteSpace(dto.Title))
        return Results.BadRequest(new { error = "Title cannot be empty." });

      // Apply changes (handles null checks internally for partial updates)
      book.Apply(dto);

      // Removed: book.CollectionId = dto.CollectionId;
      // Reason: The Apply() method now handles this safely. Setting it here would
      // accidentally set it to null during partial updates.

      await db.SaveChangesAsync();

      return Results.Ok(book.ToDto());
    });

    // UPDATE Reading Progress
    group.MapPut("/{id}/progress", async (Guid id, UpdateProgressDto dto, NostosDbContext db) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      book.LastLocation = dto.Location;
      book.ProgressPercent = dto.Percentage;

      // Optional: Auto-finish if percentage is 100%
      if (book.ProgressPercent >= 100 && book.FinishedAt == null)
      {
        book.FinishedAt = DateTime.UtcNow;
      }

      await db.SaveChangesAsync();

      return Results.Ok(new { updated = true });
    });

    // DELETE book
    group.MapDelete("/{id}", async (Guid id, NostosDbContext db, FileStorageService storage) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      // Delete physical files
      storage.DeleteBookFiles(id);

      // Clear cover reference
      book.CoverFileName = null;

      db.Books.Remove(book);
      await db.SaveChangesAsync();

      return Results.NoContent();
    });


    // Upload file
    group.MapPost("/{id}/file", async (
        Guid id,
        HttpRequest request,
        NostosDbContext db,
        FileStorageService storage) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      var form = await request.ReadFormAsync();
      var file = form.Files.FirstOrDefault();
      if (file is null) return Results.BadRequest("Missing file.");

      // Restrict formats
      var allowed = new[] {
          "application/epub+zip", "application/pdf", "text/plain",
          "audio/mpeg", "audio/mp4", "audio/x-m4a"
      };

      if (!allowed.Contains(file.ContentType) && !file.FileName.EndsWith(".m4b", StringComparison.OrdinalIgnoreCase))
        return Results.BadRequest($"Unsupported file type: {file.ContentType}");

      await storage.SaveBookFileAsync(id, file);

      book.HasFile = true;
      book.FileName = file.FileName;
      await db.SaveChangesAsync();

      return Results.Ok(new { uploaded = true });
    });

    // Download file
    group.MapGet("/{id}/file", (
        Guid id,
        FileStorageService storage) =>
    {
      var filePath = storage.GetBookFileName(id);
      if (filePath is null)
        return Results.NotFound();

      var contentType = GetContentType(filePath);
      var fileName = Path.GetFileName(filePath);


      return Results.File(filePath, contentType, fileName, enableRangeProcessing: true);
    });


    static string GetContentType(string filePath)
    {
      return Path.GetExtension(filePath).ToLower() switch
      {
        ".epub" => "application/epub+zip",
        ".pdf" => "application/pdf",
        ".txt" => "text/plain",
        ".mobi" => "application/x-mobipocket-ebook",
        // Audio
        ".mp3" => "audio/mpeg",
        ".m4a" => "audio/mp4",
        ".m4b" => "audio/mp4", // Trick browser into treating m4b as standard mp4 audio
        _ => "application/octet-stream"
      };
    }


    // Upload cover image
    group.MapPost("/{id}/cover", async (
        Guid id,
        HttpRequest request,
        NostosDbContext db,
        FileStorageService storage) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      var form = await request.ReadFormAsync();
      var file = form.Files.FirstOrDefault();
      if (file is null) return Results.BadRequest("Missing cover file.");

      // Restrict to images only
      var allowed = new[] { "image/png", "image/jpeg" };
      if (!allowed.Contains(file.ContentType))
        return Results.BadRequest("Only PNG or JPEG images allowed.");

      await storage.SaveBookCoverAsync(id, file);

      // Store filename in DB
      book.CoverFileName = "cover.png";
      await db.SaveChangesAsync();

      return Results.Ok(new { uploaded = true });
    });

    // Download cover image
    group.MapGet("/{id}/cover", (
        Guid id,
        FileStorageService storage) =>
    {
      var coverPath = storage.GetBookCoverPath(id);
      if (coverPath is null)
        return Results.NotFound();

      return Results.File(coverPath, "image/png", "cover.png");
    });


    // DELETE cover
    group.MapDelete("/{id}/cover", async (
        Guid id,
        NostosDbContext db,
        FileStorageService storage) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      var removed = storage.DeleteCover(id);
      if (!removed) return Results.NotFound();

      // Reset metadata
      book.CoverFileName = null;
      await db.SaveChangesAsync();

      return Results.NoContent();
    });


    group.MapGet("/lookup/{isbn}", async (string isbn, BookLookupService service) =>
    {
      var metadata = await service.LookupCombinedAsync(isbn);
      return metadata is not null ? Results.Ok(metadata) : Results.NotFound();
    });

    return routes;
  }

}
