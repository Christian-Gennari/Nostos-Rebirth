using Microsoft.EntityFrameworkCore;
using Nostos.Backend.Data;
using Nostos.Backend.Mapping;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Features.Collections;

public static class CollectionsEndpoints
{
  public static IEndpointRouteBuilder MapCollectionsEndpoints(this IEndpointRouteBuilder routes)
  {
    var group = routes.MapGroup("/api/collections");

    // GET all collections
    group.MapGet("/", async (NostosDbContext db) =>
    {
      var collections = await db.Collections
              .OrderBy(c => c.Name)
              .ToListAsync();

      return Results.Ok(collections.Select(c => c.ToDto()));
    });

    // GET one collection
    group.MapGet("/{id}", async (Guid id, NostosDbContext db) =>
    {
      var collection = await db.Collections.FindAsync(id);
      if (collection is null) return Results.NotFound();

      return Results.Ok(collection.ToDto());
    });

    // CREATE collection
    group.MapPost("/", async (CreateCollectionDto dto, NostosDbContext db) =>
    {
      if (string.IsNullOrWhiteSpace(dto.Name))
        return Results.BadRequest(new { error = "Name is required." });

      var model = dto.ToModel();

      db.Collections.Add(model);
      await db.SaveChangesAsync();

      return Results.Created($"/api/collections/{model.Id}", model.ToDto());
    });

    // UPDATE collection
    group.MapPut("/{id}", async (Guid id, UpdateCollectionDto dto, NostosDbContext db) =>
    {
      var existing = await db.Collections.FindAsync(id);
      if (existing is null) return Results.NotFound();

      if (string.IsNullOrWhiteSpace(dto.Name))
        return Results.BadRequest(new { error = "Name is required." });

      existing.Apply(dto);
      await db.SaveChangesAsync();

      return Results.Ok(existing.ToDto());
    });

    // DELETE collection
    group.MapDelete("/{id}", async (Guid id, NostosDbContext db) =>
    {
      var existing = await db.Collections.FindAsync(id);
      if (existing is null) return Results.NotFound();

      // 1. Unlink all books first (Set their CollectionId to null)
      var booksInCollection = await db.Books.Where(b => b.CollectionId == id).ToListAsync();
      foreach (var book in booksInCollection)
      {
        book.CollectionId = null;
      }

      // 2. Now delete the collection
      db.Collections.Remove(existing);

      await db.SaveChangesAsync();

      return Results.NoContent();
    });

    return group;
  }
}
