using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Microsoft.EntityFrameworkCore;


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

    // POST /api/books (metadata)
    group.MapPost("/", async (BookModel model, NostosDbContext db) =>
    {
      db.Books.Add(model);
      await db.SaveChangesAsync();
      return Results.Created($"/api/books/{model.Id}", model);
    });

    // PUT /api/books/{id} (update metadata)
    group.MapPut("/{id}", async (Guid id, BookModel update, NostosDbContext db) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      book.Title = update.Title;
      book.Author = update.Author;

      await db.SaveChangesAsync();
      return Results.Ok(book);
    });

    // POST /api/books/{id}/file (file upload placeholder)
    group.MapPost("/{id}/file", async (Guid id, IFormFile file, IWebHostEnvironment env, NostosDbContext db) =>
    {
      var book = await db.Books.FindAsync(id);
      if (book is null) return Results.NotFound();

      // placeholder: storage path
      var directory = Path.Combine(env.ContentRootPath, "Storage", "books", id.ToString());
      Directory.CreateDirectory(directory);

      var filePath = Path.Combine(directory, file.FileName);

      using (var stream = new FileStream(filePath, FileMode.Create))
        await file.CopyToAsync(stream);

      return Results.Ok(new { Message = "Uploaded", File = file.FileName });
    });

    return routes;
  }
}
