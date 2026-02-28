using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Mapping;
using Nostos.Backend.Services;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Endpoints;

public static class NotesEndpoints
{
    public static IEndpointRouteBuilder MapNotesEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api");

        // GET notes by book
        group.MapGet(
            "/books/{bookId}/notes",
            async (Guid bookId, INoteRepository repo) =>
            {
                var notes = await repo.GetByBookIdAsync(bookId);
                return Results.Ok(notes.Select(n => n.ToDto()));
            }
        );

        // CREATE note
        group.MapPost(
            "/books/{bookId}/notes",
            async (
                Guid bookId,
                CreateNoteDto dto,
                INoteRepository repo,
                NoteProcessorService noteProcessor
            ) =>
            {
                var model = dto.ToModel(bookId);

                await repo.AddAsync(model);

                // EF Core tracks 'model', so the service can add links to it before we save.
                await noteProcessor.ProcessNoteAsync(model);

                await repo.SaveChangesAsync();

                // Reload to get the Book Title for the response
                var createdNote = await repo.GetByIdWithBookAsync(model.Id);

                return Results.Created($"/api/notes/{model.Id}", createdNote!.ToDto());
            }
        );

        // UPDATE note
        group.MapPut(
            "/notes/{id}",
            async (
                Guid id,
                UpdateNoteDto dto,
                INoteRepository repo,
                NoteProcessorService noteProcessor
            ) =>
            {
                var existing = await repo.GetByIdWithConceptsAsync(id);
                if (existing is null)
                    return Results.NotFound();

                existing.Apply(dto);

                // Re-process concepts (Service handles clearing old links + adding new ones)
                await noteProcessor.ProcessNoteAsync(existing);

                await repo.SaveChangesAsync();

                return Results.Ok(existing.ToDto());
            }
        );

        // DELETE note
        group.MapDelete(
            "/notes/{id}",
            async (Guid id, INoteRepository repo) =>
            {
                var existing = await repo.GetByIdAsync(id);
                if (existing is null)
                    return Results.NotFound();

                // 1. Remove concept links (Bulk delete is efficient here)
                await repo.DeleteConceptLinksAsync(id);

                // 2. Remove note
                await repo.DeleteAsync(existing);

                return Results.NoContent();
            }
        );

        return routes;
    }
}
