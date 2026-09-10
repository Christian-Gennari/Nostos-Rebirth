using System;
using System.Collections.Generic;

namespace Nostos.Shared.Dtos;

public record PaginatedResponse<T>(IEnumerable<T> Items, int TotalCount, int Page, int PageSize);

public record LibraryStatusCountsDto(
    int All,
    int NotStarted,
    int Reading,
    int Favorites,
    int Finished,
    int Unsorted);

public record BookChapterDto(string Title, double StartTime);

// Separate DTO for the heavy locations JSON to avoid bloating the main list
public record BookLocationsDto(string Locations);

public record EditionSummaryDto(
    Guid Id,
    string Type,
    string? Format,
    int ProgressPercent,
    DateTime? FinishedAt,
    DateTime? LastReadAt,
    bool HasFile,
    string? FileName,
    string? Narrator,
    string? Duration,
    string? Edition
);

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
    IEnumerable<BookChapterDto>? Chapters,
    Guid? WorkId = null,
    int EditionCount = 1,
    IEnumerable<EditionSummaryDto>? OtherEditions = null
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
