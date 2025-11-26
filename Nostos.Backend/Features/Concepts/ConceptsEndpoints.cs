using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Mapping;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Features.Concepts;

public static class ConceptsEndpoints
{
  public static IEndpointRouteBuilder MapConceptsEndpoints(this IEndpointRouteBuilder routes)
  {
    var group = routes.MapGroup("/api/concepts");

    group.MapGet("/", async (NostosDbContext db) =>
    {
      var list = await db.Concepts
              .OrderBy(x => x.Concept)
              .ToListAsync();

      return Results.Ok(list.Select(c => c.ToDto()));
    });

    group.MapGet("/{id}", async (Guid id, NostosDbContext db) =>
    {
      var concept = await db.Concepts.FindAsync(id);
      if (concept is null) return Results.NotFound();

      return Results.Ok(concept.ToDto());
    });

    group.MapPost("/", async (ConceptModel model, NostosDbContext db) =>
    {
      if (string.IsNullOrWhiteSpace(model.Concept))
        return Results.BadRequest(new { error = "Concept is required." });

      model.Id = Guid.NewGuid();

      db.Concepts.Add(model);
      await db.SaveChangesAsync();

      return Results.Created($"/api/concepts/{model.Id}", model.ToDto());
    });

    group.MapPut("/{id}", async (Guid id, ConceptModel update, NostosDbContext db) =>
    {
      var existing = await db.Concepts.FindAsync(id);
      if (existing is null) return Results.NotFound();

      if (string.IsNullOrWhiteSpace(update.Concept))
        return Results.BadRequest(new { error = "Concept is required." });

      existing.Concept = update.Concept;

      await db.SaveChangesAsync();
      return Results.Ok(existing.ToDto());
    });

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
