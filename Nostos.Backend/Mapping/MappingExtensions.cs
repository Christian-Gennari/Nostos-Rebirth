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
            Translator: model.Translator, // <--- NEW FIELD
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
            ProgressPercent: model.ProgressPercent,

            // NEW FIELDS
            Rating: model.Rating,
            IsFavorite: model.IsFavorite,
            FinishedAt: model.FinishedAt
        );
    }

    public static NoteDto ToDto(this NoteModel model) =>
            new NoteDto(
                Id: model.Id,
                BookId: model.BookId,
                Content: model.Content,
                CfiRange: model.CfiRange,
                SelectedText: model.SelectedText,
                CreatedAt: model.CreatedAt,
                BookTitle: model.Book?.Title // 👈 Map the title
            );

    public static CollectionDto ToDto(this CollectionModel model) =>
        new CollectionDto(
            model.Id,
            model.Name,
            model.ParentId
        );

    public static ConceptDto ToDto(this ConceptModel model) =>
        new ConceptDto(
            model.Id,
            model.Concept,
            model.NoteConcepts?.Count ?? 0
        );

    public static WritingDto ToDto(this WritingModel model)
    {
        return new WritingDto(
            model.Id,
            model.Name,
            model.Type.ToString(), // Convert Enum to String for DTO
            model.ParentId,
            model.UpdatedAt
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
        model.Translator = dto.Translator; // <--- NEW FIELD
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

        // New Fields
        model.Rating = dto.Rating;
        model.IsFavorite = dto.IsFavorite;
        model.FinishedAt = dto.FinishedAt;

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
            Name = dto.Name,
            ParentId = dto.ParentId
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
        // 1. Apply Common Fields (ONLY IF NOT NULL to support partial updates)
        if (dto.Title != null) model.Title = dto.Title;
        if (dto.Subtitle != null) model.Subtitle = dto.Subtitle;
        if (dto.Author != null) model.Author = dto.Author;
        if (dto.Translator != null) model.Translator = dto.Translator; // <--- NEW FIELD
        if (dto.Description != null) model.Description = dto.Description;
        if (dto.Publisher != null) model.Publisher = dto.Publisher;
        if (dto.PublishedDate != null) model.PublishedDate = dto.PublishedDate;
        if (dto.Edition != null) model.Edition = dto.Edition;
        if (dto.Language != null) model.Language = dto.Language;
        if (dto.Categories != null) model.Categories = dto.Categories;
        if (dto.Series != null) model.Series = dto.Series;
        if (dto.VolumeNumber != null) model.VolumeNumber = dto.VolumeNumber;
        if (dto.CollectionId != null) model.CollectionId = dto.CollectionId;

        // NEW FIELDS: Check if nullable (HasValue or != null) to see if they were sent
        if (dto.Rating.HasValue) model.Rating = dto.Rating.Value;
        if (dto.IsFavorite.HasValue) model.IsFavorite = dto.IsFavorite.Value;

        // LOGIC FIX: Handle Finished Status
        // 1. If a specific date is provided, use it (Manual edit)
        if (dto.FinishedAt != null)
        {
            model.FinishedAt = dto.FinishedAt;
        }
        // 2. Else if the Toggle Flag is provided, use it
        else if (dto.IsFinished.HasValue)
        {
            if (dto.IsFinished.Value)
            {
                // Mark as finished (Set to Now if not already set)
                model.FinishedAt ??= DateTime.UtcNow;

                // Optional: Force progress to 100% when marking as finished
                model.ProgressPercent = 100;
            }
            else
            {
                // Mark as Unread (Clear the date)
                model.FinishedAt = null;
            }
        }

        // 2. Apply Specific Fields (Pattern Matching)
        switch (model)
        {
            case PhysicalBookModel p:
                if (dto.Isbn != null) p.Isbn = dto.Isbn;
                if (dto.PageCount != null) p.PageCount = dto.PageCount;
                break;
            case EBookModel e:
                if (dto.Isbn != null) e.Isbn = dto.Isbn;
                if (dto.PageCount != null) e.PageCount = dto.PageCount;
                break;
            case AudioBookModel a:
                if (dto.Asin != null) a.Asin = dto.Asin;
                if (dto.Duration != null) a.Duration = dto.Duration;
                break;
        }
    }

    public static void Apply(this CollectionModel model, UpdateCollectionDto dto)
    {
        model.Name = dto.Name;
        // Check if ParentId is part of the update (depends on your DTO structure)
        if (dto.ParentId != model.ParentId)
        {
            model.ParentId = dto.ParentId;
        }
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
