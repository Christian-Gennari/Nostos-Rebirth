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

        // Default values for polymorphic fields
        string type = "physical";
        string? isbn = null;
        string? asin = null;
        string? duration = null;
        int? pageCount = null;

        // Pattern Matching: Extract fields based on the specific subclass
        switch (model)
        {
            case PhysicalBookModel p:
                type = "physical";
                isbn = p.Isbn;
                pageCount = p.PageCount;
                break;
            case EBookModel e:
                type = "ebook";
                isbn = e.Isbn;
                pageCount = e.PageCount;
                break;
            case AudioBookModel a:
                type = "audiobook";
                asin = a.Asin;
                duration = a.Duration;
                break;
        }

        // Use Named Arguments to prevent argument order mismatches
        return new BookDto(
            Id: model.Id,
            Title: model.Title,
            Subtitle: model.Subtitle,
            Author: model.Author,
            Description: model.Description,

            // Polymorphic Fields
            Type: type,
            Isbn: isbn,
            Asin: asin,
            Duration: duration,

            Publisher: model.Publisher,
            PublishedDate: model.PublishedDate,
            Edition: model.Edition,
            PageCount: pageCount,
            Language: model.Language,
            Categories: model.Categories,
            Series: model.Series,
            VolumeNumber: model.VolumeNumber,

            CreatedAt: model.CreatedAt,
            HasFile: model.HasFile,
            FileName: model.FileName,
            CoverUrl: coverUrl,
            CollectionId: model.CollectionId,

            // Reading Progress
            LastLocation: model.LastLocation,
            ProgressPercent: model.ProgressPercent
        );
    }

    public static NoteDto ToDto(this NoteModel model) =>
            new NoteDto(
                Id: model.Id,
                BookId: model.BookId,
                Content: model.Content,
                CfiRange: model.CfiRange,
                SelectedText: model.SelectedText,
                CreatedAt: model.CreatedAt
            );

    public static CollectionDto ToDto(this CollectionModel model) =>
        new CollectionDto(model.Id, model.Name);

    public static ConceptDto ToDto(this ConceptModel model) =>
        new ConceptDto(
            model.Id,
            model.Concept,
            model.NoteConcepts?.Count ?? 0
        );

    // 👇 NEW: Writing Studio Mappings
    public static WritingDto ToDto(this WritingModel model)
    {
        return new WritingDto(
            model.Id,
            model.Name,
            model.Type.ToString(), // Convert Enum to String for DTO
            model.ParentId,
            model.UpdatedAt,
            // Recursive mapping for the tree structure
            model.Children.Select(c => c.ToDto()).ToList()
        );
    }

    public static WritingContentDto ToContentDto(this WritingModel model)
    {
        return new WritingContentDto(
            model.Id,
            model.Name,
            model.Content ?? string.Empty,
            model.UpdatedAt
        );
    }

    // ------------------------------
    // Create mappings (Dto → Model)
    // ------------------------------
    public static BookModel ToModel(this CreateBookDto dto)
    {
        // Factory Pattern: Create the correct subclass based on the "Type" string
        BookModel model = dto.Type?.ToLower() switch
        {
            "audiobook" => new AudioBookModel
            {
                Asin = dto.Asin,
                Duration = dto.Duration
            },
            "ebook" => new EBookModel
            {
                Isbn = dto.Isbn,
                PageCount = dto.PageCount
            },
            _ => new PhysicalBookModel // Default fallback
            {
                Isbn = dto.Isbn,
                PageCount = dto.PageCount
            }
        };

        // Map Shared Fields
        model.Id = Guid.NewGuid();
        model.Title = dto.Title;
        model.Subtitle = dto.Subtitle;
        model.Author = dto.Author;
        model.Description = dto.Description;
        model.Publisher = dto.Publisher;
        model.PublishedDate = dto.PublishedDate;
        model.Edition = dto.Edition;
        model.Language = dto.Language;
        model.Categories = dto.Categories;
        model.Series = dto.Series;
        model.VolumeNumber = dto.VolumeNumber;
        model.CreatedAt = DateTime.UtcNow;
        model.CollectionId = dto.CollectionId;

        return model;
    }

    public static NoteModel ToModel(this CreateNoteDto dto, Guid bookId) =>
        new NoteModel
        {
            Id = Guid.NewGuid(),
            BookId = bookId,
            Content = dto.Content,
            CfiRange = dto.CfiRange,
            SelectedText = dto.SelectedText
        };

    public static CollectionModel ToModel(this CreateCollectionDto dto) =>
        new CollectionModel
        {
            Id = Guid.NewGuid(),
            Name = dto.Name
        };

    public static ConceptModel ToModel(this CreateConceptDto dto) =>
        new ConceptModel
        {
            Id = Guid.NewGuid(),
            Concept = dto.Concept
        };

    // ------------------------------
    // Update mappings (Apply fields)
    // ------------------------------
    public static void Apply(this BookModel model, UpdateBookDto dto)
    {
        // 1. Apply Common Fields
        model.Title = dto.Title;
        model.Subtitle = dto.Subtitle;
        model.Author = dto.Author;
        model.Description = dto.Description;
        model.Publisher = dto.Publisher;
        model.PublishedDate = dto.PublishedDate;
        model.Edition = dto.Edition;
        model.Language = dto.Language;
        model.Categories = dto.Categories;
        model.Series = dto.Series;
        model.VolumeNumber = dto.VolumeNumber;
        model.CollectionId = dto.CollectionId;

        // 2. Apply Specific Fields (Pattern Matching)
        switch (model)
        {
            case PhysicalBookModel p:
                p.Isbn = dto.Isbn;
                p.PageCount = dto.PageCount;
                break;
            case EBookModel e:
                e.Isbn = dto.Isbn;
                e.PageCount = dto.PageCount;
                break;
            case AudioBookModel a:
                a.Asin = dto.Asin;
                a.Duration = dto.Duration;
                break;
        }
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
