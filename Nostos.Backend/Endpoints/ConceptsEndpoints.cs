using Nostos.Backend.Data.Interfaces;
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
                        nc.Note.Book?.Title ?? "Unknown Book"
                    ))
                    .ToList();

                return Results.Ok(new ConceptDetailDto(concept.Id, concept.Concept, notes));
            }
        );

        return routes;
    }
}
