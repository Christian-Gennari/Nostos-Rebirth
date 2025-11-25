using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Features.Books;

public static class BooksEndpoints
{
  public static IEndpointRouteBuilder MapBooksEndpoints(this IEndpointRouteBuilder routes)
  {
    var group = routes.MapGroup("/api/books");

    // GET /api/books
    group.MapGet("/", async (NostosDbContext db) =>
    {
      var books = await db.Books.ToListAsync();
      return Results.Ok(books);
    });

    // POST /api/books (metadata only)
    group.MapPost("/", async (BookModel model, NostosDbContext db) =>
    {
      db.Books.Add(model);
      await db.SaveChangesAsync();
      return Results.Created($"/api/books/{model.Id}", model);
    });

    return routes;
  }
}
