using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Mapping;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Features.Concepts;

public static class ConceptsEndpoints
{
  public static IEndpointRouteBuilder MapConceptsEndpoints(this IEndpointRouteBuilder routes)
  {
    var group = routes.MapGroup("/api/concepts");

    // GET all concepts
    group.MapGet("/", async (NostosDbContext db) =>
    {
      var concepts = await db.Concepts
              .OrderBy(c => c.Concept)
              .ToListAsync();

      return Results.Ok(concepts.Select(c => c.ToDto()));
    });

    // GET one concept
    group.MapGet("/{id}", async (Guid id, NostosDbContext db) =>
    {
      var concept = await db.Concepts.FindAsync(id);
      if (concept is null) return Results.NotFound();

      return Results.Ok(concept.ToDto());
    });

    // CREATE concept
    group.MapPost("/", async (CreateConceptDto dto, NostosDbContext db) =>
    {
      if (string.IsNullOrWhiteSpace(dto.Concept))
        return Results.BadRequest(new { error = "Concept is required." });

      var model = dto.ToModel();

      db.Concepts.Add(model);
      await db.SaveChangesAsync();

      return Results.Created($"/api/concepts/{model.Id}", model.ToDto());
    });

    // UPDATE concept
    group.MapPut("/{id}", async (Guid id, UpdateConceptDto dto, NostosDbContext db) =>
    {
      var existing = await db.Concepts.FindAsync(id);
      if (existing is null) return Results.NotFound();

      if (string.IsNullOrWhiteSpace(dto.Concept))
        return Results.BadRequest(new { error = "Concept is required." });

      existing.Apply(dto);
      await db.SaveChangesAsync();

      return Results.Ok(existing.ToDto());
    });

    // DELETE concept
    group.MapDelete("/{id}", async (Guid id, NostosDbContext db) =>
    {
      var existing = await db.Concepts.FindAsync(id);
      if (existing is null) return Results.NotFound();

      db.Concepts.Remove(existing);
      await db.SaveChangesAsync();

      return Results.NoContent();
    });

    return routes;
  }
}
