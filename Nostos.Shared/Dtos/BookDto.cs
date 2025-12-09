using System;

namespace Nostos.Shared.Dtos;

public record BookDto(
    string Type,
    Guid Id,
    string Title,
    string? Subtitle,
    string? Author,
    string? Translator, // <--- NEW
    string? Narrator,
    string? Description,
    string? Isbn,
    string? Asin,
    string? Duration,
    int? PageCount,
    string? Publisher,
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
    DateTime? FinishedAt
);

public record CreateBookDto(
    string Type,
    string Title,
    string? Subtitle,
    string? Author,
    string? Translator, // <--- NEW
    string? Narrator,
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
    Guid? CollectionId,
    int Rating = 0,
    bool IsFavorite = false,
    DateTime? FinishedAt = null
);

public record UpdateBookDto(
    string? Title,
    string? Subtitle,
    string? Author,
    string? Translator, // <--- NEW
    string? Narrator,
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
    Guid? CollectionId,
    int? Rating,
    bool? IsFavorite,
    DateTime? FinishedAt,
    bool? IsFinished
);

public record UpdateProgressDto(string Location, int Percentage);
