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

    // GET all collections (Tree Structure)
    group.MapGet("/", async (NostosDbContext db) =>
    {
      // STRATEGY: Load ALL collections into memory.
      // EF Core's "Relationship Fix-up" will automatically populate the .Children list
      // for every entity without needing recursive includes.
      var allCollections = await db.Collections.ToListAsync();

      // Filter for roots (no parent) and convert to recursive DTOs
      var roots = allCollections
          .Where(c => c.ParentId == null)
          .Select(c => c.ToDto());

      return Results.Ok(roots);
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

      // ToModel now handles ParentId mapping
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

      // Apply now handles renaming AND moving (ParentId changes)
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
      // Note: This only unlinks books directly in THIS collection.
      // Books in sub-collections will remain in those sub-collections
      // (which will be deleted by cascade below).
      var booksInCollection = await db.Books.Where(b => b.CollectionId == id).ToListAsync();
      foreach (var book in booksInCollection)
      {
        book.CollectionId = null;
      }

      // 2. Now delete the collection.
      // If your DB has Cascade Delete on the Self-Referencing ParentId,
      // this will also delete all child folders automatically.
      db.Collections.Remove(existing);

      await db.SaveChangesAsync();

      return Results.NoContent();
    });

    return group;
  }
}
