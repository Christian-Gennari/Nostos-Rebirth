using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Data.Models;

namespace Nostos.Backend.Features.Collections;

public static class CollectionsEndpoints
{
  public static IEndpointRouteBuilder MapCollectionsEndpoints(this IEndpointRouteBuilder routes)
  {
    var group = routes.MapGroup("/api/collections");

    // GET /api/collections
    group.MapGet("/", async (NostosDbContext db) =>
    {
      var collections = await db.Collections
        .OrderBy(c => c.Name)
        .ToListAsync();

      return Results.Ok(collections);
    });

    // GET /api/collections/{id}
    group.MapGet("/{id}", async (Guid id, NostosDbContext db) =>
    {
      var collection = await db.Collections.FindAsync(id);
      if (collection is null) return Results.NotFound();

      return Results.Ok(collection);
    });

    // POST /api/collections
    group.MapPost("/", async (CollectionModel model, NostosDbContext db) =>
    {
      if (string.IsNullOrWhiteSpace(model.Name))
      {
        return Results.BadRequest(new { error = "Name is required." });
      }

      model.Id = Guid.NewGuid();

      db.Collections.Add(model);
      await db.SaveChangesAsync();

      return Results.Created($"/api/collections/{model.Id}", model);
    });

    // PUT /api/collections/{id}
    group.MapPut("/{id}", async (Guid id, CollectionModel update, NostosDbContext db) =>
    {
      var existing = await db.Collections.FindAsync(id);
      if (existing is null) return Results.NotFound();

      if (string.IsNullOrWhiteSpace(update.Name))
      {
        return Results.BadRequest(new { error = "Name is required." });
      }

      existing.Name = update.Name;

      await db.SaveChangesAsync();
      return Results.Ok(existing);
    });

    // DELETE /api/collections/{id}
    group.MapDelete("/{id}", async (Guid id, NostosDbContext db) =>
    {
      var existing = await db.Collections.FindAsync(id);
      if (existing is null) return Results.NotFound();

      db.Collections.Remove(existing);
      await db.SaveChangesAsync();

      return Results.NoContent();
    });

    return routes;
  }
}
