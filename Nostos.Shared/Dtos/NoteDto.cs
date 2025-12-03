using System;

namespace Nostos.Shared.Dtos;

public record NoteDto(
    Guid Id,
    Guid BookId,
    string Content,
    string? CfiRange,
    string? SelectedText,
    DateTime CreatedAt // <--- ADD THIS
);

public record CreateNoteDto(
    string Content,
    string? CfiRange = null,
    string? SelectedText = null
);

public record UpdateNoteDto(string Content);
