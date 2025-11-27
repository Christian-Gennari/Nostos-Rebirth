using System;

namespace Nostos.Shared.Dtos;

public record BookDto(
    Guid Id,
    string Title,
    string? Author,
    DateTime CreatedAt,
    bool HasFile,
    string? FileName,
    string? CoverUrl,
    Guid? CollectionId // <--- NEW
);

public record CreateBookDto(string Title, string? Author, Guid? CollectionId); // <--- Updated
public record UpdateBookDto(string Title, string? Author, Guid? CollectionId); // <--- Updated
