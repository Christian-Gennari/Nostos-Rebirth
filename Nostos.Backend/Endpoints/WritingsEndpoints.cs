using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Data.Models;
using Nostos.Backend.Mapping;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Endpoints;

public static class WritingsEndpoints
{
    public static IEndpointRouteBuilder MapWritingsEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/writings");

        // GET: Fetch the entire file list (FLAT)
        group.MapGet(
            "/",
            async (IWritingRepository repo) =>
            {
                var items = await repo.GetAllAsync();
                var dtos = items.Select(w => new WritingDto(
                    w.Id,
                    w.Name,
                    w.Type.ToString(),
                    w.ParentId,
                    w.UpdatedAt
                ));
                return Results.Ok(dtos);
            }
        );

        // GET: Fetch a single document (with Content)
        group.MapGet(
            "/{id}",
            async (Guid id, IWritingRepository repo) =>
            {
                var item = await repo.GetByIdAsync(id);
                if (item is null)
                    return Results.NotFound();

                return Results.Ok(item.ToContentDto());
            }
        );

        // POST: Create new Folder or Document
        group.MapPost(
            "/",
            async (CreateWritingDto dto, IWritingRepository repo) =>
            {
                if (!Enum.TryParse<WritingType>(dto.Type, true, out var type))
                {
                    return Results.BadRequest("Invalid type. Must be 'Folder' or 'Document'.");
                }

                var model = new WritingModel
                {
                    Name = dto.Name,
                    Type = type,
                    ParentId = dto.ParentId,
                };

                await repo.AddAsync(model);

                return Results.Created($"/api/writings/{model.Id}", model.ToDto());
            }
        );

        // PUT: Update Name or Content (Auto-save)
        group.MapPut(
            "/{id}",
            async (Guid id, UpdateWritingDto dto, IWritingRepository repo) =>
            {
                var item = await repo.GetByIdAsync(id);
                if (item is null)
                    return Results.NotFound();

                item.Name = dto.Name;
                item.Content = dto.Content;
                item.UpdatedAt = DateTime.UtcNow;

                await repo.UpdateAsync(item);

                return Results.Ok(item.ToContentDto());
            }
        );

        // PUT: Move (Drag & Drop)
        group.MapPut(
            "/{id}/move",
            async (Guid id, MoveWritingDto dto, IWritingRepository repo) =>
            {
                var item = await repo.GetByIdAsync(id);
                if (item is null)
                    return Results.NotFound();

                // --- CYCLE DETECTION START ---
                if (dto.NewParentId.HasValue)
                {
                    if (dto.NewParentId == id)
                        return Results.BadRequest("Cannot move a folder into itself.");

                    var currentAncestorId = dto.NewParentId;
                    while (currentAncestorId != null)
                    {
                        if (currentAncestorId == id)
                            return Results.BadRequest(
                                "Cannot move a folder into its own descendant."
                            );

                        currentAncestorId = await repo.GetParentIdAsync(currentAncestorId.Value);
                    }
                }
                // --- CYCLE DETECTION END ---

                item.ParentId = dto.NewParentId;
                item.UpdatedAt = DateTime.UtcNow;

                await repo.UpdateAsync(item);

                return Results.Ok(item.ToDto());
            }
        );

        // DELETE
        group.MapDelete(
            "/{id}",
            async (Guid id, IWritingRepository repo) =>
            {
                var item = await repo.GetByIdAsync(id);
                if (item is null)
                    return Results.NotFound();

                await repo.DeleteAsync(item);

                return Results.NoContent();
            }
        );

        return routes;
    }
}
