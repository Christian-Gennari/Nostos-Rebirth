using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Features.Concepts;

public static class ConceptsEndpoints
{
  public static IEndpointRouteBuilder MapConceptsEndpoints(this IEndpointRouteBuilder routes)
  {
    var group = routes.MapGroup("/api/concepts");

    // GET all concepts (The Index)
    group.MapGet("/", async (NostosDbContext db) =>
    {
      var concepts = await db.Concepts
              .Select(c => new ConceptDto(
                  c.Id,
                  c.Concept,
                  c.NoteConcepts.Count()))
              .OrderByDescending(c => c.UsageCount)
              .ThenBy(c => c.Name)
              .ToListAsync();

      return Results.Ok(concepts);
    });

    // GET single concept details (The Context)
    group.MapGet("/{id}", async (Guid id, NostosDbContext db) =>
    {
      var concept = await db.Concepts
              .Include(c => c.NoteConcepts)
              .ThenInclude(nc => nc.Note)
              .ThenInclude(n => n.Book)
              .FirstOrDefaultAsync(c => c.Id == id);

      if (concept is null) return Results.NotFound();

      var notes = concept.NoteConcepts
              .Select(nc => new NoteContextDto(
                  nc.NoteId,
                  nc.Note.Content,
                  nc.Note.BookId,
                  nc.Note.Book!.Title // Access via navigation
              ))
              .ToList();

      return Results.Ok(new ConceptDetailDto(concept.Id, concept.Concept, notes));
    });

    return routes;
  }
}
