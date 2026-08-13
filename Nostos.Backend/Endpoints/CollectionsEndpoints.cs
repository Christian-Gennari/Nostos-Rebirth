using Nostos.Backend.Services.Library;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Endpoints;

public static class CollectionsEndpoints
{
    public static IEndpointRouteBuilder MapCollectionsEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/collections");

        // GET: Fetch all collections (FLAT)
        group.MapGet(
            "/",
            async (ILibraryService library, CancellationToken ct) =>
            {
                var result = await library.ListCollectionsAsync(ct);
                return LibraryHttpMapper.MapError(result) ?? Results.Ok(result.Data);
            }
        );

        // GET one collection
        group.MapGet(
            "/{id}",
            async (Guid id, ILibraryService library, CancellationToken ct) =>
            {
                var result = await library.GetCollectionAsync(id, ct);
                return LibraryHttpMapper.MapError(result) ?? Results.Ok(result.Data);
            }
        );

        // CREATE collection (duplicate sibling name returns the existing
        // collection, mirroring the canonical service contract)
        group.MapPost(
            "/",
            async (CreateCollectionDto dto, ILibraryService library, CancellationToken ct) =>
            {
                var request = new LibraryCreateCollectionRequest(
                    "rest", $"rest-collection-create-{Guid.NewGuid():N}",
                    dto.Name, dto.ParentId);

                var result = await library.CreateCollectionAsync(request, ct);
                if (LibraryHttpMapper.MapError(result) is { } error)
                    return error;

                var collection = (CollectionDto)result.Data!;
                return Results.Created($"/api/collections/{collection.Id}", collection);
            }
        );

        // UPDATE collection (name and/or parent; canonical service performs
        // sibling-collision and cycle detection)
        group.MapPut(
            "/{id}",
            async (Guid id, UpdateCollectionDto dto, ILibraryService library, CancellationToken ct) =>
            {
                var current = await library.GetCollectionAsync(id, ct);
                if (LibraryHttpMapper.MapError(current) is { } notFound)
                    return notFound;

                var before = (CollectionDto)current.Data!;

                if (before.ParentId != dto.ParentId)
                {
                    var moved = await library.MoveCollectionAsync(new LibraryMoveCollectionRequest(
                        "rest", $"rest-collection-move-{Guid.NewGuid():N}", id, dto.ParentId), ct);
                    if (LibraryHttpMapper.MapError(moved) is { } moveError)
                        return moveError;
                }

                if (!string.Equals(before.Name, dto.Name, StringComparison.Ordinal))
                {
                    var renamed = await library.RenameCollectionAsync(new LibraryRenameCollectionRequest(
                        "rest", $"rest-collection-rename-{Guid.NewGuid():N}", id, dto.Name), ct);
                    if (LibraryHttpMapper.MapError(renamed) is { } renameError)
                        return renameError;
                }

                var after = await library.GetCollectionAsync(id, ct);
                return LibraryHttpMapper.MapError(after) ?? Results.Ok(after.Data);
            }
        );

        // DELETE collection (books are unlinked, never deleted; children must
        // be moved/deleted first)
        group.MapDelete(
            "/{id}",
            async (Guid id, ILibraryService library, CancellationToken ct) =>
            {
                var result = await library.DeleteCollectionAsync(new LibraryDeleteCollectionRequest(
                    "rest", $"rest-collection-delete-{Guid.NewGuid():N}", id, Confirm: true), ct);

                return LibraryHttpMapper.MapError(result) ?? Results.NoContent();
            }
        );

        return routes;
    }
}
