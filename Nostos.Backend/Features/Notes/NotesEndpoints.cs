using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Mapping;
using Nostos.Backend.Services; // 👈 Required for the Service
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Features.Notes;

public static class NotesEndpoints
{
    public static IEndpointRouteBuilder MapNotesEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api");

        // GET notes by book
        group.MapGet(
            "/books/{bookId}/notes",
            async (Guid bookId, NostosDbContext db) =>
            {
                var notes = await db
                    .Notes.Include(n => n.Book)
                    .Where(n => n.BookId == bookId)
                    .ToListAsync();

                return Results.Ok(notes.Select(n => n.ToDto()));
            }
        );

        // CREATE note
        group.MapPost(
            "/books/{bookId}/notes",
            async (
                Guid bookId,
                CreateNoteDto dto,
                NostosDbContext db,
                NoteProcessorService noteProcessor // 👈 Inject Service
            ) =>
            {
                var model = dto.ToModel(bookId);

                db.Notes.Add(model);

                // Logic delegated to the service
                // EF Core tracks 'model', so the service can add links to it before we save.
                await noteProcessor.ProcessNoteAsync(model);

                await db.SaveChangesAsync();

                // Reload to get the Book Title for the response
                var createdNote = await db
                    .Notes.AsNoTracking()
                    .Include(n => n.Book)
                    .FirstAsync(n => n.Id == model.Id);

                return Results.Created($"/api/notes/{model.Id}", createdNote.ToDto());
            }
        );

        // UPDATE note
        group.MapPut(
            "/notes/{id}",
            async (
                Guid id,
                UpdateNoteDto dto,
                NostosDbContext db,
                NoteProcessorService noteProcessor // 👈 Inject Service
            ) =>
            {
                var existing = await db
                    .Notes.Include(n => n.NoteConcepts)
                    .Include(n => n.Book)
                    .FirstOrDefaultAsync(n => n.Id == id);

                if (existing is null)
                    return Results.NotFound();

                existing.Apply(dto);

                // Re-process concepts (Service handles clearing old links + adding new ones)
                await noteProcessor.ProcessNoteAsync(existing);

                await db.SaveChangesAsync();

                return Results.Ok(existing.ToDto());
            }
        );

        // DELETE note
        group.MapDelete(
            "/notes/{id}",
            async (Guid id, NostosDbContext db) =>
            {
                var existing = await db.Notes.FindAsync(id);
                if (existing is null)
                    return Results.NotFound();

                // 1. Remove links (Bulk delete is efficient here)
                await db.NoteConcepts.Where(nc => nc.NoteId == id).ExecuteDeleteAsync();

                // 2. Remove note
                db.Notes.Remove(existing);
                await db.SaveChangesAsync();

                return Results.NoContent();
            }
        );

        return routes;
    }
}
