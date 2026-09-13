using Nostos.Backend.Data.Interfaces;
using Nostos.Backend.Mapping;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Endpoints;

public static class ConceptsEndpoints
{
    public static IEndpointRouteBuilder MapConceptsEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/api/concepts");

        // GET all concepts (The Index)
        group.MapGet(
            "/",
            async (IConceptRepository repo) =>
            {
                var dtos = await repo.GetAllWithUsageCountAsync();
                return Results.Ok(dtos);
            }
        );

        // GET aggregate concept statistics (The Index header)
        group.MapGet(
            "/stats",
            async (IConceptRepository repo) => Results.Ok(await repo.GetStatsAsync())
        );

        // GET single concept details (The Context)
        group.MapGet(
            "/{id}",
            async (Guid id, IConceptRepository repo) =>
            {
                var concept = await repo.GetByIdWithNotesAsync(id);
                if (concept is null)
                    return Results.NotFound();

                var notes = concept
                    .NoteConcepts.Select(nc => new NoteContextDto(
                        nc.NoteId,
                        nc.Note.Content,
                        nc.Note.SelectedText,
                        nc.Note.CfiRange,
                        nc.Note.BookId,
                        nc.Note.Book?.Title ?? "Unknown Book",
                        nc.Note.CreatedAt
                    ))
                    .ToList();

                return Results.Ok(new ConceptDetailDto(concept.Id, concept.Concept, notes));
            }
        );

        // GET concepts that co-occur with this concept in notes
        group.MapGet(
            "/{id}/related",
            async (Guid id, IConceptRepository repo) => Results.Ok(await repo.GetRelatedAsync(id))
        );

        // UPDATE name, merging into an existing concept with the same name
        group.MapPut(
            "/{id}",
            async (Guid id, UpdateConceptDto dto, IConceptRepository repo) =>
            {
                if (string.IsNullOrWhiteSpace(dto.Concept))
                    return Results.BadRequest(new { error = "Concept name cannot be empty." });

                var concept = await repo.RenameAsync(id, dto.Concept.Trim());
                return concept is null
                    ? Results.NotFound()
                    : Results.Ok(concept.ToDto());
            }
        );

        // MERGE one concept into another
        group.MapPost(
            "/{id}/merge",
            async (Guid id, MergeConceptDto dto, IConceptRepository repo) =>
            {
                if (id == dto.TargetId)
                    return Results.BadRequest(new { error = "A concept cannot be merged into itself." });

                var concept = await repo.MergeAsync(id, dto.TargetId);
                return concept is null
                    ? Results.NotFound()
                    : Results.Ok(concept.ToDto());
            }
        );

        group.MapDelete(
            "/{id}",
            async (Guid id, IConceptRepository repo) =>
                await DeleteConceptAsync(id, repo)
        );

        return routes;
    }

    /// <summary>
    /// Deletes a concept and its note links. The concept will be re-created
    /// the next time a note containing [[Name]] is saved; that is expected.
    /// </summary>
    private static async Task<IResult> DeleteConceptAsync(Guid id, IConceptRepository repo)
    {
        return await repo.DeleteAsync(id) ? Results.NoContent() : Results.NotFound();
    }
}
