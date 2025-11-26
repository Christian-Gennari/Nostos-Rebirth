using System;

namespace Nostos.Shared.Dtos;

public record BookDto(
    Guid Id,
    string Title,
    string? Author,
    DateTime CreatedAt
);

