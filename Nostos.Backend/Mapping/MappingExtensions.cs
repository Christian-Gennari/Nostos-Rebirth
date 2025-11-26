using Nostos.Backend.Data.Models;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Mapping;

public static class MappingExtensions
{
    // BOOKS
    public static BookDto ToDto(this BookModel model) =>
        new(model.Id, model.Title, model.Author, model.CreatedAt);

    // NOTES
    public static NoteDto ToDto(this NoteModel model) =>
        new(model.Id, model.BookId, model.Content);

    // COLLECTIONS
    public static CollectionDto ToDto(this CollectionModel model) =>
        new(model.Id, model.Name);

    // CONCEPTS
    public static ConceptDto ToDto(this ConceptModel model) =>
        new(model.Id, model.Concept);
}
