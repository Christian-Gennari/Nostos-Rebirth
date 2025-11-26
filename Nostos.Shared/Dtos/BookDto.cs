using System;

namespace Nostos.Shared.Dtos;

public record BookDto(
    Guid Id,
    string Title,
    string? Author,
    DateTime CreatedAt,
    bool HasFile,
    string? FileName,
    string? CoverUrl
);

public record CreateBookDto(string Title, string? Author);
public record UpdateBookDto(string Title, string? Author);

