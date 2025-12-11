using System;

namespace Nostos.Shared.Dtos;

public record BookDto(
    string Type,
    Guid Id,
    string Title,
    string? Subtitle,
    string? Author,
    string? Editor,             // <--- NEW: Harvard "Edited by"
    string? Translator,
    string? Narrator,
    string? Description,
    string? Isbn,
    string? Asin,
    string? Duration,
    int? PageCount,
    string? Publisher,
    string? PlaceOfPublication, // <--- NEW: Harvard "Place: Publisher"
    string? PublishedDate,
    string? Edition,
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
    int ProgressPercent,
    int Rating,
    bool IsFavorite,
    string? PersonalReview,     // <--- NEW: Your review
    DateTime? LastReadAt,  // <--- NEW: last read time
    DateTime? FinishedAt
);

public record CreateBookDto(
    string Type,
    string Title,
    string? Subtitle,
    string? Author,
    string? Editor,             // <--- NEW
    string? Translator,
    string? Narrator,
    string? Description,
    string? Isbn,
    string? Asin,
    string? Duration,
    string? Publisher,
    string? PlaceOfPublication, // <--- NEW
    string? PublishedDate,
    string? Edition,
    int? PageCount,
    string? Language,
    string? Categories,
    string? Series,
    string? VolumeNumber,
    Guid? CollectionId,
    int Rating = 0,
    bool IsFavorite = false,
    string? PersonalReview = null, // <--- NEW
    DateTime? FinishedAt = null
);

public record UpdateBookDto(
    string? Title,
    string? Subtitle,
    string? Author,
    string? Editor,             // <--- NEW
    string? Translator,
    string? Narrator,
    string? Description,
    string? Isbn,
    string? Asin,
    string? Duration,
    string? Publisher,
    string? PlaceOfPublication, // <--- NEW
    string? PublishedDate,
    string? Edition,
    int? PageCount,
    string? Language,
    string? Categories,
    string? Series,
    string? VolumeNumber,
    Guid? CollectionId,
    int? Rating,
    bool? IsFavorite,
    string? PersonalReview,     // <--- NEW
    DateTime? FinishedAt,
    bool? IsFinished
);

public record UpdateProgressDto(string Location, int Percentage);
