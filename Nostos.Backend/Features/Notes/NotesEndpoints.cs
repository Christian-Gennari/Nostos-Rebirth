using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Features.Notes;

public static class NotesEndpoints
{
  public static IEndpointRouteBuilder MapNotesEndpoints(this IEndpointRouteBuilder routes)
  {
    var group = routes.MapGroup("/api");

    // GET /api/books/{bookId}/notes
    group.MapGet("/books/{bookId}/notes", async (Guid bookId, NostosDbContext db) =>
    {
      var notes = await db.Notes
              .Where(n => n.BookId == bookId)
              .ToListAsync();

      return Results.Ok(notes);
    });

    // POST /api/books/{bookId}/notes
    group.MapPost("/books/{bookId}/notes", async (Guid bookId, NoteModel note, NostosDbContext db) =>
    {
      note.Id = Guid.NewGuid();
      note.BookId = bookId;

      db.Notes.Add(note);
      await db.SaveChangesAsync();

      return Results.Created($"/api/notes/{note.Id}", note);
    });

    // PUT /api/notes/{id}
    group.MapPut("/notes/{id}", async (Guid id, NoteModel update, NostosDbContext db) =>
    {
      var existing = await db.Notes.FindAsync(id);
      if (existing is null) return Results.NotFound();

      existing.Content = update.Content;

      await db.SaveChangesAsync();
      return Results.Ok(existing);
    });

    // DELETE /api/notes/{id}
    group.MapDelete("/notes/{id}", async (Guid id, NostosDbContext db) =>
    {
      var existing = await db.Notes.FindAsync(id);
      if (existing is null) return Results.NotFound();

      db.Notes.Remove(existing);
      await db.SaveChangesAsync();

      return Results.NoContent();
    });

    return routes;
  }
}
