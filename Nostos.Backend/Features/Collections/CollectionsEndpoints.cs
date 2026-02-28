using Nostos.Backend.Data.Repositories;
using Nostos.Backend.Mapping;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Features.Collections;

public static class CollectionsEndpoints
{
  public static IEndpointRouteBuilder MapCollectionsEndpoints(this IEndpointRouteBuilder routes)
  {
    var group = routes.MapGroup("/api/collections");

    // GET: Fetch all collections (FLAT)
    group.MapGet("/", async (ICollectionRepository repo) =>
    {
      var items = await repo.GetAllAsync();
      var dtos = items.Select(c => new CollectionDto(c.Id, c.Name, c.ParentId));
      return Results.Ok(dtos);
    });

    // GET one collection
    group.MapGet("/{id}", async (Guid id, ICollectionRepository repo) =>
    {
      var collection = await repo.GetByIdAsync(id);
      if (collection is null) return Results.NotFound();

      return Results.Ok(collection.ToDto());
    });

    // CREATE collection
    group.MapPost("/", async (CreateCollectionDto dto, ICollectionRepository repo) =>
    {
      if (string.IsNullOrWhiteSpace(dto.Name))
        return Results.BadRequest(new { error = "Name is required." });

      var model = dto.ToModel();
      await repo.AddAsync(model);

      return Results.Created($"/api/collections/{model.Id}", model.ToDto());
    });

    // UPDATE collection
    group.MapPut("/{id}", async (Guid id, UpdateCollectionDto dto, ICollectionRepository repo) =>
    {
      var existing = await repo.GetByIdAsync(id);
      if (existing is null) return Results.NotFound();

      if (string.IsNullOrWhiteSpace(dto.Name))
        return Results.BadRequest(new { error = "Name is required." });

      // --- CYCLE DETECTION START ---
      if (dto.ParentId.HasValue)
      {
        if (dto.ParentId == id)
          return Results.BadRequest(new { error = "Cannot move a collection into itself." });

        var currentAncestorId = dto.ParentId;
        while (currentAncestorId != null)
        {
          if (currentAncestorId == id)
            return Results.BadRequest(new { error = "Cannot move a collection into its own child." });

          currentAncestorId = await repo.GetParentIdAsync(currentAncestorId.Value);
        }
      }
      // --- CYCLE DETECTION END ---

      existing.Apply(dto);
      await repo.UpdateAsync(existing);

      return Results.Ok(existing.ToDto());
    });

    // DELETE collection
    group.MapDelete("/{id}", async (Guid id, ICollectionRepository repo) =>
    {
      var existing = await repo.GetByIdAsync(id);
      if (existing is null) return Results.NotFound();

      await repo.UnlinkBooksAsync(id);
      await repo.DeleteAsync(existing);

      return Results.NoContent();
    });

    return group;
  }
}
