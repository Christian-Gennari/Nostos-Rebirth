using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Microsoft.EntityFrameworkCore;

namespace Nostos.Backend.Features.Books;

public static class BooksEndpoints
{
  public static IEndpointRouteBuilder MapBooksEndpoints(this IEndpointRouteBuilder routes)
  {
    var group = routes.MapGroup("/api/books");

    // GET /api/books - list all books
    group.MapGet("/", async (NostosDbContext db) =>
    {
      var books = await db.Books
        .OrderByDescending(b => b.CreatedAt)
        .ToListAsync();

      return Results.Ok(books);
    });

    // GET /api/books/{id} - get a single book
    group.MapGet("/{id}", async (Guid id, NostosDbContext db) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      return Results.Ok(book);
    });

    // POST /api/books - create metadata only
    group.MapPost("/", async (BookModel model, NostosDbContext db) =>
    {
      // Basic guard against empty titles
      if (string.IsNullOrWhiteSpace(model.Title))
      {
        return Results.BadRequest(new { error = "Title is required." });
      }

      // Ensure new ID and created timestamp are set server side
      model.Id = Guid.NewGuid();
      model.CreatedAt = DateTime.UtcNow;

      db.Books.Add(model);
      await db.SaveChangesAsync();

      return Results.Created($"/api/books/{model.Id}", model);
    });

    // PUT /api/books/{id} - update metadata
    group.MapPut("/{id}", async (Guid id, BookModel update, NostosDbContext db) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      if (string.IsNullOrWhiteSpace(update.Title))
      {
        return Results.BadRequest(new { error = "Title is required." });
      }

      book.Title = update.Title;
      book.Author = update.Author;

      await db.SaveChangesAsync();
      return Results.Ok(book);
    });

    // DELETE /api/books/{id} - remove a book
    group.MapDelete("/{id}", async (Guid id, NostosDbContext db) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      db.Books.Remove(book);
      await db.SaveChangesAsync();
      return Results.NoContent();
    });

    // POST /api/books/{id}/file - file upload placeholder
    group.MapPost("/{id}/file", async (Guid id, IFormFile file, IWebHostEnvironment env, NostosDbContext db) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      var directory = Path.Combine(env.ContentRootPath, "Storage", "books", id.ToString());
      Directory.CreateDirectory(directory);

      var filePath = Path.Combine(directory, file.FileName);

      using (var stream = new FileStream(filePath, FileMode.Create))
      {
        await file.CopyToAsync(stream);
      }

      return Results.Ok(new { Message = "Uploaded", File = file.FileName });
    });

    return routes;
  }
}
