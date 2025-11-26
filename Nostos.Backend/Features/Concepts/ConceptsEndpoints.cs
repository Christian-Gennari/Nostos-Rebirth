using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Features.Concepts;

public static class ConceptsEndpoints
{
  public static IEndpointRouteBuilder MapConceptsEndpoints(this IEndpointRouteBuilder routes)
  {
    var group = routes.MapGroup("/api/concepts");

    // GET /api/concepts
    group.MapGet("/", async (NostosDbContext db) =>
    {
      var concepts = await db.Concepts
        .OrderBy(c => c.Concept)
        .ToListAsync();

      return Results.Ok(concepts);
    });

    // GET /api/concepts/{id}
    group.MapGet("/{id}", async (Guid id, NostosDbContext db) =>
    {
      var concept = await db.Concepts.FindAsync(id);
      if (concept is null) return Results.NotFound();

      return Results.Ok(concept);
    });

    // POST /api/concepts
    group.MapPost("/", async (ConceptModel model, NostosDbContext db) =>
    {
      if (string.IsNullOrWhiteSpace(model.Concept))
      {
        return Results.BadRequest(new { error = "Concept is required." });
      }

      model.Id = Guid.NewGuid();

      db.Concepts.Add(model);
      await db.SaveChangesAsync();

      return Results.Created($"/api/concepts/{model.Id}", model);
    });

    // PUT /api/concepts/{id}
    group.MapPut("/{id}", async (Guid id, ConceptModel update, NostosDbContext db) =>
    {
      var existing = await db.Concepts.FindAsync(id);
      if (existing is null) return Results.NotFound();

      if (string.IsNullOrWhiteSpace(update.Concept))
      {
        return Results.BadRequest(new { error = "Concept is required." });
      }

      existing.Concept = update.Concept;

      await db.SaveChangesAsync();
      return Results.Ok(existing);
    });

    // DELETE /api/concepts/{id}
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
