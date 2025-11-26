using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Mapping;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Features.Notes;

public static class NotesEndpoints
{
  public static IEndpointRouteBuilder MapNotesEndpoints(this IEndpointRouteBuilder routes)
  {
    var group = routes.MapGroup("/api");

    // GET notes by book
    group.MapGet("/books/{bookId}/notes", async (Guid bookId, NostosDbContext db) =>
    {
      var notes = await db.Notes
              .Where(n => n.BookId == bookId)
              .ToListAsync();

      return Results.Ok(notes.Select(n => n.ToDto()));
    });

    // CREATE note
    group.MapPost("/books/{bookId}/notes", async (Guid bookId, CreateNoteDto dto, NostosDbContext db) =>
    {
      var model = dto.ToModel(bookId);

      db.Notes.Add(model);
      await db.SaveChangesAsync();

      return Results.Created($"/api/notes/{model.Id}", model.ToDto());
    });

    // UPDATE note
    group.MapPut("/notes/{id}", async (Guid id, UpdateNoteDto dto, NostosDbContext db) =>
    {
      var existing = await db.Notes.FindAsync(id);
      if (existing is null) return Results.NotFound();

      existing.Apply(dto);
      await db.SaveChangesAsync();

      return Results.Ok(existing.ToDto());
    });

    // DELETE note
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
