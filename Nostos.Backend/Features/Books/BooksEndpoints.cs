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

    // GET all books
    group.MapGet("/", async (NostosDbContext db) =>
    {
      var books = await db.Books
              .OrderByDescending(b => b.CreatedAt)
              .ToListAsync();

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

      db.Books.Add(model);
      await db.SaveChangesAsync();

      return Results.Created($"/api/books/{model.Id}", model.ToDto());
    });

    // UPDATE book
    group.MapPut("/{id}", async (Guid id, UpdateBookDto dto, NostosDbContext db) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      if (string.IsNullOrWhiteSpace(dto.Title))
        return Results.BadRequest(new { error = "Title is required." });

      book.Apply(dto);
      await db.SaveChangesAsync();

      return Results.Ok(book.ToDto());
    });

    // DELETE book
    group.MapDelete("/{id}", async (Guid id, NostosDbContext db, FileStorageService storage) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      // Delete physical files
      storage.DeleteBookFiles(id);


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
      var allowed = new[] { "application/epub+zip", "application/pdf", "text/plain" };
      if (!allowed.Contains(file.ContentType))
        return Results.BadRequest("Only EPUB, PDF, or TXT files allowed.");

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


      return Results.File(filePath, contentType, fileName);
    });


    static string GetContentType(string filePath)
    {
      return Path.GetExtension(filePath).ToLower() switch
      {
        ".epub" => "application/epub+zip",
        ".pdf" => "application/pdf",
        ".txt" => "text/plain",
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


    return routes;
  }

}
