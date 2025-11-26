using System;

namespace Nostos.Shared.Dtos;

public record NoteDto(
    Guid Id,
    Guid BookId,
    string Content
);
