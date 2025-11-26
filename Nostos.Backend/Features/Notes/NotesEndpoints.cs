using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Mapping;
using Nostos.Shared.Dtos;

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

      return Results.Ok(notes.Select(n => n.ToDto()));
    });

    // POST /api/books/{bookId}/notes
    group.MapPost("/books/{bookId}/notes", async (Guid bookId, NoteModel model, NostosDbContext db) =>
    {
      model.Id = Guid.NewGuid();
      model.BookId = bookId;

      db.Notes.Add(model);
      await db.SaveChangesAsync();

      return Results.Created($"/api/notes/{model.Id}", model.ToDto());
    });

    // PUT /api/notes/{id}
    group.MapPut("/notes/{id}", async (Guid id, NoteModel update, NostosDbContext db) =>
    {
      var note = await db.Notes.FindAsync(id);
      if (note is null) return Results.NotFound();

      note.Content = update.Content;

      await db.SaveChangesAsync();
      return Results.Ok(note.ToDto());
    });

    // DELETE /api/notes/{id}
    group.MapDelete("/notes/{id}", async (Guid id, NostosDbContext db) =>
    {
      var note = await db.Notes.FindAsync(id);
      if (note is null) return Results.NotFound();

      db.Notes.Remove(note);
      await db.SaveChangesAsync();

      return Results.NoContent();
    });

    return routes;
  }
}
