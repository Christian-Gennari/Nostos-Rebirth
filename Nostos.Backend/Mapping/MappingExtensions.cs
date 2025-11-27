using Nostos.Backend.Data.Models;
using Nostos.Shared.Dtos;

namespace Nostos.Backend.Mapping;

public static class MappingExtensions
{
    // ------------------------------
    // Read mappings (Model → DTO)
    // ------------------------------
    public static BookDto ToDto(this BookModel model)
    {
        string? coverUrl = model.CoverFileName is null
            ? null
            : $"/api/books/{model.Id}/cover";

        return new BookDto(
            model.Id,
            model.Title,
            model.Author,
            model.CreatedAt,
            model.HasFile,
            model.FileName,
            coverUrl,
            model.CollectionId // <--- NEW: Map the relationship
        );
    }

    public static NoteDto ToDto(this NoteModel model) =>
        new(model.Id, model.BookId, model.Content);

    public static CollectionDto ToDto(this CollectionModel model) =>
        new(model.Id, model.Name);

    public static ConceptDto ToDto(this ConceptModel model) =>
        new(model.Id, model.Concept);

    // ------------------------------
    // Create mappings (Dto → Model)
    // ------------------------------
    public static BookModel ToModel(this CreateBookDto dto) =>
        new()
        {
            Id = Guid.NewGuid(),
            Title = dto.Title,
            Author = dto.Author,
            CreatedAt = DateTime.UtcNow,
            CollectionId = dto.CollectionId // <--- NEW: Map on create
        };

    public static NoteModel ToModel(this CreateNoteDto dto, Guid bookId) =>
        new()
        {
            Id = Guid.NewGuid(),
            BookId = bookId,
            Content = dto.Content
        };

    public static CollectionModel ToModel(this CreateCollectionDto dto) =>
        new()
        {
            Id = Guid.NewGuid(),
            Name = dto.Name
        };

    public static ConceptModel ToModel(this CreateConceptDto dto) =>
        new()
        {
            Id = Guid.NewGuid(),
            Concept = dto.Concept
        };

    // ------------------------------
    // Update mappings (apply fields)
    // ------------------------------
    public static void Apply(this BookModel model, UpdateBookDto dto)
    {
        model.Title = dto.Title;
        model.Author = dto.Author;
        model.CollectionId = dto.CollectionId; // <--- NEW: Map on update
    }

    public static void Apply(this CollectionModel model, UpdateCollectionDto dto)
    {
        model.Name = dto.Name;
    }

    public static void Apply(this ConceptModel model, UpdateConceptDto dto)
    {
        model.Concept = dto.Concept;
    }

    public static void Apply(this NoteModel model, UpdateNoteDto dto)
    {
        model.Content = dto.Content;
    }
}
