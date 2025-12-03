using System;

namespace Nostos.Shared.Dtos;

public record BookDto(

    // Polymorphic Discriminator
    string Type, // "physical", "ebook", "audiobook"

    Guid Id,
    string Title,
    string? Subtitle,
    string? Author,
    string? Description,

    // Specific Fields (Nullable)
    string? Isbn,       // Physical & Ebook
    string? Asin,       // Audio
    string? Duration,   // Audio
    int? PageCount,     // Physical & Ebook

    string? Publisher,
    string? PublishedDate,
    string? Edition,    // <--- NEW
    string? Language,
    string? Categories,
    string? Series,
    string? VolumeNumber,
    DateTime CreatedAt,
    bool HasFile,
    string? FileName,
    string? CoverUrl,
    Guid? CollectionId,
    string? LastLocation,
    int ProgressPercent
);

public record CreateBookDto(
    string Type, // REQUIRED: Frontend must send this!
    string Title,
    string? Subtitle,
    string? Author,
    string? Description,
    string? Isbn,
    string? Asin,       // <--- NEW
    string? Duration,   // <--- NEW
    string? Publisher,
    string? PublishedDate,
    string? Edition,    // <--- NEW
    int? PageCount,
    string? Language,
    string? Categories,
    string? Series,
    string? VolumeNumber,
    Guid? CollectionId
);

public record UpdateBookDto(
    string Title,
    string? Subtitle,
    string? Author,
    string? Description,
    string? Isbn,
    string? Asin,
    string? Duration,
    string? Publisher,
    string? PublishedDate,
    string? Edition,
    int? PageCount,
    string? Language,
    string? Categories,
    string? Series,
    string? VolumeNumber,
    Guid? CollectionId
);

public record UpdateProgressDto(string Location, int Percentage);
