using System;
using System.Collections.Generic; // Added for IEnumerable

namespace Nostos.Shared.Dtos;

// --- NEW: Generic Pagination Wrapper ---
public record PaginatedResponse<T>(IEnumerable<T> Items, int TotalCount, int Page, int PageSize);

public record BookChapterDto(string Title, double StartTime);

// Separate DTO for the heavy locations JSON to avoid bloating the main list
public record BookLocationsDto(string Locations);

public record BookDto(
    string Type,
    Guid Id,
    string Title,
    string? Subtitle,
    string? Author,
    string? Editor,
    string? Translator,
    string? Narrator,
    string? Description,
    string? Isbn,
    string? Asin,
    string? Duration,
    int? PageCount,
    string? Publisher,
    string? PlaceOfPublication,
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
    string? PersonalReview,
    DateTime? LastReadAt,
    DateTime? FinishedAt,
    IEnumerable<BookChapterDto>? Chapters // <--- Add this
);

public record CreateBookDto(
    string Type,
    string Title,
    string? Subtitle,
    string? Author,
    string? Editor,
    string? Translator,
    string? Narrator,
    string? Description,
    string? Isbn,
    string? Asin,
    string? Duration,
    string? Publisher,
    string? PlaceOfPublication,
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
    string? PersonalReview = null,
    DateTime? FinishedAt = null
);

public record UpdateBookDto(
    string? Title,
    string? Subtitle,
    string? Author,
    string? Editor,
    string? Translator,
    string? Narrator,
    string? Description,
    string? Isbn,
    string? Asin,
    string? Duration,
    string? Publisher,
    string? PlaceOfPublication,
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
    string? PersonalReview,
    DateTime? FinishedAt,
    bool? IsFinished
);

public record UpdateProgressDto(string Location, int Percentage);
