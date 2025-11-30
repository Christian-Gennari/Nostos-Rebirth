using System;

namespace Nostos.Shared.Dtos;

public record BookDto(
    Guid Id,
    string Title,
    string? Subtitle,
    string? Author,
    string? Description,
    string? Isbn,
    string? Publisher,
    string? PublishedDate,
    int? PageCount,
    string? Language,
    string? Categories,
    string? Series,
    string? VolumeNumber,
    DateTime CreatedAt,
    bool HasFile,
    string? FileName,
    string? CoverUrl,
    Guid? CollectionId
);

public record CreateBookDto(
    string Title,
    string? Subtitle,
    string? Author,
    string? Description,
    string? Isbn,
    string? Publisher,
    string? PublishedDate,
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
    string? Publisher,
    string? PublishedDate,
    int? PageCount,
    string? Language,
    string? Categories,
    string? Series,
    string? VolumeNumber,
    Guid? CollectionId
);
