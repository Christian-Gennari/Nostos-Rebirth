using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Mapping;
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
    group.MapDelete("/{id}", async (Guid id, NostosDbContext db) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      db.Books.Remove(book);
      await db.SaveChangesAsync();

      return Results.NoContent();
    });

    return routes;
  }
}
