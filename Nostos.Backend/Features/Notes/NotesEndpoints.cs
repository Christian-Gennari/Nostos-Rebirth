using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Mapping;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Features.Notes;

// changed to partial to support [GeneratedRegex]
public static partial class NotesEndpoints
{
    // 1. Define the Regex using the Source Generator (Compile-time optimization)
    [GeneratedRegex(@"\[\[(.*?)\]\]", RegexOptions.Compiled)]
    private static partial Regex ConceptRegex();

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
            async (Guid bookId, CreateNoteDto dto, NostosDbContext db) =>
            {
                var model = dto.ToModel(bookId);

                db.Notes.Add(model);
                // Optimization: We don't need to save here just to get the Note ID if we trust EF's tracking,
                // but keeping it simple for now to ensure Note exists before linking concepts is fine.
                // However, we CAN batch it all. Let's try to batch it in ProcessConcepts for maximum speed.

                // To batch fully, we pass the 'model' (which is tracked) to ProcessConcepts.
                // EF Core will insert the Note, then the Concepts, then the Links in one transaction.
                await ProcessConcepts(db, model);

                await db.SaveChangesAsync(); // <--- The ONLY SaveChanges call

                // Reload to get the Book Title for the response
                var createdNote = await db
                    .Notes.AsNoTracking() // Optimization for read-only return
                    .Include(n => n.Book)
                    .FirstAsync(n => n.Id == model.Id);

                return Results.Created($"/api/notes/{model.Id}", createdNote.ToDto());
            }
        );

        // UPDATE note
        group.MapPut(
            "/notes/{id}",
            async (Guid id, UpdateNoteDto dto, NostosDbContext db) =>
            {
                var existing = await db
                    .Notes.Include(n => n.NoteConcepts)
                    .Include(n => n.Book)
                    .FirstOrDefaultAsync(n => n.Id == id);

                if (existing is null)
                    return Results.NotFound();

                existing.Apply(dto);

                // Re-eval concepts (Changes tracked in memory)
                await ProcessConcepts(db, existing);

                await db.SaveChangesAsync(); // <--- Single commit

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

                // Note: CleanupOrphanedConcepts is removed from here.
                // It will be handled by the Background Service.

                return Results.NoContent();
            }
        );

        return routes;
    }

    // --- THE BRAIN: Optimized Concept Extraction ---
    private static async Task ProcessConcepts(NostosDbContext db, NoteModel note)
    {
        // 1. Parse content using Generated Regex
        var matches = ConceptRegex().Matches(note.Content);

        var foundNames = matches
            .Select(m => m.Groups[1].Value.Trim())
            .Where(s => !string.IsNullOrEmpty(s))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        // 2. Clear existing links for this note (We rebuild them)
        // If this is an update, we might have loaded NoteConcepts. If not, load them.
        // For a new note, this list is empty.
        var currentLinks = await db.NoteConcepts.Where(nc => nc.NoteId == note.Id).ToListAsync();

        if (currentLinks.Count != 0)
        {
            db.NoteConcepts.RemoveRange(currentLinks);
        }

        if (foundNames.Count == 0)
            return;

        // 3. Find which concepts already exist in the DB
        // (SQLite defaults to case-insensitive mostly, but we ensure correctness logic)
        var existingConcepts = await db
            .Concepts.Where(c => foundNames.Contains(c.Concept))
            .ToListAsync();

        var existingNames = existingConcepts
            .Select(c => c.Concept)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        // 4. Identify new concepts to create
        // ConceptModel generates its own Guid in the constructor, so we don't need the DB to do it.
        var newConcepts = foundNames
            .Where(name => !existingNames.Contains(name))
            .Select(name => new ConceptModel { Concept = name })
            .ToList();

        if (newConcepts.Count != 0)
        {
            db.Concepts.AddRange(newConcepts); // EF Core tracks these as Added
        }

        // 5. Create the new Links
        // We combine existing entities + new entities.
        var allRelevantConcepts = existingConcepts.Concat(newConcepts);

        foreach (var concept in allRelevantConcepts)
        {
            db.NoteConcepts.Add(
                new NoteConceptModel
                {
                    Note = note, // Navigation property (handles FK automatically)
                    Concept = concept, // Navigation property (handles FK automatically)
                }
            );
        }

        // No SaveChangesAsync here! The caller handles the transaction.
    }
}
