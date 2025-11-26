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
      using var stream = storage.GetBookFile(id);
      if (stream is null) return Results.NotFound();

      var fileName = storage.GetBookFileName(id);
      var contentType = GetContentType(fileName!);

      return Results.File(stream, contentType, Path.GetFileName(fileName));
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

    return routes;
  }

}
