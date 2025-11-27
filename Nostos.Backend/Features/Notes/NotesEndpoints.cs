using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Mapping;
using Nostos.Shared.Dtos;
using System.Text.RegularExpressions;
using Nostos.Backend.Data.Models;

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
      await db.SaveChangesAsync(); // Save first to get ID

      // Process [[Concepts]]
      await ProcessConcepts(db, model);

      return Results.Created($"/api/notes/{model.Id}", model.ToDto());
    });

    // UPDATE note
    group.MapPut("/notes/{id}", async (Guid id, UpdateNoteDto dto, NostosDbContext db) =>
    {
      var existing = await db.Notes
          .Include(n => n.NoteConcepts) // Include existing links to clear them if needed
          .FirstOrDefaultAsync(n => n.Id == id);

      if (existing is null) return Results.NotFound();

      existing.Apply(dto);
      await db.SaveChangesAsync();

      // Reprocess [[Concepts]]
      await ProcessConcepts(db, existing);

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

  // --- THE BRAIN: Concept Extraction Logic ---
  private static async Task ProcessConcepts(NostosDbContext db, NoteModel note)
  {
    // 1. Parse content for [[Concept Name]]
    // Regex matches anything inside [[...]]
    var regex = new Regex(@"\[\[(.*?)\]\]");
    var matches = regex.Matches(note.Content);

    var foundNames = matches.Select(m => m.Groups[1].Value.Trim())
                            .Where(s => !string.IsNullOrEmpty(s))
                            .Distinct(StringComparer.OrdinalIgnoreCase)
                            .ToList();

    // If no concepts found, ensure we clear old links (if any) and return
    if (!foundNames.Any())
    {
      // Optional: Clear existing links if the user removed all tags
      var oldLinks = await db.NoteConcepts.Where(nc => nc.NoteId == note.Id).ToListAsync();
      if (oldLinks.Any())
      {
        db.NoteConcepts.RemoveRange(oldLinks);
        await db.SaveChangesAsync();
      }
      return;
    }

    // 2. Find existing concepts in DB
    var existingConcepts = await db.Concepts
        .Where(c => foundNames.Contains(c.Concept))
        .ToListAsync();

    // 3. Create missing concepts
    var newConcepts = foundNames
        .Except(existingConcepts.Select(c => c.Concept), StringComparer.OrdinalIgnoreCase)
        .Select(name => new ConceptModel { Concept = name })
        .ToList();

    if (newConcepts.Any())
    {
      db.Concepts.AddRange(newConcepts);
      await db.SaveChangesAsync(); // Save to generate IDs
    }

    // 4. Sync Links (Naive approach: Remove all old, add all new)
    var allRelevantConcepts = existingConcepts.Concat(newConcepts).ToList();

    // Remove old links for this note
    var currentLinks = await db.NoteConcepts.Where(nc => nc.NoteId == note.Id).ToListAsync();
    db.NoteConcepts.RemoveRange(currentLinks);

    // Add new links
    foreach (var concept in allRelevantConcepts)
    {
      db.NoteConcepts.Add(new NoteConceptModel
      {
        NoteId = note.Id,
        ConceptId = concept.Id
      });
    }

    await db.SaveChangesAsync();
  }
}
