using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Data.Models;
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

        // SEARCH notes by text (issue #158). The index could only ever match concept
        // NAMES, so a word living only in a note's body or quote was unreachable —
        // and 44 of this library's 63 notes belong to no concept at all, which no
        // concept row can ever lead to.
        group.MapGet(
            "/notes/search",
            async (string? query, INoteRepository repo, int? limit) =>
            {
                var hits = await repo.SearchByTextAsync(query ?? string.Empty, Clamp(limit));
                var term = (query ?? string.Empty).Trim();
                return Results.Ok(hits.Select(n => ByText(n, term)).ToList());
            }
        );

        // Notes linked to no concept, so they can be read at all.
        //
        // Paged on purpose. This used to answer with a bare list capped at 50,
        // which the Brain's permanent sidebar section then rendered as if it were
        // every unlinked note in the library (issue #256). The review mode that
        // replaces that section walks the whole set, so the reply carries the
        // total alongside a bounded page.
        group.MapGet(
            "/notes/unlinked",
            async (INoteRepository repo, int? limit, int? offset) =>
            {
                var take = Clamp(limit);
                var skip = Math.Max(offset ?? 0, 0);
                var total = await repo.CountWithoutConceptsAsync();
                var notes = await repo.GetWithoutConceptsAsync(take, skip);
                return Results.Ok(
                    new NoteSearchPageDto(notes.Select(n => ByText(n, null)).ToList(), total, skip, take)
                );
            }
        );

        // CREATE note
        group.MapPost(
            "/books/{bookId}/notes",
            async (
                Guid bookId,
                CreateNoteDto dto,
                IBookRepository bookRepo,
                INoteRepository repo,
                NoteProcessorService noteProcessor
            ) =>
            {
                // Validate that the book exists
                var book = await bookRepo.GetByIdAsync(bookId);
                if (book is null)
                    return Results.NotFound(new { error = $"Book {bookId} not found." });

                if (string.IsNullOrWhiteSpace(dto.Content) && string.IsNullOrWhiteSpace(dto.SelectedText))
                    return Results.BadRequest(new { error = "Note must have content or selected text." });

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

    /// <summary>A small page keeps the index responsive; the cap is a guard on the caller.</summary>
    private static int Clamp(int? limit) => Math.Clamp(limit ?? 50, 1, 200);

    private static NoteSearchHitDto ByText(NoteModel n, string? term) => new(
        n.Id,
        n.BookId,
        n.Book?.Title,
        n.Content,
        n.SelectedText,
        Snippet(n.Content, n.SelectedText, term),
        n.NoteConcepts
            .Where(nc => nc.Concept != null)
            .Select(nc => nc.Concept!.Concept)
            .OrderBy(name => name)
            .ToList(),
        n.CreatedAt);

    /// <summary>
    /// The fragment around the match, so a row can show WHY it matched. Built here
    /// rather than in the client so the whole note body never has to travel.
    /// </summary>
    private static string? Snippet(string content, string? quote, string? term)
    {
        // Prefer the quotation: it is the passage from the book either way.
        var text = string.IsNullOrWhiteSpace(quote) ? content : quote!;
        if (string.IsNullOrWhiteSpace(text)) return null;

        var flat = string.Join(' ', text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (flat.Length <= 160) return flat;

        // Centre on the match when there is one, so the row shows WHY it matched
        // rather than the opening words of every hit.
        var at = term is null ? -1 : flat.IndexOf(term, StringComparison.OrdinalIgnoreCase);
        if (at < 0) return flat[..157] + "…";

        var start = Math.Max(0, at - 60);
        var end = Math.Min(flat.Length, start + 157);
        start = Math.Max(0, Math.Min(start, end - 40));
        return (start > 0 ? "…" : string.Empty) + flat[start..end] + (end < flat.Length ? "…" : string.Empty);
    }
}
