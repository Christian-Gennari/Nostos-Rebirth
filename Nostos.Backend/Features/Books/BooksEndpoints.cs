using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Mapping;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Features.Books;

public static class BooksEndpoints
{
  public static IEndpointRouteBuilder MapBooksEndpoints(this IEndpointRouteBuilder routes)
  {
    var group = routes.MapGroup("/api/books");

    // GET /api/books (list all)
    group.MapGet("/", async (NostosDbContext db) =>
    {
      var books = await db.Books
              .OrderByDescending(b => b.CreatedAt)
              .ToListAsync();

      return Results.Ok(books.Select(b => b.ToDto()));
    });

    // GET /api/books/{id}
    group.MapGet("/{id}", async (Guid id, NostosDbContext db) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      return Results.Ok(book.ToDto());
    });

    // POST /api/books
    group.MapPost("/", async (BookModel model, NostosDbContext db) =>
    {
      if (string.IsNullOrWhiteSpace(model.Title))
        return Results.BadRequest(new { error = "Title is required." });

      model.Id = Guid.NewGuid();
      model.CreatedAt = DateTime.UtcNow;

      db.Books.Add(model);
      await db.SaveChangesAsync();

      return Results.Created($"/api/books/{model.Id}", model.ToDto());
    });

    // PUT /api/books/{id}
    group.MapPut("/{id}", async (Guid id, BookModel update, NostosDbContext db) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      if (string.IsNullOrWhiteSpace(update.Title))
        return Results.BadRequest(new { error = "Title is required." });

      book.Title = update.Title;
      book.Author = update.Author;

      await db.SaveChangesAsync();
      return Results.Ok(book.ToDto());
    });

    // DELETE /api/books/{id}
    group.MapDelete("/{id}", async (Guid id, NostosDbContext db) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      db.Books.Remove(book);
      await db.SaveChangesAsync();

      return Results.NoContent();
    });

    // UPLOAD FILE
    group.MapPost("/{id}/file", async (Guid id, IFormFile file, IWebHostEnvironment env, NostosDbContext db) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      var directory = Path.Combine(env.ContentRootPath, "Storage", "books", id.ToString());
      Directory.CreateDirectory(directory);

      var filePath = Path.Combine(directory, file.FileName);
      using var stream = new FileStream(filePath, FileMode.Create);
      await file.CopyToAsync(stream);

      return Results.Ok(new { Message = "Uploaded", File = file.FileName });
    });

    return routes;
  }
}
