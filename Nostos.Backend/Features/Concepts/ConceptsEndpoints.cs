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
      // FIX: Step 1 - Select into an anonymous type that EF Core can translate to SQL
      var rawData = await db.Concepts
              .Select(c => new
            {
              c.Id,
              Name = c.Concept,
              UsageCount = c.NoteConcepts.Count()
            })
              .OrderByDescending(x => x.UsageCount)
              .ThenBy(x => x.Name)
              .ToListAsync();

      // FIX: Step 2 - Map to your DTO in memory
      var dtos = rawData.Select(x => new ConceptDto(x.Id, x.Name, x.UsageCount));

      return Results.Ok(dtos);
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
                  nc.Note.Book?.Title ?? "Unknown Book" // Safe null check
              ))
              .ToList();

      return Results.Ok(new ConceptDetailDto(concept.Id, concept.Concept, notes));
    });

    return routes;
  }
}
